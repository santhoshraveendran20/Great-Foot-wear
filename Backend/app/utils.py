import re
import unicodedata
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text or "item"


def unique_slug(db: Session, model, text: str, exclude_id: int | None = None) -> str:
    base = slugify(text)[:120]
    slug, n = base, 2
    while True:
        stmt = select(model.id).where(model.slug == slug)
        if exclude_id:
            stmt = stmt.where(model.id != exclude_id)
        if not db.scalar(stmt):
            return slug
        slug = f"{base}-{n}"
        n += 1


# ------------------------------------------------------------------ India calendar days
# Times are stored as naive UTC; "today", report dates and dashboard periods follow the shop's calendar (IST).
IST = timezone(timedelta(hours=5, minutes=30))


def ist_today() -> date:
    return datetime.now(IST).date()


def ist_day_start(d: date) -> datetime:
    """Midnight IST of day d, as the naive UTC datetime used in the database."""
    return datetime.combine(d, time.min, tzinfo=IST).astimezone(timezone.utc).replace(tzinfo=None)


def ist_date(dt: datetime | None) -> date | None:
    """IST calendar date of a stored (naive UTC) datetime."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).astimezone(IST).date()
