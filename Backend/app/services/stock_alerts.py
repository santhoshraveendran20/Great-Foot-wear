"""CT-10 "Notify me" when an out-of-stock size returns.

change_stock() calls release_alerts() when a variant goes from 0 to in stock. The
variant's pending alerts are marked notified in that same transaction, and the
email / SMS are queued with on_commit(): they go out only after the outermost
transaction COMMITs. A rollback, a rolled-back SAVEPOINT or a session closed
without commit (an HTTPException after the stock change) drops them, and the
alerts stay pending for the next restock.

The Session events below are registered once, on the Session class (all sessions)."""
import logging
from collections.abc import Callable

from sqlalchemy import event, func, select, update
from sqlalchemy.orm import Session, SessionTransaction

from app.core.config import settings
from app.core.security import utcnow
from app.models import ProductVariant, StockAlert
from app.services import notify
from app.services.store_settings import DEFAULTS, get_setting

log = logging.getLogger("gfw.stock_alerts")

_PENDING = "gfw_on_commit"  # session.info key: [(transaction, callback), ...]


# ------------------------------------------------------------------ run-after-commit queue

def on_commit(db: Session, fn: Callable[[], None]) -> None:
    """Run fn once the outermost transaction commits; discarded if it (or the SAVEPOINT it was queued in) rolls back."""
    txn = db.get_nested_transaction() or db.get_transaction()
    db.info.setdefault(_PENDING, []).append((txn, fn))


def _inside(txn: SessionTransaction | None, ended: SessionTransaction) -> bool:
    while txn is not None:
        if txn is ended:
            return True
        txn = txn.parent
    return False


@event.listens_for(Session, "after_commit")
def _run_pending(session: Session) -> None:
    # SQLAlchemy also fires after_commit when a SAVEPOINT is released; wait for the real COMMIT
    if session.in_nested_transaction():
        return
    for _, fn in session.info.pop(_PENDING, None) or []:
        try:
            fn()
        except Exception:  # the data is already committed; never fail the request here
            log.exception("After-commit notification failed")


@event.listens_for(Session, "after_soft_rollback")
def _drop_rolled_back(session: Session, previous_transaction: SessionTransaction) -> None:
    pending = session.info.get(_PENDING)
    if pending:
        session.info[_PENDING] = [(t, fn) for t, fn in pending if not _inside(t, previous_transaction)]


@event.listens_for(Session, "after_transaction_end")
def _drop_uncommitted(session: Session, transaction: SessionTransaction) -> None:
    # outermost transaction ended: anything still queued was never committed (e.g. Session.close())
    if transaction.parent is None:
        session.info.pop(_PENDING, None)


# ------------------------------------------------------------------ alerts

def pending_counts(db: Session, variant_ids: list[int]) -> dict[int, int]:
    """Waiting customers per variant, in one grouped query (admin inventory)."""
    if not variant_ids:
        return {}
    rows = db.execute(
        select(StockAlert.variant_id, func.count(StockAlert.id))
        .where(StockAlert.variant_id.in_(variant_ids), StockAlert.notified_at.is_(None))
        .group_by(StockAlert.variant_id)
    ).all()
    return {vid: n for vid, n in rows}


def release_alerts(db: Session, variant: ProductVariant) -> int:
    """Marks the variant's pending alerts notified and queues the back-in-stock messages.
    Does nothing while the variant or its product is inactive (alerts stay pending)."""
    product = variant.product
    if not (variant.is_active and product is not None and product.is_active):
        return 0
    # locking read: InnoDB returns the latest committed rows, so two restocks cannot pick the same alerts
    rows = db.execute(
        select(StockAlert.id, StockAlert.email, StockAlert.mobile)
        .where(StockAlert.variant_id == variant.id, StockAlert.notified_at.is_(None))
        .order_by(StockAlert.id)
        .with_for_update()
    ).all()
    if not rows:
        return 0
    db.execute(update(StockAlert).where(StockAlert.id.in_([r.id for r in rows])).values(notified_at=utcnow()))

    templates = get_setting(db, "notification_templates")
    tpl = {**DEFAULTS["notification_templates"]["back_in_stock"], **(templates.get("back_in_stock") or {})}
    values = {
        "product": product.name,
        "size": variant.size,
        "colour": variant.colour,
        "link": f"{settings.FRONTEND_URL.rstrip('/')}/product/{product.slug}",
    }
    subject, body = notify._render(tpl["subject"], **values), notify._render(tpl["body"], **values)
    # one message per address, even if two alerts for the same person slipped in concurrently
    emails = list(dict.fromkeys(r.email.lower() for r in rows if r.email))
    mobiles = list(dict.fromkeys(r.mobile for r in rows if r.mobile))

    def send() -> None:
        for email in emails:
            notify.send_email(email, subject, body)
        for mobile in mobiles:
            notify.send_sms(mobile, body)

    on_commit(db, send)
    log.info("Back in stock: %s (%s) – %d alert(s) queued", variant.sku, product.name, len(rows))
    return len(rows)
