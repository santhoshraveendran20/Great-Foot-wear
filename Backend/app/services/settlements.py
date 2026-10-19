"""Razorpay settlement sync for the daily reconciliation report (PY-10).

Razorpay APIs used (https://razorpay.com/docs/api/settlements/):
- GET /v1/settlements            settlement.all({from, to, count<=100, skip})   from/to = unix seconds
- GET /v1/settlements/recon/combined
                                 settlement.report({year, month, day, count<=1000, skip})
                                 one row per payment / refund / transfer / adjustment settled on that day
- GET /v1/settlements/:id        settlement.fetch(id)  (settlements referenced by recon rows but outside the window)
Amounts are in paise (stored here in rupees); timestamps are unix seconds (stored as naive UTC).
Calendar days are Indian Standard Time, as on the Razorpay Dashboard.
"""
import logging
import threading
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.db import SessionLocal
from app.models import GatewaySettlement, GatewaySettlementItem
from app.services import gateway
from app.services.store_settings import get_setting, set_setting

log = logging.getLogger("gfw.settlements")

IST = timezone(timedelta(hours=5, minutes=30))
SETTLEMENTS_PAGE = 100  # documented maximum `count` for GET /v1/settlements
RECON_PAGE = 1000  # documented maximum `count` for GET /v1/settlements/recon/combined
MAX_PAGES = 500  # safety stop if the gateway keeps returning full pages
MAX_DAYS = 31  # largest range one sync may cover
JOB_DAYS = 7  # the background job re-syncs the last 7 days (settlements can arrive late)
TIMEOUT = 30  # seconds per gateway request
STATE_KEY = "settlement_sync"  # internal row in the settings table (not shown in Admin → Settings)
NOT_CONFIGURED = ("Razorpay keys are not set on the server for the selected mode (test/live), "
                  "so settlements cannot be fetched.")

_lock = threading.Lock()  # one sync at a time in this process


class SyncBusy(Exception):
    """Another settlement sync is running."""


# ------------------------------------------------------------------ conversions

def rupees(paise) -> Decimal:
    """Gateway amounts are integers in paise (₹500 = 50000)."""
    if paise in (None, ""):
        return Decimal("0.00")
    return (Decimal(str(paise)) / 100).quantize(Decimal("0.01"))


def from_unix(ts) -> datetime | None:
    """Unix seconds -> naive UTC datetime (how the app stores times)."""
    if ts in (None, "", 0):
        return None
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).replace(tzinfo=None)


def ist_today() -> date:
    return datetime.now(IST).date()


def ist_bounds(d_from: date, d_to: date) -> tuple[datetime, datetime]:
    """IST calendar days [d_from, d_to] as naive UTC [start, end)."""
    start = datetime.combine(d_from, time.min, tzinfo=IST).astimezone(timezone.utc).replace(tzinfo=None)
    end = datetime.combine(d_to + timedelta(days=1), time.min, tzinfo=IST).astimezone(timezone.utc).replace(tzinfo=None)
    return start, end


def _unix(dt_naive_utc: datetime) -> int:
    return int(dt_naive_utc.replace(tzinfo=timezone.utc).timestamp())


def _s(value, size: int) -> str | None:
    return None if value in (None, "") else str(value)[:size]


# ------------------------------------------------------------------ upserts

def _upsert_settlement(db: Session, s: dict, now: datetime) -> bool:
    """Returns True when the settlement was new."""
    sid = s.get("id")
    if not sid:
        return False
    row = db.get(GatewaySettlement, sid)
    new = row is None
    if new:
        row = GatewaySettlement(id=sid)
        db.add(row)
    row.amount = rupees(s.get("amount"))
    row.fees = rupees(s.get("fees"))
    row.tax = rupees(s.get("tax"))
    row.utr = _s(s.get("utr"), 60)
    row.status = _s(s.get("status"), 20) or "unknown"
    row.created_at = from_unix(s.get("created_at")) or row.created_at or now
    row.raw = s
    row.synced_at = now
    return new


def _upsert_items(db: Session, rows: list[dict], now: datetime) -> int:
    """Recon rows keyed by (entity_id, type). Returns how many were new."""
    rows = [r for r in rows if r.get("entity_id") and r.get("type")]
    if not rows:
        return 0
    ids = {r["entity_id"] for r in rows}
    existing = {
        (i.entity_id, i.entity_type): i
        for i in db.scalars(select(GatewaySettlementItem).where(GatewaySettlementItem.entity_id.in_(ids))).all()
    }
    new = 0
    for r in rows:
        key = (str(r["entity_id"]), str(r["type"]))
        item = existing.get(key)
        if item is None:
            item = GatewaySettlementItem(entity_id=key[0][:40], entity_type=key[1][:20])
            db.add(item)
            existing[key] = item
            new += 1
        # payment_id = the payment this row belongs to: Razorpay sends it for refunds / transfers and
        # null for payments, where the payment is the entity itself
        item.payment_id = _s(r.get("payment_id") or (r["entity_id"] if r["type"] == "payment" else None), 40)
        item.gateway_order_id = _s(r.get("order_id"), 40)
        item.settlement_id = _s(r.get("settlement_id"), 40)
        item.settlement_utr = _s(r.get("settlement_utr"), 60)
        item.amount = rupees(r.get("amount"))
        item.credit = rupees(r.get("credit"))
        item.debit = rupees(r.get("debit"))
        item.fee = rupees(r.get("fee"))
        item.tax = rupees(r.get("tax"))
        item.settled = bool(r.get("settled"))
        item.entity_created_at = from_unix(r.get("created_at"))
        item.settled_at = from_unix(r.get("settled_at"))
        item.raw = r
        item.synced_at = now
    return new


def _items(page) -> list[dict]:
    return list((page or {}).get("items") or [])


# ------------------------------------------------------------------ sync

def sync(db: Session, date_from: date, date_to: date) -> dict:
    """Fetch settlements and their recon rows for IST days [date_from, date_to] and upsert them.
    Idempotent. Gateway errors propagate (caller rolls back). Caller commits."""
    if not gateway.is_configured(db):
        return {"skipped": True, "message": NOT_CONFIGURED}
    if not _lock.acquire(blocking=False):
        raise SyncBusy("A settlement sync is already running. Please try again in a minute.")
    try:
        return _sync(db, date_from, date_to)
    finally:
        _lock.release()


def _sync(db: Session, date_from: date, date_to: date) -> dict:
    rz = gateway.client(db)
    now = utcnow()
    start, end = ist_bounds(date_from, date_to)
    out = {"date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
           "settlements": 0, "settlements_new": 0, "items": 0, "items_new": 0}

    # 1. settlements created in the window
    seen: set[str] = set()
    for n in range(MAX_PAGES):
        page = _items(rz.settlement.all(
            {"from": _unix(start), "to": _unix(end) - 1, "count": SETTLEMENTS_PAGE, "skip": n * SETTLEMENTS_PAGE},
            timeout=TIMEOUT))
        for s in page:
            out["settlements_new"] += _upsert_settlement(db, s, now)
            seen.add(s.get("id"))
        db.flush()
        if len(page) < SETTLEMENTS_PAGE:
            break

    # 2. recon rows, one day at a time
    referenced: set[str] = set()
    day = date_from
    while day <= date_to:
        for n in range(MAX_PAGES):
            rows = _items(rz.settlement.report(
                {"year": day.year, "month": day.month, "day": day.day, "count": RECON_PAGE, "skip": n * RECON_PAGE},
                timeout=TIMEOUT))
            out["items_new"] += _upsert_items(db, rows, now)
            out["items"] += len(rows)
            referenced.update(r["settlement_id"] for r in rows if r.get("settlement_id"))
            db.flush()
            if len(rows) < RECON_PAGE:
                break
        day += timedelta(days=1)

    # 3. settlements that recon rows point to but that were created outside the window
    missing = referenced - seen
    if missing:
        stored = set(db.scalars(select(GatewaySettlement.id).where(GatewaySettlement.id.in_(missing))).all())
        for sid in sorted(missing - stored):
            s = rz.settlement.fetch(sid, timeout=TIMEOUT)
            out["settlements_new"] += _upsert_settlement(db, s, now)
            seen.add(sid)
        db.flush()
    out["settlements"] = len(seen - {None})

    set_setting(db, STATE_KEY, {"last_synced_at": now.isoformat(), "last_result": out, "last_error": None,
                                "last_error_at": None})
    return out


def record_error(db: Session, exc: Exception) -> None:
    """Remember the last failure so Admin → Payments can show it. Caller commits."""
    set_setting(db, STATE_KEY, {"last_error": str(exc)[:300] or exc.__class__.__name__,
                                "last_error_at": utcnow().isoformat()})


def status(db: Session) -> dict:
    state = get_setting(db, STATE_KEY)
    last = state.get("last_synced_at")
    if not last:  # fall back to the data itself
        last = db.scalar(select(func.max(GatewaySettlementItem.synced_at))) or db.scalar(select(func.max(GatewaySettlement.synced_at)))
        last = last.isoformat() if last else None
    return {
        "configured": gateway.is_configured(db),
        "mode": get_setting(db, "payment").get("gateway_mode"),
        "last_synced_at": last,
        "last_result": state.get("last_result"),
        "last_error": state.get("last_error"),
        "last_error_at": state.get("last_error_at"),
    }


def sync_job() -> None:
    """Called every 6 hours by the app (see app/main.py). Never raises."""
    try:
        with SessionLocal() as db:
            if not gateway.is_configured(db):
                log.info("Settlement sync skipped: Razorpay keys are not configured")
                return
            today = ist_today()
            try:
                result = sync(db, today - timedelta(days=JOB_DAYS - 1), today)
                db.commit()
                log.info("Settlement sync done: %s", result)
            except SyncBusy:
                log.info("Settlement sync skipped: another sync is running")
            except Exception as exc:
                db.rollback()
                log.warning("Settlement sync failed: %s", exc)
                record_error(db, exc)
                db.commit()
    except Exception:
        log.exception("Settlement sync job crashed")
