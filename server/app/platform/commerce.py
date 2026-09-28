"""Carts, cart quotes, checkout (one order per item, all or nothing), cancellation and returns.

A cart item is a ready-made product or the customer's own design, with a garment,
fabric, logos and roster lines. A cart coupon is worked out on the whole cart and split
across items by value; each item becomes its own order (possibly from a different
seller) under one checkout number such as CK-00001.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator

from .. import orders as order_mod
from ..schemas import Customer, DesignSpec, Garment, OrderDelivery, OrderItem, OrderRequest
from . import config, lifecycle, notify, planning, sellers
from .db import PlatformStore, new_id, now
from .pricing import DeliveryChoice, find_zone, PriceLine, QuoteRequest, _money, cart_coupon, quote

MAX_CART_ITEMS = 20


class CartItem(BaseModel):
    """A product (product_id) or a custom design (spec), never both."""
    product_id: str = Field("", max_length=40)
    spec: DesignSpec | None = None
    design_id: str = Field("", max_length=40)
    garment: Garment | None = Field(None, description="default: the design's own garment")
    fabric: str = Field("standard", max_length=30)
    logos: int = Field(0, ge=0, le=4, description="used for pricing when the spec has no logo layers")
    lines: list[OrderItem] = Field(..., min_length=1, max_length=200)
    seller_id: str = Field("", max_length=40)

    @model_validator(mode="after")
    def _one(self):
        if bool(self.product_id) == bool(self.spec):
            raise ValueError("a cart item needs either product_id or spec")
        if sum(ln.quantity for ln in self.lines) > 5000:
            raise ValueError("an item can contain at most 5000 pieces")
        return self


class CartIn(BaseModel):
    items: list[CartItem] = Field(default_factory=list, max_length=MAX_CART_ITEMS)


class CartDelivery(BaseModel):
    method: str = Field("ship", pattern="^(ship|pickup)$")
    pincode: str = Field("", pattern=r"^$|^\d{6}$")
    state: str = Field("", max_length=4)


class CartQuoteIn(BaseModel):
    items: list[CartItem] = Field(..., min_length=1, max_length=MAX_CART_ITEMS)
    delivery: CartDelivery = Field(default_factory=CartDelivery)
    coupon: str = Field("", max_length=24)
    rush: bool = False
    payment_method: str = Field("online", pattern="^(online|cod)$")


class CheckoutIn(BaseModel):
    items: list[CartItem] = Field(..., min_length=1, max_length=MAX_CART_ITEMS)
    customer: Customer
    delivery: OrderDelivery
    coupon: str = Field("", max_length=24)
    rush: bool = False
    payment_method: str = Field("online", pattern="^(online|cod)$")
    idempotency_key: str = Field(..., min_length=8, max_length=60, pattern=r"^[A-Za-z0-9_-]+$")
    channel: str = Field("web", pattern="^(app|web)$")
    language: str = Field("en", pattern="^(en|hi|te|ta)$")


class CancelIn(BaseModel):
    reason: str = Field(..., min_length=3, max_length=300)


class ReturnLine(BaseModel):
    line: int = Field(..., ge=1)
    quantity: int = Field(..., ge=1, le=5000)


class ReturnIn(BaseModel):
    reason: str = Field(..., min_length=2, max_length=30)
    details: str = Field("", max_length=2000)
    lines: list[ReturnLine] | None = Field(None, max_length=200, description="empty: the whole order")


class ReturnStatusIn(BaseModel):
    status: str = Field(..., pattern="^(approved|picked_up|resolved|rejected)$")
    resolution: str | None = Field(None, pattern="^(replacement|refund)$")
    refund_amount: float | None = Field(None, gt=0)
    note: str = Field("", max_length=1000)


# ----------------------------------------------------------------- items

def resolve_item(store: PlatformStore, item: CartItem) -> tuple[DesignSpec, dict | None]:
    """The design to print for an item, and its product when it is one."""
    product = None
    if item.product_id:
        product = store.get("product", item.product_id)
        if not product or product["status"] != "published":
            raise HTTPException(404, f"product {item.product_id} is not available")
        data = product["spec"]
    else:
        data = item.spec.model_dump()
    if item.garment:
        data = {**data, "garment": item.garment}
    return DesignSpec.model_validate(data), product


def _logos(spec: DesignSpec, item: CartItem) -> int:
    n = sum(1 for e in spec.elements if e.type == "logo")
    return min(4, n or item.logos)


def _item_request(spec: DesignSpec, item: CartItem, delivery: CartDelivery, rush: bool, payment_method: str) -> QuoteRequest:
    return QuoteRequest(garment=spec.garment, fabric=item.fabric, logos=_logos(spec, item), rush=rush,
                        lines=[PriceLine(size=ln.size, quantity=ln.quantity, player_name=ln.player_name, number=ln.number)
                               for ln in item.lines],
                        delivery=DeliveryChoice(method=delivery.method, pincode=delivery.pincode, state=delivery.state),
                        seller_id=item.seller_id, payment_method=payment_method)


def _after_tier(q: dict) -> float:
    return _money(q["subtotal"] - q["quantity_discount"]["amount"])


def split(amount: float, weights: list[float]) -> list[float]:
    """Split an amount by weight in whole paise; the last share takes the rounding."""
    total = sum(weights)
    if not amount or not total:
        return [0.0] * len(weights)
    shares = [_money(amount * w / total) for w in weights[:-1]]
    return shares + [_money(amount - sum(shares))]


def _cart_charges(store: PlatformStore, pb: dict, body: CartQuoteIn, first: list[dict], shares: list[float]) -> list[dict]:
    """One delivery charge per seller (their items travel together) and one cash-on-delivery fee per cart.

    The charge sits on the seller's first item and the others show zero, so each order's invoice still adds up.
    """
    dl = config.get(store, "delivery")
    out = [{"shipping": None, "cod_fee": None, "cod_checked": True} for _ in first]
    groups: dict[str, list[int]] = {}
    for i, q in enumerate(first):
        key = "pickup" if q["shipping"]["method"] == "pickup" else (q.get("seller") or {}).get("id") or "none"
        groups.setdefault(key, []).append(i)
    for key, idx in groups.items():
        if key == "pickup":
            fee = _money(dl["pickup"]["fee"])
            for n, i in enumerate(idx):
                out[i].update(shipping=fee if n == 0 else 0.0, free=fee == 0)
            continue
        zone = find_zone(dl, body.delivery.pincode, body.delivery.state)
        pieces = sum(first[i]["pieces"] for i in idx)
        goods = sum(_after_tier(first[i]) + first[i]["rush"]["amount"] - shares[i] for i in idx)
        free = zone["free_above"] is not None and goods >= zone["free_above"]
        amount = 0.0 if free else _money(zone["base"] + zone["per_piece"] * pieces)
        for n, i in enumerate(idx):
            out[i].update(shipping=amount if n == 0 else 0.0, free=free)
    if body.payment_method == "cod":
        fee = _money((pb.get("cod") or {}).get("fee") or 0)
        for n in range(len(out)):
            out[n]["cod_fee"] = fee if n == 0 else 0.0
    return out


def cart_quote(store: PlatformStore, body: CartQuoteIn, today: date | None = None) -> dict:
    today = today or date.today()
    pb = config.get(store, "price_book")
    resolved = [resolve_item(store, it) for it in body.items]
    reqs = [_item_request(spec, it, body.delivery, body.rush, body.payment_method) for (spec, _), it in zip(resolved, body.items)]
    first = [quote(store, r, today) for r in reqs]
    weights = [_after_tier(q) for q in first]
    coupon_amount, coupon = cart_coupon(pb, body.coupon, sum(weights), today)
    shares = split(coupon_amount, weights)
    charges = _cart_charges(store, pb, body, first, shares)
    items, problems = [], []
    for i, ((spec, product), it, req, share) in enumerate(zip(resolved, body.items, reqs, shares)):
        q = quote(store, req, today, forced_coupon={"code": coupon["code"], "amount": share} if coupon_amount else None,
                  forced_charges=charges[i])
        seller = store.get("seller", q["seller"]["id"]) if q.get("seller") else None
        est = planning.promise(store, q["pieces"], body.rush, q["shipping"].get("transit_days", 0), today, seller=seller) \
            if seller else None
        q["estimate"] = est
        items.append({"index": i, "product_id": it.product_id or None, "title": (product or {}).get("title")
                      or spec.style_name, "garment": spec.garment, "seller": q.get("seller"), "quote": q,
                      "coupon_share": share, "charges": charges[i], "delivery_date": (est or {}).get("delivery_date"),
                      "problems": q["problems"]})
        problems += [f"Item {i + 1}: {p}" for p in q["problems"]]

    def total(key):
        return _money(sum(key(x["quote"]) for x in items))

    cod_max = (pb.get("cod") or {}).get("max_order_value")
    if body.payment_method == "cod" and cod_max and total(lambda q: q["total"]) > cod_max:
        problems.append(f"Cash on delivery is available for orders up to {cod_max:g}.")
        for x in items:
            x["quote"]["cod"]["available"] = False
    if coupon and coupon.get("amount"):
        coupon = {**coupon, "split": [{"index": x["index"], "amount": x["coupon_share"]} for x in items]}
    return {
        "currency": pb["currency"], "items": items, "coupon": coupon, "payment_method": body.payment_method,
        "pieces": sum(x["quote"]["pieces"] for x in items),
        "totals": {"subtotal": total(lambda q: q["subtotal"]),
                   "quantity_discount": total(lambda q: q["quantity_discount"]["amount"]),
                   "rush": total(lambda q: q["rush"]["amount"]),
                   "coupon": total(lambda q: (q.get("coupon") or {}).get("amount", 0)),
                   "shipping": total(lambda q: q["shipping"]["amount"]),
                   "cod_fee": total(lambda q: q["cod"]["fee"]),
                   "tax": total(lambda q: q["tax"]["amount"]),
                   "total": total(lambda q: q["total"])},
        "cod_available": all(x["quote"]["cod"]["available"] for x in items),
        "delivery_by": max((x["delivery_date"] for x in items if x["delivery_date"]), default=None),
        "problems": problems,
    }


# ----------------------------------------------------------------- checkout

def _hash(body: CheckoutIn) -> str:
    data = body.model_dump(exclude={"idempotency_key"})
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _order_request(body: CheckoutIn, i: int, spec: DesignSpec, item: CartItem) -> OrderRequest:
    return OrderRequest(design_id=item.design_id, spec=spec, items=item.lines, customer=body.customer,
                        language=body.language, idempotency_key=f"{body.idempotency_key}-{i + 1}", fabric=item.fabric,
                        delivery=body.delivery, rush=body.rush, coupon="", channel=body.channel,
                        seller_id=item.seller_id, payment_method=body.payment_method)


def checkout(store: PlatformStore, body: CheckoutIn, customer: dict | None, device: str, place_order) -> tuple[dict, bool]:
    """Create one order per item, or none. Returns (checkout, created)."""
    found, _ = store.find("checkout", ref=body.idempotency_key, limit=1)
    if found:
        if found[0]["request_hash"] != _hash(body):
            raise HTTPException(409, "This idempotency key was already used for a different checkout.")
        return found[0], False

    addr = body.delivery.address
    delivery = CartDelivery(method=body.delivery.method, pincode=addr.pincode if addr else "",
                            state=addr.state if addr else "")
    resolved = [resolve_item(store, it) for it in body.items]
    reqs = [_order_request(body, i, spec, it) for i, ((spec, _), it) in enumerate(zip(resolved, body.items))]

    # 1. Check every item first: seller and PIN code, cash on delivery, print checks.
    errors = []
    cq = cart_quote(store, CartQuoteIn(items=body.items, delivery=delivery, coupon=body.coupon, rush=body.rush,
                                       payment_method=body.payment_method))
    for i, (req, qi) in enumerate(zip(reqs, cq["items"])):
        q = qi["quote"]
        if q.get("seller_problem"):
            errors.append({"index": i, "code": q["seller_problem"], "message": sellers.problem_text(q["seller_problem"])})
            continue
        if body.payment_method == "cod" and not q["cod"]["available"]:
            errors.append({"index": i, "code": "cod_unavailable",
                           "message": next((p for p in q["problems"] if "ash on delivery" in p), "Cash on delivery is not available.")})
            continue
        failures = order_mod.check_lines(req)
        if failures:
            errors.append({"index": i, "code": "print_check_failed",
                           "message": "Some lines fail manufacturing checks.", "failures": failures})
    if errors:
        raise HTTPException(422, {"message": "Some items can't be ordered, so nothing was ordered.", "items": errors})

    # 2. Create the orders under one checkout number.
    cid = new_id("chk")
    number = f"CK-{store.next_number('checkout'):05d}"
    created: list[dict] = []
    try:
        for req, qi, (spec, product) in zip(reqs, cq["items"], resolved):
            extra = {"checkout_id": cid, "product_id": (product or {}).get("id")}
            if cq["coupon"] and cq["coupon"].get("amount"):
                extra["forced_coupon"] = {"code": cq["coupon"]["code"], "amount": qi["coupon_share"]}
            extra["forced_charges"] = qi["charges"]
            order, _ = place_order(req, customer, None, extra)
            store.link_order_device(order["id"], device)
            created.append(order)
    except Exception:
        for o in created:   # all or nothing
            try:
                lifecycle.cancel(store, o["id"], "Checkout could not be completed", "system")
            except HTTPException:
                pass
        raise
    ck = {"id": cid, "number": number, "idempotency_key": body.idempotency_key, "request_hash": _hash(body),
          "order_ids": [o["id"] for o in created], "customer": body.customer.model_dump(),
          "customer_id": created[0].get("customer_id") if created else None, "device": device,
          "payment_method": body.payment_method, "status": "paid" if body.payment_method == "cod" else "open",
          "coupon": cq["coupon"], "currency": cq["currency"],
          "totals": {**cq["totals"], "total": _money(sum(o["pricing"]["total"] for o in created))},
          "channel": body.channel}
    ck = store.put("checkout", cid, ck, status=ck["status"], parent=ck["customer_id"] or "", ref=body.idempotency_key,
                   search=f"{number} {body.customer.name} {body.customer.phone}")
    return ck, True


def view(store: PlatformStore, ck: dict) -> dict:
    orders = [store.get_order(oid) for oid in ck["order_ids"]]
    return {**{k: v for k, v in ck.items() if k not in ("request_hash", "device", "idempotency_key")},
            "orders": [lifecycle.public_view(o) for o in orders if o]}


def pay(store: PlatformStore, ck: dict, actor: str = "customer") -> dict:
    """Demo payment for every online order in the checkout that is not yet paid."""
    from ..schemas import PaymentConfirmation
    for oid in ck["order_ids"]:
        o = store.get_order(oid)
        if o and not o.get("payment") and (o.get("fulfilment") or {}).get("status") == "awaiting_payment":
            order_mod.confirm_payment(store, oid, PaymentConfirmation(demo=True), recorded_by=actor)
    ck["status"] = "paid"
    return store.put("checkout", ck["id"], ck, status="paid", parent=ck.get("customer_id") or "",
                     ref=ck["idempotency_key"], search=f"{ck['number']} {ck['customer']['name']} {ck['customer']['phone']}")


# ----------------------------------------------------------------- cancel and return

def customer_cancel(store: PlatformStore, order: dict, reason: str, customer: dict) -> dict:
    if not lifecycle.can_cancel(order):
        raise HTTPException(409, "Production has started, so this order can't be cancelled now. "
                                 "You can ask for a return after delivery if something is wrong.")
    return lifecycle.cancel(store, order["id"], reason, f"customer:{customer['id']}")


def _return_public(r: dict) -> dict:
    return {k: r.get(k) for k in ("id", "number", "status", "reason", "details", "lines", "resolution",
                                  "refund_amount", "created_at", "updated_at", "note")}


def request_return(store: PlatformStore, order: dict, body: ReturnIn, customer: dict) -> dict:
    reasons = config.get(store, "crm")["returnable_reasons"]
    if body.reason not in reasons:
        raise HTTPException(422, f"Printed goods can be returned only if they are: {', '.join(reasons)}.")
    if not lifecycle.can_return(order):
        until = lifecycle.return_until(order)
        if any(r["status"] not in ("resolved", "rejected") for r in order.get("returns", [])):
            raise HTTPException(409, "A return for this order is already open.")
        raise HTTPException(409, f"The return window closed on {until}." if until
                            else "Returns open once the order is delivered.")
    by_line = {ln["line"]: ln for ln in order["lines"]}
    lines = [ln.model_dump() for ln in body.lines] if body.lines else \
        [{"line": ln["line"], "quantity": ln["quantity"]} for ln in order["lines"]]
    for ln in lines:
        if ln["line"] not in by_line or ln["quantity"] > by_line[ln["line"]]["quantity"]:
            raise HTTPException(422, f"Line {ln['line']} is not in this order with that quantity.")
    from .security import seller_id_of
    rid = new_id("ret")
    r = {"id": rid, "number": f"R-{store.next_number('return'):05d}", "order_id": order["id"],
         "order_number": order.get("number"), "customer_id": customer["id"], "customer_name": order["customer"]["name"],
         "seller_id": seller_id_of(order), "status": "requested", "reason": body.reason, "details": body.details,
         "lines": lines, "resolution": None, "refund_amount": None, "note": "",
         "history": [{"at": now(), "status": "requested", "by": f"customer:{customer['id']}"}]}
    r = _put_return(store, r)
    order.setdefault("returns", []).append(_return_public(r))
    lifecycle.event(order, "return_requested", f"customer:{customer['id']}")
    store.save_order(order)
    notify.order_event(store, order, "return_requested")
    return r


def _put_return(store: PlatformStore, r: dict) -> dict:
    return store.put("return", r["id"], r, status=r["status"], parent=r["order_id"], owner=r["seller_id"],
                     ref=r["number"], search=f"{r['number']} {r.get('order_number') or ''} {r['customer_name']} {r['customer_id']}")


RETURN_FLOW = {"requested": ("approved", "rejected"), "approved": ("picked_up", "rejected"),
               "picked_up": ("resolved", "rejected")}


def set_return_status(store: PlatformStore, rid: str, body: ReturnStatusIn, actor: str,
                      seller_scope: str | None = None) -> dict:
    r = store.get("return", rid)
    if not r or (seller_scope and r["seller_id"] != seller_scope):
        raise HTTPException(404, "return not found")
    if body.status not in RETURN_FLOW.get(r["status"], ()):
        raise HTTPException(409, f"A {r['status']} return can't become {body.status}.")
    if body.status == "resolved" and not body.resolution:
        raise HTTPException(422, "Say how it was resolved: replacement or refund.")
    order = store.get_order(r["order_id"])
    r["status"], r["note"] = body.status, body.note
    r["history"].append({"at": now(), "status": body.status, "by": actor, "note": body.note})
    if body.status == "resolved":
        r["resolution"] = body.resolution
        if body.resolution == "refund":
            amount = body.refund_amount or (order.get("pricing") or {}).get("total")
            r["refund_amount"] = round(float(amount), 2)
            lifecycle._record_refund(order, r["refund_amount"], actor, f"Return {r['number']}")
    r = _put_return(store, r)
    order["returns"] = [_return_public(r) if x["id"] == rid else x for x in order.get("returns", [])]
    lifecycle.event(order, f"return_{body.status}", actor,
                    **({"resolution": body.resolution} if body.status == "resolved" else {}))
    store.save_order(order)
    store.audit(actor, f"return.{body.status}", f"order:{order['id']}", {"return": rid, "resolution": body.resolution})
    notify.order_event(store, order, f"return_{body.status}",
                       resolution={"refund": f"refund of {r['refund_amount']:g}" if r["refund_amount"] else "refund",
                                   "replacement": "a replacement"}.get(body.resolution or "", ""), note=body.note)
    return r


# ----------------------------------------------------------------- server cart

def get_cart(store: PlatformStore, customer_id: str) -> list[dict]:
    return (store.get("cart", customer_id) or {}).get("items", [])


def put_cart(store: PlatformStore, customer_id: str, items: list[CartItem]) -> list[dict]:
    if len(items) > MAX_CART_ITEMS:
        raise HTTPException(422, f"A cart holds up to {MAX_CART_ITEMS} items.")
    data = [it.model_dump(exclude_none=True) for it in items]
    store.put("cart", customer_id, {"customer_id": customer_id, "items": data}, parent=customer_id)
    return data


def merge_cart(store: PlatformStore, customer_id: str, items: list[CartItem]) -> list[dict]:
    """Add a guest's device cart to the saved one, skipping exact duplicates, up to the limit."""
    cur = get_cart(store, customer_id)
    seen = {json.dumps(x, sort_keys=True) for x in cur}
    for it in items:
        d = it.model_dump(exclude_none=True)
        k = json.dumps(d, sort_keys=True)
        if k not in seen and len(cur) < MAX_CART_ITEMS:
            cur.append(d)
            seen.add(k)
    store.put("cart", customer_id, {"customer_id": customer_id, "items": cur}, parent=customer_id)
    return cur
