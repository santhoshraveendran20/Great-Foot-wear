"""End-to-end flows mapped to BRD 10.4 acceptance criteria."""
import hashlib
import hmac
import io
import json
import re
from datetime import timedelta

import pytest
from PIL import Image

from app.core.security import utcnow
from app.db import SessionLocal
from app.models import Order, ProductVariant

ADMIN = {"identifier": "owner@greatfootwear.in", "password": "ChangeMe123"}
NEW_ADMIN_PW = "OwnerPass2026"
state: dict = {}


def h(token):
    return {"Authorization": f"Bearer {token}"}


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 40), (200, 50, 50)).save(buf, "PNG")
    return buf.getvalue()


def _post_product(client, headers, body, images=1):
    """Create a product the way the admin form does: ProductIn JSON plus image files in one multipart request."""
    files = [("files", (f"p{i}.png", _png(), "image/png")) for i in range(images)]
    return client.post("/api/admin/products", headers=headers, data={"data": json.dumps(body)}, files=files or None)


def _otp(outbox, mobile):
    return re.search(r"\b(\d{6})\b", [t for m, t in outbox["sms"] if m == mobile][-1]).group(1)


# ------------------------------------------------------------------ admin setup

def test_admin_forced_password_change(client):
    r = client.post("/api/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    assert r.json()["user"]["must_change_password"] is True
    assert client.get("/api/admin/dashboard", headers=h(tok)).status_code == 403  # UM-15
    r = client.put("/api/users/me/password", headers=h(tok), json={"current_password": ADMIN["password"], "new_password": NEW_ADMIN_PW})
    assert r.status_code == 200, r.text
    tok = client.post("/api/auth/login", json={"identifier": ADMIN["identifier"], "password": NEW_ADMIN_PW}).json()["access_token"]
    assert client.get("/api/admin/dashboard", headers=h(tok)).status_code == 200
    state["admin"] = tok


def test_admin_creates_product_with_variants(client):
    a = h(state["admin"])
    cats = client.get("/api/admin/categories", headers=a).json()
    assert {c["name"] for c in cats} >= {"Men", "Women", "Kids", "School shoes", "Sports", "Formal", "Sandals & Slippers"}
    men = next(c for c in cats if c["name"] == "Men")
    brand = client.post("/api/admin/brands", headers=a, json={"name": "TestBrand"}).json()
    body = {
        "name": "Leather Formal Shoe", "brand_id": brand["id"], "category_id": men["id"], "gender": "men",
        "material": "Leather", "hsn_code": "6403", "gst_rate": 12, "mrp": 1999, "price": 1499, "is_active": True,
        "variants": [
            {"sku": "LFS-BLK-7", "size": "7", "colour": "Black", "stock_qty": 3},
            {"sku": "LFS-BLK-8", "size": "8", "colour": "Black", "stock_qty": 2},
            {"sku": "LFS-BRN-8", "size": "8", "colour": "Brown", "stock_qty": 0},
        ],
    }
    assert _post_product(client, a, body, images=0).status_code == 422  # an image is mandatory
    r = _post_product(client, a, body)
    assert r.status_code == 201, r.text
    p = r.json()
    state["product"] = p
    assert len(p["images"]) == 1 and p["images"][0]["url"].endswith(".webp")  # NF-01 WebP
    r = client.post(f"/api/admin/products/{p['id']}/images", headers=a, files=[("files", ("a.png", _png(), "image/png"))])
    assert r.status_code == 200 and len(r.json()["images"]) == 2
    # SKU uniqueness
    dup = _post_product(client, a, {**body, "name": "Dup", "variants": [{"sku": "LFS-BLK-7", "size": "9", "colour": "Black"}]})
    assert dup.status_code == 409


def test_catalog_filter_search_sort(client):
    r = client.get("/api/catalog/products", params={"category": "men", "size": "8", "colour": "Black", "sort": "price_asc"})
    assert r.status_code == 200 and r.json()["total"] == 1
    assert client.get("/api/catalog/products", params={"size": "8", "colour": "Brown"}).json()["total"] == 0  # out of stock
    r = client.get("/api/catalog/products", params={"q": "lether formel"})  # typo tolerant (CT-05)
    assert r.json()["total"] == 1
    assert client.get("/api/catalog/search/suggest", params={"q": "leath"}).json()["products"]
    d = client.get(f"/api/catalog/products/{state['product']['slug']}").json()
    brown = next(v for v in d["variants"] if v["colour"] == "Brown")
    assert brown["in_stock"] is False and d["discount_pct"] == 25
    pin = client.get("/api/catalog/pincode/600068").json()
    assert pin["serviceable"] and pin["cod_available"]


# ------------------------------------------------------------------ customer

def test_register_verify_login(client, outbox):
    r = client.post("/api/auth/register", json={"name": "Ravi", "mobile": "9876543210", "email": "ravi@example.com", "password": "short"})
    assert r.status_code == 422  # UM-06
    r = client.post("/api/auth/register", json={"name": "Ravi", "mobile": "9876543210", "email": "ravi@example.com", "password": "Shoes2026"})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    assert "gfw_refresh" in r.cookies or "gfw_refresh" in client.cookies
    assert client.post("/api/auth/verify-otp", headers=h(tok), json={"code": "000000"}).status_code == 400
    r = client.post("/api/auth/verify-otp", headers=h(tok), json={"code": _otp(outbox, "9876543210")})
    assert r.json()["user"]["mobile_verified"] is True
    link = [b for to, s, b in outbox["email"] if to == "ravi@example.com"][-1]
    token = re.search(r"token=([\w-]+)", link).group(1)
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 400  # single use
    r = client.post("/api/auth/refresh")
    assert r.status_code == 200 and r.json()["user"]["is_verified"] is True
    state["cust"] = r.json()["access_token"]
    r = client.post("/api/users/me/addresses", headers=h(state["cust"]), json={
        "name": "Ravi", "mobile": "9876543210", "line1": "12 Main Road", "city": "Chennai", "state": "Tamil Nadu", "pincode": "600068"})
    assert r.status_code == 201 and r.json()["is_default"] is True
    state["addr"] = r.json()["id"]
    assert client.post("/api/users/me/addresses", headers=h(state["cust"]), json={
        "name": "X", "mobile": "9876543210", "line1": "abc", "city": "Chennai", "state": "TN", "pincode": "12345"}).status_code == 422


def test_account_lockout(client):
    client.post("/api/auth/register", json={"name": "Lock", "mobile": "9000000001", "email": "lock@example.com", "password": "Shoes2026"})
    for _ in range(5):
        assert client.post("/api/auth/login", json={"identifier": "lock@example.com", "password": "wrong123"}).status_code == 401
    r = client.post("/api/auth/login", json={"identifier": "lock@example.com", "password": "Shoes2026"})
    assert r.status_code == 423  # UM-08


def _variant(sku):
    with SessionLocal() as db:
        from sqlalchemy import select
        return db.scalar(select(ProductVariant).where(ProductVariant.sku == sku))


def test_coupon_and_cod_checkout(client):
    a, c = h(state["admin"]), h(state["cust"])
    r = client.post("/api/admin/coupons", headers=a, json={"code": "FIRST10", "type": "percent", "value": 10, "min_order": 1000,
                                                         "max_discount": 100, "first_order_only": True})
    assert r.status_code == 201, r.text
    v7 = _variant("LFS-BLK-7")
    r = client.post("/api/cart/items", headers=c, json={"variant_id": v7.id, "qty": 5})
    assert r.json()["items"][0]["qty"] == 3  # never above stock (CW-02)
    client.patch(f"/api/cart/items/{r.json()['items'][0]['id']}", headers=c, json={"qty": 1})
    assert client.post("/api/cart/apply-coupon", headers=c, json={"code": "NOPE"}).status_code == 400
    r = client.post("/api/cart/apply-coupon", headers=c, json={"code": "first10"})
    assert r.status_code == 200, r.text
    s = r.json()["summary"]
    assert s["coupon_discount"] == 100 and s["total"] == 1399
    r = client.post("/api/orders/checkout", headers=c, json={"fulfilment": "delivery", "address_id": state["addr"], "payment_method": "cod"})
    assert r.status_code == 201, r.text
    o = r.json()["order"]
    assert re.fullmatch(r"GFW-\d{4}-\d{6}", o["order_no"])  # CO-06
    assert o["order_status"] == "confirmed" and o["payment_status"] == "cod_pending"
    assert _variant("LFS-BLK-7").stock_qty == 2  # stock decreases on order
    state["cod_order"] = o["id"]
    d = client.get(f"/api/orders/{o['id']}", headers=c).json()
    assert d["is_inter_state"] is False and d["tax"] > 0
    assert client.get("/api/cart", headers=c).json()["items"] == []


def test_admin_processes_order_to_delivered(client):
    a, c = h(state["admin"]), h(state["cust"])
    oid = state["cod_order"]
    assert client.get(f"/api/orders/{oid}/invoice", headers=c).status_code == 400  # COD: invoice on delivery
    assert client.post(f"/api/admin/orders/{oid}/status", headers=a, json={"status": "packed"}).status_code == 200
    assert client.put(f"/api/admin/orders/{oid}/shipment", headers=a, json={"courier": "Local", "awb_no": "AWB123"}).status_code == 200
    for st in ("shipped", "out_for_delivery", "delivered"):
        r = client.post(f"/api/admin/orders/{oid}/status", headers=a, json={"status": st})
        assert r.status_code == 200, r.text
    assert client.post(f"/api/admin/orders/{oid}/status", headers=a, json={"status": "packed"}).status_code == 400
    assert client.post(f"/api/orders/{oid}/cancel", headers=c, json={"reason": "late"}).status_code == 400  # after shipped
    d = client.get(f"/api/orders/{oid}", headers=c).json()
    assert d["payment_status"] == "cod_collected" and d["invoice_no"]
    assert [h_["status"] for h_ in d["history"]][-1] == "delivered"
    r = client.get(f"/api/orders/{oid}/invoice", headers=c)
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    assert client.get(f"/api/admin/orders/{oid}/label", headers=a).content[:4] == b"%PDF"


def test_return_restock_and_cod_refund(client):
    a, c = h(state["admin"]), h(state["cust"])
    oid = state["cod_order"]
    d = client.get(f"/api/orders/{oid}", headers=c).json()
    assert d["can_return"]
    r = client.post(f"/api/orders/{oid}/return", headers=c, data={"order_item_id": d["items"][0]["id"], "type": "return", "reason": "Too tight"},
                    files={"photo": ("p.png", _png(), "image/png")})
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    assert client.post(f"/api/admin/returns/{rid}", headers=a, json={"action": "approve"}).status_code == 200
    before = _variant("LFS-BLK-7").stock_qty
    r = client.post(f"/api/admin/returns/{rid}", headers=a, json={"action": "receive", "restock": True})
    assert r.status_code == 200, r.text
    assert _variant("LFS-BLK-7").stock_qty == before + 1  # increases on return
    refunds = client.get("/api/admin/refunds", headers=a).json()
    assert refunds[0]["status"] == "requested" and refunds[0]["mode"] == "manual"
    assert client.post(f"/api/admin/refunds/{refunds[0]['id']}/approve", headers=a).status_code == 400  # needs bank/UPI
    assert client.post(f"/api/orders/{oid}/refund-details", headers=c, json={"upi_id": "ravi@upi"}).status_code == 200
    assert client.post(f"/api/admin/refunds/{refunds[0]['id']}/approve", headers=a).json()["status"] == "processed"
    d = client.get(f"/api/orders/{oid}", headers=c).json()
    assert d["order_status"] == "refunded" and d["payment_status"] == "refunded"


def test_review_by_verified_buyer(client):
    a, c = h(state["admin"]), h(state["cust"])
    slug = state["product"]["slug"]
    assert client.post(f"/api/catalog/products/{slug}/reviews", headers=c, json={"rating": 5, "comment": "Great"}).status_code == 201
    assert client.get(f"/api/catalog/products/{slug}/reviews").json() == []  # awaiting moderation
    rid = client.get("/api/admin/reviews", headers=a).json()[0]["id"]
    client.post(f"/api/admin/reviews/{rid}", headers=a, json={"is_approved": True})
    assert len(client.get(f"/api/catalog/products/{slug}/reviews").json()) == 1


def _sign(secret, msg: bytes) -> str:
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def test_online_payment_signature_and_webhook(client, monkeypatch):
    import app.services.gateway as gw

    c = h(state["cust"])
    monkeypatch.setattr(gw, "create_order", lambda db, amount, receipt, notes=None: {"id": f"order_{receipt}", "amount": gw.to_paise(amount)})
    monkeypatch.setattr(gw, "fetch_payment", lambda db, pid: {"id": pid, "method": "upi"})
    v8 = _variant("LFS-BLK-8")
    client.post("/api/cart/items", headers=c, json={"variant_id": v8.id, "qty": 1})
    r = client.post("/api/orders/checkout", headers=c, json={"fulfilment": "pickup", "payment_method": "online"})
    assert r.status_code == 201, r.text
    o, rz = r.json()["order"], r.json()["razorpay"]
    assert o["order_status"] == "pending_payment" and rz["amount"] == 149900
    assert _variant("LFS-BLK-8").stock_qty == 1  # reserved
    bad = {"order_id": o["id"], "razorpay_order_id": rz["gateway_order_id"], "razorpay_payment_id": "pay_1", "razorpay_signature": "forged"}
    assert client.post("/api/payments/verify", headers=c, json=bad).status_code == 400  # PY-04
    good = {**bad, "razorpay_signature": _sign("test_secret", f"{rz['gateway_order_id']}|pay_1".encode())}
    r = client.post("/api/payments/verify", headers=c, json=good)
    assert r.status_code == 200 and r.json()["order_status"] == "confirmed" and r.json()["invoice_no"]
    # webhook replay is idempotent (PY-05)
    body = json.dumps({"event": "payment.captured", "payload": {"payment": {"entity": {
        "id": "pay_1", "order_id": rz["gateway_order_id"], "method": "upi"}}}}).encode()
    hdr = {"x-razorpay-signature": _sign("webhook_secret", body), "x-razorpay-event-id": "evt_1", "content-type": "application/json"}
    assert client.post("/api/payments/webhook", content=body, headers=hdr).status_code == 200
    assert client.post("/api/payments/webhook", content=body, headers=hdr).json().get("duplicate") is True
    assert client.post("/api/payments/webhook", content=body, headers={**hdr, "x-razorpay-signature": "x"}).status_code == 400
    state["online_order"] = o["id"]


def test_cancel_prepaid_auto_refund(client, monkeypatch):
    import app.services.gateway as gw

    c = h(state["cust"])
    monkeypatch.setattr(gw, "refund", lambda db, pid, amount, notes=None: {"id": "rfnd_1", "status": "processed"})
    before = _variant("LFS-BLK-8").stock_qty
    r = client.post(f"/api/orders/{state['online_order']}/cancel", headers=c, json={"reason": "Changed mind"})
    assert r.status_code == 200, r.text
    assert r.json()["order_status"] == "cancelled"
    assert _variant("LFS-BLK-8").stock_qty == before + 1  # increases on cancellation
    assert client.get(f"/api/orders/{state['online_order']}", headers=c).json()["payment_status"] == "refunded"  # OR-03


def test_unpaid_order_releases_stock(client, monkeypatch):
    import app.services.gateway as gw
    from app.services.orders import expire_reservations

    c = h(state["cust"])
    monkeypatch.setattr(gw, "create_order", lambda db, amount, receipt, notes=None: {"id": f"order_{receipt}"})
    v8 = _variant("LFS-BLK-8")
    client.post("/api/cart/items", headers=c, json={"variant_id": v8.id, "qty": 1})
    o = client.post("/api/orders/checkout", headers=c, json={"fulfilment": "pickup", "payment_method": "online"}).json()["order"]
    assert _variant("LFS-BLK-8").stock_qty == v8.stock_qty - 1
    with SessionLocal() as db:
        order = db.get(Order, o["id"])
        order.reserved_until = utcnow() - timedelta(minutes=1)
        db.commit()
        assert expire_reservations(db) == 1  # PY-06
    assert _variant("LFS-BLK-8").stock_qty == v8.stock_qty
    d = client.get(f"/api/orders/{o['id']}", headers=c).json()
    assert d["order_status"] == "pending_payment" and d["can_retry_payment"]
    r = client.post("/api/payments/create-order", headers=c, json={"order_id": o["id"]})  # retry re-reserves
    assert r.status_code == 200 and _variant("LFS-BLK-8").stock_qty == v8.stock_qty - 1


def test_no_sku_below_zero(client):
    a = h(state["admin"])
    v = _variant("LFS-BLK-7")
    r = client.post("/api/admin/inventory/adjust", headers=a, json={"variant_id": v.id, "change_qty": -(v.stock_qty + 1), "reason": "damage"})
    assert r.status_code == 409


def test_staff_rbac(client):
    a = h(state["admin"])
    r = client.post("/api/admin/staff", headers=a, json={"name": "Staff One", "email": "staff@example.com", "mobile": "9111111111",
                                                       "role": "staff", "temp_password": "Staff2026"})
    assert r.status_code == 201, r.text
    tok = client.post("/api/auth/login", json={"identifier": "staff@example.com", "password": "Staff2026"}).json()["access_token"]
    client.put("/api/users/me/password", headers=h(tok), json={"current_password": "Staff2026", "new_password": "Staff2027x"})
    s = h(client.post("/api/auth/login", json={"identifier": "staff@example.com", "password": "Staff2027x"}).json()["access_token"])
    assert client.get("/api/admin/orders", headers=s).status_code == 200
    assert client.get("/api/admin/inventory", headers=s).status_code == 200
    for path in ("/api/admin/coupons", "/api/admin/settings", "/api/admin/staff", "/api/admin/payments", "/api/admin/reports/gst", "/api/admin/banners"):
        assert client.get(path, headers=s).status_code == 403, path
    dash = client.get("/api/admin/dashboard", headers=s).json()
    assert dash["full"] is False and "sales" not in dash["stats"]["today"]
    assert client.get("/api/admin/dashboard", headers=h(state["cust"])).status_code == 403
    assert client.get("/api/admin/orders").status_code == 401


@pytest.mark.parametrize("kind", ["sales_by_day", "sales_by_product", "sales_by_category", "gst", "payment_split", "stock_valuation", "reconciliation"])
def test_reports(client, kind):
    a = h(state["admin"])
    assert client.get(f"/api/admin/reports/{kind}", headers=a).status_code == 200
    assert client.get(f"/api/admin/reports/{kind}", headers=a, params={"format": "csv"}).status_code == 200
    assert client.get(f"/api/admin/reports/{kind}", headers=a, params={"format": "pdf"}).content[:4] == b"%PDF"


def test_bulk_export_import(client):
    a = h(state["admin"])
    csv_bytes = client.get("/api/admin/products-export", headers=a).content
    assert b"LFS-BLK-7" in csv_bytes
    csv_text = ("name,category,gender,hsn_code,mrp,price,gst_rate,is_active,sku,size,colour,stock_qty\n"
                "Kids Sandal,Kids,kids,6402,499,399,5,yes,KS-RED-10,10,Red,4\n"
                "No Gender Sandal,Kids,,6402,499,399,5,yes,KS-BLU-10,10,Blue,4\n"
                "Bad GST Sandal,Kids,kids,6402,499,399,7,yes,KS-GRN-10,10,Green,4\n")
    r = client.post("/api/admin/products-import", headers=a, files={"file": ("p.csv", csv_text.encode(), "text/csv")})
    assert r.status_code == 200 and r.json()["created"] == 1, r.text
    errors = r.json()["errors"]
    assert len(errors) == 2 and "gender is required" in errors[0] and "GST %" in errors[1], errors
    # a file import cannot carry images, so the new product is kept as a draft
    assert len(r.json()["warnings"]) == 1 and "draft" in r.json()["warnings"][0]
    assert client.get("/api/catalog/products/kids-sandal").status_code == 404
    assert _variant("KS-RED-10").stock_qty == 4


def test_product_mandatory_fields(client):
    a = h(state["admin"])
    men = next(c for c in client.get("/api/admin/categories", headers=a).json() if c["name"] == "Men")
    good = {
        "name": "Validation Shoe", "category_id": men["id"], "gender": "men", "hsn_code": "6403", "gst_rate": 5,
        "mrp": 999, "price": 899, "variants": [{"sku": "VAL-BLK-8", "size": "8", "colour": "Black", "stock_qty": 1}],
    }
    for field in ("gender", "category_id", "hsn_code", "gst_rate", "mrp", "price"):
        body = {k: v for k, v in good.items() if k != field}
        assert _post_product(client, a, body).status_code == 422, field
    assert _post_product(client, a, {**good, "variants": []}).status_code == 422
    assert _post_product(client, a, {**good, "gst_rate": 7}).status_code == 422
    assert _post_product(client, a, {**good, "price": 1200}).status_code == 422
    over = [{**good["variants"][0], "price_override": 1500}]
    assert _post_product(client, a, {**good, "variants": over}).status_code == 422
    blank = [{**good["variants"][0], "colour": "  "}]
    assert _post_product(client, a, {**good, "variants": blank}).status_code == 422
    assert _post_product(client, a, good, images=0).status_code == 422  # image is mandatory
    assert _post_product(client, a, good, images=9).status_code == 400  # at most 8
    bad_file = [("files", ("notes.txt", b"not an image", "text/plain"))]
    r = client.post("/api/admin/products", headers=a, data={"data": json.dumps(good)}, files=bad_file)
    assert r.status_code == 400 and client.get("/api/admin/products", headers=a, params={"q": "VAL-BLK-8"}).json()["total"] == 0
    r = _post_product(client, a, good)  # brand is optional
    assert r.status_code == 201 and r.json()["brand_id"] is None, r.text
    assert _post_product(client, a, {**good, "name": "Dup SKU"}).status_code == 409

    # the last image cannot be deleted; with two, one can
    p = r.json()
    last = client.delete(f"/api/admin/products/{p['id']}/images/{p['images'][0]['id']}", headers=a)
    assert last.status_code == 400 and "at least one image" in last.json()["detail"]
    two = client.post(f"/api/admin/products/{p['id']}/images", headers=a, files=[("files", ("b.png", _png(), "image/png"))]).json()
    r = client.delete(f"/api/admin/products/{p['id']}/images/{two['images'][0]['id']}", headers=a)
    assert r.status_code == 200 and len(r.json()["images"]) == 1


def test_imported_product_needs_image_to_go_live(client):
    a = h(state["admin"])
    p = client.get("/api/admin/products", headers=a, params={"q": "KS-RED-10"}).json()["items"][0]
    p = client.get(f"/api/admin/products/{p['id']}", headers=a).json()
    body = {k: p[k] for k in ("name", "category_id", "gender", "hsn_code", "mrp", "price")}
    body.update(gst_rate=float(p["gst_rate"]), is_active=True,
                variants=[{"id": v["id"], "sku": v["sku"], "size": v["size"], "colour": v["colour"]} for v in p["variants"]])
    r = client.put(f"/api/admin/products/{p['id']}", headers=a, json=body)
    assert r.status_code == 400 and "image" in r.json()["detail"]
    client.post(f"/api/admin/products/{p['id']}/images", headers=a, files=[("files", ("k.png", _png(), "image/png"))])
    r = client.put(f"/api/admin/products/{p['id']}", headers=a, json=body)
    assert r.status_code == 200 and r.json()["is_active"] is True
