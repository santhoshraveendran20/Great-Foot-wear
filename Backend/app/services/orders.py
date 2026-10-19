"""Order lifecycle (OR-02, OR-03, CO-03, PY-06, PY-07, PY-11, AD-07, AD-08)."""
import logging
from datetime import timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.db import SessionLocal
from app.models import (
    CouponUsage,
    Order,
    OrderStatus,
    OrderStatusHistory,
    Payment,
    PaymentStatus,
    Product,
    Refund,
    Return,
    Shipment,
    User,
)
from app.services import gateway
from app.services.notify import notify_order_status, notify_refund
from app.services.stock import change_stock

log = logging.getLogger("gfw.orders")

RESERVATION_MINUTES = 15  # CO-03 / PY-06

S = OrderStatus


def order_no_for(order: Order) -> str:
    """CO-06: GFW-2026-000123"""
    year = (order.created_at or utcnow()).year
    return f"GFW-{year}-{order.id:06d}"


def add_history(db: Session, order: Order, status: str, user: User | None = None, note: str | None = None) -> None:
    order.history.append(OrderStatusHistory(status=status, note=(note or None) and note[:255], user_id=user.id if user else None))


def assign_invoice(order: Order) -> None:
    """PY-11: invoice generated on payment success (or on delivery for COD)."""
    if not order.invoice_no:
        order.invoice_no = f"INV-{utcnow().year}-{order.id:06d}"
        order.invoice_date = utcnow()


# ------------------------------------------------------------------ stock

def reserve_stock(db: Session, order: Order, user: User | None = None) -> None:
    for item in order.items:
        change_stock(db, item.variant_id, -item.qty, "order", user_id=user.id if user else order.user_id, order_id=order.id)
    order.stock_released = False


def release_stock(db: Session, order: Order, reason: str, user: User | None = None) -> None:
    if order.stock_released:
        return
    for item in order.items:
        if item.variant_id:
            change_stock(db, item.variant_id, item.qty, reason, user_id=user.id if user else None, order_id=order.id)
    order.stock_released = True


def _bump_sold_count(db: Session, order: Order, sign: int) -> None:
    for item in order.items:
        if item.product_id:
            product = db.get(Product, item.product_id)
            if product:
                product.sold_count = max(0, (product.sold_count or 0) + sign * item.qty)


# ------------------------------------------------------------------ payment success

def mark_paid(db: Session, order: Order, payment: Payment, gateway_payment_id: str, method: str | None, raw: dict | None) -> None:
    """Idempotent. Called after server-side signature verification or a verified webhook."""
    if payment.status == "captured" and order.payment_status == PaymentStatus.PAID:
        return
    payment.gateway_payment_id = gateway_payment_id
    payment.method = method or payment.method
    payment.status = "captured"
    if raw:
        payment.raw_response = raw
    if order.payment_status == PaymentStatus.PAID:
        return
    if order.order_status != S.PENDING_PAYMENT:
        log.warning("Payment captured for order %s in status %s", order.order_no, order.order_status)
        order.payment_status = PaymentStatus.PAID
        return

    if order.stock_released:
        # reservation expired before capture: re-reserve, refund automatically if stock is gone
        try:
            with db.begin_nested():
                reserve_stock(db, order)
        except HTTPException:
            order.payment_status = PaymentStatus.PAID
            order.order_status = S.CANCELLED
            order.cancel_reason = "Stock not available after payment; amount refunded"
            add_history(db, order, S.CANCELLED, note=order.cancel_reason)
            db.flush()
            process_refund(db, order, Decimal(order.total), "Out of stock after payment", None, auto=True)
            return

    order.payment_status = PaymentStatus.PAID
    order.order_status = S.CONFIRMED
    order.reserved_until = None
    assign_invoice(order)
    _bump_sold_count(db, order, +1)
    add_history(db, order, S.CONFIRMED, note=f"Payment received ({payment.method or 'online'})")


def mark_payment_failed(db: Session, order: Order, payment: Payment, reason: str | None, raw: dict | None) -> None:
    """PY-06: order stays Pending Payment, stock released after the reservation window."""
    if payment.status == "captured":
        return
    payment.status = "failed"
    payment.error_reason = (reason or "")[:255] or None
    if raw:
        payment.raw_response = raw
    if order.payment_status == PaymentStatus.PENDING:
        order.payment_status = PaymentStatus.FAILED


def expire_reservations(db: Session) -> int:
    """Release stock for unpaid orders whose 15-minute reservation has passed."""
    now = utcnow()
    orders = db.scalars(
        select(Order).where(
            Order.order_status == S.PENDING_PAYMENT,
            Order.stock_released.is_(False),
            Order.reserved_until.is_not(None),
            Order.reserved_until < now,
        )
    ).all()
    for order in orders:
        release_stock(db, order, "payment_failed")
        add_history(db, order, S.PENDING_PAYMENT, note="Payment not completed in 15 minutes; stock released")
    db.commit()
    return len(orders)


def expire_reservations_job() -> None:
    db = SessionLocal()
    try:
        n = expire_reservations(db)
        if n:
            log.info("Released stock for %s unpaid orders", n)
    except Exception:
        db.rollback()
        log.exception("expire_reservations failed")
    finally:
        db.close()


def retry_reservation(db: Session, order: Order) -> None:
    """PY-06 retry: re-reserve stock if it had been released."""
    if order.stock_released:
        reserve_stock(db, order)
    order.reserved_until = utcnow() + timedelta(minutes=RESERVATION_MINUTES)


# ------------------------------------------------------------------ status changes

def allowed_next(order: Order) -> list[str]:
    st = order.order_status
    nxt: list[str] = []
    if st in S.FLOW and st != S.PENDING_PAYMENT:
        idx = S.FLOW.index(st)
        nxt.extend(S.FLOW[idx + 1:])
    if st in S.CANCELLABLE:
        nxt.append(S.CANCELLED)
    return nxt


def set_status(db: Session, order: Order, status: str, user: User | None, note: str | None = None) -> None:
    """Admin / staff forward status change (AD-07)."""
    if status == order.order_status:
        return
    if status == S.CANCELLED:
        cancel_order(db, order, user, note or "Cancelled by store")
        return
    if status not in allowed_next(order):
        raise HTTPException(400, f"Cannot change status from {order.order_status} to {status}")
    now = utcnow()
    if status in (S.SHIPPED, S.OUT_FOR_DELIVERY) and order.fulfilment == "delivery":
        shipment = order.shipment
        if not shipment:
            shipment = Shipment(order_id=order.id)
            db.add(shipment)
            order.shipment = shipment
        if not shipment.shipped_at:
            shipment.shipped_at = now
    if status == S.DELIVERED:
        order.delivered_at = now
        if order.shipment:
            order.shipment.delivered_at = now
        if order.payment_method == "cod":
            order.payment_status = PaymentStatus.COD_COLLECTED
            for p in order.payments:
                if p.gateway == "cod":
                    p.status = "cod_collected"
            assign_invoice(order)
    order.order_status = status
    add_history(db, order, status, user, note)
    notify_order_status(db, order, status, note)  # OR-06


def cancel_order(db: Session, order: Order, user: User | None, reason: str, by_customer: bool = False) -> None:
    """OR-03: cancel before Shipped; prepaid amount auto-refunded."""
    if order.order_status not in S.CANCELLABLE:
        raise HTTPException(400, "This order can no longer be cancelled")
    was_confirmed = order.order_status != S.PENDING_PAYMENT
    release_stock(db, order, "cancellation", user)
    if was_confirmed:
        _bump_sold_count(db, order, -1)
    order.order_status = S.CANCELLED
    order.cancel_reason = reason[:255] if reason else None
    db.execute(delete(CouponUsage).where(CouponUsage.order_id == order.id))
    add_history(db, order, S.CANCELLED, user, ("Cancelled by customer: " if by_customer else "") + (reason or ""))
    db.flush()
    if order.payment_status == PaymentStatus.PAID:
        process_refund(db, order, refundable_amount(db, order), "Order cancelled", user, auto=True)
    notify_order_status(db, order, S.CANCELLED, reason)


# ------------------------------------------------------------------ refunds

def refunded_total(db: Session, order: Order) -> Decimal:
    return Decimal(
        db.scalar(
            select(func.coalesce(func.sum(Refund.amount), 0)).where(
                Refund.order_id == order.id, Refund.status.in_(["processing", "processed"])
            )
        )
        or 0
    )


def refundable_amount(db: Session, order: Order) -> Decimal:
    return max(Decimal("0"), Decimal(order.total) - refunded_total(db, order))


def _captured_payment(order: Order) -> Payment | None:
    for p in reversed(order.payments):
        if p.gateway == "razorpay" and p.status in ("captured", "refunded", "partially_refunded") and p.gateway_payment_id:
            return p
    return None


def request_refund(db: Session, order: Order, amount: Decimal, reason: str | None, staff: User) -> Refund:
    """Staff can only request a refund (section 3 permissions)."""
    _validate_refund_amount(db, order, amount)
    refund = Refund(
        order_id=order.id,
        amount=amount,
        reason=reason,
        mode="gateway" if order.payment_method == "online" else "manual",
        status="requested",
        requested_by=staff.id,
    )
    db.add(refund)
    return refund


def _validate_refund_amount(db: Session, order: Order, amount: Decimal) -> None:
    if amount <= 0:
        raise HTTPException(400, "Refund amount must be greater than zero")
    if order.payment_status not in (
        PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.COD_COLLECTED
    ):
        raise HTTPException(400, "No payment has been received for this order")
    if amount > refundable_amount(db, order):
        raise HTTPException(400, f"Refund cannot exceed ₹{refundable_amount(db, order):.2f}")


def process_refund(
    db: Session,
    order: Order,
    amount: Decimal,
    reason: str | None,
    admin: User | None,
    *,
    auto: bool = False,
    existing: Refund | None = None,
) -> Refund:
    """Super Admin refund (PY-07) or automatic refund on cancellation (OR-03).
    Online: calls the gateway; status completes on refund.processed webhook.
    COD: manual transfer to the customer's bank/UPI (PY-08) — marked processed by admin."""
    amount = Decimal(amount)
    if not auto or existing:
        _validate_refund_amount(db, order, amount)
    refund = existing or Refund(
        order_id=order.id, amount=amount, reason=reason, requested_by=admin.id if admin else None, status="processing"
    )
    refund.amount = amount
    refund.processed_by = admin.id if admin else None
    if existing is None:
        db.add(refund)
    if order.payment_method == "online":
        payment = _captured_payment(order)
        if not payment:
            raise HTTPException(400, "No captured online payment found for this order")
        refund.mode = "gateway"
        refund.payment_id = payment.id
        db.flush()
        try:
            resp = gateway.refund(db, payment.gateway_payment_id, amount, {"order_no": order.order_no, "refund_id": str(refund.id)})
        except HTTPException as exc:
            refund.status = "failed"
            refund.raw_response = {"error": str(exc.detail)}
            if not auto:
                raise
            log.error("Auto refund failed for %s: %s", order.order_no, exc.detail)
            return refund
        refund.gateway_refund_id = resp.get("id")
        refund.raw_response = resp
        refund.status = "processed" if resp.get("status") == "processed" else "processing"
    else:
        refund.mode = "manual"
        refund.status = "processed"
    db.flush()
    _sync_payment_status(db, order)
    notify_refund(db, order, amount, refund.status)
    return refund


def complete_gateway_refund(db: Session, refund: Refund, raw: dict | None) -> None:
    refund.status = "processed"
    if raw:
        refund.raw_response = raw
    db.flush()
    _sync_payment_status(db, refund.order)


def _sync_payment_status(db: Session, order: Order) -> None:
    refunded = refunded_total(db, order)
    if refunded <= 0:
        return
    if refunded >= Decimal(order.total):
        order.payment_status = PaymentStatus.REFUNDED
        if order.order_status == S.RETURNED:
            order.order_status = S.REFUNDED
            add_history(db, order, S.REFUNDED, note=f"Refunded ₹{refunded:.2f}")
    elif order.payment_method == "online":
        order.payment_status = PaymentStatus.PARTIALLY_REFUNDED
    payment = _captured_payment(order)
    if payment:
        payment.status = "refunded" if refunded >= Decimal(payment.amount) else "partially_refunded"


def open_returns(db: Session, order: Order) -> int:
    return db.scalar(
        select(func.count(Return.id)).where(Return.order_id == order.id, Return.status.in_(["requested", "approved"]))
    ) or 0
