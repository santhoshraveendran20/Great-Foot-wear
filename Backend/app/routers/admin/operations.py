"""Admin: inventory (AD-06), orders (AD-07), returns & exchanges (AD-08),
payments & refunds (AD-09, PY-07)."""
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import admin_only, staff_or_admin
from app.core.security import utcnow
from app.db import get_db
from app.models import (
    Order,
    OrderItem,
    OrderStatus,
    Payment,
    PaymentStatus,
    Product,
    ProductVariant,
    Refund,
    Return,
    Role,
    Shipment,
    StockAlert,
    StockMovement,
    User,
)
from app.schemas import OrderStatusIn, RefundIn, ReturnDecisionIn, ShipmentIn, StockAdjustIn, ThresholdIn
from app.serializers import order_detail, order_summary, refund_out, return_out
from app.services.audit import audit
from app.services.invoice import invoice_pdf, shipping_label_pdf
from app.services.notify import notify_order_status
from app.services.orders import (
    add_history,
    allowed_next,
    open_returns,
    order_no_for,
    process_refund,
    refundable_amount,
    request_refund,
    reserve_stock,
    set_status,
)
from app.services.pricing import money
from app.services.stock import change_stock
from app.services.stock_alerts import pending_counts
from app.services.store_settings import get_setting
from app.utils import ist_day_start

router = APIRouter(dependencies=[Depends(staff_or_admin)])
S = OrderStatus


def _day_range(d_from: date | None, d_to: date | None):
    """IST calendar days as stored (naive UTC) datetimes."""
    start = ist_day_start(d_from) if d_from else None
    end = ist_day_start(d_to + timedelta(days=1)) if d_to else None
    return start, end


# ------------------------------------------------------------------ inventory (AD-06)

@router.get("/inventory")
def inventory(
    db: Session = Depends(get_db),
    q: str | None = None,
    low_stock: bool = False,
    waiting: bool = False,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    """AD-06 stock list; waiting_alerts = customers who asked "Notify me" for that size (CT-10)."""
    stmt = select(ProductVariant).join(Product, Product.id == ProductVariant.product_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Product.name.like(like), ProductVariant.sku.like(like)))
    if low_stock:
        stmt = stmt.where(ProductVariant.stock_qty <= ProductVariant.low_stock_threshold, ProductVariant.is_active.is_(True))
    if waiting:
        stmt = stmt.where(ProductVariant.id.in_(select(StockAlert.variant_id).where(StockAlert.notified_at.is_(None))))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.options(selectinload(ProductVariant.product)).order_by(Product.name, ProductVariant.size, ProductVariant.colour)
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    waiting_counts = pending_counts(db, [v.id for v in rows])
    return {
        "items": [
            {
                "variant_id": v.id, "product_id": v.product_id, "product_name": v.product.name, "sku": v.sku,
                "size": v.size, "colour": v.colour, "stock_qty": v.stock_qty, "low_stock_threshold": v.low_stock_threshold,
                "is_low": v.stock_qty <= v.low_stock_threshold, "is_active": v.is_active,
                "price": v.effective_price, "waiting_alerts": waiting_counts.get(v.id, 0),
            }
            for v in rows
        ],
        "total": total, "page": page, "page_size": page_size,
    }


@router.post("/inventory/adjust")
def adjust_stock(body: StockAdjustIn, request: Request, db: Session = Depends(get_db), user: User = Depends(staff_or_admin)):
    """Stock adjust with reason: purchase, damage, store sale, return, correction."""
    if body.reason in ("damage", "store_sale") and body.change_qty > 0:
        raise HTTPException(400, "Damage and store sale reduce stock — enter a negative quantity")
    if body.reason in ("purchase", "return") and body.change_qty < 0:
        raise HTTPException(400, "Purchase and return add stock — enter a positive quantity")
    waiting_before = pending_counts(db, [body.variant_id]).get(body.variant_id, 0)
    v = change_stock(db, body.variant_id, body.change_qty, body.reason, user_id=user.id, note=body.note)
    alerts_notified = waiting_before - pending_counts(db, [v.id]).get(v.id, 0)  # CT-10 "Notify me" released by this restock
    details = body.model_dump() | ({"alerts_notified": alerts_notified} if alerts_notified else {})
    audit(db, user, "stock_adjust", "variant", v.id, details, request)
    db.commit()
    return {"variant_id": v.id, "stock_qty": v.stock_qty, "alerts_notified": alerts_notified}


@router.put("/inventory/{variant_id}/threshold")
def set_threshold(variant_id: int, body: ThresholdIn, db: Session = Depends(get_db)):
    v = db.get(ProductVariant, variant_id)
    if not v:
        raise HTTPException(404, "Variant not found")
    v.low_stock_threshold = body.low_stock_threshold
    db.commit()
    return {"ok": True}


@router.get("/inventory/movements")
def stock_history(
    db: Session = Depends(get_db),
    variant_id: int | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    stmt = select(StockMovement)
    if variant_id:
        stmt = stmt.where(StockMovement.variant_id == variant_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(StockMovement.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    variants = {v.id: v for v in db.scalars(
        select(ProductVariant).options(selectinload(ProductVariant.product)).where(ProductVariant.id.in_({m.variant_id for m in rows} or {-1}))
    ).all()}
    users = {u.id: u.name for u in db.scalars(select(User).where(User.id.in_({m.user_id for m in rows if m.user_id} or {-1}))).all()}
    orders = {o.id: o.order_no for o in db.scalars(select(Order).where(Order.id.in_({m.ref_order_id for m in rows if m.ref_order_id} or {-1}))).all()}
    return {
        "items": [
            {
                "id": m.id, "variant_id": m.variant_id,
                "sku": variants[m.variant_id].sku if m.variant_id in variants else None,
                "product_name": variants[m.variant_id].product.name if m.variant_id in variants else None,
                "change_qty": m.change_qty, "balance_after": m.balance_after, "reason": m.reason, "note": m.note,
                "order_no": orders.get(m.ref_order_id), "user": users.get(m.user_id), "created_at": m.created_at,
            }
            for m in rows
        ],
        "total": total, "page": page, "page_size": page_size,
    }


# ------------------------------------------------------------------ orders (AD-07)

def _order(db: Session, oid: int) -> Order:
    o = db.scalar(
        select(Order).options(
            selectinload(Order.items), selectinload(Order.history), selectinload(Order.payments),
            selectinload(Order.shipment), selectinload(Order.user),
        ).where(Order.id == oid)
    )
    if not o:
        raise HTTPException(404, "Order not found")
    return o


@router.get("/orders")
def list_orders(
    db: Session = Depends(get_db),
    status: str | None = None,
    payment_method: str | None = Query(default=None, pattern="^(online|cod)$"),
    payment_status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
):
    stmt = select(Order)
    if status:
        stmt = stmt.where(Order.order_status == status)
    if payment_method:
        stmt = stmt.where(Order.payment_method == payment_method)
    if payment_status:
        stmt = stmt.where(Order.payment_status == payment_status)
    start, end = _day_range(date_from, date_to)
    if start:
        stmt = stmt.where(Order.created_at >= start)
    if end:
        stmt = stmt.where(Order.created_at < end)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.join(User, User.id == Order.user_id).where(
            or_(Order.order_no.like(like), User.name.like(like), User.mobile.like(like), User.email.like(like))
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.options(selectinload(Order.items), selectinload(Order.user)).order_by(Order.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {"items": [order_summary(o) for o in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/orders/{oid}")
def get_order(oid: int, db: Session = Depends(get_db)):
    o = _order(db, oid)
    data = order_detail(o, admin=True)
    data["allowed_next"] = allowed_next(o)
    data["refundable_amount"] = refundable_amount(db, o)
    data["returns"] = [
        return_out(r) for r in db.scalars(
            select(Return).options(selectinload(Return.order_item), selectinload(Return.exchange_variant), selectinload(Return.order))
            .where(Return.order_id == o.id)
        ).all()
    ]
    data["refunds"] = [refund_out(r) for r in db.scalars(select(Refund).options(selectinload(Refund.order)).where(Refund.order_id == o.id)).all()]
    return data


@router.post("/orders/{oid}/status")
def change_status(oid: int, body: OrderStatusIn, request: Request, db: Session = Depends(get_db), user: User = Depends(staff_or_admin)):
    o = _order(db, oid)
    old = o.order_status
    set_status(db, o, body.status, user, body.note)
    audit(db, user, "order_status", "order", o.order_no, {"from": old, "to": body.status, "note": body.note}, request)
    db.commit()
    return get_order(oid, db)


@router.put("/orders/{oid}/shipment")
def set_shipment(oid: int, body: ShipmentIn, request: Request, db: Session = Depends(get_db), user: User = Depends(staff_or_admin)):
    """OR-05: courier + AWB / tracking link."""
    o = _order(db, oid)
    if o.fulfilment != "delivery":
        raise HTTPException(400, "Store pickup orders do not need a shipment")
    sh = o.shipment or Shipment(order_id=o.id)
    sh.courier, sh.awb_no, sh.tracking_url = body.courier, body.awb_no, body.tracking_url
    db.add(sh)
    audit(db, user, "shipment", "order", o.order_no, body.model_dump(), request)
    db.commit()
    return get_order(oid, db)


@router.get("/orders/{oid}/invoice")
def order_invoice(oid: int, db: Session = Depends(get_db)):
    o = _order(db, oid)
    if not o.invoice_no:
        raise HTTPException(400, "Invoice is generated after payment (or on delivery for COD orders)")
    return Response(invoice_pdf(o, get_setting(db, "store")), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{o.invoice_no}.pdf"'})


@router.get("/orders/{oid}/label")
def order_label(oid: int, db: Session = Depends(get_db)):
    o = _order(db, oid)
    return Response(shipping_label_pdf(o, get_setting(db, "store")), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="label-{o.order_no}.pdf"'})


@router.post("/orders/{oid}/refunds")
def refund_order(oid: int, body: RefundIn, request: Request, db: Session = Depends(get_db), user: User = Depends(staff_or_admin)):
    """Super Admin issues refunds; Staff can only request (section 3)."""
    o = _order(db, oid)
    amount = money(body.amount)
    if user.role == Role.ADMIN:
        if o.payment_method == "cod" and not o.refund_details:
            raise HTTPException(400, "Ask the customer to add bank/UPI details for this COD refund first")
        refund = process_refund(db, o, amount, body.reason, user)
        action = "refund"
    else:
        refund = request_refund(db, o, amount, body.reason, user)
        action = "refund_request"
    audit(db, user, action, "order", o.order_no, {"amount": str(amount), "reason": body.reason}, request)
    db.commit()
    return refund_out(refund)


# ------------------------------------------------------------------ returns & exchanges (AD-08)

@router.get("/returns")
def list_returns(db: Session = Depends(get_db), status: str | None = None):
    stmt = select(Return).options(selectinload(Return.order_item), selectinload(Return.exchange_variant), selectinload(Return.order))
    if status:
        stmt = stmt.where(Return.status == status)
    return [return_out(r) for r in db.scalars(stmt.order_by(Return.id.desc()).limit(500)).all()]


def _create_replacement(db: Session, original: Order, ret: Return, user: User) -> Order:
    item = ret.order_item
    v = ret.exchange_variant
    rep = Order(
        user_id=original.user_id, fulfilment=original.fulfilment, address=original.address,
        subtotal=Decimal("0"), mrp_total=Decimal("0"), discount=Decimal("0"), shipping=Decimal("0"), cod_fee=Decimal("0"),
        tax=Decimal("0"), total=Decimal("0"), payment_method=original.payment_method, payment_status=PaymentStatus.PAID,
        order_status=S.CONFIRMED, is_inter_state=original.is_inter_state,
    )
    rep.user = original.user
    rep.items.append(OrderItem(
        variant_id=v.id, product_id=v.product_id, product_name=item.product_name, sku=v.sku, size=v.size, colour=v.colour,
        image_url=item.image_url, hsn_code=item.hsn_code, mrp=item.mrp, price=Decimal("0"), qty=ret.qty,
        discount=Decimal("0"), gst_rate=item.gst_rate, taxable_value=Decimal("0"), tax_amount=Decimal("0"), line_total=Decimal("0"),
    ))
    db.add(rep)
    db.flush()
    rep.order_no = order_no_for(rep)
    reserve_stock(db, rep, user)
    add_history(db, rep, S.CONFIRMED, user, f"Size exchange replacement for {original.order_no}")
    return rep


def _close_order_returns(db: Session, o: Order, user: User) -> None:
    if open_returns(db, o) == 0 and o.order_status == S.RETURN_REQUESTED:
        statuses = set(db.scalars(select(Return.status).where(Return.order_id == o.id)).all())
        if statuses <= {"rejected"}:
            o.order_status = S.DELIVERED
            add_history(db, o, S.DELIVERED, user, "Return request closed")
        else:
            o.order_status = S.RETURNED
            add_history(db, o, S.RETURNED, user)
            notify_order_status(db, o, S.RETURNED)


@router.post("/returns/{rid}")
def decide_return(rid: int, body: ReturnDecisionIn, request: Request, db: Session = Depends(get_db), user: User = Depends(staff_or_admin)):
    ret = db.scalar(select(Return).options(selectinload(Return.order_item), selectinload(Return.exchange_variant)).where(Return.id == rid))
    if not ret:
        raise HTTPException(404, "Return not found")
    o = _order(db, ret.order_id)
    if body.action == "approve":
        if ret.status != "requested":
            raise HTTPException(400, "Only new requests can be approved")
        ret.status = "approved"
        add_history(db, o, S.RETURN_REQUESTED, user, f"{ret.type.title()} approved" + (f": {body.note}" if body.note else ""))
        notify_order_status(db, o, S.RETURN_REQUESTED, f"Your {ret.type} request was approved. {body.note or ''}")
    elif body.action == "reject":
        if ret.status not in ("requested", "approved"):
            raise HTTPException(400, "This request is already closed")
        ret.status = "rejected"
        add_history(db, o, o.order_status, user, f"{ret.type.title()} rejected" + (f": {body.note}" if body.note else ""))
        notify_order_status(db, o, o.order_status, f"Your {ret.type} request was rejected. {body.note or ''}")
        db.flush()
        _close_order_returns(db, o, user)
    else:  # receive: restock and trigger refund or replacement
        if ret.status != "approved":
            raise HTTPException(400, "Approve the request before marking the item as received")
        item = ret.order_item
        if body.restock and item.variant_id:
            change_stock(db, item.variant_id, ret.qty, "return", user_id=user.id, order_id=o.id, note=f"Return #{ret.id}")
        if ret.type == "exchange":
            rep = _create_replacement(db, o, ret, user)
            ret.replacement_order_id = rep.id
        else:
            amount = money(Decimal(item.line_total) * ret.qty / item.qty)
            amount = min(amount, refundable_amount(db, o))
            if amount > 0:
                if user.role == Role.ADMIN and o.payment_method == "online":
                    refund = process_refund(db, o, amount, f"Return #{ret.id}", user)
                else:
                    refund = request_refund(db, o, amount, f"Return #{ret.id}", user)
                ret.refund_id = refund.id
        ret.status = "completed"
        db.flush()
        _close_order_returns(db, o, user)
    if body.note:
        ret.admin_note = body.note
    audit(db, user, f"return_{body.action}", "return", ret.id, {"order": o.order_no, "note": body.note}, request)
    db.commit()
    return return_out(db.scalar(select(Return).options(
        selectinload(Return.order_item), selectinload(Return.exchange_variant), selectinload(Return.order)).where(Return.id == rid)))


# ------------------------------------------------------------------ payments & refunds (AD-09) — Super Admin

@router.get("/payments", dependencies=[Depends(admin_only)])
def list_payments(
    db: Session = Depends(get_db),
    status: str | None = None,
    method: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    stmt = select(Payment)
    if status:
        stmt = stmt.where(Payment.status == status)
    if method:
        stmt = stmt.where(Payment.method == method)
    start, end = _day_range(date_from, date_to)
    if start:
        stmt = stmt.where(Payment.created_at >= start)
    if end:
        stmt = stmt.where(Payment.created_at < end)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.options(selectinload(Payment.order)).order_by(Payment.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {
        "items": [
            {
                "id": p.id, "order_id": p.order_id, "order_no": p.order.order_no, "gateway": p.gateway,
                "gateway_order_id": p.gateway_order_id, "gateway_payment_id": p.gateway_payment_id, "method": p.method,
                "amount": p.amount, "status": p.status, "error_reason": p.error_reason, "created_at": p.created_at,
            }
            for p in rows
        ],
        "total": total, "page": page, "page_size": page_size,
    }


@router.get("/refunds", dependencies=[Depends(admin_only)])
def list_refunds(db: Session = Depends(get_db), status: str | None = None):
    stmt = select(Refund).options(selectinload(Refund.order))
    if status:
        stmt = stmt.where(Refund.status == status)
    return [refund_out(r) for r in db.scalars(stmt.order_by(Refund.id.desc()).limit(500)).all()]


@router.post("/refunds/{refund_id}/approve")
def approve_refund(refund_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(admin_only)):
    """Super Admin processes a staff refund request (gateway) or confirms a manual COD transfer."""
    refund = db.get(Refund, refund_id)
    if not refund or refund.status not in ("requested", "failed"):
        raise HTTPException(400, "This refund is not awaiting approval")
    o = _order(db, refund.order_id)
    if o.payment_method == "cod" and not o.refund_details:
        raise HTTPException(400, "Customer has not added bank/UPI details for this COD refund yet")
    process_refund(db, o, Decimal(refund.amount), refund.reason, user, existing=refund)
    audit(db, user, "refund_approve", "refund", refund.id, {"order": o.order_no, "amount": str(refund.amount)}, request)
    db.commit()
    return refund_out(refund)


@router.post("/refunds/{refund_id}/reject")
def reject_refund(refund_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(admin_only)):
    refund = db.get(Refund, refund_id)
    if not refund or refund.status != "requested":
        raise HTTPException(400, "This refund is not awaiting approval")
    refund.status = "rejected"
    refund.processed_by = user.id
    audit(db, user, "refund_reject", "refund", refund.id, None, request)
    db.commit()
    return refund_out(refund)
