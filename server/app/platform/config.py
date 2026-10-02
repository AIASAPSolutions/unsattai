"""Business configuration (prices, production, delivery, company, CRM) with validation.

Each section is a versioned setting. Reading falls back to the defaults, so a new
install works immediately; saving validates the whole section first, so a typo in the
operations app can't break checkout.
"""
from __future__ import annotations

import copy
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from ..engine import sizing as sizing_engine
from ..schemas import ALL_SIZES, COLLARS, FITS, GARMENTS, SLEEVES
from . import defaults
from .db import PlatformStore

SECTIONS = tuple(defaults.ALL)


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GarmentPrice(_M):
    name: str = Field(..., min_length=1, max_length=60)
    base: float = Field(..., ge=0, le=1_000_000)


class Fabric(_M):
    id: str = Field(..., pattern=r"^[a-z0-9_-]{2,30}$")
    name: str = Field(..., min_length=1, max_length=80)
    surcharge: float = Field(0, ge=0, le=100_000)
    garments: list[Literal[GARMENTS]] = Field(default_factory=lambda: list(GARMENTS), min_length=1)


class Tier(_M):
    min: int = Field(..., ge=1, le=100_000)
    discount: float = Field(..., ge=0, le=0.9)


class Rush(_M):
    enabled: bool = True
    fee_rate: float = Field(0.25, ge=0, le=3)
    label: str = Field("Express production", max_length=60)


class Tax(_M):
    name: str = Field("GST", max_length=20)
    rate: float = Field(..., ge=0, le=0.5)
    rate_above: float = Field(..., ge=0, le=0.5)
    threshold_per_piece: float = Field(..., ge=0)
    inclusive: bool = False


class Coupon(_M):
    code: str = Field(..., pattern=r"^[A-Z0-9_-]{3,24}$")
    kind: Literal["percent", "amount"] = "percent"
    value: float = Field(..., gt=0, le=100_000)
    max_discount: float | None = Field(None, ge=0)
    min_subtotal: float = Field(0, ge=0)
    active: bool = True
    expires: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    note: str = Field("", max_length=120)
    public: bool = Field(False, description="listed under GET /shop/offers")
    title: str = Field("", max_length=80, description="what customers see in the offers list")

    @model_validator(mode="after")
    def _pct(self):
        if self.public and not self.title.strip():
            raise ValueError(f"coupon {self.code}: a public coupon needs a title")
        if self.kind == "percent" and self.value > 90:
            raise ValueError("a percent coupon can be at most 90")
        return self


class Cod(_M):
    enabled: bool = True
    fee: float = Field(0, ge=0, le=10_000)
    max_order_value: float | None = Field(None, gt=0, description="orders above this total can't use cash on delivery")


class OptionChoice(_M):
    name: str = Field(..., min_length=1, max_length=60)
    price: float = Field(0, ge=-100_000, le=100_000, description="per piece; negative = discount")
    active: bool = True


class Options(_M):
    sleeves: dict[Literal[SLEEVES], OptionChoice]
    collar: dict[Literal[COLLARS], OptionChoice]
    fit: dict[Literal[FITS], OptionChoice]

    @model_validator(mode="after")
    def _all(self):
        for group, keys in (("sleeves", SLEEVES), ("collar", COLLARS), ("fit", FITS)):
            got = getattr(self, group)
            if set(got) != set(keys):
                raise ValueError(f"{group}: every choice is needed ({', '.join(keys)}); switch one off with active")
            if not any(c.active for c in got.values()):
                raise ValueError(f"{group}: at least one choice must be active")
        if not self.sleeves["short"].active or not self.collar["crew"].active:
            raise ValueError("short sleeves and the crew neck are the defaults and can't be switched off")
        return self


def _default_options() -> "Options":
    return Options.model_validate(defaults.PRICE_BOOK["options"])


class PriceBook(_M):
    currency: str = Field("INR", pattern=r"^[A-Z]{3}$")
    garments: dict[Literal[GARMENTS], GarmentPrice]
    fabrics: list[Fabric] = Field(..., min_length=1)
    size_surcharge: dict[Literal[ALL_SIZES], float]
    options: Options = Field(default_factory=_default_options)
    personalisation: dict[Literal["name", "number"], float]
    logo_per_piece: float = Field(0, ge=0)
    quantity_tiers: list[Tier] = Field(..., min_length=1)
    minimum_pieces: int = Field(1, ge=1, le=1000)
    rush: Rush
    tax: Tax
    coupons: list[Coupon] = Field(default_factory=list)
    cod: Cod = Field(default_factory=lambda: Cod(enabled=False))

    @model_validator(mode="after")
    def _check(self):
        if set(self.garments) != set(GARMENTS):
            raise ValueError(f"prices are needed for every garment: {', '.join(GARMENTS)}")
        ids = [f.id for f in self.fabrics]
        if len(ids) != len(set(ids)):
            raise ValueError("fabric ids must be unique")
        if sorted(t.min for t in self.quantity_tiers) != [t.min for t in self.quantity_tiers] or self.quantity_tiers[0].min != 1:
            raise ValueError("quantity tiers must start at 1 and go up")
        codes = [c.code for c in self.coupons]
        if len(codes) != len(set(codes)):
            raise ValueError("coupon codes must be unique")
        return self


class Stage(_M):
    id: str = Field(..., pattern=r"^[a-z0-9_-]{2,30}$")
    name: str = Field(..., min_length=1, max_length=60)
    capacity_per_day: int = Field(..., ge=1, le=1_000_000)
    fixed_days: int = Field(0, ge=0, le=30)


class Production(_M):
    timezone: str = "Asia/Kolkata"
    working_days: list[int] = Field(..., min_length=1)
    holidays: list[str] = Field(default_factory=list)
    daily_cutoff_hour: int = Field(14, ge=0, le=23)
    stages: list[Stage] = Field(..., min_length=1, max_length=20)
    rush_priority: bool = True

    @field_validator("working_days")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("working days are 0 (Monday) to 6 (Sunday)")
        return sorted(set(v))

    @field_validator("holidays")
    @classmethod
    def _hol(cls, v: list[str]) -> list[str]:
        import re
        bad = [d for d in v if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d)]
        if bad:
            raise ValueError(f"holidays must be YYYY-MM-DD: {bad[0]}")
        return sorted(set(v))


class Zone(_M):
    id: str = Field(..., pattern=r"^[a-z0-9_-]{2,30}$")
    name: str = Field(..., min_length=1, max_length=60)
    states: list[str] = Field(default_factory=list)
    pincode_prefixes: list[str] = Field(default_factory=list)
    base: float = Field(..., ge=0)
    per_piece: float = Field(0, ge=0)
    free_above: float | None = Field(None, ge=0)
    transit_days: int = Field(..., ge=0, le=60)


class Carrier(_M):
    id: str = Field(..., pattern=r"^[a-z0-9_-]{2,30}$")
    name: str = Field(..., min_length=1, max_length=60)
    tracking_url: str = Field("", max_length=300, description="use {tracking} where the number goes")
    active: bool = True


class Pickup(_M):
    enabled: bool = True
    label: str = Field("Collect from our workshop", max_length=80)
    fee: float = Field(0, ge=0)


class Delivery(_M):
    origin: dict[str, str]
    dispatch_days: list[int] = Field(..., min_length=1)
    pickup: Pickup
    zones: list[Zone] = Field(..., min_length=1)
    carriers: list[Carrier] = Field(..., min_length=1)

    @model_validator(mode="after")
    def _fallback(self):
        if not any(not z.states and not z.pincode_prefixes for z in self.zones):
            raise ValueError("one zone must have no states and no pincode prefixes: it covers everywhere else")
        return self


class Company(_M):
    name: str = Field(..., min_length=1, max_length=80)
    legal_name: str = Field("", max_length=120)
    tax_id: str = Field("", max_length=40)
    email: str = Field("", max_length=120)
    phone: str = Field("", max_length=30)
    address: str = Field("", max_length=300)
    invoice_prefix: str = Field("US", pattern=r"^[A-Z0-9-]{1,8}$")
    quote_valid_days: int = Field(14, ge=1, le=365)
    support_hours: str = Field("", max_length=80)


class CRMConfig(_M):
    lead_stages: list[str] = Field(..., min_length=3)
    lead_sources: list[str] = Field(..., min_length=1)
    organisation_kinds: list[str] = Field(..., min_length=1)
    ticket_categories: list[str] = Field(..., min_length=1)
    reorder_reminder_days: int = Field(300, ge=0, le=2000)
    return_window_days: int = Field(7, ge=0, le=60, description="0 turns returns off")
    returnable_reasons: list[str] = Field(default_factory=lambda: ["damaged", "wrong_item", "print_quality"],
                                          max_length=20)

    @model_validator(mode="after")
    def _won_lost(self):
        if "won" not in self.lead_stages or "lost" not in self.lead_stages:
            raise ValueError('lead stages must include "won" and "lost"')
        import re
        bad = [r for r in self.returnable_reasons if not re.fullmatch(r"[a-z0-9_]{2,30}", r)]
        if bad:
            raise ValueError(f"return reasons are short ids like print_quality: {bad[0]!r}")
        return self


def _pair(v, what):
    if v is None:
        return v
    if len(v) != 2 or v[0] > v[1]:
        raise ValueError(f"{what} is [from, to] with from <= to")
    return v


class TopMeasure(_M):
    chest: float = Field(..., gt=10, lt=120)
    length: float = Field(..., gt=20, lt=130)
    shoulder: float = Field(..., gt=10, lt=90)
    sleeve_short: float = Field(..., gt=3, lt=60)
    sleeve_long: float = Field(..., gt=15, lt=100)


class ShortsMeasure(_M):
    waist: float = Field(..., gt=10, lt=100)
    hip: float = Field(..., gt=15, lt=110)
    length: float = Field(..., gt=10, lt=100)


class SizeRow(_M):
    size: Literal[ALL_SIZES]
    body_chest: list[float] = Field(..., description="wearer's chest all round, cm [from, to]")
    height: list[float] | None = Field(None, description="child's height, cm [from, to]")
    top: TopMeasure
    shorts: ShortsMeasure

    @field_validator("body_chest")
    @classmethod
    def _bc(cls, v):
        return _pair(v, "body_chest")

    @field_validator("height")
    @classmethod
    def _h(cls, v):
        return _pair(v, "height")


class FitChart(_M):
    name: str = Field(..., min_length=1, max_length=40)
    sizes: list[SizeRow]


class Sizing(_M):
    unit: Literal["cm"] = "cm"
    tolerance_cm: float = Field(1.0, ge=0, le=5)
    note: str = Field("", max_length=400)
    fits: dict[Literal[FITS], FitChart]

    @model_validator(mode="after")
    def _sizes(self):
        if set(self.fits) != set(FITS):
            raise ValueError(f"a chart is needed for each fit: {', '.join(FITS)}")
        for fit, chart in self.fits.items():
            got = [r.size for r in chart.sizes]
            want = list(sizing_engine.FIT_SIZES[fit])
            if got != want:
                raise ValueError(f"{fit}: the sizes are fixed as {', '.join(want)} (in that order); only measurements change")
            for a, b in zip(chart.sizes, chart.sizes[1:]):
                if b.top.chest < a.top.chest or b.top.length < a.top.length:
                    raise ValueError(f"{fit} {b.size}: chest and length must not be smaller than {a.size}")
        return self


MODELS = {"sizing": Sizing, "price_book": PriceBook, "production": Production, "delivery": Delivery, "company": Company, "crm": CRMConfig}


class ConfigInvalid(Exception):
    def __init__(self, errors: list[dict]):
        super().__init__("invalid configuration")
        self.errors = errors


def _fill(section: str, value: dict) -> dict:
    """Settings saved before a newer server added keys get those keys' defaults."""
    base = copy.deepcopy(defaults.ALL[section])
    return {**base, **value}


def get(store: PlatformStore, section: str) -> dict:
    row = store.get_setting(section)
    return _fill(section, row["value"]) if row else copy.deepcopy(defaults.ALL[section])


def get_with_version(store: PlatformStore, section: str) -> dict:
    row = store.get_setting(section)
    if row:
        return {**row, "value": _fill(section, row["value"])}
    return {"value": copy.deepcopy(defaults.ALL[section]), "version": 0, "updated_at": None, "updated_by": None}


def validate(section: str, value: dict) -> dict:
    try:
        return MODELS[section].model_validate(value).model_dump()
    except ValidationError as e:
        raise ConfigInvalid([{"path": ".".join(str(p) for p in err["loc"]), "message": err["msg"].replace("Value error, ", "")}
                             for err in e.errors()]) from e


def save(store: PlatformStore, section: str, value: dict, actor: str, expected_version: int | None) -> dict:
    clean = validate(section, value)
    out = store.put_setting(section, clean, actor, expected_version)
    store.audit(actor, "settings.update", f"settings:{section}", {"version": out["version"]})
    return out


def public_catalogue(store: PlatformStore) -> dict:
    """What customers may see: prices, fabrics, zones, but no internal notes or coupon list."""
    pb, dl, co = get(store, "price_book"), get(store, "delivery"), get(store, "company")
    return {
        "currency": pb["currency"],
        "garments": pb["garments"],
        "fabrics": pb["fabrics"],
        "size_surcharge": pb["size_surcharge"],
        "options": public_options(pb),
        "personalisation": pb["personalisation"],
        "logo_per_piece": pb["logo_per_piece"],
        "quantity_tiers": pb["quantity_tiers"],
        "minimum_pieces": pb["minimum_pieces"],
        "rush": pb["rush"],
        "tax": {"name": pb["tax"]["name"], "inclusive": pb["tax"]["inclusive"]},
        "pickup": dl["pickup"],
        "zones": [{"id": z["id"], "name": z["name"], "transit_days": z["transit_days"], "free_above": z["free_above"]}
                  for z in dl["zones"]],
        "company": {k: co[k] for k in ("name", "email", "phone", "support_hours")},
        "cod": pb.get("cod") or {"enabled": False, "fee": 0, "max_order_value": None},
        "returns": {"window_days": get(store, "crm")["return_window_days"],
                    "reasons": get(store, "crm")["returnable_reasons"]},
    }


def public_options(pb: dict) -> dict:
    """Active garment options with their per-piece prices."""
    opts = pb.get("options") or defaults.PRICE_BOOK["options"]
    return {group: [{"id": k, "name": c["name"], "price": c["price"]} for k, c in choices.items() if c.get("active", True)]
            for group, choices in opts.items()}


def size_guide(store: PlatformStore) -> dict:
    """The size charts customers see (Men, Women, Kids), with how to measure."""
    chart = get(store, "sizing")
    active = {c["id"] for c in public_options(get(store, "price_book"))["fit"]}
    return {
        "unit": chart["unit"], "tolerance_cm": chart["tolerance_cm"], "note": chart["note"],
        "how_to_measure": [
            {"id": "chest", "name": "Chest", "text": "Lay the garment flat and measure straight across, 2 cm below the armholes."},
            {"id": "length", "name": "Length", "text": "From the highest point of the shoulder, next to the collar, down to the hem."},
            {"id": "shoulder", "name": "Shoulder", "text": "Across the back from one shoulder seam to the other."},
            {"id": "sleeve", "name": "Sleeve", "text": "From the shoulder seam to the end of the sleeve."},
            {"id": "body_chest", "name": "Your chest", "text": "Around your body at the fullest part of the chest, under the arms."},
            {"id": "height", "name": "Height (kids)", "text": "The child's height without shoes."},
        ],
        "fits": [{"id": fit, **c} for fit, c in chart["fits"].items() if fit in active],
    }
