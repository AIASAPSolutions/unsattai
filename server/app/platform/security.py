"""Sign-in for customers (phone + one-time code) and staff (email + password, with roles).

Tokens are random and only their SHA-256 is stored. Passwords use PBKDF2-SHA256.
With no SMS provider configured the one-time code is written to the server log, and
(when OTP_DEV_ECHO is on, the default for local use) returned in the response so the
apps can be tried end to end. Turn OTP_DEV_ECHO off in production.
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

ROLES = ("admin", "manager", "sales", "production", "dispatch", "viewer")

# What each role may do. "read" covers dashboards and lists.
PERMISSIONS: dict[str, set[str]] = {
    "admin": {"*"},
    "manager": {"read", "orders", "pricing", "production", "delivery", "crm", "settings"},
    "sales": {"read", "orders", "crm", "quotes"},
    "production": {"read", "production"},
    "dispatch": {"read", "delivery"},
    "viewer": {"read"},
}

SESSION_DAYS = {"customer": 60, "staff": 1}
OTP_MINUTES = 10
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_SECONDS = 30


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


def issue_token(store: PlatformStore, kind: str, subject: str) -> dict:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS[kind])).isoformat(timespec="seconds")
    store.add_session(_sha(token), kind, subject, expires)
    return {"token": token, "expires_at": expires}


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


def otp_echo() -> bool:
    return os.getenv("OTP_DEV_ECHO", "1") not in ("0", "false", "no")


def request_otp(store: PlatformStore, phone: str) -> dict:
    phone = normalize_phone(phone)
    if not valid_phone(phone):
        raise HTTPException(422, "Enter a valid mobile number.")
    cur = store.get_otp(phone)
    if cur and (datetime.fromisoformat(cur["sent_at"]) + timedelta(seconds=OTP_RESEND_SECONDS)
                > datetime.now(timezone.utc)):
        raise HTTPException(429, "Please wait a few seconds before asking for another code.")
    code = f"{secrets.randbelow(1_000_000):06d}"
    expires = (datetime.now(timezone.utc) + timedelta(minutes=OTP_MINUTES)).isoformat(timespec="seconds")
    store.put_otp(phone, _sha(phone + code), expires)
    # Hook an SMS or WhatsApp provider here. Until then the code is only logged.
    log.info("one-time code for %s: %s", phone, code)
    out = {"sent": True, "phone": phone, "expires_in": OTP_MINUTES * 60}
    if otp_echo():
        out["dev_code"] = code
    return out


def verify_otp(store: PlatformStore, phone: str, code: str) -> str:
    phone = normalize_phone(phone)
    cur = store.get_otp(phone)
    if not cur or cur["expires_at"] < now():
        raise HTTPException(401, "The code has expired. Ask for a new one.")
    if cur["attempts"] >= OTP_MAX_ATTEMPTS:
        raise HTTPException(429, "Too many wrong codes. Ask for a new one.")
    if not hmac.compare_digest(cur["code_hash"], _sha(phone + code.strip())):
        store.bump_otp(phone)
        raise HTTPException(401, "That code is not right.")
    store.drop_otp(phone)
    return phone


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


def need(permission: str):
    def dep(staff: dict = Depends(current_staff)) -> dict:
        if not can(staff, permission):
            raise HTTPException(403, f"Your role ({staff['role']}) cannot do this.")
        return staff
    return dep


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
    who = {"customer_id": None, "staff": False,
           "device": device_key(x_device_id, request.client.host if request.client else None)}
    if s and s["subject_kind"] == "customer":
        who["customer_id"] = s["subject_id"]
    elif s and s["subject_kind"] == "staff":
        st = _store.get_staff(s["subject_id"])
        who["staff"] = bool(st and st["active"])
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
