"""Dashboard / report days follow the shop's calendar (IST), not UTC."""
from datetime import date, datetime, timedelta

from app.db import SessionLocal
from app.models import Role, User
from app.utils import ist_date, ist_day_start, ist_today


def test_ist_helpers():
    # 03:23 IST on 19 Oct is 21:53 UTC on 18 Oct
    stored = datetime(2026, 10, 18, 21, 53, 13)
    assert ist_date(stored) == date(2026, 10, 19)
    assert ist_day_start(date(2026, 10, 19)) == datetime(2026, 10, 18, 18, 30)


def test_dashboard_counts_early_morning_signup_as_today(client, admin_token):
    # a customer who joined just after midnight IST (still "yesterday" in UTC)
    with SessionLocal() as db:
        u = User(name="Night Owl", email="nightowl@example.com", mobile="9000000777", password_hash="x", role=Role.CUSTOMER)
        u.created_at = ist_day_start(ist_today()) + timedelta(minutes=5)
        db.add(u)
        db.commit()
    data = client.get("/api/admin/dashboard", headers={"Authorization": f"Bearer {admin_token}"}).json()
    assert data["stats"]["today"]["new_customers"] >= 1
    # the card's side panel lists exactly the customers it counts
    d = client.get("/api/admin/dashboard/details", params={"metric": "customers", "period": "today"},
                   headers={"Authorization": f"Bearer {admin_token}"}).json()
    assert d["total"] == data["stats"]["today"]["new_customers"]
    assert any(c["email"] == "nightowl@example.com" and c["is_verified"] is False for c in d["items"])


def test_dashboard_details_sales_is_admin_only(client, staff_token, admin_token):
    h = lambda t: {"Authorization": f"Bearer {t}"}  # noqa: E731
    assert client.get("/api/admin/dashboard/details", params={"metric": "sales"}, headers=h(staff_token)).status_code == 403
    r = client.get("/api/admin/dashboard/details", params={"metric": "pending"}, headers=h(staff_token))
    assert r.status_code == 200 and all("total" not in o for o in r.json()["items"])
    assert client.get("/api/admin/dashboard/details", params={"metric": "nope"}, headers=h(admin_token)).status_code == 422
