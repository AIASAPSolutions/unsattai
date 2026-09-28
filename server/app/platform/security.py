"""Sign-in for customers (phone or email + one-time code, optional password) and staff
(email + password, with roles).

Tokens are random and only their SHA-256 is stored. Passwords use PBKDF2-SHA256.
Codes go out through the SMS and email hooks in notify.py; with no provider configured
they are written to the server log, and (when OTP_DEV_ECHO is on, the default for local
use) returned in the response so the apps can be tried end to end. Turn OTP_DEV_ECHO
off in production. Five wrong passwords lock that identifier for 15 minutes.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException, Request

from .db import PlatformStore, now

log = logging.getLogger("urjersey.auth")

ROLES = ("admin", "manager", "sales", "production", "dispatch", "viewer", "seller")

# What each role may do. "read" covers dashboards and lists.
PERMISSIONS: dict[str, set[str]] = {
    "admin": {"*"},
    "manager": {"read", "orders", "pricing", "production", "delivery", "crm", "settings"},
    "sales": {"read", "orders", "crm", "quotes"},
    "production": {"read", "production"},
    "dispatch": {"read", "delivery"},
    "viewer": {"read"},
    # A seller's own login: only routes that opt in with need(..., seller=True), and only
    # that seller's orders, plan and shipments (see seller_scope).
    "seller": {"seller"},
}

SESSION_DAYS = {"customer": 60, "staff": 1}
OTP_MINUTES = 10
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_SECONDS = 30
LOGIN_MAX_FAILURES = 5
LOGIN_LOCK_MINUTES = 15


def _pbkdf2(password: str, salt: bytes, rounds: int = 240_000) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, rounds)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f"pbkdf2_sha256$240000${salt.hex()}${_pbkdf2(password, salt).hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt, digest = stored.split("$")
        return hmac.compare_digest(_pbkdf2(password, bytes.fromhex(salt), int(rounds)).hex(), digest)
    except ValueError:
        return False


def password_problem(password: str) -> str | None:
    if len(password) < 10:
        return "Use at least 10 characters."
    if password.lower() == password or not re.search(r"\d", password):
        return "Use upper and lower case letters and at least one digit."
    return None


def _sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def device_label(user_agent: str | None) -> str:
    """A short, human label for a session list: "Chrome on Android", "UrJersey app on iPhone"."""
    ua = user_agent or ""
    if not ua:
        return "Unknown device"
    low = ua.lower()
    os_name = next((name for key, name in (("iphone", "iPhone"), ("ipad", "iPad"), ("android", "Android"),
                                           ("windows", "Windows"), ("mac os", "Mac"), ("macintosh", "Mac"),
                                           ("cros", "Chromebook"), ("linux", "Linux")) if key in low), "")
    app = next((name for key, name in (("urjersey", "UrJersey app"), ("okhttp", "UrJersey app"), ("dart", "UrJersey app"),
                                       ("expo", "UrJersey app"), ("edg/", "Edge"), ("opr/", "Opera"),
                                       ("firefox", "Firefox"), ("samsungbrowser", "Samsung Internet"),
                                       ("chrome", "Chrome"), ("safari", "Safari"), ("curl", "curl"),
                                       ("python", "Script"), ("testclient", "Test client")) if key in low), "Browser")
    return f"{app} on {os_name}" if os_name else app


def issue_token(store: PlatformStore, kind: str, subject: str, user_agent: str | None = None,
                method: str = "") -> dict:
    """method: how the person proved who they are (otp, password), kept on the session."""
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS[kind])).isoformat(timespec="seconds")
    sid = store.add_session(_sha(token), kind, subject, expires, device_label(user_agent), method)
    return {"token": token, "expires_at": expires, "session_id": sid}


def token_hash(token: str) -> str:
    return _sha(token)


def revoke(store: PlatformStore, token: str) -> None:
    store.drop_session(_sha(token))


def normalize_phone(phone: str) -> str:
    """+91 98765 43210 / 098765-43210 / 9876543210 -> +919876543210 (India default)."""
    digits = re.sub(r"\D", "", phone or "")
    if phone.strip().startswith("+"):
        return "+" + digits
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 10:
        return "+91" + digits
    return "+" + digits


def valid_phone(phone: str) -> bool:
    return bool(re.fullmatch(r"\+\d{8,15}", phone))


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def valid_email(email: str) -> bool:
    return bool(EMAIL_RE.fullmatch(email)) and len(email) <= 120


def otp_echo() -> bool:
    return os.getenv("OTP_DEV_ECHO", "1") not in ("0", "false", "no")


def _otp_key(phone: str | None, email: str | None) -> tuple[str, str, str]:
    """(storage key, channel, normalised identifier). Phone codes keep the phone as key."""
    if email:
        email = normalize_email(email)
        if not valid_email(email):
            raise HTTPException(422, "Enter a valid email address.")
        return f"email:{email}", "email", email
    phone = normalize_phone(phone or "")
    if not valid_phone(phone):
        raise HTTPException(422, "Enter a valid mobile number.")
    return phone, "phone", phone


def request_code(store: PlatformStore, phone: str | None = None, email: str | None = None) -> dict:
    """Send a one-time code by SMS or email. The answer never says whether an account exists."""
    from . import notify
    key, channel, ident = _otp_key(phone, email)
    cur = store.get_otp(key)
    if cur and (datetime.fromisoformat(cur["sent_at"]) + timedelta(seconds=OTP_RESEND_SECONDS)
                > datetime.now(timezone.utc)):
        raise HTTPException(429, "Please wait a few seconds before asking for another code.")
    code = f"{secrets.randbelow(1_000_000):06d}"
    expires = (datetime.now(timezone.utc) + timedelta(minutes=OTP_MINUTES)).isoformat(timespec="seconds")
    store.put_otp(key, _sha(key + code), expires)
    text = f"{code} is your UrJersey code. It expires in {OTP_MINUTES} minutes. Don't share it."
    if channel == "email":
        notify.send_email(ident, "Your UrJersey code", text, secret=True)
    else:
        notify.send_sms(ident, text, secret=True)
    out = {"sent": True, channel: ident, "expires_in": OTP_MINUTES * 60}
    if otp_echo():
        out["dev_code"] = code
    return out


def request_otp(store: PlatformStore, phone: str) -> dict:
    return request_code(store, phone=phone)


def verify_code(store: PlatformStore, code: str, phone: str | None = None, email: str | None = None) -> str:
    """Check a code; returns the normalised phone or email it was sent to."""
    key, _, ident = _otp_key(phone, email)
    cur = store.get_otp(key)
    if not cur or cur["expires_at"] < now():
        raise HTTPException(401, "The code has expired. Ask for a new one.")
    if cur["attempts"] >= OTP_MAX_ATTEMPTS:
        raise HTTPException(429, "Too many wrong codes. Ask for a new one.")
    if not hmac.compare_digest(cur["code_hash"], _sha(key + code.strip())):
        store.bump_otp(key)
        raise HTTPException(401, "That code is not right.")
    store.drop_otp(key)
    return ident


def verify_otp(store: PlatformStore, phone: str, code: str) -> str:
    return verify_code(store, code, phone=phone)


# ----------------------------------------------------------------- password lockout

def _guard_id(identifier: str) -> str:
    ident = identifier.strip()
    return normalize_email(ident) if "@" in ident else normalize_phone(ident) if re.search(r"\d", ident) else ident.lower()


def check_lock(store: PlatformStore, kind: str, identifier: str) -> None:
    g = store.get("login_guard", f"{kind}:{_guard_id(identifier)}")
    if g and g.get("locked_until") and g["locked_until"] > now():
        raise HTTPException(429, f"Too many wrong passwords. Try again in {LOGIN_LOCK_MINUTES} minutes, "
                                 "or sign in with a one-time code.")


def login_failed(store: PlatformStore, kind: str, identifier: str) -> None:
    gid = f"{kind}:{_guard_id(identifier)}"
    g = store.get("login_guard", gid) or {"failures": 0, "locked_until": None}
    if g.get("locked_until") and g["locked_until"] <= now():
        g = {"failures": 0, "locked_until": None}
    g["failures"] += 1
    if g["failures"] >= LOGIN_MAX_FAILURES:
        g["locked_until"] = (datetime.now(timezone.utc) + timedelta(minutes=LOGIN_LOCK_MINUTES)).isoformat(timespec="seconds")
        log.warning("sign-in locked for %s after %d wrong passwords", gid, g["failures"])
    store.put("login_guard", gid, g)


def login_ok(store: PlatformStore, kind: str, identifier: str) -> None:
    store.delete("login_guard", f"{kind}:{_guard_id(identifier)}")


# ----------------------------------------------------------------- FastAPI dependencies

_store: PlatformStore | None = None


def bind(store: PlatformStore) -> None:
    global _store
    _store = store


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def optional_customer(authorization: str | None = Header(default=None)) -> dict | None:
    token = _bearer(authorization)
    if not token:
        return None
    s = _store.get_session(_sha(token))
    if not s or s["subject_kind"] != "customer":
        return None
    return _store.get("customer", s["subject_id"])


def current_session(authorization: str | None = Header(default=None)) -> dict:
    """The caller's own session row (for the session list's "this device")."""
    token = _bearer(authorization)
    s = _store.get_session(_sha(token)) if token else None
    if not s:
        raise HTTPException(401, "Please sign in.")
    return s


def require_customer(customer: dict | None = Depends(optional_customer)) -> dict:
    if customer is None:
        raise HTTPException(401, "Please sign in.")
    if customer.get("status") == "blocked":
        raise HTTPException(403, "This account is blocked. Contact support.")
    return customer


def current_staff(authorization: str | None = Header(default=None)) -> dict:
    token = _bearer(authorization)
    s = _store.get_session(_sha(token)) if token else None
    if not s or s["subject_kind"] != "staff":
        raise HTTPException(401, "Please sign in.")
    staff = _store.get_staff(s["subject_id"])
    if not staff or not staff["active"]:
        raise HTTPException(401, "This account is not active.")
    return staff


def can(staff: dict, permission: str) -> bool:
    perms = PERMISSIONS.get(staff["role"], set())
    return "*" in perms or permission in perms


def need(permission: str, seller: bool = False):
    """Route guard. seller=True also lets a seller login in; the route must then scope
    what it returns or changes with seller_scope / check_seller_order."""
    def dep(staff: dict = Depends(current_staff)) -> dict:
        if staff["role"] == "seller":
            if not seller or not staff.get("seller_id"):
                raise HTTPException(403, "A seller login can only see its own orders, plan and shipments.")
            return staff
        if not can(staff, permission):
            raise HTTPException(403, f"Your role ({staff['role']}) cannot do this.")
        return staff
    return dep


def seller_scope(staff: dict, requested: str | None = None) -> str | None:
    """The seller id a request is limited to: a seller login always gets its own."""
    if staff["role"] == "seller":
        return staff["seller_id"]
    return requested or None


def check_seller_order(staff: dict, order: dict | None) -> dict:
    """404 (as for a missing order) when a seller login reaches for another seller's order."""
    if order is None:
        raise HTTPException(404, "order not found")
    if staff["role"] == "seller" and seller_id_of(order) != staff.get("seller_id"):
        raise HTTPException(404, "order not found")
    return order


HOUSE_SELLER = "sel_house"


def seller_id_of(order: dict) -> str:
    """Orders from before sellers existed belong to the house seller."""
    return (order.get("seller") or {}).get("id") or HOUSE_SELLER


def bootstrap_admin(store: PlatformStore) -> None:
    """First run: create the admin from ADMIN_EMAIL / ADMIN_PASSWORD if there are no staff yet."""
    email, password = os.getenv("ADMIN_EMAIL", "").strip(), os.getenv("ADMIN_PASSWORD", "")
    if store.staff_count() or not email or not password:
        return
    problem = password_problem(password)
    if problem:
        log.error("ADMIN_PASSWORD rejected: %s No admin was created.", problem)
        return
    store.add_staff(email, "admin", hash_password(password), {"name": "Administrator"})
    log.info("created admin %s", email)


# ----------------------------------------------------------------- who may see an order

def order_viewer(request: Request, authorization: str | None = Header(default=None),
                 x_device_id: str | None = Header(default=None)) -> dict:
    """Everything that can prove a link to an order: a customer or staff session, and the device."""
    from ..ai_edit import device_key
    token = _bearer(authorization)
    s = _store.get_session(_sha(token)) if token else None
    who = {"customer_id": None, "staff": False, "seller_id": None,
           "device": device_key(x_device_id, request.client.host if request.client else None)}
    if s and s["subject_kind"] == "customer":
        who["customer_id"] = s["subject_id"]
    elif s and s["subject_kind"] == "staff":
        st = _store.get_staff(s["subject_id"])
        who["staff"] = bool(st and st["active"])
        if who["staff"] and st["role"] == "seller":
            # A partner's login works in the operations app only; here it is like any stranger.
            who["staff"], who["seller_id"] = False, st.get("seller_id")
    return who


def check_order_access(order: dict | None, who: dict, phone: str | None = None) -> dict:
    """The order's customer, the device that placed it, staff, or someone who knows its phone number.

    Anything else gets the same 404 as a missing order, so order references can't be probed.
    """
    if order:
        if who.get("staff"):
            return order
        if who.get("customer_id") and order.get("customer_id") == who["customer_id"]:
            return order
        if who.get("device") and _store.order_device(order["id"]) == who["device"]:
            return order
        if phone and normalize_phone(order["customer"]["phone"]) == normalize_phone(phone):
            return order
    raise HTTPException(404, "order not found")


def check_checkout_access(checkout: dict | None, who: dict, phone: str | None = None) -> dict:
    """Same rule as orders: the customer, the placing device, staff, or the phone number used."""
    if checkout:
        if who.get("staff"):
            return checkout
        if who.get("customer_id") and checkout.get("customer_id") == who["customer_id"]:
            return checkout
        if who.get("device") and checkout.get("device") == who["device"]:
            return checkout
        if phone and normalize_phone(checkout["customer"]["phone"]) == normalize_phone(phone):
            return checkout
    raise HTTPException(404, "checkout not found")
