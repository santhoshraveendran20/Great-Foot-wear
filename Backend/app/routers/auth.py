"""/auth — register, login, refresh, logout, OTP, email verification, password reset
(UM-01, UM-02, UM-03, UM-05, UM-06, UM-07, UM-08)."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user
from app.core.ratelimit import rate_limit
from app.core.security import (
    create_access_token,
    hash_password,
    new_opaque_token,
    new_otp,
    sha256,
    utcnow,
    verify_password,
)
from app.db import get_db
from app.models import ActionToken, OtpCode, RefreshToken, User
from app.schemas import (
    ForgotPasswordIn,
    LoginIn,
    OtpLoginIn,
    OtpSendIn,
    OtpVerifyIn,
    RegisterIn,
    ResetPasswordIn,
    TokenIn,
)
from app.serializers import user_out
from app.services.notify import send_email, send_sms

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "gfw_refresh"
TOKEN_MINUTES = 15  # UM-05 link / OTP validity
MAX_FAILED_LOGINS = 5  # UM-08
LOCK_MINUTES = 15
MAX_OTP_ATTEMPTS = 5


# ------------------------------------------------------------------ helpers

def _otp_hash(target: str, purpose: str, code: str) -> str:
    return sha256(f"{settings.JWT_SECRET}:{purpose}:{target}:{code}")


def issue_otp(db: Session, target: str, purpose: str) -> str:
    db.execute(
        update(OtpCode)
        .where(OtpCode.target == target, OtpCode.purpose == purpose, OtpCode.used_at.is_(None))
        .values(used_at=utcnow())
    )
    code = new_otp()
    db.add(OtpCode(target=target, purpose=purpose, code_hash=_otp_hash(target, purpose, code),
                   expires_at=utcnow() + timedelta(minutes=TOKEN_MINUTES)))
    return code


def consume_otp(db: Session, target: str, purpose: str, code: str) -> None:
    otp = db.scalar(
        select(OtpCode)
        .where(OtpCode.target == target, OtpCode.purpose == purpose, OtpCode.used_at.is_(None))
        .order_by(OtpCode.id.desc())
    )
    if not otp or otp.expires_at < utcnow():
        raise HTTPException(400, "OTP expired. Please request a new one.")
    if otp.attempts >= MAX_OTP_ATTEMPTS:
        raise HTTPException(400, "Too many wrong attempts. Please request a new OTP.")
    if otp.code_hash != _otp_hash(target, purpose, code):
        otp.attempts += 1
        db.commit()
        raise HTTPException(400, "Incorrect OTP")
    otp.used_at = utcnow()


def issue_action_token(db: Session, user: User, purpose: str, minutes: int = TOKEN_MINUTES) -> str:
    db.execute(
        update(ActionToken)
        .where(ActionToken.user_id == user.id, ActionToken.purpose == purpose, ActionToken.used_at.is_(None))
        .values(used_at=utcnow())
    )
    token = new_opaque_token()
    db.add(ActionToken(user_id=user.id, purpose=purpose, token_hash=sha256(token),
                       expires_at=utcnow() + timedelta(minutes=minutes)))
    return token


def consume_action_token(db: Session, token: str, purpose: str) -> User:
    row = db.scalar(select(ActionToken).where(ActionToken.token_hash == sha256(token), ActionToken.purpose == purpose))
    if not row or row.used_at or row.expires_at < utcnow():
        raise HTTPException(400, "This link is invalid or has expired")
    row.used_at = utcnow()
    user = db.get(User, row.user_id)
    if not user:
        raise HTTPException(400, "This link is invalid or has expired")
    return user


def send_email_verification(db: Session, user: User) -> None:
    token = issue_action_token(db, user, "verify_email", minutes=24 * 60)
    link = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    send_email(user.email, "Verify your email – Great Foot Wear",
               f"Hi {user.name},\n\nPlease verify your email address by opening this link:\n{link}\n")


def send_mobile_otp(db: Session, user: User, purpose: str = "verify_mobile") -> None:
    code = issue_otp(db, user.mobile, purpose)
    send_sms(user.mobile, f"{code} is your Great Foot Wear OTP. Valid for {TOKEN_MINUTES} minutes. Do not share it.")


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=settings.REFRESH_TOKEN_DAYS * 86400,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        path="/api/auth",
    )


def login_response(db: Session, user: User, response: Response) -> dict:
    """UM-07: short-lived JWT access token in body, refresh token in httpOnly cookie."""
    refresh = new_opaque_token()
    db.add(RefreshToken(user_id=user.id, token_hash=sha256(refresh),
                        expires_at=utcnow() + timedelta(days=settings.REFRESH_TOKEN_DAYS)))
    db.commit()
    _set_refresh_cookie(response, refresh)
    return {"access_token": create_access_token(user.id, user.role), "token_type": "bearer", "user": user_out(user)}


def _find_user(db: Session, identifier: str) -> User | None:
    ident = identifier.strip().lower()
    return db.scalar(select(User).where(or_(User.email == ident, User.mobile == ident), User.deleted_at.is_(None)))


def revoke_all_refresh_tokens(db: Session, user_id: int) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


# ------------------------------------------------------------------ endpoints

@router.post("/register", dependencies=[Depends(rate_limit("register", 10, 3600))])
def register(body: RegisterIn, response: Response, db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    if db.scalar(select(User.id).where(User.mobile == body.mobile)):
        raise HTTPException(409, "An account with this mobile number already exists")
    user = User(name=body.name.strip(), email=email, mobile=body.mobile, password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    send_mobile_otp(db, user)
    send_email_verification(db, user)
    return login_response(db, user, response)


@router.post("/login", dependencies=[Depends(rate_limit("login", 20, 300))])
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = _find_user(db, body.identifier)
    now = utcnow()
    if user and user.locked_until and user.locked_until > now:
        mins = int((user.locked_until - now).total_seconds() // 60) + 1
        raise HTTPException(423, f"Account locked after too many failed attempts. Try again in {mins} min.")
    if not user or not verify_password(body.password, user.password_hash):
        if user:
            user.failed_login_count += 1
            if user.failed_login_count >= MAX_FAILED_LOGINS:
                user.locked_until = now + timedelta(minutes=LOCK_MINUTES)
                user.failed_login_count = 0
            db.commit()
        raise HTTPException(401, "Incorrect email/mobile or password")
    if not user.is_active:
        raise HTTPException(403, "This account has been blocked. Please contact the store.")
    user.failed_login_count = 0
    user.locked_until = None
    return login_response(db, user, response)


@router.post("/send-otp", dependencies=[Depends(rate_limit("otp", 5, 600))])
def send_otp(body: OtpSendIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.mobile == body.mobile, User.deleted_at.is_(None)))
    # do not reveal whether the number is registered
    if user and user.is_active:
        if body.purpose == "verify_mobile" and user.mobile_verified:
            return {"ok": True}
        send_mobile_otp(db, user, body.purpose)
        db.commit()
    return {"ok": True}


@router.post("/verify-otp", dependencies=[Depends(rate_limit("otp-verify", 10, 600))])
def verify_mobile_otp(body: OtpVerifyIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """UM-02: verify the logged-in user's mobile number."""
    consume_otp(db, user.mobile, "verify_mobile", body.code)
    user.mobile_verified = True
    user.refresh_verified()
    db.commit()
    return {"user": user_out(user)}


@router.post("/otp-login", dependencies=[Depends(rate_limit("otp-verify", 10, 600))])
def otp_login(body: OtpLoginIn, response: Response, db: Session = Depends(get_db)):
    """UM-03 optional OTP login."""
    user = db.scalar(select(User).where(User.mobile == body.mobile, User.deleted_at.is_(None)))
    if not user:
        raise HTTPException(400, "Incorrect OTP")
    consume_otp(db, user.mobile, "login", body.code)
    if not user.is_active:
        raise HTTPException(403, "This account has been blocked. Please contact the store.")
    user.mobile_verified = True
    user.refresh_verified()
    return login_response(db, user, response)


@router.post("/verify-email")
def verify_email(body: TokenIn, db: Session = Depends(get_db)):
    user = consume_action_token(db, body.token, "verify_email")
    user.email_verified = True
    user.refresh_verified()
    db.commit()
    return {"ok": True}


@router.post("/resend-email-verification", dependencies=[Depends(rate_limit("email-verify", 5, 600))])
def resend_email_verification(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not user.email_verified:
        send_email_verification(db, user)
        db.commit()
    return {"ok": True}


@router.post("/forgot-password", dependencies=[Depends(rate_limit("forgot", 5, 600))])
def forgot_password(body: ForgotPasswordIn, db: Session = Depends(get_db)):
    """UM-05: email link (if an email was given) or SMS OTP (if a mobile number was given)."""
    user = _find_user(db, body.identifier)
    channel = "email" if "@" in body.identifier else "sms"
    if user and user.is_active:
        if channel == "email":
            token = issue_action_token(db, user, "reset_password")
            link = f"{settings.FRONTEND_URL}/reset-password?token={token}"
            send_email(user.email, "Reset your password – Great Foot Wear",
                       f"Hi {user.name},\n\nReset your password using this link (valid {TOKEN_MINUTES} minutes, single use):\n{link}\n\n"
                       "If you did not request this, ignore this email.")
        else:
            send_mobile_otp(db, user, "reset_password")
        db.commit()
    return {"ok": True, "channel": channel}


@router.post("/reset-password", dependencies=[Depends(rate_limit("reset", 10, 600))])
def reset_password(body: ResetPasswordIn, db: Session = Depends(get_db)):
    if body.token:
        user = consume_action_token(db, body.token, "reset_password")
    elif body.mobile and body.code:
        user = db.scalar(select(User).where(User.mobile == body.mobile))
        if not user:
            raise HTTPException(400, "Incorrect OTP")
        consume_otp(db, user.mobile, "reset_password", body.code)
    else:
        raise HTTPException(400, "Reset token or mobile OTP is required")
    user.password_hash = hash_password(body.new_password)
    user.failed_login_count = 0
    user.locked_until = None
    user.must_change_password = False
    revoke_all_refresh_tokens(db, user.id)
    db.commit()
    return {"ok": True}


@router.post("/refresh")
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise HTTPException(401, "Not authenticated")
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha256(token)))
    if not row or row.revoked_at or row.expires_at < utcnow():
        response.delete_cookie(REFRESH_COOKIE, path="/api/auth")
        raise HTTPException(401, "Session expired. Please log in again.")
    user = db.get(User, row.user_id)
    if not user or not user.is_active or user.deleted_at:
        raise HTTPException(401, "Not authenticated")
    row.revoked_at = utcnow()  # rotate
    return login_response(db, user, response)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """UM-07: logout revokes the refresh token."""
    token = request.cookies.get(REFRESH_COOKIE)
    if token:
        row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha256(token)))
        if row and not row.revoked_at:
            row.revoked_at = utcnow()
            db.commit()
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")
    return {"ok": True}
