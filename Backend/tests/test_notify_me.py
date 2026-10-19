"""CT-10 "Notify me" when an out-of-stock size returns."""
import io
import json
import uuid
from collections import defaultdict, deque

import pytest
from PIL import Image
from sqlalchemy import event, select

import app.core.ratelimit as ratelimit
import app.services.notify as notify
from app.core.config import settings
from app.db import SessionLocal, engine
from app.models import Product, ProductVariant, StockAlert
from app.services.stock import change_stock


def h(token):
    return {"Authorization": f"Bearer {token}"}


def _uid() -> str:
    return uuid.uuid4().hex[:10]


def _guest_email() -> str:
    return f"guest{_uid()}@example.com"


def _mobile() -> str:
    return "6" + str(uuid.uuid4().int)[:9]


@pytest.fixture(autouse=True)
def _fresh_rate_limit(monkeypatch):
    monkeypatch.setattr(ratelimit, "_hits", defaultdict(deque))


@pytest.fixture
def sent(monkeypatch):
    """Captures every email / SMS sent through app.services.notify."""
    box = {"email": [], "sms": []}
    monkeypatch.setattr(notify, "send_email", lambda to, subject, body, *a, **k: box["email"].append((to, subject, body)))
    monkeypatch.setattr(notify, "send_sms", lambda to, text: box["sms"].append((to, text)) if to else None)
    return box


def _back_in_stock(box):
    return [m for m in box["email"] if m[1].startswith("Back in stock")]


def _back_in_stock_sms(box):
    return [to for to, text in box["sms"] if "back in stock" in text]


def _product(client, admin_token, sizes: dict[str, int], active: bool = True):
    n = _uid()
    cats = client.get("/api/admin/categories", headers=h(admin_token)).json()
    body = {
        "name": f"Notify Runner {n}", "category_id": cats[0]["id"], "gender": "unisex", "hsn_code": "6404", "gst_rate": 12, "mrp": 999, "price": 899,
        "is_active": active,
        "variants": [{"sku": f"NM-{n}-{s}", "size": s, "colour": "Black", "stock_qty": q} for s, q in sizes.items()],
    }
    png = io.BytesIO()
    Image.new("RGB", (20, 20), "white").save(png, "PNG")
    r = client.post("/api/admin/products", headers=h(admin_token), data={"data": json.dumps(body)},
                    files=[("files", ("p.png", png.getvalue(), "image/png"))])
    assert r.status_code == 201, r.text
    p = r.json()
    return p, {v["size"]: v["id"] for v in p["variants"]}


def _subscribe(client, vid, token=None, **body):
    return client.post(f"/api/catalog/variants/{vid}/notify-me", json=body, headers=h(token) if token else {})


def _alerts(vid):
    with SessionLocal() as db:
        return db.scalars(select(StockAlert).where(StockAlert.variant_id == vid).order_by(StockAlert.id)).all()


def _adjust(client, admin_token, vid, qty, reason="purchase"):
    r = client.post("/api/admin/inventory/adjust", headers=h(admin_token), json={"variant_id": vid, "change_qty": qty, "reason": reason})
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------ subscribe

def test_guest_subscribe_is_idempotent(client, admin_token):
    p, v = _product(client, admin_token, {"7": 0})
    assert _subscribe(client, v["7"]).status_code == 400  # guest must give an email
    assert _subscribe(client, v["7"], email="not-an-email").status_code == 422
    assert _subscribe(client, v["7"], email=_guest_email(), mobile="12345").status_code == 422

    email = _guest_email()
    r = _subscribe(client, v["7"], email=email.upper(), mobile="")
    assert r.status_code == 201, r.text
    first = r.json()
    assert first["already_subscribed"] is False and email in first["message"]
    r = _subscribe(client, v["7"], email=email, mobile=_mobile())
    assert r.status_code == 200 and r.json()["already_subscribed"] is True and r.json()["alert_id"] == first["alert_id"]
    alerts = _alerts(v["7"])
    assert len(alerts) == 1 and alerts[0].email == email and alerts[0].user_id is None and alerts[0].mobile  # mobile added
    assert alerts[0].notified_at is None


def test_only_out_of_stock_active_sizes(client, admin_token):
    p, v = _product(client, admin_token, {"8": 2, "9": 0})
    r = _subscribe(client, v["8"], email=_guest_email())
    assert r.status_code == 400 and "in stock" in r.json()["detail"]
    draft, dv = _product(client, admin_token, {"9": 0}, active=False)
    assert _subscribe(client, dv["9"], email=_guest_email()).status_code == 400
    with SessionLocal() as db:
        db.get(ProductVariant, v["9"]).is_active = False
        db.commit()
    assert _subscribe(client, v["9"], email=_guest_email()).status_code == 400
    assert _subscribe(client, 987654321, email=_guest_email()).status_code == 404


def test_customer_uses_account_details_list_and_delete(client, admin_token, make_customer):
    p, v = _product(client, admin_token, {"6": 0, "7": 0})
    uid, token, email, mobile = make_customer()
    r = _subscribe(client, v["6"], token, email="someone.else@example.com", mobile=_mobile())
    assert r.status_code == 201, r.text
    alert = _alerts(v["6"])[0]
    assert (alert.email, alert.mobile, alert.user_id) == (email, mobile, uid)  # body ignored for signed-in customers
    # a guest request made earlier with the customer's verified email is theirs too
    assert _subscribe(client, v["7"], email=email).status_code == 201

    mine = client.get("/api/catalog/notify-me", headers=h(token))
    assert mine.status_code == 200
    rows = {a["variant_id"]: a for a in mine.json()}
    assert set(rows) == {v["6"], v["7"]}
    assert rows[v["6"]]["product_slug"] == p["slug"] and rows[v["6"]]["product_name"] == p["name"]
    assert rows[v["6"]]["size"] == "6" and rows[v["6"]]["colour"] == "Black" and "created_at" in rows[v["6"]]

    _, other_token, _, _ = make_customer()
    assert client.get("/api/catalog/notify-me", headers=h(other_token)).json() == []
    assert client.delete(f"/api/catalog/notify-me/{alert.id}", headers=h(other_token)).status_code == 404
    assert client.delete(f"/api/catalog/notify-me/{alert.id}", headers=h(token)).status_code == 200
    assert client.delete(f"/api/catalog/notify-me/{alert.id}", headers=h(token)).status_code == 404
    assert [a["variant_id"] for a in client.get("/api/catalog/notify-me", headers=h(token)).json()] == [v["7"]]
    assert client.get("/api/catalog/notify-me").status_code == 401


def test_staff_and_expired_tokens(client, admin_token, staff_token):
    p, v = _product(client, admin_token, {"10": 0})
    assert _subscribe(client, v["10"], staff_token, email=_guest_email()).status_code == 403
    assert _subscribe(client, v["10"], admin_token, email=_guest_email()).status_code == 403
    assert client.get("/api/catalog/notify-me", headers=h(staff_token)).status_code == 403
    # a stale token gets 401 (so the app refreshes the session) instead of silently becoming a guest request
    assert _subscribe(client, v["10"], "expired.or.forged", email=_guest_email()).status_code == 401
    assert _alerts(v["10"]) == []


def test_rate_limited(client):
    for _ in range(20):
        assert _subscribe(client, 987654321, email=_guest_email()).status_code == 404
    assert _subscribe(client, 987654321, email=_guest_email()).status_code == 429


# ------------------------------------------------------------------ restock trigger

def test_restock_sends_once_after_commit(client, admin_token, make_customer, sent):
    p, v = _product(client, admin_token, {"8": 0})
    vid = v["8"]
    guest, guest_mobile = _guest_email(), _mobile()
    _, token, cust_email, cust_mobile = make_customer()
    assert _subscribe(client, vid, email=guest, mobile=guest_mobile).status_code == 201
    assert _subscribe(client, vid, token).status_code == 201

    with SessionLocal() as db:
        change_stock(db, vid, 2, "purchase")
        assert sent["email"] == [] and sent["sms"] == []  # queued, not sent before COMMIT
        db.commit()
    mails = _back_in_stock(sent)
    assert sorted(m[0] for m in mails) == sorted([guest, cust_email])
    to, subject, body = mails[0]
    assert subject == f"Back in stock: {p['name']}"
    assert "size 8" in body and "Black" in body and f"{settings.FRONTEND_URL.rstrip('/')}/product/{p['slug']}" in body
    assert sorted(_back_in_stock_sms(sent)) == sorted([guest_mobile, cust_mobile])
    assert all(a.notified_at is not None for a in _alerts(vid))
    assert client.get("/api/catalog/notify-me", headers=h(token)).json() == []

    # more stock, or sold out and restocked again: already-notified alerts are never sent again
    _adjust(client, admin_token, vid, 1)
    _adjust(client, admin_token, vid, -3, "store_sale")
    assert _adjust(client, admin_token, vid, 4)["alerts_notified"] == 0
    assert len(_back_in_stock(sent)) == 2 and len(_back_in_stock_sms(sent)) == 2


def test_admin_restock_reports_alerts_notified(client, admin_token, sent):
    p, v = _product(client, admin_token, {"9": 0})
    emails = [_guest_email() for _ in range(3)]
    for e in emails:
        assert _subscribe(client, v["9"], email=e).status_code == 201
    r = _adjust(client, admin_token, v["9"], 5)
    assert r == {"variant_id": v["9"], "stock_qty": 5, "alerts_notified": 3}
    assert sorted(m[0] for m in _back_in_stock(sent)) == sorted(emails)


def test_cancellation_restock_notifies(client, admin_token, make_customer, sent):
    p, v = _product(client, admin_token, {"11": 1})
    _, buyer, _, _ = make_customer()
    assert client.post("/api/cart/items", headers=h(buyer), json={"variant_id": v["11"], "qty": 1}).status_code == 200
    r = client.post("/api/orders/checkout", headers=h(buyer), json={"fulfilment": "pickup", "payment_method": "cod"})
    assert r.status_code == 201, r.text
    guest = _guest_email()
    assert _subscribe(client, v["11"], email=guest).status_code == 201  # last pair sold
    assert _back_in_stock(sent) == []
    r = client.post(f"/api/orders/{r.json()['order']['id']}/cancel", headers=h(buyer), json={"reason": "Ordered wrong size"})
    assert r.status_code == 200, r.text
    assert [m[0] for m in _back_in_stock(sent)] == [guest]


def test_rollback_sends_nothing(client, admin_token, sent):
    p, v = _product(client, admin_token, {"5": 0, "6": 3})
    vid, other = v["5"], v["6"]
    assert _subscribe(client, vid, email=_guest_email()).status_code == 201

    with SessionLocal() as db:  # explicit rollback (e.g. checkout that fails after the stock change)
        change_stock(db, vid, 3, "purchase")
        db.rollback()
    with SessionLocal() as db:  # session closed without commit (HTTPException after the stock change)
        change_stock(db, vid, 3, "purchase")
    with SessionLocal() as db:  # the discarded message must not leak into a later commit of the same session
        change_stock(db, vid, 3, "purchase")
        db.rollback()
        change_stock(db, other, -1, "store_sale")
        db.commit()
    with SessionLocal() as db:  # SAVEPOINT rolled back, outer transaction committed
        change_stock(db, other, -1, "store_sale")  # outer DML first (pysqlite begins lazily)
        try:
            with db.begin_nested():
                change_stock(db, vid, 3, "purchase")
                raise RuntimeError("abort savepoint")
        except RuntimeError:
            pass
        db.commit()
    assert _back_in_stock(sent) == []
    assert _alerts(vid)[0].notified_at is None
    with SessionLocal() as db:
        assert db.get(ProductVariant, vid).stock_qty == 0

    with SessionLocal() as db:  # SAVEPOINT released: still waits for the outer COMMIT, then sends exactly once
        change_stock(db, other, -1, "store_sale")
        with db.begin_nested():
            change_stock(db, vid, 2, "purchase")
        assert _back_in_stock(sent) == []
        db.commit()
    assert len(_back_in_stock(sent)) == 1
    assert _alerts(vid)[0].notified_at is not None


def test_inactive_variant_or_product_sends_nothing(client, admin_token, sent):
    p, v = _product(client, admin_token, {"7": 0, "8": 0})
    assert _subscribe(client, v["7"], email=_guest_email()).status_code == 201
    assert _subscribe(client, v["8"], email=_guest_email()).status_code == 201
    with SessionLocal() as db:
        db.get(ProductVariant, v["7"]).is_active = False
        db.commit()
    assert _adjust(client, admin_token, v["7"], 2)["alerts_notified"] == 0
    with SessionLocal() as db:
        db.get(Product, p["id"]).is_active = False
        db.commit()
    assert _adjust(client, admin_token, v["8"], 2)["alerts_notified"] == 0
    assert _back_in_stock(sent) == []
    assert all(a.notified_at is None for a in _alerts(v["7"]) + _alerts(v["8"]))  # stay pending


# ------------------------------------------------------------------ admin inventory

def test_inventory_waiting_alerts_single_query(client, admin_token):
    p, v = _product(client, admin_token, {"6": 0, "7": 0, "8": 4})
    for _ in range(2):
        assert _subscribe(client, v["6"], email=_guest_email()).status_code == 201
    assert _subscribe(client, v["7"], email=_guest_email()).status_code == 201

    statements = []

    def _log(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _log)
    try:
        r = client.get("/api/admin/inventory", headers=h(admin_token), params={"q": p["name"]})
    finally:
        event.remove(engine, "before_cursor_execute", _log)
    assert r.status_code == 200, r.text
    counts = {row["variant_id"]: row["waiting_alerts"] for row in r.json()["items"]}
    assert counts == {v["6"]: 2, v["7"]: 1, v["8"]: 0}
    assert sum("stock_alerts" in s for s in statements) == 1  # one grouped query, not one per row

    r = client.get("/api/admin/inventory", headers=h(admin_token), params={"q": p["name"], "waiting": True})
    assert {row["variant_id"] for row in r.json()["items"]} == {v["6"], v["7"]}
