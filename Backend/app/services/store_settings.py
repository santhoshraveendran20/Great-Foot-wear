"""Store configuration kept in the `settings` table (AD-14, AD-16, PY-12).
Numeric business values (shipping fee, COD limits, delivery days...) are set by
the owner in Admin → Settings; defaults below are neutral starting points."""
import copy

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Setting

DEFAULTS: dict[str, dict] = {
    "store": {
        "name": "Great Foot Wear",
        "address": "#106/3, Kamarajar Salai, Manali, Mathur MMDA, Chennai – 68",
        "city": "Chennai",
        "state": "Tamil Nadu",
        "state_code": "33",
        "pincode": "600068",
        "phones": ["93859 38581", "95661 16654"],
        "email": "",
        "gstin": "",
        "logo_url": "",
        # store finder page: Google Maps link + pin position, and opening hours text (shown only when filled in)
        "map_url": "https://maps.app.goo.gl/fM7cKSW4dhQULw116",
        # Google's listing id (CID) for the shop, so the map shows its name, address and rating card
        "map_cid": "14542216090117738325",
        "map_lat": 13.1669847,
        "map_lng": 80.2466069,
        "opening_hours": "",
    },
    "shipping": {
        "flat_fee": 0,
        "free_shipping_threshold": None,  # CW-05; None = no free-shipping rule
        "serviceable_pincodes": [],  # empty = all Indian PIN codes serviceable
        "delivery_days_min": 2,
        "delivery_days_max": 7,
        "pickup_enabled": True,  # CO-02 store pickup at Manali
    },
    "cod": {
        "enabled": True,
        "max_order_value": None,  # PY-02
        "blocked_pincodes": [],
        "fee": 0,
    },
    "returns": {"window_days": 7},  # OR-04
    "courier": {
        # manual = staff types courier + AWB (OR-05); shiprocket = create shipment / AWB / pickup / tracking via API
        "provider": "manual",
        "pickup_location": "",  # pickup location nickname exactly as configured in the Shiprocket panel
        # package used for one pair; set by the owner (no defaults — values come from the actual shoe box)
        "package_length_cm": None,
        "package_breadth_cm": None,
        "package_height_cm": None,
        "package_weight_kg": None,
        "use_for_pincode_check": False,  # CT-07: use Shiprocket serviceability for ETD / COD on product page
    },
    "payment": {"online_enabled": True, "gateway_mode": "test"},  # PY-12 test/live switch
    "admin_alerts": {"emails": [], "mobiles": []},  # AD-17
    "notification_templates": {
        "order_placed": {
            "subject": "Order {order_no} confirmed",
            "body": "Hi {name}, your order {order_no} for Rs.{total} is confirmed. Thank you for shopping with Great Foot Wear.",
        },
        "order_status": {
            "subject": "Order {order_no}: {status}",
            "body": "Hi {name}, your order {order_no} is now {status}. {note}",
        },
        "refund": {
            "subject": "Refund for order {order_no}",
            "body": "Hi {name}, a refund of Rs.{amount} for order {order_no} is {status}.",
        },
        "back_in_stock": {  # CT-10
            "subject": "Back in stock: {product}",
            "body": "Good news! {product} (size {size}, {colour}) is back in stock at Great Foot Wear. Buy now: {link}",
        },
    },
}


def get_setting(db: Session, key: str) -> dict:
    row = db.get(Setting, key)
    value = copy.deepcopy(DEFAULTS.get(key, {}))
    if row and isinstance(row.value, dict):
        value.update(row.value)
    return value


def set_setting(db: Session, key: str, value: dict) -> dict:
    merged = get_setting(db, key)
    merged.update(value)
    row = db.get(Setting, key)
    if row:
        row.value = merged
    else:
        db.add(Setting(key=key, value=merged))
    return merged


def all_settings(db: Session) -> dict:
    return {key: get_setting(db, key) for key in DEFAULTS}


def public_settings(db: Session) -> dict:
    """Values the storefront needs (no secrets)."""
    store = get_setting(db, "store")
    shipping = get_setting(db, "shipping")
    cod = get_setting(db, "cod")
    payment = get_setting(db, "payment")
    returns = get_setting(db, "returns")
    return {
        "store": store,
        "shipping": {
            "flat_fee": shipping["flat_fee"],
            "free_shipping_threshold": shipping["free_shipping_threshold"],
            "pickup_enabled": shipping["pickup_enabled"],
        },
        "cod": {"enabled": cod["enabled"], "fee": cod["fee"], "max_order_value": cod["max_order_value"]},
        "online_payment_enabled": payment["online_enabled"],
        "return_window_days": returns["window_days"],
        "google_client_id": settings.GOOGLE_CLIENT_ID or None,  # UM-04; public by design (OAuth client id)
    }
