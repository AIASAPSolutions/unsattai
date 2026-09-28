"""Operations API for staff: dashboard, orders, production, delivery, CRM, settings, reports.

Every route needs a staff session (POST /api/v1/ops/auth/login). Roles limit what each
person can change (see security.PERMISSIONS); every change is written to the audit log.
"""
from __future__ import annotations

import csv
import html
import io
from collections import Counter, defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import HTMLResponse, PlainTextResponse
from pydantic import BaseModel, Field

from .. import orders as order_mod
from ..schemas import PaymentConfirmation
from . import config, crm, lifecycle, planning, security, sellers
from .db import ConflictError, PlatformStore
from .pricing import QuoteRequest, quote

need = security.need


class Login(BaseModel):
    email: str = Field(..., max_length=120)
    password: str = Field(..., max_length=200)


class PasswordChange(BaseModel):
    current: str = Field(..., max_length=200)
    new: str = Field(..., max_length=200)


class StaffIn(BaseModel):
    email: str = Field(..., pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=120)
    name: str = Field(..., min_length=1, max_length=80)
    role: str = Field(..., pattern="^(" + "|".join(security.ROLES) + ")$")
    password: str = Field(..., max_length=200)
    seller_id: str = Field("", max_length=40, description="required for (and only for) the seller role")


class StaffPatch(BaseModel):
    name: str | None = Field(None, max_length=80)
    role: str | None = Field(None, pattern="^(" + "|".join(security.ROLES) + ")$")
    active: bool | None = None
    password: str | None = Field(None, max_length=200)
    seller_id: str | None = Field(None, max_length=40)


class SettingsPut(BaseModel):
    value: dict
    version: int = Field(..., ge=0, description="the version you edited; a newer save is refused")


class SimulateIn(BaseModel):
    price_book: dict
    request: QuoteRequest


class HoldIn(BaseModel):
    hold: bool
    reason: str = Field("", max_length=300)


class CancelIn(BaseModel):
    reason: str = Field(..., min_length=3, max_length=300)


class PriorityIn(BaseModel):
    rush: bool
    promised_delivery_date: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class NoteIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    public: bool = False


class PaymentIn(BaseModel):
    method: str = Field(..., pattern="^(cash|upi|bank_transfer|card|cheque|demo)$")
    reference: str = Field("", max_length=80)
    amount: float = Field(..., gt=0)


class ShipmentIn(BaseModel):
    carrier: str = Field(..., max_length=30)
    tracking_no: str = Field("", max_length=60)
    planned_date: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class ShipmentPatch(BaseModel):
    status: str = Field(..., pattern="^(planned|packed|dispatched|delivered|returned|cancelled)$")
    tracking_no: str | None = Field(None, max_length=60)


class TicketPatch(BaseModel):
    body: str = Field("", max_length=4000)
    internal: bool = False
    status: str | None = Field(None, pattern="^(open|pending|resolved|closed)$")
    owner: str | None = Field(None, max_length=40)


def _page(rows: list, total: int, page: int, size: int) -> dict:
    return {"items": rows, "total": total, "page": page, "pages": max(1, -(-total // size))}


def router(store: PlatformStore, key_dep) -> APIRouter:
    r = APIRouter(prefix="/api/v1/ops")

    def actor(s: dict) -> str:
        return f"staff:{s['id']}"

    # ------------------------------------------------------------- sign-in and staff

    @r.post("/auth/login")
    def login(body: Login, user_agent: str | None = Header(default=None)):
        email = body.email.strip()
        security.check_lock(store, "staff", email)
        found = store.staff_by_email(email)
        if not found or not found[0]["active"] or not security.check_password(body.password, found[1]):
            security.login_failed(store, "staff", email)
            raise HTTPException(401, "Email or password is not right.")
        security.login_ok(store, "staff", email)
        staff = found[0]
        store.audit(actor(staff), "staff.login", f"staff:{staff['id']}")
        return {**security.issue_token(store, "staff", staff["id"], user_agent, "password"), "staff": staff,
                "permissions": sorted(security.PERMISSIONS[staff["role"]])}

    @r.post("/auth/logout")
    def logout(authorization: str | None = Header(default=None)):
        token = security._bearer(authorization)
        if token:
            security.revoke(store, token)
        return {"ok": True}

    @r.get("/me")
    def me(s: dict = Depends(security.current_staff)):
        return {"staff": s, "permissions": sorted(security.PERMISSIONS[s["role"]]), "roles": list(security.ROLES)}

    @r.post("/me/password")
    def change_password(body: PasswordChange, s: dict = Depends(security.current_staff)):
        _, pw = store.staff_by_email(s["email"])
        if not security.check_password(body.current, pw):
            raise HTTPException(401, "Your current password is not right.")
        problem = security.password_problem(body.new)
        if problem:
            raise HTTPException(422, problem)
        store.update_staff(s["id"], password_hash=security.hash_password(body.new))
        store.audit(actor(s), "staff.password", f"staff:{s['id']}")
        return {"ok": True}

    @r.get("/staff")
    def list_staff(s: dict = Depends(need("read"))):
        return {"items": store.list_staff()}

    @r.post("/staff", status_code=201)
    def add_staff(body: StaffIn, s: dict = Depends(need("staff"))):
        problem = security.password_problem(body.password)
        if problem:
            raise HTTPException(422, problem)
        _check_seller_link(body.role, body.seller_id)
        data = {"name": body.name, **({"seller_id": body.seller_id} if body.role == "seller" else {})}
        try:
            new = store.add_staff(body.email, body.role, security.hash_password(body.password), data)
        except ConflictError as e:
            raise HTTPException(409, str(e)) from e
        store.audit(actor(s), "staff.create", f"staff:{new['id']}", {"role": body.role})
        return new

    @r.patch("/staff/{sid}")
    def edit_staff(sid: str, body: StaffPatch, s: dict = Depends(need("staff"))):
        if sid == s["id"] and (body.active is False or (body.role and body.role != "admin")):
            raise HTTPException(409, "You can't remove your own admin access.")
        cur = store.get_staff(sid)
        if not cur:
            raise HTTPException(404, "staff not found")
        role = body.role or cur["role"]
        seller_id = body.seller_id if body.seller_id is not None else cur.get("seller_id", "")
        _check_seller_link(role, seller_id)
        pw = None
        if body.password:
            problem = security.password_problem(body.password)
            if problem:
                raise HTTPException(422, problem)
            pw = security.hash_password(body.password)
        data = {k: v for k, v in (("name", body.name), ("seller_id", seller_id if role == "seller" else "")) if v is not None}
        out = store.update_staff(sid, role=body.role, active=body.active, password_hash=pw, data=data or None)
        if not out:
            raise HTTPException(404, "staff not found")
        if pw or body.active is False or body.role or body.seller_id is not None:
            # A reset password, a lock-out or a new role takes effect now, not when the old session expires.
            store.drop_sessions_for("staff", sid)
        store.audit(actor(s), "staff.update", f"staff:{sid}", body.model_dump(exclude={"password"}, exclude_none=True))
        return out

    def _check_seller_link(role: str, seller_id: str | None) -> None:
        if role == "seller":
            if not seller_id or not store.get("seller", seller_id):
                raise HTTPException(422, "A seller login needs the id of an existing seller (seller_id).")
        elif seller_id:
            raise HTTPException(422, "Only the seller role is linked to a seller.")

    # ------------------------------------------------------------- settings

    @r.get("/settings")
    def all_settings(s: dict = Depends(need("read"))):
        return {k: config.get_with_version(store, k) for k in config.SECTIONS}

    @r.get("/settings/{section}")
    def get_settings(section: str, s: dict = Depends(need("read"))):
        _section(section)
        return config.get_with_version(store, section)

    @r.put("/settings/{section}")
    def put_settings(section: str, body: SettingsPut, s: dict = Depends(security.current_staff)):
        _section(section)
        perm = {"price_book": "pricing", "production": "production", "delivery": "delivery"}.get(section, "settings")
        if not (security.can(s, perm) or security.can(s, "settings")):
            raise HTTPException(403, f"Your role ({s['role']}) cannot change {section}.")
        try:
            return config.save(store, section, body.value, actor(s), body.version)
        except ConflictError as e:
            raise HTTPException(409, str(e)) from e

    @r.get("/settings/{section}/history")
    def settings_history(section: str, s: dict = Depends(need("read"))):
        _section(section)
        return {"items": store.setting_history(section)}

    @r.post("/settings/{section}/validate")
    def validate_settings(section: str, body: dict, s: dict = Depends(need("read"))):
        _section(section)
        config.validate(section, body)
        return {"ok": True}

    def _section(section: str) -> None:
        if section not in config.SECTIONS:
            raise HTTPException(404, f"unknown section; use one of {', '.join(config.SECTIONS)}")

    @r.post("/pricing/simulate")
    def simulate(body: SimulateIn, s: dict = Depends(need("read"))):
        """Price an example order with a draft price book before saving it."""
        draft = config.validate("price_book", body.price_book)
        return {"draft": quote(store, body.request, price_book=draft), "current": quote(store, body.request)}

    # ------------------------------------------------------------- dashboard and reports

    @r.get("/dashboard")
    def dashboard(s: dict = Depends(need("read"))):
        rows, _ = store.find("order_index", limit=10000)
        today = date.today().isoformat()
        week = (date.today() - timedelta(days=6)).isoformat()
        month = (date.today() - timedelta(days=29)).isoformat()
        paid = [o for o in rows if o["fulfilment_status"] not in ("awaiting_payment", "cancelled")]

        def rev(since: str) -> float:
            return round(sum(o.get("total") or 0 for o in paid if o["created_at"][:10] >= since), 2)

        plan = planning.plan(store)
        by_id = {o["id"]: o for o in rows}
        late = [{**p, "number": by_id.get(p["order_id"], {}).get("number"),
                 "customer_name": by_id.get(p["order_id"], {}).get("customer_name"),
                 "status": by_id.get(p["order_id"], {}).get("fulfilment_status")}
                for p in plan["plans"].values() if p["late"]]
        util = planning.utilisation(store, 7)
        status_counts = Counter(o["fulfilment_status"] for o in rows)
        pipe = crm.pipeline(store)
        tickets = store.count_by_status("ticket")
        tasks = crm.tasks_due(store, None, today)
        return {
            "currency": config.get(store, "price_book")["currency"],
            "orders": {"today": sum(1 for o in rows if o["created_at"][:10] == today),
                       "last_7_days": sum(1 for o in rows if o["created_at"][:10] >= week),
                       "by_status": dict(status_counts)},
            "revenue": {"today": rev(today), "last_7_days": rev(week), "last_30_days": rev(month),
                        "average_order_30_days": round(rev(month) / max(1, sum(1 for o in paid if o["created_at"][:10] >= month)), 2)},
            "production": {"active": len(plan["plans"]), "late": len(late),
                           "late_orders": sorted(late, key=lambda p: p["promised_delivery_date"] or "")[:10],
                           "pieces_in_progress": sum(p["pieces"] for p in plan["plans"].values()),
                           "bottleneck": util["bottleneck"],
                           "utilisation_7_days": [{"stage": r["stage"], "name": r["name"],
                                                   "percent": round(sum(c["percent"] for c in r["days"]) / len(r["days"]))}
                                                  for r in util["stages"]]},
            "delivery": {"ready_to_ship": status_counts.get("ready", 0),
                         "ship_today": sum(1 for p in plan["plans"].values() if p["ship_date"] == today)},
            "crm": {"open_pipeline_value": pipe["open_value"], "win_rate": pipe["win_rate"],
                    "open_leads": sum(c["count"] for c in pipe["stages"] if c["stage"] not in ("won", "lost")),
                    "open_tickets": tickets.get("open", 0) + tickets.get("pending", 0),
                    "tasks_due_today": len(tasks), "reorder_candidates": len(crm.reorder_candidates(store))},
            "recent_orders": rows[:8],
        }

    @r.get("/reports/sales")
    def sales_report(since: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
                     until: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"), s: dict = Depends(need("read"))):
        rows, _ = store.find("order_index", limit=100000)
        rows = [o for o in rows if since <= o["created_at"][:10] <= until
                and o["fulfilment_status"] not in ("awaiting_payment", "cancelled")]
        by_day: dict[str, dict] = defaultdict(lambda: {"orders": 0, "revenue": 0.0, "pieces": 0})
        for o in rows:
            d = by_day[o["created_at"][:10]]
            d["orders"] += 1
            d["revenue"] += o.get("total") or 0
            d["pieces"] += o.get("pieces") or 0

        def group(key: str) -> dict:
            out: dict[str, float] = defaultdict(float)
            for o in rows:
                out[str(o.get(key) or "unknown")] += o.get("total") or 0
            return {k: round(v, 2) for k, v in out.items()}

        return {"days": [{"date": k, **{**v, "revenue": round(v["revenue"], 2)}} for k, v in sorted(by_day.items())],
                "by_garment": group("garment"), "by_channel": group("channel"),
                "orders": len(rows), "revenue": round(sum(o.get("total") or 0 for o in rows), 2),
                "pieces": sum(o.get("pieces") or 0 for o in rows)}

    @r.get("/exports/orders.csv", response_class=PlainTextResponse)
    def export_orders(s: dict = Depends(need("read"))):
        rows, _ = store.find("order_index", limit=100000, order="created_at ASC")
        buf = io.StringIO()
        cols = ["number", "id", "created_at", "customer_name", "phone", "team_name", "garment", "pieces", "total",
                "currency", "status", "fulfilment_status", "promised_delivery_date", "channel", "rush"]
        w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for o in rows:
            w.writerow(o)
        return PlainTextResponse(buf.getvalue(), media_type="text/csv",
                                 headers={"Content-Disposition": 'attachment; filename="orders.csv"'})

    @r.get("/audit")
    def audit(subject: str | None = None, s: dict = Depends(need("read"))):
        return {"items": store.audit_for(subject, 200)}

    # ------------------------------------------------------------- orders

    @r.get("/orders")
    def list_orders(status: str | None = None, q: str | None = None, customer_id: str | None = None,
                    seller_id: str | None = None, checkout_id: str | None = None,
                    page: int = Query(1, ge=1), size: int = Query(25, ge=1, le=200),
                    s: dict = Depends(need("read", seller=True))):
        statuses = status.split(",") if status else None
        scope = security.seller_scope(s, seller_id)
        if checkout_id:
            ck = store.get("checkout", checkout_id) or {"order_ids": []}
            rows = [x for x in (store.get("order_index", oid) for oid in ck["order_ids"])
                    if x and (not scope or x.get("seller_id") == scope)]
            return _page(rows, len(rows), 1, max(1, len(rows)))
        rows, total = store.find("order_index", status=statuses, parent=customer_id, owner=scope, q=q,
                                 order="created_at DESC", limit=size, offset=(page - 1) * size)
        return _page(rows, total, page, size)

    def _order(order_id: str, s: dict | None = None) -> dict:
        o = store.get_order(order_id)
        if not o:
            raise HTTPException(404, "order not found")
        return security.check_seller_order(s, o) if s else o

    @r.get("/orders/{order_id}")
    def get_order(order_id: str, s: dict = Depends(need("read", seller=True))):
        o = _order(order_id, s)
        plan = planning.plan(store, seller_id=security.seller_id_of(o))["plans"].get(order_id)
        ships, _ = store.find("shipment", parent=order_id, limit=20)
        seller_login = s["role"] == "seller"
        acts = [] if seller_login else store.find("activity", parent=f"order:{order_id}", limit=100)[0]
        ck = store.get("checkout", o["checkout_id"]) if o.get("checkout_id") else None
        rets, _ = store.find("return", parent=order_id, limit=20)
        if seller_login:   # a partner sees what it needs to make and ship the order, not the CRM trail
            o = {k: v for k, v in o.items() if k not in ("customer_id", "quote_id", "events")}
        return {"order": o, "plan": plan, "shipments": ships, "activities": acts,
                "audit": [] if seller_login else store.audit_for(f"order:{order_id}", 100),
                "checkout": {"id": ck["id"], "number": ck["number"], "order_ids": ck["order_ids"],
                             "payment_method": ck["payment_method"], "status": ck["status"]} if ck else None,
                "returns": rets, "seller": store.get("seller", security.seller_id_of(o))}

    @r.post("/orders/{order_id}/hold")
    def hold(order_id: str, body: HoldIn, s: dict = Depends(need("orders"))):
        return lifecycle.set_hold(store, order_id, body.hold, body.reason, actor(s))

    @r.post("/orders/{order_id}/cancel")
    def cancel(order_id: str, body: CancelIn, s: dict = Depends(need("orders"))):
        return lifecycle.cancel(store, order_id, body.reason, actor(s))

    @r.post("/orders/{order_id}/priority")
    def priority(order_id: str, body: PriorityIn, s: dict = Depends(need("orders"))):
        return lifecycle.reprioritise(store, order_id, body.rush, body.promised_delivery_date, actor(s))

    @r.post("/orders/{order_id}/notes")
    def note(order_id: str, body: NoteIn, s: dict = Depends(need("orders"))):
        o = _order(order_id)
        lifecycle.event(o, "note", actor(s), public=body.public, text=body.text)
        store.save_order(o)
        return o

    @r.post("/orders/{order_id}/payments")
    def record_payment(order_id: str, body: PaymentIn, s: dict = Depends(need("orders"))):
        """Record money received outside the app (cash, UPI, bank transfer), then release the order."""
        o = _order(order_id)
        if o.get("payment"):
            raise HTTPException(409, "A payment is already recorded for this order.")
        o = order_mod.confirm_payment(store, order_id, PaymentConfirmation(demo=True, reference=body.reference),
                                      method=body.method, amount=body.amount, recorded_by=actor(s))
        store.audit(actor(s), "order.payment", f"order:{order_id}", body.model_dump())
        return o

    @r.get("/orders/{order_id}/invoice", response_class=HTMLResponse)
    def invoice(order_id: str, s: dict = Depends(need("read", seller=True))):
        return HTMLResponse(lifecycle.invoice_html(store, _order(order_id, s)))

    # ------------------------------------------------------------- production

    @r.get("/production/plan")
    def production_plan(seller_id: str | None = None, s: dict = Depends(need("read", seller=True))):
        scope = security.seller_scope(s, seller_id)
        result = planning.plan(store, seller_id=scope)
        idx = {o["id"]: o for o in store.find("order_index", status=list(planning.ACTIVE), owner=scope, limit=5000)[0]}
        stages = config.get(store, "production")["stages"]
        if scope:
            stages = sellers.production_for(config.get(store, "production"), store.get("seller", scope))["stages"]
        return {"today": result["today"], "stages": stages, "seller_id": scope,
                "orders": [{**p, "summary": idx.get(oid)} for oid, p in
                           sorted(result["plans"].items(), key=lambda kv: kv[1]["ship_date"])]}

    @r.get("/production/utilisation")
    def utilisation(days: int = Query(14, ge=1, le=60), seller_id: str | None = None,
                    s: dict = Depends(need("read", seller=True))):
        return planning.utilisation(store, days, seller_id=security.seller_scope(s, seller_id))

    @r.get("/production/board")
    def board(seller_id: str | None = None, s: dict = Depends(need("read", seller=True))):
        """Kanban: each paid order sits in the first stage it hasn't finished."""
        scope = security.seller_scope(s, seller_id)
        stages = config.get(store, "production")["stages"]
        cols = {st["id"]: {"stage": st["id"], "name": st["name"], "orders": []} for st in stages}
        cols["ready"] = {"stage": "ready", "name": "Ready to ship", "orders": []}
        plan = planning.plan(store, seller_id=scope)["plans"]
        for o in store.all_orders():
            f = o.get("fulfilment") or {}
            if f.get("status") not in ("queued", "in_production", "ready"):
                continue
            if scope and security.seller_id_of(o) != scope:
                continue
            nxt = next((st["id"] for st in f.get("stages", []) if not st["done_at"]), "ready")
            cols.setdefault(nxt, {"stage": nxt, "name": nxt, "orders": []})["orders"].append({
                "id": o["id"], "number": o.get("number"), "customer": o["customer"]["name"], "pieces": o["total_pieces"],
                "garment": o["garment"], "rush": f.get("rush"), "hold": f.get("hold"),
                "promised_delivery_date": f.get("promised_delivery_date"),
                "plan": plan.get(o["id"]), "style_name": o["spec"].get("style_name"),
                "seller_id": security.seller_id_of(o)})
        for c in cols.values():
            c["orders"].sort(key=lambda x: (not x["rush"], x["promised_delivery_date"] or "9999"))
        return {"columns": list(cols.values())}

    @r.get("/production/worklist")
    def worklist(stage: str, day: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"), seller_id: str | None = None,
                 s: dict = Depends(need("read", seller=True))):
        """What a stage should work on today (or on a given day), with print files for the print stage."""
        result = planning.plan(store, seller_id=security.seller_scope(s, seller_id))
        day = day or result["today"]
        items = []
        for oid, p in result["plans"].items():
            st = next((x for x in p["stages"] if x["id"] == stage), None)
            if st and st["start"] <= day <= st["end"]:
                o = store.get_order(oid)
                items.append({"order_id": oid, "number": o.get("number"), "customer": o["customer"]["name"],
                              "seller_id": p.get("seller_id"),
                              "pieces": o["total_pieces"], "rush": p["rush"], "start": st["start"], "end": st["end"],
                              "lines": o["lines"], "files": [f["name"] for f in o["files"]] if stage in ("prepress", "print") else []})
        return {"stage": stage, "day": day, "items": sorted(items, key=lambda i: (not i["rush"], i["end"]))}

    @r.post("/orders/{order_id}/stages/{stage_id}")
    def stage_done(order_id: str, stage_id: str, undo: bool = False, s: dict = Depends(need("production", seller=True))):
        _order(order_id, s)
        return lifecycle.complete_stage(store, order_id, stage_id, actor(s), undo)

    # ------------------------------------------------------------- delivery

    @r.get("/delivery/plan")
    def delivery_plan(days: int = Query(7, ge=1, le=30), seller_id: str | None = None,
                      s: dict = Depends(need("read", seller=True))):
        """Planned dispatches by day and zone, from the production plan and ready orders."""
        scope = security.seller_scope(s, seller_id)
        result = planning.plan(store, seller_id=scope)
        horizon = (date.fromisoformat(result["today"]) + timedelta(days=days)).isoformat()
        by_day: dict[str, dict] = defaultdict(lambda: {"orders": [], "pieces": 0, "zones": Counter()})
        for o in store.all_orders():
            f = o.get("fulfilment") or {}
            if scope and security.seller_id_of(o) != scope:
                continue
            if f.get("status") == "ready":
                ship = result["today"]
            elif o["id"] in result["plans"]:
                ship = result["plans"][o["id"]]["ship_date"]
            else:
                continue
            if ship > horizon:
                continue
            d = by_day[ship]
            zone = (o.get("delivery") or {}).get("zone") or "pickup"
            d["orders"].append({"id": o["id"], "number": o.get("number"), "customer": o["customer"]["name"],
                                "pieces": o["total_pieces"], "zone": zone, "method": (o.get("delivery") or {}).get("method"),
                                "ready": f.get("status") == "ready", "rush": f.get("rush"),
                                "promised_delivery_date": f.get("promised_delivery_date"),
                                "city": (((o.get("delivery") or {}).get("address")) or {}).get("city"),
                                "seller_id": security.seller_id_of(o), "payment_method": o.get("payment_method", "online")})
            d["pieces"] += o["total_pieces"]
            d["zones"][zone] += 1
        return {"today": result["today"],
                "days": [{"date": k, "orders": v["orders"], "pieces": v["pieces"], "zones": dict(v["zones"])}
                         for k, v in sorted(by_day.items())]}

    @r.get("/shipments")
    def shipments(status: str | None = None, q: str | None = None, seller_id: str | None = None,
                  page: int = Query(1, ge=1), s: dict = Depends(need("read", seller=True))):
        rows, total = store.find("shipment", status=status.split(",") if status else None, q=q,
                                 owner=security.seller_scope(s, seller_id), limit=50, offset=(page - 1) * 50)
        return _page(rows, total, page, 50)

    @r.post("/orders/{order_id}/shipments", status_code=201)
    def add_shipment(order_id: str, body: ShipmentIn, s: dict = Depends(need("delivery", seller=True))):
        _order(order_id, s)
        return lifecycle.create_shipment(store, order_id, body.carrier, body.tracking_no, body.planned_date, actor(s))

    def _shipment(sid: str, s: dict) -> dict:
        shp = store.get("shipment", sid)
        if not shp or (s["role"] == "seller" and shp.get("seller_id", security.HOUSE_SELLER) != s["seller_id"]):
            raise HTTPException(404, "shipment not found")
        return shp

    @r.patch("/shipments/{sid}")
    def patch_shipment(sid: str, body: ShipmentPatch, s: dict = Depends(need("delivery", seller=True))):
        _shipment(sid, s)
        return lifecycle.update_shipment(store, sid, body.status, actor(s), body.tracking_no)

    @r.get("/shipments/{sid}/label", response_class=HTMLResponse)
    def label(sid: str, s: dict = Depends(need("read", seller=True))):
        shp = _shipment(sid, s)
        co = config.get(store, "company")
        sender = store.get("seller", shp.get("seller_id") or security.HOUSE_SELLER) or {}
        if sender and not sender.get("house"):
            co = {**co, "name": sender["name"], "phone": sender.get("phone", "")}
        a = shp.get("address") or {}
        e = html.escape
        return HTMLResponse(f"""<!doctype html><html><head><meta charset=utf-8><title>Label {e(shp.get('order_number') or '')}</title>
<style>body{{font-family:system-ui;margin:0}}.l{{width:100mm;height:150mm;border:1px dashed #999;padding:6mm;box-sizing:border-box}}
h2{{margin:0 0 4mm}}.big{{font-size:18pt;font-weight:700}}.m{{color:#555;font-size:10pt}}</style></head><body><div class=l>
<div class=m>From: {e(co['name'])} {e(co['phone'])}</div><h2>To</h2>
<div class=big>{e(a.get('name') or shp['customer_name'])}</div>
<div>{e(a.get('line1', ''))}<br>{e(a.get('line2', ''))}<br>{e(a.get('city', ''))} {e(a.get('state', ''))} {e(a.get('pincode', ''))}<br>{e(a.get('phone', ''))}</div>
<hr><div>Order <b>{e(shp.get('order_number') or shp['order_id'])}</b> · {shp['pieces']} pcs</div>
<div>{e(shp['carrier_name'])} {e(shp['tracking_no'])}</div></div></body></html>""")

    # ------------------------------------------------------------- CRM: customers and organisations

    @r.get("/customers")
    def customers(q: str | None = None, page: int = Query(1, ge=1), owner: str | None = None,
                  s: dict = Depends(need("read"))):
        rows, total = store.find("customer", q=q, owner=owner, limit=50, offset=(page - 1) * 50)
        return _page(rows, total, page, 50)

    @r.post("/customers", status_code=201)
    def add_customer(body: crm.CustomerIn, s: dict = Depends(need("crm"))):
        return crm.create_customer(store, body, actor(s))

    @r.get("/customers/{cid}")
    def customer(cid: str, s: dict = Depends(need("read"))):
        c = store.get("customer", cid)
        if not c:
            raise HTTPException(404, "customer not found")
        return {"customer": c,
                "orders": store.find("order_index", parent=cid, limit=100, order="created_at DESC")[0],
                "activities": store.find("activity", parent=f"customer:{cid}", limit=100)[0],
                "quotes": store.find("quote", parent=cid, limit=50)[0],
                "tickets": store.find("ticket", parent=cid, limit=50)[0],
                "leads": store.find("lead", ref=cid, limit=50)[0],
                "organisation": store.get("organisation", c["organisation_id"]) if c.get("organisation_id") else None}

    @r.put("/customers/{cid}")
    def edit_customer(cid: str, body: crm.CustomerIn, s: dict = Depends(need("crm"))):
        return crm.update_customer(store, cid, body, actor(s))

    @r.get("/organisations")
    def organisations(q: str | None = None, page: int = Query(1, ge=1), s: dict = Depends(need("read"))):
        rows, total = store.find("organisation", q=q, limit=50, offset=(page - 1) * 50)
        return _page(rows, total, page, 50)

    @r.post("/organisations", status_code=201)
    def add_org(body: crm.OrganisationIn, s: dict = Depends(need("crm"))):
        return crm.save_org(store, None, body, actor(s))

    @r.get("/organisations/{oid}")
    def org(oid: str, s: dict = Depends(need("read"))):
        o = store.get("organisation", oid)
        if not o:
            raise HTTPException(404, "organisation not found")
        members = store.find("customer", parent=oid, limit=500)[0]
        return {"organisation": o, "members": members, "leads": store.find("lead", parent=oid, limit=100)[0],
                "activities": store.find("activity", parent=f"organisation:{oid}", limit=100)[0],
                "orders": [x for m in members for x in store.find("order_index", parent=m["id"], limit=100)[0]]}

    @r.put("/organisations/{oid}")
    def edit_org(oid: str, body: crm.OrganisationIn, s: dict = Depends(need("crm"))):
        return crm.save_org(store, oid, body, actor(s))

    # ------------------------------------------------------------- CRM: leads, activities, tasks

    @r.get("/leads")
    def leads(stage: str | None = None, q: str | None = None, owner: str | None = None, s: dict = Depends(need("read"))):
        rows, total = store.find("lead", status=stage, q=q, owner=owner, limit=500)
        return {"items": rows, "total": total}

    @r.get("/leads/pipeline")
    def lead_pipeline(s: dict = Depends(need("read"))):
        return crm.pipeline(store)

    @r.post("/leads", status_code=201)
    def add_lead(body: crm.LeadIn, s: dict = Depends(need("crm"))):
        return crm.save_lead(store, None, body, actor(s))

    @r.get("/leads/{lid}")
    def lead(lid: str, s: dict = Depends(need("read"))):
        ld = store.get("lead", lid)
        if not ld:
            raise HTTPException(404, "lead not found")
        return {"lead": ld, "activities": store.find("activity", parent=f"lead:{lid}", limit=100)[0],
                "customer": store.get("customer", ld["customer_id"]) if ld.get("customer_id") else None,
                "quotes": [q for q in store.find("quote", parent=ld.get("customer_id") or "-", limit=500)[0]
                           if q.get("lead_id") == lid]}

    @r.put("/leads/{lid}")
    def edit_lead(lid: str, body: crm.LeadIn, s: dict = Depends(need("crm"))):
        return crm.save_lead(store, lid, body, actor(s))

    @r.get("/activities")
    def activities(subject: str | None = None, owner: str | None = None, status: str | None = None,
                   s: dict = Depends(need("read"))):
        rows, total = store.find("activity", parent=subject, owner=owner, status=status, limit=200)
        return {"items": rows, "total": total}

    @r.post("/activities", status_code=201)
    def add_activity(body: crm.ActivityIn, s: dict = Depends(need("crm"))):
        return crm.add_activity(store, body, actor(s))

    @r.post("/activities/{aid}/done")
    def activity_done(aid: str, done: bool = True, s: dict = Depends(need("crm"))):
        return crm.set_activity_done(store, aid, done, actor(s))

    @r.get("/tasks")
    def tasks(mine: bool = False, until: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
              s: dict = Depends(need("read"))):
        return {"items": crm.tasks_due(store, actor(s) if mine else None, until or (date.today() + timedelta(days=7)).isoformat())}

    @r.get("/reorders")
    def reorders(s: dict = Depends(need("read"))):
        return {"items": crm.reorder_candidates(store)}

    # ------------------------------------------------------------- CRM: quotes

    @r.get("/quotes")
    def quotes(status: str | None = None, q: str | None = None, lead_id: str | None = None,
               customer_id: str | None = None, s: dict = Depends(need("read"))):
        if lead_id and not customer_id:
            customer_id = (store.get("lead", lead_id) or {}).get("customer_id") or "-"
        rows, total = store.find("quote", status=status, q=q, parent=customer_id, limit=200)
        if lead_id:
            rows = [r for r in rows if r.get("lead_id") == lead_id]
            total = len(rows)
        return {"items": rows, "total": total}

    @r.post("/quotes", status_code=201)
    def add_quote(body: crm.QuoteIn, s: dict = Depends(need("quotes"))):
        return crm.save_quote(store, None, body, actor(s))

    @r.get("/quotes/{qid}")
    def get_quote(qid: str, s: dict = Depends(need("read"))):
        q = store.get("quote", qid)
        if not q:
            raise HTTPException(404, "quote not found")
        return q

    @r.put("/quotes/{qid}")
    def edit_quote(qid: str, body: crm.QuoteIn, s: dict = Depends(need("quotes"))):
        return crm.save_quote(store, qid, body, actor(s))

    @r.post("/quotes/{qid}/send")
    def send_quote(qid: str, s: dict = Depends(need("quotes"))):
        """Marks the quote as sent and returns the customer's link. Sending by SMS/email/WhatsApp
        is left to the salesperson (or a provider hooked in here)."""
        q = crm.set_quote_status(store, qid, "sent", actor(s))
        if q.get("lead_id"):
            ld = store.get("lead", q["lead_id"])
            if ld and ld["stage"] not in ("quoted", "won", "lost"):
                crm.save_lead(store, ld["id"], crm.LeadIn(**{k: ld.get(k) for k in crm.LeadIn.model_fields if k in ld}
                                                          | {"stage": "quoted"}), actor(s))
        return {**q, "path": f"/quote/{q['token']}"}

    @r.post("/quotes/{qid}/status")
    def quote_status(qid: str, status: str = Query(..., pattern="^(draft|sent|declined|expired)$"),
                     s: dict = Depends(need("quotes"))):
        return crm.set_quote_status(store, qid, status, actor(s))

    # ------------------------------------------------------------- CRM: tickets

    @r.get("/tickets")
    def tickets(status: str | None = None, q: str | None = None, owner: str | None = None,
                s: dict = Depends(need("read"))):
        rows, total = store.find("ticket", status=status.split(",") if status else None, q=q, owner=owner, limit=200)
        return {"items": rows, "total": total}

    @r.get("/tickets/{tid}")
    def ticket(tid: str, s: dict = Depends(need("read"))):
        t = store.get("ticket", tid)
        if not t:
            raise HTTPException(404, "ticket not found")
        return t

    @r.post("/tickets/{tid}")
    def update_ticket(tid: str, body: TicketPatch, s: dict = Depends(need("crm"))):
        out = crm.ticket_reply(store, tid, body.body, f"staff:{s.get('name') or s['email']}", body.status,
                               body.owner, body.internal)
        store.audit(actor(s), "ticket.update", f"ticket:{tid}", {"status": body.status})
        return out

    @r.get("/enquiries")
    def enquiries(s: dict = Depends(need("read"))):
        rows, _ = store.find("lead", limit=100)
        return {"items": [x for x in rows if x.get("source") == "web"]}

    return r

