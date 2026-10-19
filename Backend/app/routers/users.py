"""/users — profile, addresses, password, preferences, account deletion
(UM-09, UM-10, UM-11, UM-13, UM-14, UM-15 forced change)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.security import hash_password, new_opaque_token, utcnow, verify_password
from app.db import get_db
from app.models import Address, Cart, User, Wishlist
from app.routers.auth import revoke_all_refresh_tokens, send_email_verification, send_mobile_otp
from app.schemas import AddressIn, ChangePasswordIn, DeleteAccountIn, PreferencesIn, ProfileIn
from app.serializers import address_out, user_out

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return user_out(user)


@router.put("/me")
def update_me(body: ProfileIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    email = body.email.lower()
    if email != user.email:
        if db.scalar(select(User.id).where(User.email == email, User.id != user.id)):
            raise HTTPException(409, "This email is already used by another account")
        user.email = email
        user.email_verified = False
        send_email_verification(db, user)
    if body.mobile != user.mobile:
        if db.scalar(select(User.id).where(User.mobile == body.mobile, User.id != user.id)):
            raise HTTPException(409, "This mobile number is already used by another account")
        user.mobile = body.mobile
        user.mobile_verified = False  # UM-09 re-verify on change
        send_mobile_otp(db, user)
    user.refresh_verified()
    user.name = body.name.strip()
    user.gender = body.gender
    user.date_of_birth = body.date_of_birth
    db.commit()
    return user_out(user)


@router.put("/me/password")
def change_password(body: ChangePasswordIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    if verify_password(body.new_password, user.password_hash):
        raise HTTPException(400, "New password must be different from the current password")
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    db.commit()
    return user_out(user)


@router.put("/me/preferences")
def update_preferences(body: PreferencesIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.promo_email = body.promo_email
    user.promo_sms = body.promo_sms
    user.promo_whatsapp = body.promo_whatsapp
    db.commit()
    return user_out(user)


@router.post("/me/delete")
def delete_account(body: DeleteAccountIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """UM-13 / DPDP: anonymise personal data; order records are kept for GST/accounting."""
    if user.role != "customer":
        raise HTTPException(400, "Staff accounts are deactivated by the Super Admin")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(400, "Password is incorrect")
    now = utcnow()
    db.execute(delete(Address).where(Address.user_id == user.id))
    db.execute(delete(Wishlist).where(Wishlist.user_id == user.id))
    db.execute(delete(Cart).where(Cart.user_id == user.id))
    revoke_all_refresh_tokens(db, user.id)
    user.deletion_requested_at = now
    user.deleted_at = now
    user.name = "Deleted user"
    user.email = f"deleted-{user.id}@deleted.invalid"
    user.mobile = f"del{user.id}"[:15]
    user.password_hash = hash_password(new_opaque_token()[:40])
    user.gender = None
    user.date_of_birth = None
    user.is_active = False
    user.promo_email = user.promo_sms = user.promo_whatsapp = False
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ addresses (UM-10)

def _own_address(db: Session, user: User, address_id: int) -> Address:
    addr = db.get(Address, address_id)
    if not addr or addr.user_id != user.id:
        raise HTTPException(404, "Address not found")
    return addr


def _make_default(db: Session, user: User, addr: Address) -> None:
    db.execute(update(Address).where(Address.user_id == user.id, Address.id != addr.id).values(is_default=False))
    addr.is_default = True


@router.get("/me/addresses")
def list_addresses(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Address).where(Address.user_id == user.id).order_by(Address.is_default.desc(), Address.id)).all()
    return [address_out(a) for a in rows]


@router.post("/me/addresses", status_code=201)
def add_address(body: AddressIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    addr = Address(user_id=user.id, **body.model_dump())
    db.add(addr)
    db.flush()
    has_default = db.scalar(select(Address.id).where(Address.user_id == user.id, Address.is_default.is_(True), Address.id != addr.id))
    if body.is_default or not has_default:
        _make_default(db, user, addr)
    db.commit()
    return address_out(addr)


@router.put("/me/addresses/{address_id}")
def edit_address(address_id: int, body: AddressIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    addr = _own_address(db, user, address_id)
    for k, v in body.model_dump(exclude={"is_default"}).items():
        setattr(addr, k, v)
    if body.is_default:
        _make_default(db, user, addr)
    db.commit()
    return address_out(addr)


@router.post("/me/addresses/{address_id}/default")
def set_default_address(address_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    addr = _own_address(db, user, address_id)
    _make_default(db, user, addr)
    db.commit()
    return address_out(addr)


@router.delete("/me/addresses/{address_id}")
def delete_address(address_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    addr = _own_address(db, user, address_id)
    was_default = addr.is_default
    db.delete(addr)
    db.flush()
    if was_default:
        nxt = db.scalar(select(Address).where(Address.user_id == user.id).order_by(Address.id))
        if nxt:
            nxt.is_default = True
    db.commit()
    return {"ok": True}
