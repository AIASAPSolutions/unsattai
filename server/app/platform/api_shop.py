"""Customer-facing API used by the web store and the mobile app.

Everything here also needs the channel's X-API-Key when the server sets API_KEYS.
Signing in is optional for ordering (guest checkout by phone); it is needed for the
order history, saved designs, team collections and support tickets.
"""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from ..schemas import SIZES, Address, DesignSpec
from . import config, crm, lifecycle, planning, security
from .db import PlatformStore, new_id, now
from .pricing import QuoteRequest, find_zone, quote


class OtpRequest(BaseModel):
    phone: str = Field(..., min_length=6, max_length=24)


class OtpVerify(BaseModel):
    phone: str = Field(..., min_length=6, max_length=24)
    code: str = Field(..., min_length=4, max_length=8)
    name: str = Field("", max_length=80)


class ProfileIn(BaseModel):
    name: str | None = Field(None, max_length=80)
    email: str | None = Field(None, max_length=120, pattern=r"^$|^[^@\s]+@[^@\s]+\.[^@\s]+$")
    addresses: list[Address] | None = Field(None, max_length=10)
    marketing_opt_in: bool | None = None


class SavedDesignIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    spec: DesignSpec
    design_id: str = Field("", max_length=40)


class CollectionIn(BaseModel):
    title: str = Field(..., min_length=2, max_length=80)
    spec: DesignSpec
    design_id: str = Field("", max_length=40)
    fabric: str = Field("standard", max_length=30)
    deadline: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    message: str = Field("", max_length=500)
    unique_numbers: bool = True


class EntryIn(BaseModel):
    player_name: str = Field("", max_length=16)
    number: str = Field("", pattern=r"^\d{0,3}$")
    size: str = Field(..., pattern="^(" + "|".join(SIZES) + ")$")
    quantity: int = Field(1, ge=1, le=20)
    contact: str = Field("", max_length=40)


class EnquiryIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    phone: str = Field(..., min_length=6, max_length=24)
    email: str = Field("", max_length=120)
    organisation: str = Field("", max_length=120)
    pieces: int = Field(0, ge=0, le=100_000)
    needed_by: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    message: str = Field("", max_length=2000)
    spec: DesignSpec | None = None


class Reply(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)


class AcceptQuote(BaseModel):
    address: Address | None = None


def router(store: PlatformStore, key_dep, create_order) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=key_dep)

    # ------------------------------------------------------------- catalogue and prices

    @r.get("/shop/catalogue")
    def catalogue():
        return config.public_catalogue(store)

    @r.post("/shop/quote")
    def shop_quote(req: QuoteRequest):
        q = quote(store, req)
        transit = q["shipping"].get("transit_days", 0)
        q["estimate"] = planning.promise(store, q["pieces"], req.rush, transit)
        if req.rush:
            q["estimate_standard"] = planning.promise(store, q["pieces"], False, transit)
        return q

    @r.get("/shop/delivery-estimate")
    def delivery_estimate(pieces: int = Query(1, ge=1, le=5000), pincode: str = Query("", pattern=r"^$|^\d{6}$"),
                          rush: bool = False):
        zone = find_zone(config.get(store, "delivery"), pincode, "")
        return {"zone": zone["name"], **planning.promise(store, pieces, rush, zone["transit_days"])}

    @r.post("/shop/enquiries", status_code=201)
    def enquiry(body: EnquiryIn):
        """Bulk or custom request from the website: becomes a customer, a lead and a task for sales."""
        cust = lifecycle.upsert_customer(store, body.name, body.phone, body.email, "web")
        title = f"{body.organisation or body.name}: {body.pieces or 'bulk'} pieces"
        lead = crm.save_lead(store, None, crm.LeadIn(title=title[:120], customer_id=cust["id"], pieces=body.pieces,
                                                    source="web", notes=body.message,
                                                    expected_close=body.needed_by), "web")
        if body.spec:
            lead["spec"] = body.spec.model_dump()
            store.put("lead", lead["id"], lead, status=lead["stage"], parent=lead.get("organisation_id", ""),
                      ref=cust["id"], search=title)
        crm.add_activity(store, crm.ActivityIn(kind="task", subject=f"lead:{lead['id']}",
                                               body=f"Call {body.name} ({cust['phone']}) about their enquiry.",
                                               due_at=now()[:10]), "web")
        return {"ok": True, "reference": lead["id"]}

    # ------------------------------------------------------------- sign-in

    @r.post("/auth/otp/request")
    def otp_request(body: OtpRequest):
        return security.request_otp(store, body.phone)

    @r.post("/auth/otp/verify")
    def otp_verify(body: OtpVerify):
        phone = security.verify_otp(store, body.phone, body.code)
        cust = lifecycle.upsert_customer(store, body.name, phone, "", "web")
        if cust.get("status") == "blocked":
            raise HTTPException(403, "This account is blocked. Contact support.")
        _link_guest_orders(cust)
        return {**security.issue_token(store, "customer", cust["id"]), "customer": _me(cust)}

    @r.post("/auth/logout")
    def logout(authorization: str | None = Header(default=None)):
        token = security._bearer(authorization)
        if token:
            security.revoke(store, token)
        return {"ok": True}

    def _me(c: dict) -> dict:
        return {k: c.get(k) for k in ("id", "name", "phone", "email", "addresses", "marketing_opt_in", "orders_count")}

    def _link_guest_orders(cust: dict) -> None:
        rows, _ = store.find("order_index", ref=cust["phone"], limit=500)
        for row in rows:
            if row.get("customer_id") != cust["id"]:
                order = store.get_order(row["id"])
                if order:
                    order["customer_id"] = cust["id"]
                    store.save_order(order)
                    lifecycle.index_order(store, order)
        lifecycle.refresh_customer_stats(store, cust["id"])

    @r.get("/me")
    def me(customer: dict = Depends(security.require_customer)):
        return _me(customer)

    @r.patch("/me")
    def update_me(body: ProfileIn, customer: dict = Depends(security.require_customer)):
        for k, v in body.model_dump(exclude_none=True).items():
            customer[k] = v
        return _me(lifecycle.save_customer(store, customer))

    # ------------------------------------------------------------- my orders

    @r.get("/me/orders")
    def my_orders(customer: dict = Depends(security.require_customer), page: int = Query(1, ge=1)):
        rows, total = store.find("order_index", parent=customer["id"], order="created_at DESC", limit=20,
                                 offset=(page - 1) * 20)
        return {"orders": rows, "total": total, "page": page}

    def _mine(order_id: str, customer: dict) -> dict:
        order = store.get_order(order_id)
        if not order or order.get("customer_id") != customer["id"]:
            raise HTTPException(404, "order not found")
        return order

    @r.get("/me/orders/{order_id}")
    def my_order(order_id: str, customer: dict = Depends(security.require_customer)):
        return lifecycle.public_view(_mine(order_id, customer))

    @r.post("/me/orders/{order_id}/reorder")
    def reorder(order_id: str, customer: dict = Depends(security.require_customer)):
        o = _mine(order_id, customer)
        return {"spec": o["spec"], "design_id": o.get("design_id"),
                "items": [{"player_name": ln["player_name"], "number": ln["number"], "size": ln["size"],
                           "quantity": ln["quantity"]} for ln in o["lines"]],
                "fabric": (o.get("pricing") or {}).get("fabric", {}).get("id", "standard"),
                "delivery": (o.get("delivery") or {})}

    @r.get("/orders/{order_id}/invoice", response_class=HTMLResponse)
    def invoice(order_id: str):
        order = store.get_order(order_id)
        if not order:
            raise HTTPException(404, "order not found")
        return HTMLResponse(lifecycle.invoice_html(store, order))

    @r.get("/orders/{order_id}/track")
    def track(order_id: str, phone: str = Query(..., min_length=6, max_length=24)):
        """Guest tracking: order id plus the phone number used for it."""
        order = store.get_order(order_id)
        if not order or security.normalize_phone(order["customer"]["phone"]) != security.normalize_phone(phone):
            raise HTTPException(404, "No order matches this number and phone.")
        return lifecycle.public_view(order)

    # ------------------------------------------------------------- saved designs

    @r.get("/me/designs")
    def my_designs(customer: dict = Depends(security.require_customer)):
        rows, total = store.find("saved_design", parent=customer["id"], limit=100)
        return {"designs": rows, "total": total}

    @r.post("/me/designs", status_code=201)
    def save_design(body: SavedDesignIn, customer: dict = Depends(security.require_customer)):
        did = new_id("sav")
        return store.put("saved_design", did, {**body.model_dump(), "customer_id": customer["id"]},
                         parent=customer["id"], search=body.name)

    @r.delete("/me/designs/{did}")
    def delete_design(did: str, customer: dict = Depends(security.require_customer)):
        d = store.get("saved_design", did)
        if not d or d["customer_id"] != customer["id"]:
            raise HTTPException(404, "design not found")
        store.delete("saved_design", did)
        return {"ok": True}

    # ------------------------------------------------------------- team collections

    def _collection_public(c: dict, entries: list[dict]) -> dict:
        pb = config.get(store, "price_book")
        return {"id": c["id"], "token": c["token"], "title": c["title"], "spec": c["spec"], "deadline": c["deadline"],
                "message": c["message"], "status": c["status"], "organiser": c["organiser_name"],
                "fabric": c["fabric"], "sizes": list(SIZES), "count": sum(e["quantity"] for e in entries),
                "taken_numbers": sorted({e["number"] for e in entries if e["number"]}),
                "unique_numbers": c["unique_numbers"], "currency": pb["currency"],
                "base_price": pb["garments"][c["spec"]["garment"]]["base"]}

    def _entries(cid: str) -> list[dict]:
        rows, _ = store.find("entry", parent=cid, status="active", order="created_at ASC", limit=1000)
        return rows

    @r.post("/collections", status_code=201)
    def create_collection(body: CollectionIn, customer: dict = Depends(security.require_customer)):
        cid = new_id("col")
        c = {**body.model_dump(), "id": cid, "token": secrets.token_urlsafe(10), "status": "open",
             "customer_id": customer["id"], "organiser_name": customer.get("name") or "Your organiser"}
        return store.put("collection", cid, c, status="open", parent=customer["id"], ref=c["token"], search=body.title)

    @r.get("/me/collections")
    def my_collections(customer: dict = Depends(security.require_customer)):
        rows, _ = store.find("collection", parent=customer["id"], limit=100)
        return {"collections": [{**c, "count": sum(e["quantity"] for e in _entries(c["id"]))} for c in rows]}

    def _my_collection(cid: str, customer: dict) -> dict:
        c = store.get("collection", cid)
        if not c or c["customer_id"] != customer["id"]:
            raise HTTPException(404, "collection not found")
        return c

    @r.get("/me/collections/{cid}")
    def my_collection(cid: str, customer: dict = Depends(security.require_customer)):
        c = _my_collection(cid, customer)
        return {**c, "entries": _entries(cid)}

    @r.post("/me/collections/{cid}/status")
    def collection_status(cid: str, status: str = Query(..., pattern="^(open|locked|cancelled)$"),
                          customer: dict = Depends(security.require_customer)):
        c = _my_collection(cid, customer)
        if c["status"] == "ordered":
            raise HTTPException(409, "This collection has already been ordered.")
        c["status"] = status
        return store.put("collection", cid, c, status=status, parent=c["customer_id"], ref=c["token"], search=c["title"])

    @r.delete("/me/collections/{cid}/entries/{eid}")
    def organiser_remove_entry(cid: str, eid: str, customer: dict = Depends(security.require_customer)):
        _my_collection(cid, customer)
        e = store.get("entry", eid)
        if not e or e["collection_id"] != cid:
            raise HTTPException(404, "entry not found")
        e["status"] = "removed"
        store.put("entry", eid, e, status="removed", parent=cid)
        return {"ok": True}

    def _by_token(token: str) -> dict:
        rows, _ = store.find("collection", ref=token, limit=1)
        if not rows:
            raise HTTPException(404, "This team link is not valid.")
        return rows[0]

    @r.get("/collections/{token}")
    def collection_public(token: str):
        c = _by_token(token)
        return _collection_public(c, _entries(c["id"]))

    def _check_entry(c: dict, body: EntryIn, skip: str | None = None) -> None:
        if c["status"] != "open":
            raise HTTPException(409, "The organiser has closed this list.")
        if c["deadline"] and c["deadline"] < now()[:10]:
            raise HTTPException(409, "The deadline for this list has passed.")
        if c["unique_numbers"] and body.number:
            if any(e["number"] == body.number and e["id"] != skip for e in _entries(c["id"])):
                raise HTTPException(409, f"Number {body.number} is already taken. Choose another.")

    @r.post("/collections/{token}/entries", status_code=201)
    def add_entry(token: str, body: EntryIn):
        c = _by_token(token)
        _check_entry(c, body)
        eid, edit_key = new_id("ent"), secrets.token_urlsafe(12)
        e = {**body.model_dump(), "id": eid, "collection_id": c["id"], "edit_key": edit_key, "status": "active"}
        store.put("entry", eid, e, status="active", parent=c["id"], search=f"{body.player_name} {body.number}")
        return {**e}

    @r.put("/collections/{token}/entries/{eid}")
    def edit_entry(token: str, eid: str, body: EntryIn, key: str = Query(..., min_length=8)):
        c = _by_token(token)
        e = store.get("entry", eid)
        if not e or e["collection_id"] != c["id"] or not secrets.compare_digest(e["edit_key"], key):
            raise HTTPException(404, "entry not found")
        _check_entry(c, body, skip=eid)
        e.update(body.model_dump())
        store.put("entry", eid, e, status="active", parent=c["id"], search=f"{body.player_name} {body.number}")
        return e

    # ------------------------------------------------------------- quotes sent by sales

    @r.get("/quotes/{token}")
    def get_quote(token: str):
        return crm.public_quote(store, token)

    @r.post("/quotes/{token}/accept")
    def accept_quote(token: str, body: AcceptQuote):
        q = crm.public_quote(store, token)
        if q["expired"] or q["status"] not in ("sent",):
            raise HTTPException(409, "This quote can no longer be accepted. Ask us for a new one.")
        full = store.get("quote", q["id"])
        order = create_order({
            "design_id": full.get("design_id", ""), "spec": full["spec"], "language": "en",
            "items": [{"player_name": ln["player_name"], "number": ln["number"], "size": ln["size"],
                       "quantity": ln["quantity"]} for ln in full["lines"]],
            "customer": {"name": full["customer"]["name"] or "Customer", "phone": full["customer"]["phone"],
                         "email": full["customer"].get("email", "")},
            "idempotency_key": f"quote_{full['id']}", "fabric": full["fabric"], "rush": full["rush"],
            "coupon": full.get("coupon", ""), "channel": "sales",
            "delivery": {"method": full["delivery"]["method"],
                         "address": body.address.model_dump() if body.address else None},
        }, quote=full)
        full["status"], full["order_id"] = "converted", order["id"]
        crm._put_quote(store, full)
        return {"order_id": order["id"], "order": lifecycle.public_view(order)}

    # ------------------------------------------------------------- support

    @r.get("/me/tickets")
    def my_tickets(customer: dict = Depends(security.require_customer)):
        rows, _ = store.find("ticket", parent=customer["id"], limit=100)
        return {"tickets": [crm.public_ticket(t) for t in rows]}

    @r.post("/me/tickets", status_code=201)
    def new_ticket(body: crm.TicketIn, customer: dict = Depends(security.require_customer)):
        if body.order_id:
            o = store.get_order(body.order_id)
            if not o or o.get("customer_id") != customer["id"]:
                raise HTTPException(404, "order not found")
        return crm.public_ticket(crm.open_ticket(store, customer, body, "web"))

    @r.post("/me/tickets/{tid}/reply")
    def reply_ticket(tid: str, body: Reply, customer: dict = Depends(security.require_customer)):
        t = store.get("ticket", tid)
        if not t or t["customer_id"] != customer["id"]:
            raise HTTPException(404, "ticket not found")
        return crm.public_ticket(crm.ticket_reply(store, tid, body.body, "customer"))

    return r
