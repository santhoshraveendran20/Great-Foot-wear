import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="gfw-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["MEDIA_DIR"] = str(_tmp / "media")
os.environ["RAZORPAY_TEST_KEY_ID"] = "rzp_test_dummy"
os.environ["RAZORPAY_TEST_KEY_SECRET"] = "test_secret"
os.environ["RAZORPAY_WEBHOOK_SECRET"] = "webhook_secret"
os.environ["JWT_SECRET"] = "test-jwt-secret"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402


@pytest.fixture(scope="session")
def client():
    import seed
    from app.main import app

    Base.metadata.create_all(engine)
    seed.run()
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def outbox(monkeypatch_session):
    """Captures SMS / email instead of sending them."""
    sent = {"sms": [], "email": []}
    import app.routers.auth as auth
    import app.services.notify as notify

    monkeypatch_session.setattr(auth, "send_sms", lambda to, text: sent["sms"].append((to, text)))
    monkeypatch_session.setattr(auth, "send_email", lambda to, s, b, *a: sent["email"].append((to, s, b)))
    monkeypatch_session.setattr(notify, "send_sms", lambda to, text: None)
    monkeypatch_session.setattr(notify, "send_email", lambda *a, **k: None)
    return sent


@pytest.fixture(scope="session")
def monkeypatch_session():
    mp = pytest.MonkeyPatch()
    yield mp
    mp.undo()


# ---------------------------------------------------------------- helpers shared by feature test modules
# The session DB is shared by all modules; always create unique emails / mobiles / SKUs.

ADMIN_EMAIL = "owner@greatfootwear.in"
ADMIN_PASSWORDS = ("OwnerPass2026", "ChangeMe123")  # after / before test_flows changes it


@pytest.fixture(scope="session")
def admin_token(client):
    """Super Admin access token, regardless of test execution order."""
    for pw in ADMIN_PASSWORDS:
        r = client.post("/api/auth/login", json={"identifier": ADMIN_EMAIL, "password": pw})
        if r.status_code == 200:
            tok = r.json()["access_token"]
            if r.json()["user"]["must_change_password"]:
                client.put("/api/users/me/password", headers={"Authorization": f"Bearer {tok}"},
                           json={"current_password": pw, "new_password": ADMIN_PASSWORDS[0]})
                tok = client.post("/api/auth/login", json={"identifier": ADMIN_EMAIL, "password": ADMIN_PASSWORDS[0]}).json()["access_token"]
            return tok
    raise RuntimeError("cannot log in as Super Admin")


_seq = {"n": 0}


def _unique() -> int:
    import time
    _seq["n"] += 1
    return int(time.time() * 1000) % 10_000_000 * 100 + _seq["n"] % 100


@pytest.fixture(scope="session")
def make_customer(client):
    """Creates a verified, active customer directly in the DB and returns (user_id, access_token, email, mobile)."""
    from app.core.security import create_access_token, hash_password
    from app.db import SessionLocal
    from app.models import User

    def factory(verified: bool = True, mobile: str | None = "auto"):
        n = _unique()
        email = f"cust{n}@example.com"
        mob = f"8{n:09d}"[:10] if mobile == "auto" else mobile
        with SessionLocal() as db:
            u = User(name=f"Customer {n}", email=email, mobile=mob, password_hash=hash_password("Shoes2026"),
                     mobile_verified=verified and mob is not None, email_verified=verified)
            u.refresh_verified()
            db.add(u)
            db.commit()
            return u.id, create_access_token(u.id, u.role), email, mob

    return factory


@pytest.fixture(scope="session")
def staff_token(client, admin_token):
    """A Staff (non Super Admin) access token."""
    n = _unique()
    email = f"staff{n}@example.com"
    r = client.post("/api/admin/staff", headers={"Authorization": f"Bearer {admin_token}"},
                    json={"name": "Staff", "email": email, "mobile": f"7{n:09d}"[:10], "role": "staff", "temp_password": "Staff2026"})
    assert r.status_code == 201, r.text
    tok = client.post("/api/auth/login", json={"identifier": email, "password": "Staff2026"}).json()["access_token"]
    client.put("/api/users/me/password", headers={"Authorization": f"Bearer {tok}"},
               json={"current_password": "Staff2026", "new_password": "Staff2027x"})
    return client.post("/api/auth/login", json={"identifier": email, "password": "Staff2027x"}).json()["access_token"]
