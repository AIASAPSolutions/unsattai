"""Messages to customers: one hook for SMS, one for email, an outbox and in-app notifications.

No SMS or email provider is connected by default. Both hooks then only log the
message, and it stays in the outbox with status "logged". To connect a provider,
set SMS_WEBHOOK_URL / EMAIL_WEBHOOK_URL (and optionally SMS_WEBHOOK_TOKEN /
EMAIL_WEBHOOK_TOKEN, sent as a bearer token): the hook then POSTs the message as JSON
to that URL, which can be a small adapter for any provider. Nothing is hard-coded.

One-time codes go through the same hooks but are never written to the outbox.
"""
from __future__ import annotations

import logging
import os

from .db import PlatformStore, now, sortable_id

log = logging.getLogger("urjersey.notify")


def _post(kind: str, payload: dict) -> str:
    url = os.getenv(f"{kind}_WEBHOOK_URL", "").strip()
    if not url:
        return "logged"
    import httpx
    token = os.getenv(f"{kind}_WEBHOOK_TOKEN", "")
    try:
        r = httpx.post(url, json=payload, timeout=10, headers={"Authorization": f"Bearer {token}"} if token else {})
        r.raise_for_status()
        return "sent"
    except Exception as e:   # a provider outage must never break an order
        log.warning("%s provider failed: %s", kind.lower(), e)
        return "failed"


def _shown(kind: str, text: str, secret: bool) -> str:
    # With a provider connected, one-time codes stay out of the log.
    return "(one-time code sent)" if secret and os.getenv(f"{kind}_WEBHOOK_URL", "").strip() else text


def send_sms(to: str, text: str, *, secret: bool = False) -> str:
    """The SMS hook. Returns logged | sent | failed."""
    log.info("SMS to %s: %s", to, _shown("SMS", text, secret))
    return _post("SMS", {"to": to, "text": text})


def send_email(to: str, subject: str, body: str, *, secret: bool = False) -> str:
    """The email hook. Returns logged | sent | failed."""
    log.info("email to %s: %s | %s", to, subject, _shown("EMAIL", body, secret))
    return _post("EMAIL", {"to": to, "subject": subject, "text": body})


# ----------------------------------------------------------------- order events

TEMPLATES = {
    "placed": ("Order {number} placed", "We have your order {number}. Total {currency} {total}."),
    "confirmed": ("Order {number} confirmed", "Order {number} is confirmed and scheduled. Expected delivery {delivery_date}."),
    "dispatched": ("Order {number} dispatched", "Order {number} is on its way with {carrier}. Tracking: {tracking}."),
    "delivered": ("Order {number} delivered", "Order {number} was delivered. Tell us how it went."),
    "cancelled": ("Order {number} cancelled", "Order {number} was cancelled. {refund}"),
    "return_requested": ("Return request received", "We received your return request for order {number}."),
    "return_approved": ("Return approved", "Your return for order {number} is approved. We'll arrange a pickup."),
    "return_picked_up": ("Return picked up", "We have picked up the return for order {number}."),
    "return_resolved": ("Return resolved", "Your return for order {number} is resolved: {resolution}."),
    "return_rejected": ("Return not accepted", "We could not accept the return for order {number}. {note}"),
}


class _Blank(dict):
    def __missing__(self, key):
        return ""


def order_event(store: PlatformStore, order: dict, code: str, **params) -> None:
    """Write a customer-facing event to the in-app notifications and the SMS/email outbox."""
    if code not in TEMPLATES:
        return
    p = order.get("pricing") or {}
    f = order.get("fulfilment") or {}
    values = _Blank(number=order.get("number") or order["id"], currency=p.get("currency", ""), total=p.get("total", ""),
                    delivery_date=f.get("promised_delivery_date") or (f.get("estimate") or {}).get("delivery_date", ""),
                    **{k: v if v is not None else "" for k, v in params.items()})
    title, body = (t.format_map(values) for t in TEMPLATES[code])
    cust = order.get("customer") or {}
    cid = order.get("customer_id") or ""
    if cid:
        nid = sortable_id("ntf")
        store.put("notification", nid, {"customer_id": cid, "order_id": order["id"], "code": code, "title": title,
                                         "body": body, "read": False}, status="unread", parent=cid, ref=order["id"])
    if cust.get("phone"):
        from .security import normalize_phone
        _outbox(store, "sms", normalize_phone(cust["phone"]), title, body, cid, order["id"], code)
    if cust.get("email"):
        _outbox(store, "email", cust["email"], title, body, cid, order["id"], code)


def _outbox(store: PlatformStore, channel: str, to: str, subject: str, body: str, customer_id: str, order_id: str,
            code: str) -> None:
    status = send_sms(to, body) if channel == "sms" else send_email(to, subject, body)
    mid = sortable_id("msg")
    store.put("message", mid, {"channel": channel, "to": to, "subject": subject, "body": body, "status": status,
                                "customer_id": customer_id, "order_id": order_id, "event": code, "sent_at": now()},
              status=status, parent=customer_id, ref=order_id, search=f"{to} {subject} {order_id}")
