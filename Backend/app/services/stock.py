"""Inventory changes (BO-3, AD-06, CO-03). Every change writes a stock_movements row.
Decrements use a conditional UPDATE so no SKU can go below zero, even under concurrency.
A size coming back into stock releases its "Notify me" alerts (CT-10)."""
from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import ProductVariant, StockMovement
from app.services.notify import notify_admin
from app.services.stock_alerts import release_alerts


def change_stock(
    db: Session,
    variant_id: int,
    delta: int,
    reason: str,
    *,
    user_id: int | None = None,
    order_id: int | None = None,
    note: str | None = None,
) -> ProductVariant:
    if delta == 0:
        raise HTTPException(400, "Quantity change cannot be zero")
    stmt = update(ProductVariant).where(ProductVariant.id == variant_id)
    if delta < 0:
        stmt = stmt.where(ProductVariant.stock_qty >= -delta)
    result = db.execute(stmt.values(stock_qty=ProductVariant.stock_qty + delta).execution_options(synchronize_session=False))
    variant = db.get(ProductVariant, variant_id)
    if result.rowcount != 1:
        if variant is None:
            raise HTTPException(404, "Variant not found")
        raise HTTPException(409, f"Not enough stock for {variant.sku} (available {variant.stock_qty})")
    db.refresh(variant)
    db.add(
        StockMovement(
            variant_id=variant_id,
            change_qty=delta,
            balance_after=variant.stock_qty,
            reason=reason,
            note=note,
            ref_order_id=order_id,
            user_id=user_id,
        )
    )
    # the UPDATE is atomic, so stock_qty - delta is exactly the balance before this change
    if delta > 0 and variant.stock_qty - delta <= 0 < variant.stock_qty:
        release_alerts(db, variant)  # CT-10: messages are sent only after the transaction commits
    if delta < 0 and variant.stock_qty <= variant.low_stock_threshold:
        notify_admin(
            db,
            f"Low stock: {variant.sku}",
            f"Low stock alert: {variant.product.name} size {variant.size} {variant.colour} ({variant.sku}) has {variant.stock_qty} left.",
        )
    return variant
