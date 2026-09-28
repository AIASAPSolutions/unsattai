"""What happens to an order after it is placed: pricing, customer record, promised dates,
production stages, shipments, invoices and the timeline the customer sees.

Order statuses (order["status"]) keep their original meaning for payment and factory
hand-off. Fulfilment has its own status (order["fulfilment"]["status"]):

    awaiting_payment -> queued -> in_production -> ready -> dispatched -> delivered
                                     (on hold at any point; cancelled before dispatch)
"""
from __future__ import annotations

import html
from datetime import datetime, timezone

from fastapi import HTTPException

from . import config, notify, planning
from .db import PlatformStore, new_id, now
from .security import HOUSE_SELLER, seller_id_of
from .pricing import DeliveryChoice, PriceLine, QuoteRequest, find_zone, quote

FULFILMENT = ("awaiting_payment", "queued", "in_production", "ready", "dispatched", "delivered", "cancelled")

EVENT_TEXT = {
    "placed": "Order placed",
    "paid": "Payment received",
    "cod_confirmed": "Order confirmed: pay on delivery",
    "cod_collected": "Cash on delivery payment received",
    "refund": "Refund of {amount} recorded",
    "return_requested": "Return requested",
    "return_approved": "Return approved",
    "return_picked_up": "Return picked up",
    "return_resolved": "Return resolved: {resolution}",
    "return_rejected": "Return not accepted",
    "reviewed": "You reviewed this order",
    "planned": "Scheduled for production",
    "stage": "{stage} done",
    "hold": "Order on hold",
    "resumed": "Order resumed",
    "ready": "Packed and ready to ship",
    "dispatched": "Dispatched with {carrier}",
    "delivered": "Delivered",
    "cancelled": "Order cancelled",
    "returned": "Shipment returned to us; we'll contact you",
    "note": "{text}",
}


def event(order: dict, code: str, actor: str = "system", public: bool = True, **params) -> None:
    text = EVENT_TEXT.get(code, code).format(**params)
    order.setdefault("events", []).append({"at": now(), "code": code, "text": text, "actor": actor,
                                           "public": public, **params})


def index_order(store: PlatformStore, order: dict) -> None:
    """Searchable copy for the operations app and the customer's order list."""
    f = order.get("fulfilment") or {}
    c = order.get("customer") or {}
    names = " ".join(filter(None, [ln.get("player_name") for ln in order.get("lines", [])]))
    team = (order.get("spec") or {}).get("typography", {}).get("team_name", "")
    summary = {
        "id": order["id"], "number": order.get("number"), "created_at": order["created_at"], "status": order["status"],
        "fulfilment_status": f.get("status", "awaiting_payment"), "customer_id": order.get("customer_id"),
        "customer_name": c.get("name"), "phone": c.get("phone"), "team_name": team, "garment": order.get("garment"),
        "pieces": order.get("total_pieces"), "total": (order.get("pricing") or {}).get("total"),
        "currency": (order.get("pricing") or {}).get("currency"), "rush": f.get("rush", False),
        "promised_delivery_date": f.get("promised_delivery_date"), "channel": order.get("channel", "app"),
        "hold": f.get("hold", False), "style_name": (order.get("spec") or {}).get("style_name"),
        "seller_id": seller_id_of(order), "seller_name": (order.get("seller") or {}).get("name"),
        "payment_method": order.get("payment_method", "online"), "checkout_id": order.get("checkout_id"),
        "email": (c.get("email") or "").lower(), "product_id": order.get("product_id"),
        "cod_collected": ((order.get("payment") or {}).get("collected") if order.get("payment_method") == "cod" else None),
    }
    store.put("order_index", order["id"], summary, status=summary["fulfilment_status"], owner=summary["seller_id"],
              parent=order.get("customer_id") or "", ref=c.get("phone") or "",
              search=" ".join(filter(None, [order["id"], str(order.get("number") or ""), c.get("name"), c.get("phone"),
                                            c.get("email"), team, names])))


def upsert_customer(store: PlatformStore, name: str, phone: str, email: str = "", source: str = "app") -> dict:
    from .security import normalize_phone
    phone = normalize_phone(phone)
    found, _ = store.find("customer", ref=phone, limit=1)
    if found:
        cust = found[0]
        changed = False
        if name and not cust.get("name"):
            cust["name"], changed = name, True
        if email and not cust.get("email"):
            cust["email"], changed = email, True
        if changed:
            cust = save_customer(store, cust)
        return cust
    return save_customer(store, new_customer(name, phone, email, source))


def new_customer(name: str, phone: str, email: str, source: str) -> dict:
    return {"id": new_id("cus"), "name": name, "phone": phone, "email": email, "status": "active", "source": source,
            "organisation_id": "", "owner": "", "tags": [], "addresses": [], "orders_count": 0, "lifetime_value": 0,
            "last_order_at": None, "marketing_opt_in": False, "notes": "", "phone_verified": False,
            "email_verified": False, "has_password": False}


def save_customer(store: PlatformStore, cust: dict) -> dict:
    if cust.get("email_verified") and cust.get("email"):
        store.put("email_index", cust["email"].lower(), {"customer_id": cust["id"]})
    return store.put("customer", cust["id"], cust, status=cust.get("status", "active"), owner=cust.get("owner", ""),
                     parent=cust.get("organisation_id", ""), ref=cust.get("phone") or "",
                     search=" ".join(filter(None, [cust.get("name"), cust.get("phone"), cust.get("email"), *cust.get("tags", [])])))


def customer_by_email(store: PlatformStore, email: str) -> dict | None:
    """The customer whose verified email this is (an index entry left by an old email is ignored)."""
    ix = store.get("email_index", email.lower())
    cust = store.get("customer", ix["customer_id"]) if ix else None
    if cust and cust.get("email_verified") and (cust.get("email") or "").lower() == email.lower():
        return cust
    return None


def refresh_customer_stats(store: PlatformStore, customer_id: str) -> None:
    cust = store.get("customer", customer_id)
    if not cust:
        return
    rows, n = store.find("order_index", parent=customer_id, limit=1000)
    paid = [r for r in rows if r["fulfilment_status"] not in ("awaiting_payment", "cancelled")]
    cust["orders_count"] = len(paid)
    cust["lifetime_value"] = round(sum(r.get("total") or 0 for r in paid), 2)
    cust["last_order_at"] = max((r["created_at"] for r in rows), default=None)
    save_customer(store, cust)


def price_order(store: PlatformStore, order: dict, extras: dict) -> dict:
    spec = order["spec"]
    logos = sum(1 for e in spec.get("elements", []) if e.get("type") == "logo")
    req = QuoteRequest(
        garment=order["garment"], fabric=extras.get("fabric") or "standard", logos=min(logos, 4),
        lines=[PriceLine(size=ln["size"], quantity=ln["quantity"], player_name=ln["player_name"], number=ln["number"])
               for ln in order["lines"]],
        delivery=DeliveryChoice(**(extras.get("delivery_choice") or {})), rush=bool(extras.get("rush")),
        coupon=extras.get("coupon") or "", seller_id=(order.get("seller") or {}).get("id") or "",
        payment_method=extras.get("payment_method") or "online")
    return quote(store, req, forced_coupon=extras.get("forced_coupon"), forced_charges=extras.get("forced_charges"))


def on_created(store: PlatformStore, order: dict, extras: dict, customer: dict | None, channel: str) -> dict:
    """Called once, when an order is first created."""
    if order.get("pricing"):
        return order
    cust = customer or upsert_customer(store, order["customer"]["name"], order["customer"]["phone"],
                                       order["customer"].get("email", ""), channel)
    order["customer_id"] = cust["id"]
    order["channel"] = channel
    order["number"] = f"{config.get(store, 'company')['invoice_prefix']}-{store.next_number('order'):05d}"
    # An accepted sales quote keeps its agreed prices; everything else is priced now.
    seller, area = extras.get("seller"), extras.get("area")
    if seller is None:
        seller = store.get("seller", HOUSE_SELLER)
    order["seller"] = {"id": (seller or {}).get("id") or HOUSE_SELLER, "name": (seller or {}).get("name") or ""}
    order["payment_method"] = extras.get("payment_method") or "online"
    order["checkout_id"] = extras.get("checkout_id")
    order["product_id"] = extras.get("product_id")
    order["pricing"] = extras.get("pricing") or price_order(store, order, extras)
    choice = extras.get("delivery_choice") or {"method": "ship"}
    dl = config.get(store, "delivery")
    zone = None if choice.get("method") == "pickup" else find_zone(dl, choice.get("pincode", ""), choice.get("state", ""))
    transit = (area or {}).get("transit_days", zone["transit_days"]) if zone else 0
    order["delivery"] = {"method": choice.get("method", "ship"), "address": extras.get("address"),
                         "zone": zone["id"] if zone else None, "transit_days": transit}
    est = planning.promise(store, order["total_pieces"], bool(extras.get("rush")), transit, seller=seller)
    order["fulfilment"] = {"status": "awaiting_payment", "rush": bool(extras.get("rush")), "paid_at": None,
                           "estimate": est, "promised_ship_date": None, "promised_delivery_date": None,
                           "stages": [], "hold": False}
    order["quote_id"] = extras.get("quote_id")
    order["collection_id"] = extras.get("collection_id")
    if order["collection_id"]:
        col = store.get("collection", order["collection_id"])
        if col and col["customer_id"] == cust["id"]:
            col["status"], col["order_id"] = "ordered", order["id"]
            store.put("collection", col["id"], col, status="ordered", parent=col["customer_id"], ref=col["token"],
                      search=col["title"])
    event(order, "placed")
    store.save_order(order)
    index_order(store, order)
    store.audit(f"customer:{cust['id']}", "order.create", f"order:{order['id']}", {"total": order["pricing"]["total"]})
    notify.order_event(store, order, "placed")
    return order


def on_paid(store: PlatformStore, order: dict, actor: str = "system") -> dict:
    f = order.setdefault("fulfilment", {"status": "awaiting_payment", "stages": [], "hold": False, "rush": False})
    if f.get("status") != "awaiting_payment":
        return order
    f["status"] = "queued"
    f["paid_at"] = now()
    est = planning.promise(store, order["total_pieces"], bool(f.get("rush")), (order.get("delivery") or {}).get("transit_days", 0),
                           seller=store.get("seller", seller_id_of(order)))
    f["promised_ship_date"], f["promised_delivery_date"] = est["ship_date"], est["delivery_date"]
    stages = config.get(store, "production")["stages"]
    f["stages"] = [{"id": s["id"], "name": s["name"], "done_at": None, "done_by": None} for s in stages]
    event(order, "paid" if order.get("payment_method") != "cod" else "cod_confirmed", actor)
    event(order, "planned", actor)
    store.save_order(order)
    index_order(store, order)
    if order.get("customer_id"):
        refresh_customer_stats(store, order["customer_id"])
    if order.get("product_id"):
        from . import catalog
        catalog.count_order(store, order["product_id"])
    notify.order_event(store, order, "confirmed")
    return order


def _load(store: PlatformStore, order_id: str) -> dict:
    order = store.get_order(order_id)
    if not order:
        raise HTTPException(404, "order not found")
    return order


def complete_stage(store: PlatformStore, order_id: str, stage_id: str, actor: str, undo: bool = False) -> dict:
    order = _load(store, order_id)
    f = order.get("fulfilment") or {}
    if f.get("status") not in ("queued", "in_production", "ready"):
        raise HTTPException(409, "Only paid orders that are not dispatched can move through production.")
    st = next((s for s in f["stages"] if s["id"] == stage_id), None)
    if st is None:
        raise HTTPException(404, "unknown stage")
    if undo:
        st["done_at"], st["done_by"] = None, None
    else:
        idx = f["stages"].index(st)
        missing = [s["name"] for s in f["stages"][:idx] if not s["done_at"]]
        if missing:
            raise HTTPException(409, f"Finish {missing[0]} first.")
        st["done_at"], st["done_by"] = now(), actor
        event(order, "stage", actor, stage=st["name"])
    done = [s for s in f["stages"] if s["done_at"]]
    f["status"] = "ready" if len(done) == len(f["stages"]) else "in_production" if done else "queued"
    if f["status"] == "ready" and not undo:
        event(order, "ready", actor)
    store.save_order(order)
    index_order(store, order)
    store.audit(actor, "production.undo" if undo else "production.stage", f"order:{order_id}", {"stage": stage_id})
    return order


def set_hold(store: PlatformStore, order_id: str, hold: bool, reason: str, actor: str) -> dict:
    order = _load(store, order_id)
    f = order.get("fulfilment") or {}
    if f.get("status") in ("dispatched", "delivered", "cancelled"):
        raise HTTPException(409, "This order can no longer be held.")
    f["hold"], f["hold_reason"] = hold, reason if hold else ""
    event(order, "hold" if hold else "resumed", actor, public=False, reason=reason)
    store.save_order(order)
    index_order(store, order)
    store.audit(actor, "order.hold" if hold else "order.resume", f"order:{order_id}", {"reason": reason})
    return order


def cancel(store: PlatformStore, order_id: str, reason: str, actor: str) -> dict:
    order = _load(store, order_id)
    f = order.setdefault("fulfilment", {"stages": []})
    if f.get("status") in ("dispatched", "delivered"):
        raise HTTPException(409, "A dispatched order can't be cancelled; create a return instead.")
    if f.get("status") == "cancelled":
        raise HTTPException(409, "This order is already cancelled.")
    f["status"], f["cancel_reason"] = "cancelled", reason
    f["cancelled_by"] = "customer" if actor.startswith("customer:") else "staff"
    event(order, "cancelled", actor)
    refund = _record_refund(order, (order.get("pricing") or {}).get("total"), actor, "Order cancelled")
    store.save_order(order)
    index_order(store, order)
    if order.get("customer_id"):
        refresh_customer_stats(store, order["customer_id"])
    store.audit(actor, "order.cancel", f"order:{order_id}", {"reason": reason})
    notify.order_event(store, order, "cancelled",
                       refund=f"A refund of {refund['amount']:g} is recorded." if refund else "")
    return order


def _money_taken(order: dict) -> bool:
    p = order.get("payment") or {}
    if not p:
        return False
    return bool(p.get("collected")) if p.get("method") == "cod" else True


def _record_refund(order: dict, amount: float | None, actor: str, reason: str) -> dict | None:
    """Refunds are recorded, not sent: demo payments took no money, and money taken by hand
    (cash, UPI, bank transfer, collected COD) is refunded by hand."""
    if not _money_taken(order) or not amount:
        return None
    p = order["payment"]
    refund = {"id": new_id("rfd"), "amount": round(float(amount), 2), "reason": reason, "at": now(), "by": actor,
              "method": "demo" if p.get("demo") else "manual",
              "note": "Demo payment: no money was taken, so nothing is sent back." if p.get("demo")
              else "Refund this amount by hand and keep the reference."}
    order.setdefault("refunds", []).append(refund)
    event(order, "refund", actor, amount=refund["amount"])
    return refund


def can_cancel(order: dict) -> bool:
    """Customers may cancel while unpaid, or paid with no production stage done."""
    f = order.get("fulfilment") or {}
    st = f.get("status", "awaiting_payment")
    if st == "awaiting_payment":
        return True
    return st == "queued" and not any(s.get("done_at") for s in f.get("stages", []))


def return_until(order: dict) -> str | None:
    f = order.get("fulfilment") or {}
    if f.get("status") != "delivered":
        return None
    if f.get("return_until"):
        return f["return_until"]
    from datetime import date, timedelta
    from . import defaults
    delivered = (f.get("delivered_at") or order["created_at"])[:10]
    return (date.fromisoformat(delivered) + timedelta(days=defaults.CRM["return_window_days"])).isoformat()


def can_return(order: dict) -> bool:
    until = return_until(order)
    open_return = any(r["status"] not in ("resolved", "rejected") for r in order.get("returns", []))
    return bool(until) and today_iso() <= until and not open_return and not order.get("returns_disabled")


def reprioritise(store: PlatformStore, order_id: str, rush: bool, promised_delivery_date: str | None, actor: str) -> dict:
    order = _load(store, order_id)
    f = order.get("fulfilment") or {}
    f["rush"] = rush
    if promised_delivery_date:
        f["promised_delivery_date"] = promised_delivery_date
    event(order, "note", actor, public=False, text=f"Priority changed (express: {'yes' if rush else 'no'})")
    store.save_order(order)
    index_order(store, order)
    store.audit(actor, "order.priority", f"order:{order_id}", {"rush": rush, "promised": promised_delivery_date})
    return order


# ----------------------------------------------------------------- shipments

def create_shipment(store: PlatformStore, order_id: str, carrier: str, tracking_no: str, planned_date: str | None,
                    actor: str) -> dict:
    order = _load(store, order_id)
    f = order.get("fulfilment") or {}
    if f.get("status") not in ("ready", "in_production", "queued"):
        raise HTTPException(409, "Only paid orders that are not yet dispatched can be shipped.")
    dl = config.get(store, "delivery")
    c = next((c for c in dl["carriers"] if c["id"] == carrier and c["active"]), None)
    if order["delivery"]["method"] != "pickup" and c is None:
        raise HTTPException(422, "Choose an active carrier.")
    sid = new_id("shp")
    shp = {"id": sid, "order_id": order_id, "order_number": order.get("number"), "carrier": carrier,
           "carrier_name": c["name"] if c else "Pickup", "tracking_no": tracking_no.strip(), "status": "planned",
           "planned_date": planned_date, "packed_at": None, "dispatched_at": None, "delivered_at": None,
           "address": order["delivery"].get("address"), "method": order["delivery"]["method"],
           "pieces": order["total_pieces"], "customer_name": order["customer"]["name"],
           "tracking_url": (c["tracking_url"].replace("{tracking}", tracking_no.strip()) if c and c["tracking_url"] and tracking_no else "")}
    shp["seller_id"] = seller_id_of(order)
    put_shipment(store, shp)
    order.setdefault("shipments", []).append(sid)
    f["shipment"] = _shipment_public(shp)
    store.save_order(order)
    store.audit(actor, "shipment.create", f"order:{order_id}", {"shipment": sid})
    return shp


def put_shipment(store: PlatformStore, shp: dict) -> dict:
    return store.put("shipment", shp["id"], shp, status=shp["status"], parent=shp["order_id"], ref=shp["tracking_no"],
                     owner=shp.get("seller_id") or HOUSE_SELLER,
                     search=" ".join(filter(None, [shp["order_id"], shp.get("order_number"), shp["tracking_no"],
                                                   shp["customer_name"]])))


def _shipment_public(shp: dict) -> dict:
    """What the customer sees of a shipment: carrier, tracking number and dates."""
    return {k: shp.get(k) for k in ("id", "carrier_name", "tracking_no", "tracking_url", "status", "planned_date",
                                    "dispatched_at", "delivered_at")}


def update_shipment(store: PlatformStore, shipment_id: str, status: str, actor: str, tracking_no: str | None = None) -> dict:
    shp = store.get("shipment", shipment_id)
    if not shp:
        raise HTTPException(404, "shipment not found")
    flow = ["planned", "packed", "dispatched", "delivered"]
    if status not in flow + ["returned", "cancelled"]:
        raise HTTPException(422, "unknown status")
    order = _load(store, shp["order_id"])
    f = order["fulfilment"]
    if status == "dispatched" and f.get("status") != "ready":
        raise HTTPException(409, "Finish all production stages before dispatching.")
    if tracking_no is not None:
        shp["tracking_no"] = tracking_no.strip()
    shp["status"] = status
    shp[f"{status}_at"] = now()
    if status == "dispatched":
        f["status"] = "dispatched"
        f["dispatched_at"] = now()
        event(order, "dispatched", actor, carrier=shp["carrier_name"], tracking=shp["tracking_no"])
    elif status == "delivered":
        f["status"] = "delivered"
        f["delivered_at"] = now()
        from datetime import date, timedelta
        days = config.get(store, "crm")["return_window_days"]
        f["return_until"] = (date.fromisoformat(f["delivered_at"][:10]) + timedelta(days=days)).isoformat() if days else None
        order["returns_disabled"] = not days
        event(order, "delivered", actor)
        if order.get("payment_method") == "cod":
            collect_cod(store, order, actor, save=False)
    elif status in ("returned", "cancelled") and f.get("status") in ("dispatched", "delivered"):
        # The goods are back with us (or never left): the order is ready to ship again.
        f["status"] = "ready"
        event(order, "returned" if status == "returned" else "note", actor,
              public=status == "returned", **({} if status == "returned" else {"text": f"Shipment {shipment_id} cancelled"}))
    if status not in ("returned", "cancelled"):
        f["shipment"] = _shipment_public(shp)
    elif (f.get("shipment") or {}).get("id") == shipment_id:
        f["shipment"] = None
    shp.setdefault("seller_id", seller_id_of(order))
    put_shipment(store, shp)
    store.save_order(order)
    index_order(store, order)
    store.audit(actor, f"shipment.{status}", f"order:{shp['order_id']}", {"shipment": shipment_id})
    if status == "dispatched":
        notify.order_event(store, order, "dispatched", carrier=shp["carrier_name"],
                           tracking=shp["tracking_no"] or "not available yet")
    elif status == "delivered":
        notify.order_event(store, order, "delivered")
    return shp


def collect_cod(store: PlatformStore, order: dict, actor: str, reference: str = "", save: bool = True) -> dict:
    """Mark a cash on delivery amount as collected (automatically on delivery, or by hand)."""
    p = order.get("payment") or {}
    if order.get("payment_method") != "cod" or p.get("method") != "cod":
        raise HTTPException(409, "This order is not cash on delivery.")
    if (order.get("fulfilment") or {}).get("status") == "cancelled":
        raise HTTPException(409, "This order was cancelled.")
    if p.get("collected"):
        return order
    p.update(collected=True, collected_at=now(), collected_by=actor, reference=reference or p.get("reference", ""))
    order["payment"] = p
    event(order, "cod_collected", actor)
    if save:
        store.save_order(order)
        index_order(store, order)
    store.audit(actor, "order.cod_collected", f"order:{order['id']}", {"amount": p.get("amount")})
    return order


# ----------------------------------------------------------------- customer-facing view and invoice

def public_view(order: dict) -> dict:
    """The order as its customer sees it: no internal notes or staff names."""
    out = {k: v for k, v in order.items() if k not in ("events",)}
    out["seller"] = order.get("seller") or {"id": HOUSE_SELLER, "name": ""}
    out["checkout_id"] = order.get("checkout_id")
    out["payment_method"] = order.get("payment_method", "online")
    out["can_cancel"] = can_cancel(order)
    out["return_until"] = return_until(order) if not order.get("returns_disabled") else None
    out["can_return"] = can_return(order)
    out["review"] = order.get("review")
    out["returns"] = order.get("returns", [])
    out["refunds"] = [{k: r[k] for k in ("id", "amount", "at", "method", "note")} for r in order.get("refunds", [])]
    # params let apps show each event in the customer's language (stage names, carrier, tracking number).
    out["timeline"] = [{"at": e["at"], "code": e["code"], "text": e["text"],
                        "params": {k: v for k, v in e.items() if k not in ("at", "code", "text", "actor", "public")}}
                       for e in order.get("events", []) if e.get("public")]
    f = order.get("fulfilment") or {}
    out["fulfilment"] = {k: v for k, v in f.items() if k not in ("hold_reason",)}
    for s in out["fulfilment"].get("stages", []):
        s.pop("done_by", None)
    return out


def invoice_html(store: PlatformStore, order: dict) -> str:
    co = config.get(store, "company")
    p = order.get("pricing") or {}
    cur = p.get("currency", "")
    e = html.escape

    def money(x):
        return f"{cur} {x:,.2f}"

    rows = "".join(
        f"<tr><td>{ln['line']}</td><td>{e(ln['player_name'] or '-')}</td><td>{e(ln['number'] or '-')}</td>"
        f"<td>{ln['size']}</td><td class=r>{ln['quantity']}</td><td class=r>{money(ln['unit_price'])}</td>"
        f"<td class=r>{money(ln['line_total'])}</td></tr>" for ln in p.get("lines", []))
    extra = []
    if p.get("quantity_discount", {}).get("amount"):
        extra.append(("Quantity discount", -p["quantity_discount"]["amount"]))
    if p.get("rush", {}).get("amount"):
        extra.append((p["rush"]["label"], p["rush"]["amount"]))
    if p.get("coupon") and p["coupon"].get("amount"):
        extra.append((f"Coupon {p['coupon']['code']}", -p["coupon"]["amount"]))
    sh = p.get("shipping") or {}
    extra.append(("Delivery" if sh.get("method") == "ship" else "Pickup", sh.get("amount", 0)))
    tx = p.get("tax") or {}
    extra.append((f"{tx.get('name', 'Tax')} {round(100 * tx.get('rate', 0), 1):g}%" + (" (included)" if tx.get("inclusive") else ""),
                  tx.get("amount", 0)))
    if (p.get("cod") or {}).get("fee"):
        extra.insert(-1, ("Cash on delivery fee", p["cod"]["fee"]))
    totals = "".join(f"<tr><td colspan=6 class=r>{e(k)}</td><td class=r>{money(v)}</td></tr>" for k, v in extra)
    paid = order.get("payment")
    cod_due = bool(paid) and paid.get("method") == "cod" and not paid.get("collected")
    if cod_due:
        paid = None
    seller = order.get("seller") or {}
    c = order["customer"]
    addr = (order.get("delivery") or {}).get("address") or {}
    addr_txt = ", ".join(filter(None, [addr.get(k) for k in ("line1", "line2", "city", "state", "pincode")]))
    return f"""<!doctype html><html><head><meta charset=utf-8><title>Invoice {e(order.get('number') or order['id'])}</title>
<style>body{{font-family:system-ui,sans-serif;margin:32px;color:#111}}table{{width:100%;border-collapse:collapse;margin-top:16px}}
td,th{{border-bottom:1px solid #ddd;padding:6px;text-align:left;font-size:14px}}.r{{text-align:right}}h1{{margin:0}}
.muted{{color:#666;font-size:13px}}.demo{{background:#fff4d6;padding:8px;border-radius:6px;margin-top:12px}}</style></head><body>
<h1>{e(co['name'])}</h1><div class=muted>{e(co['legal_name'])} {e(co['address'])} {('Tax ID ' + e(co['tax_id'])) if co['tax_id'] else ''}</div>
<h2>{'Tax invoice' if paid else 'Proforma invoice'} {e(order.get('number') or order['id'])}</h2>
<div>Sold by: {e(seller.get('name') or co['name'])}</div>
<div>Date: {order['created_at'][:10]}<br>Customer: {e(c['name'])}, {e(c['phone'])} {e(c.get('email') or '')}<br>
{('Deliver to: ' + e(addr_txt)) if addr_txt else ''}</div>
<table><tr><th>#</th><th>Name</th><th>No.</th><th>Size</th><th class=r>Qty</th><th class=r>Unit</th><th class=r>Amount</th></tr>
{rows}<tr><td colspan=6 class=r>Subtotal</td><td class=r>{money(p.get('subtotal', 0))}</td></tr>{totals}
<tr><th colspan=6 class=r>Total</th><th class=r>{money(p.get('total', 0))}</th></tr></table>
<p class=muted>{e(p.get('fabric', {}).get('name', ''))} · {e(order.get('garment', ''))} · {order.get('total_pieces')} pieces</p>
{('<div class=demo>Demo payment: no money was taken.</div>' if paid and paid.get('demo') else '')}
{('<div class=demo>Cash on delivery: pay ' + money(p.get('total', 0)) + ' when it arrives.</div>' if cod_due else '')}
</body></html>"""


def overdue_check(plan: dict) -> list[str]:
    return [oid for oid, p in plan["plans"].items() if p["late"]]


def today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()
