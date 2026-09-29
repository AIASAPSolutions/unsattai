"""Prices for a design and a roster, from the configurable price book.

Every amount on a quote is itemised, so the customer, the sales team and the
invoice all see the same numbers:

    per piece = garment base + fabric + logos + options (sleeves, collar, fit) + size surcharge + name + number
    subtotal  = sum of lines
    - quantity discount (tier by total pieces)
    + express production fee
    - coupon
    + delivery (zone rate, free above a threshold, or pickup fee)
    + cash on delivery fee (when paying on delivery)
    + tax (rate by average price per piece, e.g. 5% / 12% GST)

The seller (production partner) is chosen here too: the one asked for, or the
recommended offer for the PIN code. Its price adjustment is a per-piece part, and its
transit days for the PIN code set the delivery estimate.
"""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field, model_validator

from ..schemas import ALL_SIZES, Collar, Fit, Garment, Sleeves, check_fit_size
from . import config
from .db import PlatformStore


class PriceLine(BaseModel):
    fit: Fit = "men"
    size: str = Field(..., pattern="^(" + "|".join(ALL_SIZES) + ")$")
    quantity: int = Field(..., ge=1, le=5000)
    player_name: str = Field("", max_length=16)
    number: str = Field("", pattern=r"^\d{0,3}$")

    @model_validator(mode="after")
    def _fit_size(self):
        check_fit_size(self.fit, self.size)
        return self


class DeliveryChoice(BaseModel):
    method: str = Field("ship", pattern="^(ship|pickup)$")
    pincode: str = Field("", pattern=r"^$|^\d{6}$")
    state: str = Field("", max_length=4)


class QuoteRequest(BaseModel):
    garment: Garment = "jersey"
    fabric: str = "standard"
    logos: int = Field(0, ge=0, le=4)
    sleeves: Sleeves = "short"
    collar: Collar = "crew"
    lines: list[PriceLine] = Field(..., min_length=1, max_length=500)
    delivery: DeliveryChoice = Field(default_factory=DeliveryChoice)
    rush: bool = False
    coupon: str = Field("", max_length=24)
    seller_id: str = Field("", max_length=40, description="empty: the recommended seller for the PIN code")
    payment_method: str = Field("online", pattern="^(online|cod)$")


def _money(x: float) -> float:
    return round(x + 1e-9, 2)


def find_zone(delivery_cfg: dict, pincode: str, state: str) -> dict:
    zones = delivery_cfg["zones"]
    if pincode:
        best = None
        for z in zones:
            for p in z["pincode_prefixes"]:
                if pincode.startswith(p) and (best is None or len(p) > best[1]):
                    best = (z, len(p))
        if best:
            return best[0]
    if state:
        for z in zones:
            if state.upper() in z["states"]:
                return z
    return next(z for z in zones if not z["states"] and not z["pincode_prefixes"])


def _coupon(pb: dict, code: str, subtotal: float, today: date) -> tuple[float, dict | None]:
    code = code.strip().upper()
    if not code:
        return 0.0, None
    c = next((c for c in pb["coupons"] if c["code"] == code), None)
    if c is None or not c["active"]:
        return 0.0, {"code": code, "amount": 0, "error": "This code is not valid."}
    if c["expires"] and c["expires"] < today.isoformat():
        return 0.0, {"code": code, "amount": 0, "error": "This code has expired."}
    if subtotal < c["min_subtotal"]:
        return 0.0, {"code": code, "amount": 0, "error": f"This code needs an order of at least {c['min_subtotal']:g}."}
    amount = subtotal * c["value"] / 100 if c["kind"] == "percent" else c["value"]
    if c["max_discount"] is not None:
        amount = min(amount, c["max_discount"])
    amount = min(amount, subtotal)
    return _money(amount), {"code": code, "amount": _money(amount), "note": c["note"]}


def cart_coupon(pb: dict, code: str, subtotal: float, today: date) -> tuple[float, dict | None]:
    """A coupon applied to a whole cart (after quantity discounts)."""
    return _coupon(pb, code, subtotal, today)


def quote(store: PlatformStore, req: QuoteRequest, today: date | None = None, price_book: dict | None = None,
          forced_coupon: dict | None = None, forced_charges: dict | None = None) -> dict:
    """price_book: a draft to try before saving (operations app preview).
    forced_coupon: this item's share of a cart coupon ({code, amount}), instead of req.coupon.
    forced_charges: this item's share of charges worked out for a whole cart ({shipping, cod_fee}), so a cart pays
    one delivery charge per seller and one cash-on-delivery fee, not one per item."""
    from . import sellers
    today = today or date.today()
    pb = price_book or config.get(store, "price_book")
    dl = config.get(store, "delivery")
    version = "draft" if price_book else config.get_with_version(store, "price_book")["version"]
    problems: list[str] = []
    pieces_total = sum(ln.quantity for ln in req.lines)
    seller, area, why = sellers.choose(store, req.seller_id, req.delivery.pincode, req.delivery.state, req.garment,
                                       req.fabric, pieces_total, req.rush, pickup=req.delivery.method == "pickup")
    if why:
        problems.append(sellers.problem_text(why))
    adjust = (seller or {}).get("price_adjust", 0.0) if not why else 0.0

    fabric = next((f for f in pb["fabrics"] if f["id"] == req.fabric), None)
    if fabric is None or req.garment not in fabric["garments"]:
        problems.append("This fabric is not available for this garment.")
        fabric = next(f for f in pb["fabrics"] if req.garment in f["garments"])
    base = pb["garments"][req.garment]["base"]
    logos = req.logos * pb["logo_per_piece"]
    opts = pb.get("options") or config.defaults.PRICE_BOOK["options"]

    def option(group: str, key: str) -> float:
        c = opts[group][key]
        if not c.get("active", True):
            problems.append(f"{c['name']} is not available right now.")
        return c["price"]

    garment_options = {}
    if req.garment != "shorts":
        garment_options["sleeves"] = option("sleeves", req.sleeves)
    if req.garment == "jersey":
        garment_options["collar"] = option("collar", req.collar)

    lines, subtotal, pieces = [], 0.0, 0
    for i, ln in enumerate(req.lines, 1):
        parts = {"garment": base, "fabric": fabric["surcharge"], "logos": logos,
                 **{k: v for k, v in garment_options.items() if v},
                 **({"fit": f} if (f := option("fit", ln.fit)) else {}),
                 "size": pb["size_surcharge"].get(ln.size, 0),
                 "name": pb["personalisation"]["name"] if ln.player_name.strip() else 0,
                 "number": pb["personalisation"]["number"] if ln.number else 0}
        if adjust:
            parts["seller"] = _money(sum(parts.values()) * adjust)
        unit = max(0.0, _money(sum(parts.values())))
        total = _money(unit * ln.quantity)
        lines.append({"line": i, "fit": ln.fit, "size": ln.size, "quantity": ln.quantity, "player_name": ln.player_name,
                      "number": ln.number, "unit_price": unit, "line_total": total, "parts": parts})
        subtotal += total
        pieces += ln.quantity
    subtotal = _money(subtotal)
    if pieces < pb["minimum_pieces"]:
        problems.append(f"The minimum order is {pb['minimum_pieces']} pieces.")

    tier = max((t for t in pb["quantity_tiers"] if pieces >= t["min"]), key=lambda t: t["min"])
    tier_amount = _money(subtotal * tier["discount"])
    after_tier = subtotal - tier_amount
    next_tier = next((t for t in pb["quantity_tiers"] if t["min"] > pieces), None)

    rush_amount = 0.0
    if req.rush:
        if pb["rush"]["enabled"]:
            rush_amount = _money(after_tier * pb["rush"]["fee_rate"])
        else:
            problems.append("Express production is not available right now.")

    if forced_coupon is not None:
        coupon_amount = min(_money(forced_coupon.get("amount", 0)), _money(after_tier))
        coupon = {**forced_coupon, "amount": coupon_amount, "cart_share": True} if forced_coupon.get("code") else None
    else:
        coupon_amount, coupon = _coupon(pb, req.coupon, after_tier, today)
    goods = _money(after_tier + rush_amount - coupon_amount)

    if req.delivery.method == "pickup":
        if not dl["pickup"]["enabled"]:
            problems.append("Pickup is not available.")
        zone = None
        shipping = {"method": "pickup", "label": dl["pickup"]["label"], "amount": _money(dl["pickup"]["fee"]),
                    "free": dl["pickup"]["fee"] == 0, "transit_days": 0}
    else:
        zone = find_zone(dl, req.delivery.pincode, req.delivery.state)
        raw = zone["base"] + zone["per_piece"] * pieces
        free = zone["free_above"] is not None and goods >= zone["free_above"]
        shipping = {"method": "ship", "zone": zone["id"], "zone_name": zone["name"], "amount": 0.0 if free else _money(raw),
                    "free": free, "free_above": zone["free_above"],
                    "transit_days": area["transit_days"] if area else zone["transit_days"]}

    if forced_charges and forced_charges.get("shipping") is not None:
        shipping = {**shipping, "amount": _money(forced_charges["shipping"]), "free": forced_charges.get("free", False),
                    "combined": True}
    cod_cfg = pb.get("cod") or {"enabled": False, "fee": 0, "max_order_value": None}
    cod = {"selected": req.payment_method == "cod", "fee": 0.0, "available": bool(cod_cfg["enabled"]) and bool(
        area is None or area.get("cod", True)), "max_order_value": cod_cfg.get("max_order_value")}
    if cod["selected"]:
        if not cod["available"]:
            problems.append("Cash on delivery is not available for this PIN code.")
        else:
            cod["fee"] = _money(cod_cfg.get("fee") or 0)
            if forced_charges and forced_charges.get("cod_fee") is not None:
                cod["fee"] = _money(forced_charges["cod_fee"])

    per_piece = goods / pieces if pieces else 0
    tax_cfg = pb["tax"]
    rate = tax_cfg["rate_above"] if per_piece > tax_cfg["threshold_per_piece"] else tax_cfg["rate"]
    taxable = goods + shipping["amount"] + cod["fee"]
    if tax_cfg["inclusive"]:
        tax_amount = _money(taxable - taxable / (1 + rate))
        total = _money(taxable)
    else:
        tax_amount = _money(taxable * rate)
        total = _money(taxable + tax_amount)
    if cod["selected"] and cod["available"] and cod["max_order_value"] and total > cod["max_order_value"] \
            and not (forced_charges and forced_charges.get("cod_checked")):
        cod["available"] = False
        problems.append(f"Cash on delivery is available for orders up to {cod['max_order_value']:g}.")

    return {
        "currency": pb["currency"],
        "price_book_version": version,
        "garment": req.garment,
        "fabric": {"id": fabric["id"], "name": fabric["name"]},
        "options": {k: {"id": getattr(req, k), "name": opts[k][getattr(req, k)]["name"], "price": v}
                    for k, v in garment_options.items()},
        "lines": lines,
        "pieces": pieces,
        "subtotal": subtotal,
        "quantity_discount": {"min": tier["min"], "rate": tier["discount"], "amount": tier_amount,
                              "next": ({"min": next_tier["min"], "rate": next_tier["discount"],
                                        "pieces_needed": next_tier["min"] - pieces} if next_tier else None)},
        "rush": {"selected": req.rush, "amount": rush_amount, "rate": pb["rush"]["fee_rate"], "label": pb["rush"]["label"]},
        "coupon": coupon,
        "shipping": shipping,
        "payment_method": req.payment_method,
        "cod": cod,
        "seller": {"id": seller["id"], "name": seller["name"]} if seller and not why else None,
        "seller_problem": why,
        "tax": {"name": tax_cfg["name"], "rate": rate, "amount": tax_amount, "inclusive": tax_cfg["inclusive"]},
        "total": total,
        "average_per_piece": _money(total / pieces) if pieces else 0,
        "problems": list(dict.fromkeys(problems)),
    }
