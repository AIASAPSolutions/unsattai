"""Sellers (production partners) and PIN code serviceability.

Each seller is a record (kind "seller") with its own delivery coverage, capacity,
garments, price adjustment and cash on delivery. A service area matches a PIN code
prefix ("600"), a state code ("TN") or everywhere ("*"); the most specific match wins:
the longest matching prefix, then the state, then "*".

The customer never has to choose: offers are ranked by earliest delivery, then lowest
price, then best rating, and the first is recommended.
"""
from __future__ import annotations

import re
from datetime import date

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..schemas import GARMENTS, Garment
from . import config, pincodes, planning
from .db import PlatformStore, new_id
from .security import HOUSE_SELLER

REASONS = ("invalid_pincode", "not_serviceable", "garment_unavailable", "pieces_out_of_range")


class ServiceArea(BaseModel):
    model_config = ConfigDict(extra="forbid")
    match: str = Field(..., description='a PIN code prefix ("600"), a state code ("TN") or "*" for everywhere')
    transit_days: int = Field(..., ge=0, le=60)
    cod: bool = True

    @field_validator("match")
    @classmethod
    def _match(cls, v: str) -> str:
        v = v.strip().upper()
        if v != "*" and not re.fullmatch(r"[1-9]\d{0,5}", v) and v not in pincodes.STATES:
            raise ValueError(f'"{v}" is not a PIN code prefix (1 to 6 digits), a state code like TN, or "*"')
        return v


class SellerAddress(BaseModel):
    model_config = ConfigDict(extra="forbid")
    line1: str = Field("", max_length=160)
    city: str = Field("", max_length=60)
    state: str = Field("", max_length=4)
    pincode: str = Field("", pattern=r"^$|^\d{6}$")


class SellerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=2, max_length=80)
    legal_name: str = Field("", max_length=120)
    gstin: str = Field("", pattern=r"^$|^[0-9A-Z]{15}$")
    email: str = Field("", max_length=120, pattern=r"^$|^[^@\s]+@[^@\s]+\.[^@\s]+$")
    phone: str = Field("", max_length=24)
    address: SellerAddress = Field(default_factory=SellerAddress)
    active: bool = True
    garments: list[Garment] = Field(default_factory=lambda: list(GARMENTS), min_length=1)
    fabrics: list[str] = Field(default_factory=list, description="fabric ids; empty means every fabric")
    service_areas: list[ServiceArea] = Field(..., min_length=1, max_length=500)
    blocked_pincodes: list[str] = Field(default_factory=list, max_length=5000)
    capacity_factor: float = Field(1.0, gt=0, le=20)
    holidays: list[str] = Field(default_factory=list, max_length=200)
    handling_days: int = Field(0, ge=0, le=30)
    min_pieces: int = Field(1, ge=1, le=100_000)
    max_pieces: int = Field(5000, ge=1, le=100_000)
    price_adjust: float = Field(0.0, ge=-0.5, le=2.0, description="0.05 = 5% above the price book per piece")

    @field_validator("blocked_pincodes")
    @classmethod
    def _blocked(cls, v: list[str]) -> list[str]:
        bad = [p for p in v if not re.fullmatch(r"\d{6}", p.strip())]
        if bad:
            raise ValueError(f"blocked PIN codes must have 6 digits: {bad[0]!r}")
        return sorted({p.strip() for p in v})

    @field_validator("holidays")
    @classmethod
    def _holidays(cls, v: list[str]) -> list[str]:
        bad = [d for d in v if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d)]
        if bad:
            raise ValueError(f"holidays must be YYYY-MM-DD: {bad[0]!r}")
        return sorted(set(v))

    @model_validator(mode="after")
    def _check(self):
        if self.min_pieces > self.max_pieces:
            raise ValueError("min_pieces can't be more than max_pieces")
        matches = [a.match for a in self.service_areas]
        if len(matches) != len(set(matches)):
            raise ValueError("each service area match can appear only once")
        self.garments = list(dict.fromkeys(self.garments))
        return self


def save(store: PlatformStore, sid: str | None, body: SellerIn, actor: str) -> dict:
    """Create or update a seller. Fabric ids must exist in the price book."""
    fabrics = {f["id"] for f in config.get(store, "price_book")["fabrics"]}
    unknown = [f for f in body.fabrics if f not in fabrics]
    if unknown:
        raise HTTPException(422, f"Unknown fabric {unknown[0]!r}. Use one of: {', '.join(sorted(fabrics))}.")
    cur = store.get("seller", sid) if sid else None
    if sid and not cur:
        raise HTTPException(404, "seller not found")
    if cur and sid == HOUSE_SELLER and not body.active:
        raise HTTPException(409, "The house seller can't be switched off; remove its service areas instead.")
    data = {**(cur or {}), **body.model_dump(), "rating": (cur or {}).get("rating") or {"average": None, "count": 0}}
    out = _put(store, sid or new_id("sel"), data)
    store.audit(actor, "seller.update" if cur else "seller.create", f"seller:{out['id']}")
    return out


def _put(store: PlatformStore, sid: str, data: dict) -> dict:
    return store.put("seller", sid, data, status="active" if data.get("active", True) else "inactive",
                     search=" ".join(filter(None, [sid, data["name"], data.get("legal_name"), data.get("gstin"),
                                                   (data.get("address") or {}).get("city")])))


def get(store: PlatformStore, sid: str) -> dict | None:
    return store.get("seller", sid)


def active(store: PlatformStore) -> list[dict]:
    rows, _ = store.find("seller", status="active", order="created_at ASC", limit=500)
    return rows


def ensure_house(store: PlatformStore) -> dict:
    """First start: the company's own unit, serving what the delivery zones served, so an order
    with no seller behaves exactly as before. Older orders and shipments are marked as its."""
    house = store.get("seller", HOUSE_SELLER)
    if house:
        return house
    dl, co = config.get(store, "delivery"), config.get(store, "company")
    areas, seen = [], set()
    for z in dl["zones"]:
        keys = [p for p in z["pincode_prefixes"]] + [s.upper() for s in z["states"]]
        if not z["pincode_prefixes"] and not z["states"]:
            keys = ["*"]
        for k in keys:
            if k not in seen:
                seen.add(k)
                areas.append({"match": k, "transit_days": z["transit_days"], "cod": True})
    if "*" not in seen:
        areas.append({"match": "*", "transit_days": max(z["transit_days"] for z in dl["zones"]), "cod": True})
    origin = dl.get("origin") or {}
    body = SellerIn(name=co["name"] or "House", legal_name=co.get("legal_name", ""),
                    email=co.get("email", "") if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", co.get("email", "")) else "",
                    phone=co.get("phone", ""),
                    address=SellerAddress(city=origin.get("city", ""), state=origin.get("state", ""),
                                          pincode=origin.get("pincode", "") if re.fullmatch(r"\d{6}", origin.get("pincode", "")) else ""),
                    service_areas=[ServiceArea(**a) for a in areas])
    house = _put(store, HOUSE_SELLER, {**body.model_dump(), "house": True, "rating": {"average": None, "count": 0}})
    _adopt_old_orders(store, house)
    return house


def _adopt_old_orders(store: PlatformStore, house: dict) -> None:
    from . import lifecycle
    ref = {"id": house["id"], "name": house["name"]}
    for o in store.all_orders():
        if not o.get("seller"):
            o["seller"] = ref
            store.save_order(o)
            if o.get("fulfilment") is not None:
                lifecycle.index_order(store, o)
    for shp in store.find("shipment", limit=100_000)[0]:
        if not shp.get("seller_id"):
            shp["seller_id"] = house["id"]
            lifecycle.put_shipment(store, shp)


# ----------------------------------------------------------------- matching a PIN code

def match_area(seller: dict, pincode: str, state: str) -> dict | None:
    """Most specific area: longest PIN prefix, then state, then "*"."""
    best, best_len = None, -1
    for a in seller.get("service_areas", []):
        m = a["match"]
        if m.isdigit() and pincode and pincode.startswith(m) and len(m) > best_len:
            best, best_len = a, len(m)
    if best:
        return best
    if state:
        hit = next((a for a in seller.get("service_areas", []) if a["match"] == state.upper()), None)
        if hit:
            return hit
    return next((a for a in seller.get("service_areas", []) if a["match"] == "*"), None)


def check(seller: dict, pincode: str, state: str, garment: str, fabric: str | None, pieces: int) -> tuple[dict | None, str | None]:
    """(service area, None) when the seller can take the order, else (None, reason)."""
    if not seller.get("active", True):
        return None, "not_serviceable"
    if pincode and pincode in seller.get("blocked_pincodes", []):
        return None, "not_serviceable"
    area = match_area(seller, pincode, state)
    if area is None:
        return None, "not_serviceable"
    if garment not in seller.get("garments", GARMENTS) or (fabric and seller.get("fabrics") and fabric not in seller["fabrics"]):
        return None, "garment_unavailable"
    if not seller.get("min_pieces", 1) <= pieces <= seller.get("max_pieces", 5000):
        return None, "pieces_out_of_range"
    return area, None


def production_for(production: dict, seller: dict | None) -> dict:
    """The global production settings with this seller's capacity factor and holidays."""
    if not seller:
        return production
    f = seller.get("capacity_factor", 1.0) or 1.0
    return {**production,
            "holidays": sorted(set(production["holidays"]) | set(seller.get("holidays", []))),
            "stages": [{**s, "capacity_per_day": max(1, int(round(s["capacity_per_day"] * f)))} for s in production["stages"]]}


def unit_price(pb: dict, seller: dict, garment: str, fabric: str | None, pieces: int) -> float:
    """Price of one plain piece at this quantity: garment + fabric, the seller's adjustment, tier discount."""
    fab = next((x for x in pb["fabrics"] if x["id"] == fabric), None) if fabric else None
    if fab is None:
        fab = min((x for x in pb["fabrics"] if garment in x["garments"]), key=lambda x: x["surcharge"])
    tier = max((t for t in pb["quantity_tiers"] if pieces >= t["min"]), key=lambda t: t["min"])
    base = (pb["garments"][garment]["base"] + fab["surcharge"]) * (1 + seller.get("price_adjust", 0.0))
    return round(base * (1 - tier["discount"]) + 1e-9, 2)


def serviceability(store: PlatformStore, pincode: str, garment: str = "jersey", fabric: str | None = None,
                   pieces: int = 1, rush: bool = False, state: str = "", today: date | None = None) -> dict:
    place = pincodes.place(pincode) if pincode else None
    out = {"pincode": pincode, "serviceable": False, "place": place, "reason": None, "offers": [],
           "recommended_seller_id": None}
    if pincode and not place:
        out["reason"] = "invalid_pincode"
        return out
    state = (place or {}).get("state") or state
    pb = config.get(store, "price_book")
    offers, reasons = [], []
    for s in active(store):
        area, why = check(s, pincode, state, garment, fabric, pieces)
        if why:
            reasons.append(why)
            continue
        est = planning.promise(store, pieces, rush, area["transit_days"], today, seller=s)
        offers.append({"seller_id": s["id"], "seller_name": s["name"], "rating": s.get("rating") or {"average": None, "count": 0},
                       "unit_price": unit_price(pb, s, garment, fabric, pieces), "ship_date": est["ship_date"],
                       "delivery_date": est["delivery_date"], "transit_days": area["transit_days"],
                       "cod_available": bool(area.get("cod")) and bool((pb.get("cod") or {}).get("enabled")),
                       "recommended": False, "fastest": False, "cheapest": False})
    if not offers:
        # The reason furthest along the checks explains best why nobody can take it.
        out["reason"] = max(reasons, key=REASONS.index) if reasons else "not_serviceable"
        return out
    rank(offers)
    out.update(serviceable=True, offers=offers, recommended_seller_id=offers[0]["seller_id"])
    return out


def rank(offers: list[dict]) -> None:
    """Earliest delivery, then lowest price, then best rating; flag recommended, fastest and cheapest."""
    offers.sort(key=lambda o: (o["delivery_date"], o["unit_price"], -((o["rating"] or {}).get("average") or 0)))
    offers[0]["recommended"] = True
    min(offers, key=lambda o: o["delivery_date"])["fastest"] = True
    min(offers, key=lambda o: (o["unit_price"], o["delivery_date"]))["cheapest"] = True


def choose(store: PlatformStore, seller_id: str, pincode: str, state: str, garment: str, fabric: str | None,
           pieces: int, rush: bool = False, pickup: bool = False) -> tuple[dict | None, dict | None, str | None]:
    """The seller for a quote or order: (seller, service area, problem).

    With seller_id, that seller must be able to serve; without it, the recommended offer.
    Pickup orders are made by the chosen seller (the house unit by default), with no transit.
    """
    if pincode and not pincodes.place(pincode) and not pickup:
        return None, None, "invalid_pincode"
    state = ((pincodes.place(pincode) or {}).get("state") if pincode else None) or state
    if seller_id:
        s = store.get("seller", seller_id)
        if not s or not s.get("active", True):
            return None, None, "seller_unavailable"
        if pickup:
            return s, {"match": "pickup", "transit_days": 0, "cod": True}, None
        area, why = check(s, pincode, state, garment, fabric, pieces)
        return (s, area, None) if area else (s, None, why)
    if pickup:
        s = store.get("seller", HOUSE_SELLER) or (active(store) or [None])[0]
        return s, {"match": "pickup", "transit_days": 0, "cod": True}, None if s else "not_serviceable"
    res = serviceability(store, pincode, garment, fabric, pieces, rush, state)
    if not res["serviceable"]:
        return None, None, res["reason"]
    best = res["offers"][0]
    s = store.get("seller", best["seller_id"])
    return s, match_area(s, pincode, state), None


PROBLEM_TEXT = {
    "invalid_pincode": "This PIN code doesn't look right.",
    "not_serviceable": "We can't deliver to this PIN code yet.",
    "garment_unavailable": "This garment or fabric is not available for this PIN code.",
    "pieces_out_of_range": "This quantity can't be delivered to this PIN code.",
    "seller_unavailable": "This seller is not available.",
}


def problem_text(code: str) -> str:
    return PROBLEM_TEXT.get(code, code)


def refresh_rating(store: PlatformStore, seller_id: str) -> None:
    s = store.get("seller", seller_id)
    if not s:
        return
    rows, _ = store.find("review", owner=seller_id, status="visible", limit=100_000)
    s["rating"] = {"average": round(sum(r["rating"] for r in rows) / len(rows), 2) if rows else None, "count": len(rows)}
    _put(store, seller_id, s)

