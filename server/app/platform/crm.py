"""CRM: customers, organisations (teams, clubs, schools...), leads through a pipeline,
activities (notes, calls, tasks with due dates), quotes that customers accept online,
support tickets, and team order collections.

Customers are created automatically from orders and sign-ins (matched by phone), so
sales sees every buyer without data entry.
"""
from __future__ import annotations

import secrets
from datetime import date, timedelta

from fastapi import HTTPException
from pydantic import BaseModel, Field

from ..schemas import DesignSpec, Garment
from . import config
from .db import PlatformStore, new_id, now
from .lifecycle import save_customer, upsert_customer
from .pricing import DeliveryChoice, PriceLine, QuoteRequest, quote


# ----------------------------------------------------------------- inputs

class CustomerIn(BaseModel):
    name: str = Field("", max_length=80)
    phone: str = Field(..., min_length=6, max_length=24)
    email: str = Field("", max_length=120)
    organisation_id: str = Field("", max_length=40)
    owner: str = Field("", max_length=40)
    tags: list[str] = Field(default_factory=list, max_length=20)
    notes: str = Field("", max_length=2000)
    marketing_opt_in: bool = False
    status: str = Field("active", pattern="^(active|blocked)$")


class OrganisationIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    kind: str = Field("team", max_length=30)
    city: str = Field("", max_length=60)
    state: str = Field("", max_length=40)
    phone: str = Field("", max_length=24)
    email: str = Field("", max_length=120)
    owner: str = Field("", max_length=40)
    tags: list[str] = Field(default_factory=list, max_length=20)
    notes: str = Field("", max_length=2000)
    status: str = Field("active", pattern="^(active|archived)$")


class LeadIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    stage: str = Field("new", max_length=30)
    customer_id: str = Field("", max_length=40)
    organisation_id: str = Field("", max_length=40)
    value: float = Field(0, ge=0)
    pieces: int = Field(0, ge=0, le=100_000)
    source: str = Field("other", max_length=30)
    owner: str = Field("", max_length=40)
    expected_close: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    lost_reason: str = Field("", max_length=300)
    notes: str = Field("", max_length=2000)


class ActivityIn(BaseModel):
    kind: str = Field("note", pattern="^(note|call|email|whatsapp|meeting|task)$")
    subject: str = Field(..., pattern=r"^(customer|organisation|lead|order|ticket|quote):[A-Za-z0-9_-]{3,40}$")
    body: str = Field(..., min_length=1, max_length=4000)
    due_at: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}")
    owner: str = Field("", max_length=40)
    done: bool = False


class QuoteIn(BaseModel):
    customer_id: str = Field(..., max_length=40)
    lead_id: str = Field("", max_length=40)
    title: str = Field("", max_length=120)
    spec: DesignSpec
    design_id: str = Field("", max_length=40)
    garment: Garment = "jersey"
    fabric: str = "standard"
    lines: list[PriceLine] = Field(..., min_length=1, max_length=500)
    delivery: DeliveryChoice = Field(default_factory=DeliveryChoice)
    rush: bool = False
    coupon: str = Field("", max_length=24)
    extra_discount: float = Field(0, ge=0, description="sales discount on top of the price book")
    message: str = Field("", max_length=2000)
    valid_until: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="default: company quote_valid_days from today")


class TicketIn(BaseModel):
    subject: str = Field(..., min_length=3, max_length=160)
    body: str = Field(..., min_length=1, max_length=4000)
    category: str = Field("other", max_length=30)
    order_id: str = Field("", max_length=40)
    priority: str = Field("normal", pattern="^(low|normal|high|urgent)$")


# ----------------------------------------------------------------- customers & organisations

def create_customer(store: PlatformStore, body: CustomerIn, actor: str) -> dict:
    cust = upsert_customer(store, body.name, body.phone, body.email, "sales")
    return update_customer(store, cust["id"], body, actor)


def update_customer(store: PlatformStore, cid: str, body: CustomerIn, actor: str) -> dict:
    cust = store.get("customer", cid)
    if not cust:
        raise HTTPException(404, "customer not found")
    from .security import normalize_phone
    data = body.model_dump()
    data["phone"] = normalize_phone(data["phone"])
    if data["phone"] != cust["phone"]:
        other, _ = store.find("customer", ref=data["phone"], limit=1)
        if other and other[0]["id"] != cid:
            raise HTTPException(409, "Another customer already has this phone number.")
    cust.update(data)
    store.audit(actor, "customer.update", f"customer:{cid}")
    return save_customer(store, cust)


def save_org(store: PlatformStore, oid: str | None, body: OrganisationIn, actor: str) -> dict:
    cur = store.get("organisation", oid) if oid else None
    if oid and not cur:
        raise HTTPException(404, "organisation not found")
    oid = oid or new_id("org")
    data = {**(cur or {}), **body.model_dump(), "id": oid}
    store.audit(actor, "organisation.save", f"organisation:{oid}")
    return store.put("organisation", oid, data, status=body.status, owner=body.owner,
                     search=" ".join(filter(None, [body.name, body.city, body.kind, *body.tags])))


# ----------------------------------------------------------------- leads

def save_lead(store: PlatformStore, lid: str | None, body: LeadIn, actor: str) -> dict:
    stages = config.get(store, "crm")["lead_stages"]
    if body.stage not in stages:
        raise HTTPException(422, f"Unknown stage. Use one of: {', '.join(stages)}.")
    cur = store.get("lead", lid) if lid else None
    if lid and not cur:
        raise HTTPException(404, "lead not found")
    lid = lid or new_id("lead")
    data = {**(cur or {}), **body.model_dump(), "id": lid}
    if cur and cur.get("stage") != body.stage:
        data.setdefault("history", []).append({"at": now(), "from": cur.get("stage"), "to": body.stage, "by": actor})
        if body.stage in ("won", "lost"):
            data["closed_at"] = now()
    store.audit(actor, "lead.save", f"lead:{lid}", {"stage": body.stage})
    return store.put("lead", lid, data, status=body.stage, owner=body.owner, parent=body.organisation_id,
                     ref=body.customer_id, search=f"{body.title} {body.source} {body.notes[:200]}")


def pipeline(store: PlatformStore) -> dict:
    stages = config.get(store, "crm")["lead_stages"]
    leads, _ = store.find("lead", limit=2000)
    cols = {s: {"stage": s, "count": 0, "value": 0.0, "leads": []} for s in stages}
    for ld in leads:
        col = cols.get(ld["stage"])
        if col:
            col["count"] += 1
            col["value"] += ld.get("value") or 0
            col["leads"].append(ld)
    won = cols.get("won", {}).get("count", 0)
    lost = cols.get("lost", {}).get("count", 0)
    return {"stages": list(cols.values()),
            "win_rate": round(won / (won + lost), 3) if won + lost else None,
            "open_value": round(sum(c["value"] for s, c in cols.items() if s not in ("won", "lost")), 2)}


# ----------------------------------------------------------------- activities

def add_activity(store: PlatformStore, body: ActivityIn, actor: str) -> dict:
    aid = new_id("act")
    data = {**body.model_dump(), "id": aid, "created_by": actor, "done_at": now() if body.done else None}
    return store.put("activity", aid, data, status="done" if body.done else "open", owner=body.owner or actor,
                     parent=body.subject, search=body.body[:300])


def set_activity_done(store: PlatformStore, aid: str, done: bool, actor: str) -> dict:
    a = store.get("activity", aid)
    if not a:
        raise HTTPException(404, "activity not found")
    a["done"], a["done_at"] = done, now() if done else None
    return store.put("activity", aid, a, status="done" if done else "open", owner=a["owner"], parent=a["subject"],
                     search=a["body"][:300])


def tasks_due(store: PlatformStore, owner: str | None, until: str) -> list[dict]:
    rows, _ = store.find("activity", status="open", owner=owner, limit=500, order="created_at ASC")
    return sorted([r for r in rows if r["kind"] == "task" and r.get("due_at") and r["due_at"][:10] <= until],
                  key=lambda r: r["due_at"])


# ----------------------------------------------------------------- quotes

def _quote_pricing(store: PlatformStore, body: QuoteIn) -> dict:
    logos = sum(1 for e in body.spec.elements if e.type == "logo")
    pr = quote(store, QuoteRequest(garment=body.spec.garment, fabric=body.fabric, logos=min(logos, 4), lines=body.lines,
                                   delivery=body.delivery, rush=body.rush, coupon=body.coupon))
    if body.extra_discount:
        d = min(body.extra_discount, pr["total"])
        pr["sales_discount"] = round(d, 2)
        pr["total"] = round(pr["total"] - d, 2)
    return pr


def save_quote(store: PlatformStore, qid: str | None, body: QuoteIn, actor: str) -> dict:
    cust = store.get("customer", body.customer_id)
    if not cust:
        raise HTTPException(404, "customer not found")
    cur = store.get("quote", qid) if qid else None
    if qid and not cur:
        raise HTTPException(404, "quote not found")
    if cur and cur["status"] in ("accepted", "converted"):
        raise HTTPException(409, "An accepted quote can't be changed. Create a new one.")
    qid = qid or new_id("qte")
    days = config.get(store, "company")["quote_valid_days"]
    data = {**(cur or {}), **body.model_dump(), "id": qid,
            "number": (cur or {}).get("number") or f"Q-{store.next_number('quote'):05d}",
            "pricing": _quote_pricing(store, body), "status": (cur or {}).get("status", "draft"),
            "token": (cur or {}).get("token") or secrets.token_urlsafe(18),
            "valid_until": body.valid_until or (cur or {}).get("valid_until") or (date.today() + timedelta(days=days)).isoformat(), "created_by": (cur or {}).get("created_by", actor),
            "customer": {"name": cust["name"], "phone": cust["phone"], "email": cust.get("email", "")}}
    store.audit(actor, "quote.save", f"quote:{qid}", {"total": data["pricing"]["total"]})
    return _put_quote(store, data)


def _put_quote(store: PlatformStore, q: dict) -> dict:
    return store.put("quote", q["id"], q, status=q["status"], parent=q["customer_id"], ref=q["token"],
                     owner=q.get("created_by", ""),
                     search=" ".join(filter(None, [q["number"], q.get("title"), q["customer"]["name"], q["customer"]["phone"]])))


def set_quote_status(store: PlatformStore, qid: str, status: str, actor: str) -> dict:
    q = store.get("quote", qid)
    if not q:
        raise HTTPException(404, "quote not found")
    q["status"] = status
    q.setdefault("history", []).append({"at": now(), "status": status, "by": actor})
    return _put_quote(store, q)


def public_quote(store: PlatformStore, token: str) -> dict:
    rows, _ = store.find("quote", ref=token, limit=1)
    if not rows:
        raise HTTPException(404, "quote not found")
    q = rows[0]
    if q["status"] in ("draft",):
        raise HTTPException(404, "quote not found")
    expired = q["valid_until"] < date.today().isoformat() and q["status"] == "sent"
    return {k: q[k] for k in ("id", "number", "title", "spec", "lines", "pricing", "valid_until", "message", "status",
                              "customer", "fabric", "rush", "delivery")} | {"expired": expired}


# ----------------------------------------------------------------- tickets

def open_ticket(store: PlatformStore, customer: dict, body: TicketIn, channel: str) -> dict:
    tid = new_id("tkt")
    data = {**body.model_dump(), "id": tid, "number": f"T-{store.next_number('ticket'):05d}", "status": "open",
            "customer_id": customer["id"], "customer": {"name": customer.get("name"), "phone": customer["phone"]},
            "channel": channel, "owner": "", "messages": [{"at": now(), "from": "customer", "body": body.body}]}
    return _put_ticket(store, data)


def _put_ticket(store: PlatformStore, t: dict) -> dict:
    return store.put("ticket", t["id"], t, status=t["status"], owner=t.get("owner", ""), parent=t["customer_id"],
                     ref=t.get("order_id", ""), search=" ".join(filter(None, [t["number"], t["subject"],
                                                                               t["customer"].get("name"), t["customer"]["phone"]])))


def ticket_reply(store: PlatformStore, tid: str, body: str, sender: str, status: str | None = None,
                 owner: str | None = None, internal: bool = False) -> dict:
    t = store.get("ticket", tid)
    if not t:
        raise HTTPException(404, "ticket not found")
    if body:
        t["messages"].append({"at": now(), "from": sender, "body": body, "internal": internal})
    if status:
        t["status"] = status
    elif sender == "customer" and t["status"] in ("pending", "resolved"):
        t["status"] = "open"
    if owner is not None:
        t["owner"] = owner
    return _put_ticket(store, t)


def public_ticket(t: dict) -> dict:
    return {**{k: v for k, v in t.items() if k != "messages"},
            "messages": [m for m in t["messages"] if not m.get("internal")]}


# ----------------------------------------------------------------- reorder reminders

def reorder_candidates(store: PlatformStore) -> list[dict]:
    days = config.get(store, "crm")["reorder_reminder_days"]
    if not days:
        return []
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    rows, _ = store.find("customer", status="active", limit=5000)
    return sorted([c for c in rows if c.get("last_order_at") and c["last_order_at"][:10] <= cutoff and c["orders_count"]],
                  key=lambda c: -c["lifetime_value"])[:100]
