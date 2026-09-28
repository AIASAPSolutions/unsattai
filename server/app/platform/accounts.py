"""Customer accounts: the profile view, linking guest orders, passwords, and adding a verified
phone or email to an account."""
from __future__ import annotations

from fastapi import HTTPException

from . import lifecycle, security
from .db import PlatformStore


def me_view(c: dict) -> dict:
    return {**{k: c.get(k) for k in ("id", "name", "phone", "email", "addresses", "marketing_opt_in", "orders_count")},
            "phone_verified": bool(c.get("phone_verified")), "email_verified": bool(c.get("email_verified")),
            "has_password": bool(c.get("has_password"))}


def _verified_account(store: PlatformStore, customer_id: str | None) -> bool:
    c = store.get("customer", customer_id) if customer_id else None
    return bool(c and (c.get("phone_verified") or c.get("email_verified") or c.get("has_password")))


def link_guest_orders(store: PlatformStore, cust: dict) -> None:
    """Guest orders placed with this customer's verified phone or verified email become theirs.
    By email, only orders not already held by another signed-in account move."""
    rows = []
    if cust.get("phone") and cust.get("phone_verified"):
        rows += store.find("order_index", ref=cust["phone"], limit=500)[0]
    if cust.get("email") and cust.get("email_verified"):
        email = cust["email"].lower()
        rows += [r for r in store.find("order_index", q=email, limit=500)[0]
                 if (r.get("email") or "") == email and not _verified_account(store, r.get("customer_id"))]
    for row in rows:
        if row.get("customer_id") != cust["id"]:
            order = store.get_order(row["id"])
            if order:
                order["customer_id"] = cust["id"]
                store.save_order(order)
                lifecycle.index_order(store, order)
                for n in store.find("notification", ref=order["id"], limit=200)[0]:
                    n["customer_id"] = cust["id"]
                    store.put("notification", n["id"], n, status="read" if n["read"] else "unread", parent=cust["id"],
                              ref=order["id"])
    lifecycle.refresh_customer_stats(store, cust["id"])


def password_hash(store: PlatformStore, customer_id: str) -> str | None:
    """Customer password hashes live in their own record, so no customer view or export can carry one."""
    return (store.get("customer_secret", customer_id) or {}).get("password_hash")


def set_password(store: PlatformStore, cust: dict, new: str) -> dict:
    store.put("customer_secret", cust["id"], {"password_hash": security.hash_password(new)})
    cust["has_password"] = True
    return lifecycle.save_customer(store, cust)


def owner_of_phone(store: PlatformStore, phone: str) -> dict | None:
    rows, _ = store.find("customer", ref=phone, limit=5)
    return rows[0] if rows else None


def claim_identifier(store: PlatformStore, cust: dict, phone: str | None, email: str | None, check_only: bool) -> dict:
    """Give this account a phone or email (already proven by a code when check_only is False).

    Another signed-in account holding it is a 409. A guest record that only exists because
    of an order placed with that phone steps aside, and its orders move over."""
    if email:
        other = lifecycle.customer_by_email(store, email)
        if other and other["id"] != cust["id"]:
            raise HTTPException(409, "This email belongs to another account.")
        if check_only:
            return cust
        cust["email"], cust["email_verified"] = email, True
        cust = lifecycle.save_customer(store, cust)
    else:
        other = owner_of_phone(store, phone)
        if other and other["id"] != cust["id"]:
            if _verified_account(store, other["id"]):
                raise HTTPException(409, "This mobile number belongs to another account.")
            if not check_only:
                other["phone"] = ""
                other["notes"] = (other.get("notes") or "") + f"\nPhone moved to account {cust['id']}."
                lifecycle.save_customer(store, other)
        if check_only:
            return cust
        cust["phone"], cust["phone_verified"] = phone, True
        cust = lifecycle.save_customer(store, cust)
    link_guest_orders(store, cust)
    return cust
