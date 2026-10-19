"""Email / SMS notifications (OR-06, CO-05, AD-17).

No SMS provider is named in the BRD, so SMS_PROVIDER=console writes messages to
the server log. Plug a provider (MSG91, Twilio, ...) into `_send_sms`.
Email uses SMTP when SMTP_HOST is set; otherwise it is logged."""
import logging
import smtplib
from concurrent.futures import ThreadPoolExecutor
from email.message import EmailMessage

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Order, User
from app.services.store_settings import get_setting

log = logging.getLogger("gfw.notify")
_pool = ThreadPoolExecutor(max_workers=4)

STATUS_LABELS = {
    "pending_payment": "Pending Payment",
    "confirmed": "Confirmed",
    "packed": "Packed",
    "shipped": "Shipped",
    "out_for_delivery": "Out for Delivery",
    "delivered": "Delivered",
    "cancelled": "Cancelled",
    "return_requested": "Return Requested",
    "returned": "Returned",
    "refunded": "Refunded",
}


def _send_email(to: str, subject: str, body: str, attachments: list[tuple[str, bytes, str]] | None = None) -> None:
    if not settings.SMTP_HOST:
        log.info("[EMAIL] to=%s subject=%s\n%s", to, subject, body)
        return
    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    for filename, data, mime in attachments or []:
        maintype, subtype = mime.split("/")
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as s:
            if settings.SMTP_TLS:
                s.starttls()
            if settings.SMTP_USER:
                s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.send_message(msg)
    except Exception:  # never break the request because of email
        log.exception("Email send failed to %s", to)


def _send_sms(mobile: str, text: str) -> None:
    if settings.SMS_PROVIDER == "console":
        log.info("[SMS] to=%s %s", mobile, text)
        return
    log.warning("SMS provider '%s' not configured; message to %s dropped", settings.SMS_PROVIDER, mobile)


def send_email(to: str, subject: str, body: str, attachments=None) -> None:
    _pool.submit(_send_email, to, subject, body, attachments)


def send_sms(mobile: str | None, text: str) -> None:
    if not mobile:  # Google sign-in accounts may not have a mobile number yet (UM-04)
        return
    _pool.submit(_send_sms, mobile, text)


def _render(template: str, **values) -> str:
    try:
        return template.format(**values)
    except (KeyError, IndexError):
        return template


def notify_order_placed(db: Session, order: Order) -> None:
    tpl = get_setting(db, "notification_templates")["order_placed"]
    user: User = order.user
    values = {"name": user.name, "order_no": order.order_no, "total": f"{order.total:.2f}"}
    send_email(user.email, _render(tpl["subject"], **values), _render(tpl["body"], **values))
    send_sms(user.mobile, _render(tpl["body"], **values))
    notify_admin(db, f"New order {order.order_no}", f"New order {order.order_no} – Rs.{order.total:.2f} ({order.payment_method.upper()})")


def notify_order_status(db: Session, order: Order, status: str, note: str | None = None) -> None:
    tpl = get_setting(db, "notification_templates")["order_status"]
    user: User = order.user
    values = {
        "name": user.name,
        "order_no": order.order_no,
        "status": STATUS_LABELS.get(status, status),
        "note": note or "",
    }
    send_email(user.email, _render(tpl["subject"], **values), _render(tpl["body"], **values))
    send_sms(user.mobile, _render(tpl["body"], **values))


def notify_refund(db: Session, order: Order, amount, status: str) -> None:
    tpl = get_setting(db, "notification_templates")["refund"]
    user: User = order.user
    values = {"name": user.name, "order_no": order.order_no, "amount": f"{amount:.2f}", "status": status}
    send_email(user.email, _render(tpl["subject"], **values), _render(tpl["body"], **values))
    send_sms(user.mobile, _render(tpl["body"], **values))


def notify_admin(db: Session, subject: str, body: str) -> None:
    """AD-17 admin alerts on new order and low stock."""
    alerts = get_setting(db, "admin_alerts")
    for email in alerts.get("emails") or []:
        send_email(email, subject, body)
    for mobile in alerts.get("mobiles") or []:
        send_sms(mobile, body)
