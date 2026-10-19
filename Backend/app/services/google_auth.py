"""Google sign-in (UM-04): verify the ID token that Google Identity Services gives the browser.

Contract, checked against the official docs and the installed google-auth source:
- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- google.oauth2.id_token.verify_oauth2_token(token, request, audience) checks the RS256
  signature against https://www.googleapis.com/oauth2/v1/certs, plus `aud`, `iss`
  (accounts.google.com / https://accounts.google.com), `iat` and `exp`. It raises ValueError /
  google.auth.exceptions.GoogleAuthError for a bad token and TransportError when the certs
  cannot be fetched.
- `sub` is the account key ("unique among all Google Accounts and never reused"); the email
  is not, because a Google Account's email can change.
- Google is authoritative for the email only for Gmail addresses or Workspace accounts
  (email_verified and `hd` set); for other addresses Google recommends a password challenge
  before linking an existing account.
"""
import logging
import time
from dataclasses import dataclass

from fastapi import HTTPException
from google.auth import exceptions as google_exceptions
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from app.core.config import settings

log = logging.getLogger("gfw.google")

ISSUERS = ("accounts.google.com", "https://accounts.google.com")
CERTS_TIMEOUT_SECONDS = 10  # google-auth's own default is 120 s; a login should fail fast instead
SUB_MAX_LEN = 64  # users.google_sub column size (Google documents `sub` as up to 255 ASCII chars)
INVALID = "Google sign-in failed. Please try again."


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str  # lowercased
    name: str | None
    email_authoritative: bool  # Gmail or Google Workspace address


class _Transport(google_requests.Request):
    """google-auth HTTP transport with a bounded timeout for the certificate fetch."""

    def __call__(self, url, method="GET", body=None, headers=None, timeout=None, **kwargs):
        return super().__call__(url, method=method, body=body, headers=headers,
                                timeout=timeout or CERTS_TIMEOUT_SECONDS, **kwargs)


def _transport():
    return _Transport()


def fetch_claims(credential: str) -> dict:
    """Signature / aud / iss / exp verification by Google's library (tests monkeypatch this)."""
    return dict(id_token.verify_oauth2_token(credential, _transport(), settings.GOOGLE_CLIENT_ID))


def is_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID)


def verify_credential(credential: str) -> GoogleIdentity:
    """UM-04: returns the verified Google identity or raises a user-facing HTTPException."""
    if not is_configured():
        raise HTTPException(503, "Google sign-in is not available right now. Please log in with your email or mobile number.")
    try:
        claims = fetch_claims(credential)
    except google_exceptions.TransportError:
        log.warning("Google sign-in: could not fetch Google's public certificates")
        raise HTTPException(503, "Could not reach Google right now. Please try again in a moment.")
    except (ValueError, google_exceptions.GoogleAuthError) as exc:
        log.info("Google sign-in: ID token rejected (%s)", type(exc).__name__)  # never log the token itself
        raise HTTPException(401, INVALID)

    # Defence in depth: re-check what verify_oauth2_token is documented to check
    # ("exp: expiration time on or after which the ID token must not be accepted").
    exp = claims.get("exp")
    if (claims.get("iss") not in ISSUERS or claims.get("aud") != settings.GOOGLE_CLIENT_ID
            or not isinstance(exp, (int, float)) or exp <= time.time()):
        raise HTTPException(401, INVALID)

    sub = str(claims.get("sub") or "").strip()
    email = str(claims.get("email") or "").strip().lower()
    if len(sub) > SUB_MAX_LEN:
        log.error("Google sign-in: sub claim longer than the users.google_sub column (%d chars)", len(sub))
        raise HTTPException(400, "This Google account cannot be used here. Please register with your email and mobile number.")
    if not sub or not email:
        raise HTTPException(400, "Your Google account did not share an email address. Please register with your email and mobile number.")
    if claims.get("email_verified") not in (True, "true"):
        raise HTTPException(400, "Your Google account's email address is not verified. Please verify it with Google, "
                                 "or register with your email and mobile number.")
    name = str(claims.get("name") or "").strip() or None
    authoritative = email.endswith("@gmail.com") or bool(claims.get("hd"))
    return GoogleIdentity(sub=sub, email=email, name=name, email_authoritative=authoritative)
