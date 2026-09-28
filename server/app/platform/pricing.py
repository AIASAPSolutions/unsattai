"""Prices for a design and a roster, from the configurable price book.

Every amount on a quote is itemised, so the customer, the sales team and the
invoice all see the same numbers:

    per piece = garment base + fabric + logos + size surcharge + name + number
    subtotal  = sum of lines
    - quantity discount (tier by total pieces)
    + express production fee
    - coupon
    + delivery (zone rate, free above a threshold, or pickup fee)
    + tax (rate by average price per piece, e.g. 5% / 12% GST)
"""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from ..schemas import SIZES, Garment
from . import config
from .db import PlatformStore


class PriceLine(BaseModel):
    size: str = Field(..., pattern="^(" + "|".join(SIZES) + ")$")
    quantity: int = Field(..., ge=1, le=5000)
    player_name: str = Field("", max_length=16)
    number: str = Field("", pattern=r"^\d{0,3}$")


class DeliveryChoice(BaseModel):
    method: str = Field("ship", pattern="^(ship|pickup)$")
    pincode: str = Field("", pattern=r"^$|^\d{6}$")
    state: str = Field("", max_length=4)


class QuoteRequest(BaseModel):
    garment: Garment = "jersey"
    fabric: str = "standard"
    logos: int = Field(0, ge=0, le=4)
    lines: list[PriceLine] = Field(..., min_length=1, max_length=500)
    delivery: DeliveryChoice = Field(default_factory=DeliveryChoice)
    rush: bool = False
    coupon: str = Field("", max_length=24)


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


def quote(store: PlatformStore, req: QuoteRequest, today: date | None = None, price_book: dict | None = None) -> dict:
    """price_book: a draft to try before saving (operations app preview)."""
    today = today or date.today()
    pb = price_book or config.get(store, "price_book")
    dl = config.get(store, "delivery")
    version = "draft" if price_book else config.get_with_version(store, "price_book")["version"]
    problems: list[str] = []

    fabric = next((f for f in pb["fabrics"] if f["id"] == req.fabric), None)
    if fabric is None or req.garment not in fabric["garments"]:
        problems.append("This fabric is not available for this garment.")
        fabric = next(f for f in pb["fabrics"] if req.garment in f["garments"])
    base = pb["garments"][req.garment]["base"]
    logos = req.logos * pb["logo_per_piece"]

    lines, subtotal, pieces = [], 0.0, 0
    for i, ln in enumerate(req.lines, 1):
        parts = {"garment": base, "fabric": fabric["surcharge"], "logos": logos,
                 "size": pb["size_surcharge"].get(ln.size, 0),
                 "name": pb["personalisation"]["name"] if ln.player_name.strip() else 0,
                 "number": pb["personalisation"]["number"] if ln.number else 0}
        unit = _money(sum(parts.values()))
        total = _money(unit * ln.quantity)
        lines.append({"line": i, "size": ln.size, "quantity": ln.quantity, "player_name": ln.player_name,
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
                    "free": free, "free_above": zone["free_above"], "transit_days": zone["transit_days"]}

    per_piece = goods / pieces if pieces else 0
    tax_cfg = pb["tax"]
    rate = tax_cfg["rate_above"] if per_piece > tax_cfg["threshold_per_piece"] else tax_cfg["rate"]
    taxable = goods + shipping["amount"]
    if tax_cfg["inclusive"]:
        tax_amount = _money(taxable - taxable / (1 + rate))
        total = _money(taxable)
    else:
        tax_amount = _money(taxable * rate)
        total = _money(taxable + tax_amount)

    return {
        "currency": pb["currency"],
        "price_book_version": version,
        "garment": req.garment,
        "fabric": {"id": fabric["id"], "name": fabric["name"]},
        "lines": lines,
        "pieces": pieces,
        "subtotal": subtotal,
        "quantity_discount": {"min": tier["min"], "rate": tier["discount"], "amount": tier_amount,
                              "next": ({"min": next_tier["min"], "rate": next_tier["discount"],
                                        "pieces_needed": next_tier["min"] - pieces} if next_tier else None)},
        "rush": {"selected": req.rush, "amount": rush_amount, "rate": pb["rush"]["fee_rate"], "label": pb["rush"]["label"]},
        "coupon": coupon,
        "shipping": shipping,
        "tax": {"name": tax_cfg["name"], "rate": rate, "amount": tax_amount, "inclusive": tax_cfg["inclusive"]},
        "total": total,
        "average_per_piece": _money(total / pieces) if pieces else 0,
        "problems": problems,
    }
