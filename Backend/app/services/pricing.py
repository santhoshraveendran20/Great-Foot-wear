"""Price summary, coupon validation and GST split (CW-03, CW-04, CW-05, PY-02, PY-11).

Selling prices are GST-inclusive (CW-03 "GST included"):
    taxable = line_total * 100 / (100 + rate);  tax = line_total - taxable
Intra-state supply (delivery state == store state, or store pickup) → CGST + SGST,
otherwise IGST."""
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.models import Coupon, CouponUsage, Order, OrderStatus, ProductVariant, User
from app.services.store_settings import get_setting
from app.utils import ist_today

CENT = Decimal("0.01")
MAX_QTY_PER_SKU = 5  # CW-02


def money(value) -> Decimal:
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass
class Line:
    variant: ProductVariant
    qty: int
    unit_price: Decimal = Decimal("0")
    unit_mrp: Decimal = Decimal("0")
    discount: Decimal = Decimal("0")
    line_total: Decimal = Decimal("0")
    taxable_value: Decimal = Decimal("0")
    tax_amount: Decimal = Decimal("0")


@dataclass
class Quote:
    lines: list[Line]
    mrp_total: Decimal = Decimal("0")
    subtotal: Decimal = Decimal("0")
    discount: Decimal = Decimal("0")
    shipping: Decimal = Decimal("0")
    cod_fee: Decimal = Decimal("0")
    tax: Decimal = Decimal("0")
    total: Decimal = Decimal("0")
    coupon_code: str | None = None
    coupon_error: str | None = None
    is_inter_state: bool = False
    free_shipping_threshold: Decimal | None = None
    warnings: list[str] = field(default_factory=list)


def _completed_order_count(db: Session, user_id: int) -> int:
    return db.scalar(
        select(func.count(Order.id)).where(
            Order.user_id == user_id,
            Order.order_status.notin_([OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED]),
        )
    ) or 0


def validate_coupon(db: Session, code: str, user: User | None, lines: list[Line]) -> tuple[Coupon, Decimal, list[Line]]:
    """Returns (coupon, discount, eligible_lines) or raises HTTPException(400) with the reason."""
    coupon = db.scalar(select(Coupon).where(func.upper(Coupon.code) == code.strip().upper()))
    now = utcnow()
    if not coupon or not coupon.is_active:
        raise HTTPException(400, "Invalid coupon code")
    if coupon.valid_from and now < coupon.valid_from:
        raise HTTPException(400, "This coupon is not active yet")
    if coupon.valid_to and now > coupon.valid_to:
        raise HTTPException(400, "This coupon has expired")
    if coupon.usage_limit is not None:
        used = db.scalar(select(func.count(CouponUsage.id)).where(CouponUsage.coupon_id == coupon.id)) or 0
        if used >= coupon.usage_limit:
            raise HTTPException(400, "This coupon has reached its usage limit")
    if user is not None:
        if coupon.per_user_limit is not None:
            used_by_user = db.scalar(
                select(func.count(CouponUsage.id)).where(
                    CouponUsage.coupon_id == coupon.id, CouponUsage.user_id == user.id
                )
            ) or 0
            if used_by_user >= coupon.per_user_limit:
                raise HTTPException(400, "You have already used this coupon")
        if coupon.first_order_only and _completed_order_count(db, user.id) > 0:
            raise HTTPException(400, "This coupon is valid on your first order only")
    elif coupon.first_order_only or coupon.per_user_limit is not None:
        raise HTTPException(400, "Please log in to use this coupon")

    eligible = lines
    if coupon.product_ids or coupon.category_ids:
        pids = set(coupon.product_ids or [])
        cids = set(coupon.category_ids or [])
        eligible = [
            ln for ln in lines
            if ln.variant.product_id in pids or (ln.variant.product.category_id in cids)
        ]
        if not eligible:
            raise HTTPException(400, "This coupon is not applicable to the items in your cart")

    cart_value = sum((ln.unit_price * ln.qty for ln in lines), Decimal("0"))
    if cart_value < coupon.min_order:
        raise HTTPException(400, f"Minimum order value for this coupon is ₹{coupon.min_order:.2f}")

    eligible_value = sum((ln.unit_price * ln.qty for ln in eligible), Decimal("0"))
    if coupon.type == "percent":
        discount = eligible_value * coupon.value / Decimal("100")
    else:
        discount = coupon.value
    if coupon.max_discount is not None:
        discount = min(discount, coupon.max_discount)
    discount = money(min(discount, eligible_value))
    return coupon, discount, eligible


def build_quote(
    db: Session,
    items: list[tuple[ProductVariant, int]],
    *,
    user: User | None,
    coupon_code: str | None = None,
    fulfilment: str = "delivery",
    delivery_state: str | None = None,
    payment_method: str | None = None,
    strict_coupon: bool = False,
) -> Quote:
    lines: list[Line] = []
    for variant, qty in items:
        price = money(variant.effective_price)
        mrp = money(variant.product.mrp)
        lines.append(Line(variant=variant, qty=qty, unit_price=price, unit_mrp=mrp))

    q = Quote(lines=lines)
    q.mrp_total = money(sum((ln.unit_mrp * ln.qty for ln in lines), Decimal("0")))
    q.subtotal = money(sum((ln.unit_price * ln.qty for ln in lines), Decimal("0")))

    # coupon
    if coupon_code and lines:
        try:
            coupon, discount, eligible = validate_coupon(db, coupon_code, user, lines)
            q.coupon_code = coupon.code
            q.discount = discount
            # distribute discount across eligible lines in proportion to value
            eligible_value = sum((ln.unit_price * ln.qty for ln in eligible), Decimal("0"))
            remaining = discount
            for i, ln in enumerate(eligible):
                if i == len(eligible) - 1:
                    share = remaining
                else:
                    share = money(discount * (ln.unit_price * ln.qty) / eligible_value)
                    remaining -= share
                ln.discount = share
        except HTTPException as exc:
            if strict_coupon:
                raise
            q.coupon_error = exc.detail

    # GST split per line
    store = get_setting(db, "store")
    if fulfilment == "pickup" or not delivery_state:
        q.is_inter_state = False
    else:
        q.is_inter_state = delivery_state.strip().lower() != str(store["state"]).strip().lower()
    for ln in lines:
        ln.line_total = money(ln.unit_price * ln.qty - ln.discount)
        rate = Decimal(ln.variant.product.gst_rate or 0)
        ln.taxable_value = money(ln.line_total * Decimal("100") / (Decimal("100") + rate))
        ln.tax_amount = money(ln.line_total - ln.taxable_value)
    q.tax = money(sum((ln.tax_amount for ln in lines), Decimal("0")))

    goods_total = q.subtotal - q.discount

    # shipping (AD-14, CW-05)
    shipping = get_setting(db, "shipping")
    threshold = shipping.get("free_shipping_threshold")
    q.free_shipping_threshold = money(threshold) if threshold not in (None, "") else None
    if fulfilment == "pickup" or not lines:
        q.shipping = Decimal("0.00")
    elif q.free_shipping_threshold is not None and goods_total >= q.free_shipping_threshold:
        q.shipping = Decimal("0.00")
    else:
        q.shipping = money(shipping.get("flat_fee") or 0)

    # COD fee (PY-02)
    if payment_method == "cod":
        q.cod_fee = money(get_setting(db, "cod").get("fee") or 0)

    q.total = money(goods_total + q.shipping + q.cod_fee)
    return q


def check_pincode(db: Session, pincode: str, order_value: Decimal | None = None) -> dict:
    """CT-07: serviceability, estimated delivery date and COD availability."""
    shipping = get_setting(db, "shipping")
    cod = get_setting(db, "cod")
    serviceable_list = [str(p) for p in shipping.get("serviceable_pincodes") or []]
    serviceable = not serviceable_list or pincode in serviceable_list
    blocked = [str(p) for p in cod.get("blocked_pincodes") or []]
    cod_available = bool(cod.get("enabled")) and serviceable and pincode not in blocked
    if cod_available and order_value is not None and cod.get("max_order_value") not in (None, ""):
        cod_available = order_value <= Decimal(str(cod["max_order_value"]))
    today = ist_today()  # delivery dates count from the shop's calendar day
    dmin = int(shipping.get("delivery_days_min") or 0)
    dmax = int(shipping.get("delivery_days_max") or dmin)
    return {
        "pincode": pincode,
        "serviceable": serviceable,
        "cod_available": cod_available,
        "estimated_delivery_from": (today + timedelta(days=dmin)).isoformat() if serviceable else None,
        "estimated_delivery_to": (today + timedelta(days=dmax)).isoformat() if serviceable else None,
        "pickup_available": bool(shipping.get("pickup_enabled")),
    }


def serialize_quote(q: Quote) -> dict:
    return {
        "mrp_total": q.mrp_total,
        "subtotal": q.subtotal,
        "product_discount": money(q.mrp_total - q.subtotal),
        "coupon_discount": q.discount,
        "coupon_code": q.coupon_code,
        "coupon_error": q.coupon_error,
        "shipping": q.shipping,
        "cod_fee": q.cod_fee,
        "tax": q.tax,
        "total": q.total,
        "is_inter_state": q.is_inter_state,
        "free_shipping_threshold": q.free_shipping_threshold,
    }
