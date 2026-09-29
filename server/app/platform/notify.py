"""Messages to customers: SMS, email, an outbox and in-app notifications.

Which service sends them is chosen with environment variables, nothing is hard-coded:

SMS_PROVIDER    log (default) | msg91 | twilio | webhook
EMAIL_PROVIDER  log (default) | smtp | resend | webhook

"log" only writes the message to the server log (and, for order messages, the outbox
with status "logged"), which is right for local development. When SMS_PROVIDER or
EMAIL_PROVIDER is blank, SMTP_HOST or a *_WEBHOOK_URL being set picks smtp or webhook.
Each provider's own settings are listed in .env.example and docs/configuration.md.

A provider outage never breaks an order or a sign-in: the send returns "failed" and
the reason is logged. One-time codes are never written to the outbox, and once a real
provider is connected they are not written to the log either.
"""
from __future__ import annotations

import html
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import make_msgid

import httpx

from ..config import env_int, env_str, is_production
from .db import PlatformStore, now, sortable_id

log = logging.getLogger("urjersey.notify")

TIMEOUT = 10


def brand() -> str:
    return env_str("BRAND_NAME", "UrJersey")


def sms_provider() -> str:
    p = env_str("SMS_PROVIDER").lower()
    return p or ("webhook" if env_str("SMS_WEBHOOK_URL") else "log")


def email_provider() -> str:
    p = env_str("EMAIL_PROVIDER").lower()
    if p:
        return p
    return "smtp" if env_str("SMTP_HOST") else "webhook" if env_str("EMAIL_WEBHOOK_URL") else "log"


def status() -> dict:
    """What the health check and the operations app show (no secrets)."""
    return {"sms": sms_provider(), "email": email_provider()}


def check_config() -> list[str]:
    """Problems with the messaging settings, logged once at start-up."""
    problems = []
    sms, email = sms_provider(), email_provider()
    need = {
        "msg91": ["MSG91_AUTH_KEY", "MSG91_OTP_TEMPLATE_ID"], "twilio": ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
        "webhook_sms": ["SMS_WEBHOOK_URL"], "smtp": ["SMTP_HOST", "EMAIL_FROM"], "resend": ["RESEND_API_KEY", "EMAIL_FROM"],
        "webhook_email": ["EMAIL_WEBHOOK_URL"],
    }
    for kind, prov in (("SMS", sms), ("EMAIL", email)):
        key = f"webhook_{kind.lower()}" if prov == "webhook" else prov
        if prov != "log" and key not in need:
            problems.append(f"{kind}_PROVIDER={prov} is not one of the supported providers.")
        problems += [f"{kind}_PROVIDER={prov} needs {v}." for v in need.get(key, []) if not env_str(v)]
    if sms == "twilio" and not (env_str("TWILIO_FROM") or env_str("TWILIO_MESSAGING_SERVICE_SID")):
        problems.append("SMS_PROVIDER=twilio needs TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID.")
    if is_production() and sms == "log" and email == "log":
        problems.append("No SMS or email provider is set, so customers cannot receive sign-in codes.")
    return problems


# ------------------------------------------------------------------------------ SMS

def _digits(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isdigit())


def _sms_msg91(to: str, text: str, vars: dict) -> None:
    template = env_str("MSG91_OTP_TEMPLATE_ID") if "otp" in vars else env_str("MSG91_ORDER_TEMPLATE_ID")
    if not template:
        raise RuntimeError("MSG91_ORDER_TEMPLATE_ID is not set, so order SMS are not sent")
    body = {"template_id": template, "short_url": "0",
            "recipients": [{"mobiles": _digits(to), **{k: str(v) for k, v in vars.items()}}]}
    if env_str("MSG91_SENDER_ID"):
        body["sender"] = env_str("MSG91_SENDER_ID")
    r = httpx.post(env_str("MSG91_FLOW_URL", "https://control.msg91.com/api/v5/flow"), json=body, timeout=TIMEOUT,
                   headers={"authkey": env_str("MSG91_AUTH_KEY"), "accept": "application/json"})
    r.raise_for_status()
    if "error" in r.text.lower() and '"type":"success"' not in r.text.replace(" ", ""):
        raise RuntimeError(f"MSG91 answered: {r.text[:200]}")


def _sms_twilio(to: str, text: str, vars: dict) -> None:
    sid = env_str("TWILIO_ACCOUNT_SID")
    data = {"To": to, "Body": text}
    if env_str("TWILIO_MESSAGING_SERVICE_SID"):
        data["MessagingServiceSid"] = env_str("TWILIO_MESSAGING_SERVICE_SID")
    else:
        data["From"] = env_str("TWILIO_FROM")
    r = httpx.post(f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json", data=data, timeout=TIMEOUT,
                   auth=(sid, env_str("TWILIO_AUTH_TOKEN")))
    r.raise_for_status()


def _webhook(kind: str, payload: dict) -> None:
    token = env_str(f"{kind}_WEBHOOK_TOKEN")
    r = httpx.post(env_str(f"{kind}_WEBHOOK_URL"), json=payload, timeout=TIMEOUT,
                   headers={"Authorization": f"Bearer {token}"} if token else {})
    r.raise_for_status()


def _sms_webhook(to: str, text: str, vars: dict) -> None:
    _webhook("SMS", {"to": to, "text": text, **vars})


SMS_SENDERS = {"msg91": _sms_msg91, "twilio": _sms_twilio, "webhook": _sms_webhook}


def send_sms(to: str, text: str, *, secret: bool = False, vars: dict | None = None) -> str:
    """Send one SMS. vars are template values for providers that need them (MSG91, webhook).

    Returns logged | sent | failed."""
    provider = sms_provider()
    sender = SMS_SENDERS.get(provider)
    log.info("SMS to %s via %s: %s", to, provider, "(one-time code)" if secret and sender else text)
    if not sender:
        return "logged"
    try:
        sender(to, text, vars or {})
        return "sent"
    except Exception as e:   # a provider outage must never break an order or a sign-in
        log.warning("SMS via %s failed: %s", provider, e)
        return "failed"


def send_code_sms(to: str, code: str, minutes: int) -> str:
    text = env_str("OTP_SMS_TEXT", "{code} is your {brand} code. It expires in {minutes} minutes. Don't share it.")
    text = text.format(code=code, brand=brand(), minutes=minutes)
    return send_sms(to, text, secret=True, vars={"otp": code, "minutes": minutes, "brand": brand()})


# ---------------------------------------------------------------------------- email

def _email_html(title: str, body: str, code: str | None = None, link: str | None = None) -> str:
    colour = env_str("EMAIL_BRAND_COLOUR", "#14225c")
    esc = html.escape
    parts = [f'<p style="margin:0 0 16px;font-size:15px;line-height:1.5">{esc(line)}</p>'
             for line in body.split("\n") if line.strip()]
    if code:
        parts.insert(0, f'<p style="margin:8px 0 20px;font-size:32px;font-weight:700;letter-spacing:6px">{esc(code)}</p>')
    if link:
        parts.append(f'<p style="margin:8px 0 16px"><a href="{esc(link)}" style="background:{esc(colour)};color:#fff;'
                     f'padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">View your order</a></p>')
    footer = esc(env_str("EMAIL_FOOTER", f"{brand()}. You get this email because you used {brand()}."))
    return (f'<!doctype html><html><body style="margin:0;background:#f4f5f8;font-family:Arial,Helvetica,sans-serif;color:#1b1f2a">'
            f'<div style="max-width:560px;margin:0 auto;padding:24px">'
            f'<div style="background:{esc(colour)};color:#fff;padding:14px 20px;border-radius:8px 8px 0 0;font-size:18px;'
            f'font-weight:700">{esc(brand())}</div>'
            f'<div style="background:#fff;padding:24px 20px;border-radius:0 0 8px 8px">'
            f'<h1 style="margin:0 0 16px;font-size:20px">{esc(title)}</h1>{"".join(parts)}</div>'
            f'<p style="font-size:12px;color:#6b7280;margin:16px 4px">{footer}</p></div></body></html>')


def _email_smtp(to: str, subject: str, text: str, html_body: str) -> None:
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = env_str("EMAIL_FROM"), to, subject
    msg["Message-ID"] = make_msgid(domain=env_str("EMAIL_FROM").rpartition("@")[2].strip("> ") or None)
    if env_str("EMAIL_REPLY_TO"):
        msg["Reply-To"] = env_str("EMAIL_REPLY_TO")
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    host, security = env_str("SMTP_HOST"), env_str("SMTP_SECURITY", "starttls").lower()
    port = env_int("SMTP_PORT", 465 if security == "ssl" else 587 if security == "starttls" else 25)
    context = ssl.create_default_context()
    if security == "ssl":
        server = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT, context=context)
    else:
        server = smtplib.SMTP(host, port, timeout=TIMEOUT)
    with server:
        if security == "starttls":
            server.starttls(context=context)
        if env_str("SMTP_USERNAME"):
            server.login(env_str("SMTP_USERNAME"), os.getenv("SMTP_PASSWORD", ""))
        server.send_message(msg)


def _email_resend(to: str, subject: str, text: str, html_body: str) -> None:
    body = {"from": env_str("EMAIL_FROM"), "to": [to], "subject": subject, "text": text, "html": html_body}
    if env_str("EMAIL_REPLY_TO"):
        body["reply_to"] = env_str("EMAIL_REPLY_TO")
    r = httpx.post("https://api.resend.com/emails", json=body, timeout=TIMEOUT,
                   headers={"Authorization": f"Bearer {env_str('RESEND_API_KEY')}"})
    r.raise_for_status()


def _email_webhook(to: str, subject: str, text: str, html_body: str) -> None:
    _webhook("EMAIL", {"to": to, "subject": subject, "text": text, "html": html_body})


EMAIL_SENDERS = {"smtp": _email_smtp, "resend": _email_resend, "webhook": _email_webhook}


def send_email(to: str, subject: str, body: str, *, secret: bool = False, code: str | None = None,
               link: str | None = None) -> str:
    """Send one email (plain text plus a simple branded HTML version). Returns logged | sent | failed."""
    provider = email_provider()
    sender = EMAIL_SENDERS.get(provider)
    log.info("email to %s via %s: %s | %s", to, provider, subject, "(one-time code)" if secret and sender else body)
    if not sender:
        return "logged"
    try:
        sender(to, subject, body + (f"\n\n{link}" if link else ""), _email_html(subject, body, code, link))
        return "sent"
    except Exception as e:
        log.warning("email via %s failed: %s", provider, e)
        return "failed"


def send_code_email(to: str, code: str, minutes: int) -> str:
    subject = env_str("OTP_EMAIL_SUBJECT", "Your {brand} code: {code}").format(code=code, brand=brand())
    body = (f"{code} is your {brand()} sign-in code. It expires in {minutes} minutes.\n"
            "If you didn't ask for it, you can ignore this email. Never share this code.")
    return send_email(to, subject, body, secret=True, code=code)


def order_link(order: dict) -> str | None:
    base = env_str("PUBLIC_SHOP_URL").rstrip("/")
    return f"{base}/account/orders/{order['id']}" if base and order.get("customer_id") else None


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
        _outbox(store, "sms", normalize_phone(cust["phone"]), title, body, cid, order["id"], code, values["number"])
    if cust.get("email"):
        _outbox(store, "email", cust["email"], title, body, cid, order["id"], code, values["number"], order_link(order))


def _outbox(store: PlatformStore, channel: str, to: str, subject: str, body: str, customer_id: str, order_id: str,
            code: str, number: str = "", link: str | None = None) -> None:
    if channel == "sms":
        status = send_sms(to, body, vars={"number": number, "message": body, "event": code, "brand": brand()})
    else:
        status = send_email(to, subject, body, link=link)
    mid = sortable_id("msg")
    store.put("message", mid, {"channel": channel, "to": to, "subject": subject, "body": body, "status": status,
                                "customer_id": customer_id, "order_id": order_id, "event": code, "sent_at": now()},
              status=status, parent=customer_id, ref=order_id, search=f"{to} {subject} {order_id}")
