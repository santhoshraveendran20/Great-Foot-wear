"""/orders (checkout, my orders, cancel, return, invoice) and /payments
(create-order, verify, webhook) — CO-01…CO-06, OR-01…OR-06, PY-01…PY-09."""
import json
import logging
from datetime import timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.deps import get_current_user
from app.core.security import utcnow
from app.db import get_db
from app.models import (
    CouponUsage,
    Coupon,
    Order,
    OrderItem,
    OrderStatus,
    Payment,
    PaymentStatus,
    Product,
    ProductVariant,
    Refund,
    Return,
    User,
    WebhookEvent,
)
from app.routers.cart import get_cart, resolve_address
from app.schemas import CancelIn, CheckoutIn, PaymentFailedIn, PaymentVerifyIn, RefundDetailsIn
from app.serializers import address_snapshot, order_detail, order_summary, return_out
from app.services import gateway
from app.services.invoice import invoice_pdf
from app.services.media import save_image
from app.services.notify import notify_order_placed
from app.services.orders import (
    RESERVATION_MINUTES,
    _bump_sold_count,
    add_history,
    cancel_order,
    complete_gateway_refund,
    mark_paid,
    mark_payment_failed,
    order_no_for,
    reserve_stock,
    retry_reservation,
)
from app.services.pricing import build_quote, check_pincode
from app.services.store_settings import get_setting

log = logging.getLogger("gfw.payments")
router = APIRouter(tags=["orders"])
S = OrderStatus


def _order_query():
    return select(Order).options(
        selectinload(Order.items),
        selectinload(Order.history),
        selectinload(Order.payments),
        selectinload(Order.shipment),
        selectinload(Order.user),
    )


def _my_order(db: Session, user: User, order_id: int) -> Order:
    order = db.scalar(_order_query().where(Order.id == order_id))
    if not order or order.user_id != user.id:
        raise HTTPException(404, "Order not found")
    return order


def _gateway_payload(db: Session, order: Order, payment: Payment, user: User) -> dict:
    store = get_setting(db, "store")
    return {
        "key_id": gateway.key_id(db),
        "gateway_order_id": payment.gateway_order_id,
        "amount": gateway.to_paise(order.total),
        "currency": "INR",
        "name": store.get("name") or "Great Foot Wear",
        "description": f"Order {order.order_no}",
        "prefill": {"name": user.name, "email": user.email, "contact": user.mobile},
    }


def _new_gateway_payment(db: Session, order: Order) -> Payment:
    gw = gateway.create_order(db, Decimal(order.total), order.order_no, {"order_id": str(order.id)})
    payment = Payment(
        order_id=order.id, gateway="razorpay", gateway_order_id=gw["id"], amount=order.total,
        status="created", raw_response=gw,
    )
    db.add(payment)
    return payment


# ------------------------------------------------------------------ checkout

@router.post("/orders/checkout", status_code=201)
def checkout(body: CheckoutIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role != "customer":
        raise HTTPException(403, "Please use a customer account to place orders")
    if not user.is_verified:  # UM-02
        raise HTTPException(403, "Please verify your mobile number and email before placing your first order")
    cart = get_cart(db, user)
    if not cart.items:
        raise HTTPException(400, "Your cart is empty")

    # CO-03 re-validate stock and price
    problems = []
    lines = []
    for ci in cart.items:
        v = ci.variant
        if not v.is_active or not v.product.is_active:
            problems.append(f"{v.product.name} ({v.size}/{v.colour}) is no longer available")
        elif ci.qty > v.stock_qty:
            problems.append(f"{v.product.name} ({v.size}/{v.colour}): only {v.stock_qty} left")
        else:
            lines.append((v, ci.qty))
    if problems:
        raise HTTPException(409, "; ".join(problems))

    shipping_cfg = get_setting(db, "shipping")
    address = None
    if body.fulfilment == "delivery":
        address = resolve_address(db, user, body.address_id)
        if not address:
            raise HTTPException(400, "Please select a delivery address")
    elif not shipping_cfg.get("pickup_enabled"):
        raise HTTPException(400, "Store pickup is currently not available")

    quote = build_quote(
        db, lines, user=user, coupon_code=cart.coupon_code, fulfilment=body.fulfilment,
        delivery_state=address.state if address else None, payment_method=body.payment_method,
    )
    if cart.coupon_code and quote.coupon_error:
        cart.coupon_code = None
        db.commit()
        raise HTTPException(409, f"Coupon removed: {quote.coupon_error}")

    if address:
        pin = check_pincode(db, address.pincode, quote.total)
        if not pin["serviceable"]:
            raise HTTPException(400, f"Sorry, we do not deliver to PIN code {address.pincode} yet")
    if body.payment_method == "cod":
        cod = get_setting(db, "cod")
        if not cod.get("enabled"):
            raise HTTPException(400, "Cash on Delivery is not available")
        if address and not check_pincode(db, address.pincode, quote.total)["cod_available"]:
            raise HTTPException(400, "Cash on Delivery is not available for this PIN code / order value")
        if cod.get("max_order_value") not in (None, "") and quote.total > Decimal(str(cod["max_order_value"])):
            raise HTTPException(400, f"Cash on Delivery is available only up to ₹{cod['max_order_value']}")
    else:
        if not get_setting(db, "payment").get("online_enabled"):
            raise HTTPException(400, "Online payment is currently unavailable. Please choose Cash on Delivery.")
        if not gateway.is_configured(db):
            raise HTTPException(503, "Online payment is not configured. Please choose Cash on Delivery.")

    is_cod = body.payment_method == "cod"
    order = Order(
        user_id=user.id,
        fulfilment=body.fulfilment,
        address=address_snapshot(address) if address else None,
        subtotal=quote.subtotal,
        mrp_total=quote.mrp_total,
        discount=quote.discount,
        shipping=quote.shipping,
        cod_fee=quote.cod_fee,
        tax=quote.tax,
        total=quote.total,
        coupon_code=quote.coupon_code,
        payment_method=body.payment_method,
        payment_status=PaymentStatus.COD_PENDING if is_cod else PaymentStatus.PENDING,
        order_status=S.CONFIRMED if is_cod else S.PENDING_PAYMENT,
        is_inter_state=quote.is_inter_state,
        reserved_until=None if is_cod else utcnow() + timedelta(minutes=RESERVATION_MINUTES),
    )
    order.user = user
    for ln in quote.lines:
        v = ln.variant
        p = v.product
        order.items.append(OrderItem(
            variant_id=v.id, product_id=p.id, product_name=p.name, sku=v.sku, size=v.size, colour=v.colour,
            image_url=p.images[0].url if p.images else None, hsn_code=p.hsn_code, mrp=ln.unit_mrp,
            price=ln.unit_price, qty=ln.qty, discount=ln.discount, gst_rate=p.gst_rate,
            taxable_value=ln.taxable_value, tax_amount=ln.tax_amount, line_total=ln.line_total,
        ))
    db.add(order)
    db.flush()
    order.order_no = order_no_for(order)
    reserve_stock(db, order, user)  # 409 if any SKU would go below zero
    if quote.coupon_code:
        coupon = db.scalar(select(Coupon).where(Coupon.code == quote.coupon_code))
        db.add(CouponUsage(coupon_id=coupon.id, user_id=user.id, order_id=order.id))

    response: dict = {}
    if is_cod:
        db.add(Payment(order_id=order.id, gateway="cod", method="cod", amount=order.total, status="cod_pending"))
        add_history(db, order, S.PENDING_PAYMENT, note="Order placed")
        add_history(db, order, S.CONFIRMED, note="Confirmed – COD")
        _bump_sold_count(db, order, +1)
    else:
        add_history(db, order, S.PENDING_PAYMENT, note="Awaiting payment")
        payment = _new_gateway_payment(db, order)
        response["razorpay"] = _gateway_payload(db, order, payment, user)

    cart.items.clear()
    cart.coupon_code = None
    db.commit()
    if is_cod:
        notify_order_placed(db, order)
    response["order"] = order_summary(order)
    return response


# ------------------------------------------------------------------ my orders

@router.get("/orders")
def my_orders(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Order).options(selectinload(Order.items), selectinload(Order.user))
        .where(Order.user_id == user.id).order_by(Order.id.desc())
    ).all()
    return [order_summary(o) for o in rows]


@router.get("/orders/{order_id}")
def my_order(order_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    order = _my_order(db, user, order_id)
    data = order_detail(order)
    window = int(get_setting(db, "returns").get("window_days") or 0)
    data["return_window_days"] = window
    data["can_cancel"] = order.order_status in S.CANCELLABLE
    data["can_return"] = bool(
        order.order_status in (S.DELIVERED, S.RETURN_REQUESTED) and order.delivered_at
        and utcnow() <= order.delivered_at + timedelta(days=window)
    )
    data["can_retry_payment"] = order.order_status == S.PENDING_PAYMENT
    data["returns"] = [
        return_out(r) for r in db.scalars(
            select(Return).options(selectinload(Return.order_item), selectinload(Return.exchange_variant))
            .where(Return.order_id == order.id)
        ).all()
    ]
    data["refunds"] = [
        {"id": r.id, "amount": r.amount, "status": r.status, "mode": r.mode, "created_at": r.created_at}
        for r in db.scalars(select(Refund).where(Refund.order_id == order.id, Refund.status != "requested")).all()
    ]
    return data


@router.post("/orders/{order_id}/cancel")
def cancel_my_order(order_id: int, body: CancelIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """OR-03: cancel before Shipped; prepaid amount auto-refunded."""
    order = _my_order(db, user, order_id)
    cancel_order(db, order, user, body.reason, by_customer=True)
    db.commit()
    return order_detail(order)


@router.post("/orders/{order_id}/refund-details")
def save_refund_details(order_id: int, body: RefundDetailsIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """PY-08: bank / UPI details for refunds on COD orders."""
    order = _my_order(db, user, order_id)
    if order.payment_method != "cod":
        raise HTTPException(400, "Refunds for online payments go back to the original payment method")
    if not body.upi_id and not (body.account_number and body.ifsc and body.account_name):
        raise HTTPException(400, "Enter a UPI ID or full bank account details")
    order.refund_details = body.model_dump()
    db.commit()
    return {"ok": True}


@router.post("/orders/{order_id}/return", status_code=201)
async def request_return(
    order_id: int,
    order_item_id: int = Form(...),
    type: str = Form(..., pattern="^(return|exchange)$"),
    reason: str = Form(..., min_length=3, max_length=500),
    qty: int = Form(1, ge=1, le=5),
    exchange_variant_id: int | None = Form(None),
    photo: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """OR-04: return / size exchange within the configured window, with reason and photo."""
    order = _my_order(db, user, order_id)
    window = int(get_setting(db, "returns").get("window_days") or 0)
    if order.order_status not in (S.DELIVERED, S.RETURN_REQUESTED) or not order.delivered_at:
        raise HTTPException(400, "Returns can be requested only after delivery")
    if utcnow() > order.delivered_at + timedelta(days=window):
        raise HTTPException(400, f"The {window}-day return window for this order has ended")
    item = next((i for i in order.items if i.id == order_item_id), None)
    if not item:
        raise HTTPException(404, "Item not found in this order")
    already = db.scalar(
        select(func.coalesce(func.sum(Return.qty), 0)).where(Return.order_item_id == item.id, Return.status != "rejected")
    ) or 0
    if qty > item.qty - already:
        raise HTTPException(400, "A return has already been requested for this item")
    exchange_variant = None
    if type == "exchange":
        if not exchange_variant_id:
            raise HTTPException(400, "Choose the size you want in exchange")
        exchange_variant = db.get(ProductVariant, exchange_variant_id)
        if not exchange_variant or exchange_variant.product_id != item.product_id or not exchange_variant.is_active:
            raise HTTPException(400, "Invalid exchange size")
        if exchange_variant.stock_qty < qty:
            raise HTTPException(409, "The selected size is out of stock. Please choose a return instead.")
    photo_url = await save_image(photo, "returns", max_side=1200)
    ret = Return(
        order_item_id=item.id, order_id=order.id, type=type, qty=qty, reason=reason, photo_url=photo_url,
        exchange_variant_id=exchange_variant.id if exchange_variant else None,
    )
    db.add(ret)
    if order.order_status != S.RETURN_REQUESTED:
        order.order_status = S.RETURN_REQUESTED
    add_history(db, order, S.RETURN_REQUESTED, user, f"{type.title()} requested for {item.product_name} ({item.size})")
    db.commit()
    return {"ok": True, "id": ret.id}


@router.get("/orders/{order_id}/items/{item_id}/exchange-options")
def exchange_options(order_id: int, item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Sizes available for a size exchange (OR-04)."""
    order = _my_order(db, user, order_id)
    item = next((i for i in order.items if i.id == item_id), None)
    if not item or not item.product_id:
        raise HTTPException(404, "Item not found in this order")
    variants = db.scalars(
        select(ProductVariant).where(
            ProductVariant.product_id == item.product_id, ProductVariant.is_active.is_(True),
            ProductVariant.stock_qty > 0, ProductVariant.id != item.variant_id,
        ).order_by(ProductVariant.colour, ProductVariant.size)
    ).all()
    return [{"id": v.id, "size": v.size, "colour": v.colour} for v in variants]


@router.get("/orders/{order_id}/invoice")
def my_invoice(order_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    order = _my_order(db, user, order_id)
    if not order.invoice_no:
        raise HTTPException(400, "Invoice is generated after payment (or on delivery for COD orders)")
    pdf = invoice_pdf(order, get_setting(db, "store"))
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{order.invoice_no}.pdf"'})


# ------------------------------------------------------------------ payments

@router.post("/payments/create-order")
def create_payment_order(body: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """PY-06 retry: new gateway order for a Pending Payment order."""
    order = _my_order(db, user, int(body.get("order_id", 0)))
    if order.order_status != S.PENDING_PAYMENT:
        raise HTTPException(400, "This order is not awaiting payment")
    retry_reservation(db, order)
    payment = _new_gateway_payment(db, order)
    add_history(db, order, S.PENDING_PAYMENT, user, "Payment retried")
    db.commit()
    return {"order": order_summary(order), "razorpay": _gateway_payload(db, order, payment, user)}


@router.post("/payments/verify")
def verify_payment(body: PaymentVerifyIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """PY-04: verify HMAC signature on the server — never trust the frontend callback alone."""
    order = _my_order(db, user, body.order_id)
    payment = db.scalar(select(Payment).where(Payment.order_id == order.id, Payment.gateway_order_id == body.razorpay_order_id))
    if not payment:
        raise HTTPException(400, "Payment does not belong to this order")
    if not gateway.verify_payment_signature(db, body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature):
        raise HTTPException(400, "Payment verification failed")
    method, raw = None, None
    try:
        raw = gateway.fetch_payment(db, body.razorpay_payment_id)
        method = raw.get("method")
    except HTTPException:
        log.warning("Could not fetch payment %s details", body.razorpay_payment_id)
    was_paid = order.payment_status == PaymentStatus.PAID
    mark_paid(db, order, payment, body.razorpay_payment_id, method, raw)
    db.commit()
    if not was_paid and order.order_status == S.CONFIRMED:
        notify_order_placed(db, order)
    return order_detail(order)


@router.post("/payments/failed")
def payment_failed(body: PaymentFailedIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    order = _my_order(db, user, body.order_id)
    payment = None
    if body.razorpay_order_id:
        payment = db.scalar(select(Payment).where(Payment.order_id == order.id, Payment.gateway_order_id == body.razorpay_order_id))
    if payment:
        mark_payment_failed(db, order, payment, body.reason, None)
        db.commit()
    return order_summary(order)


@router.post("/payments/webhook", include_in_schema=False)
async def webhook(request: Request, db: Session = Depends(get_db)):
    """PY-05: payment.captured, payment.failed, refund.processed — signature checked, idempotent."""
    body = await request.body()
    if not gateway.verify_webhook_signature(body, request.headers.get("x-razorpay-signature", "")):
        log.error("Webhook signature check failed")
        raise HTTPException(400, "Invalid signature")
    payload = json.loads(body)
    event = payload.get("event", "")
    event_id = request.headers.get("x-razorpay-event-id") or f"{event}:{payload.get('created_at')}:{hash(body)}"
    rec = WebhookEvent(event_id=event_id[:80], event=event[:60], payload=payload)
    db.add(rec)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return {"ok": True, "duplicate": True}

    try:
        entity = payload.get("payload", {})
        if event in ("payment.captured", "payment.failed", "order.paid"):
            pay = entity.get("payment", {}).get("entity", {})
            payment = db.scalar(select(Payment).where(Payment.gateway_order_id == pay.get("order_id")))
            if payment:
                order = db.scalar(_order_query().where(Order.id == payment.order_id))
                if event == "payment.failed":
                    mark_payment_failed(db, order, payment, pay.get("error_description"), pay)
                else:
                    was_paid = order.payment_status == PaymentStatus.PAID
                    mark_paid(db, order, payment, pay.get("id"), pay.get("method"), pay)
                    db.flush()
                    if not was_paid and order.order_status == S.CONFIRMED:
                        notify_order_placed(db, order)
        elif event in ("refund.processed", "refund.failed"):
            ref = entity.get("refund", {}).get("entity", {})
            refund = db.scalar(select(Refund).where(Refund.gateway_refund_id == ref.get("id")))
            if refund:
                if event == "refund.processed":
                    complete_gateway_refund(db, refund, ref)
                else:
                    refund.status = "failed"
                    refund.raw_response = ref
        rec.processed = True
        db.commit()
    except Exception as exc:  # keep the log row; NF-12 alert via error log
        db.rollback()
        log.exception("Webhook processing failed")
        rec = db.scalar(select(WebhookEvent).where(WebhookEvent.event_id == event_id[:80]))
        if rec:
            rec.error = str(exc)[:500]
            db.commit()
        raise HTTPException(500, "Webhook processing failed")
    return {"ok": True}
