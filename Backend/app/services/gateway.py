"""Razorpay integration (PY-03, PY-04, PY-05, PY-07, PY-12).
Keys come only from server environment variables; the test/live switch is in
Admin → Settings (payment.gateway_mode) and selects which key pair is used."""
import hashlib
import hmac
from decimal import Decimal

import razorpay
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services.store_settings import get_setting


def _keys(db: Session) -> tuple[str, str]:
    mode = get_setting(db, "payment").get("gateway_mode") or settings.RAZORPAY_MODE
    if mode == "live":
        return settings.RAZORPAY_LIVE_KEY_ID, settings.RAZORPAY_LIVE_KEY_SECRET
    return settings.RAZORPAY_TEST_KEY_ID, settings.RAZORPAY_TEST_KEY_SECRET


def is_configured(db: Session) -> bool:
    key_id, secret = _keys(db)
    return bool(key_id and secret)


def key_id(db: Session) -> str:
    return _keys(db)[0]


def client(db: Session) -> razorpay.Client:
    key, secret = _keys(db)
    if not key or not secret:
        raise HTTPException(503, "Online payment is not configured. Please choose Cash on Delivery.")
    return razorpay.Client(auth=(key, secret))


def to_paise(amount: Decimal) -> int:
    return int((Decimal(amount) * 100).quantize(Decimal("1")))


def create_order(db: Session, amount: Decimal, receipt: str, notes: dict | None = None) -> dict:
    """PY-03: amount in paise, receipt = our order number."""
    try:
        return client(db).order.create(
            {"amount": to_paise(amount), "currency": "INR", "receipt": receipt, "notes": notes or {}}
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Payment gateway error: {exc}") from exc


def verify_payment_signature(db: Session, gateway_order_id: str, payment_id: str, signature: str) -> bool:
    """PY-04: HMAC-SHA256(order_id|payment_id, key_secret)."""
    _, secret = _keys(db)
    if not secret:
        return False
    expected = hmac.new(secret.encode(), f"{gateway_order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


def verify_webhook_signature(body: bytes, signature: str) -> bool:
    """PY-05: HMAC-SHA256(raw body, webhook secret)."""
    secret = settings.RAZORPAY_WEBHOOK_SECRET
    if not secret:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


def fetch_payment(db: Session, payment_id: str) -> dict:
    try:
        return client(db).payment.fetch(payment_id)
    except Exception as exc:
        raise HTTPException(502, f"Payment gateway error: {exc}") from exc


def refund(db: Session, payment_id: str, amount: Decimal, notes: dict | None = None) -> dict:
    """PY-07: full / partial refund through the gateway API."""
    try:
        return client(db).payment.refund(payment_id, {"amount": to_paise(amount), "notes": notes or {}})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Refund failed at gateway: {exc}") from exc
