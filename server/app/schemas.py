"""The DesignSpec is the contract between every AI provider and the renderer.

Providers (rule engine, Claude, in-house SLM) only ever produce a DesignSpec;
the deterministic renderer turns it into print-ready vector art. Keeping the
model's job this small is what makes a small in-house model viable later.
"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PATTERNS = ("stripes", "pinstripe", "chevron", "camo", "halftone", "geometric",
            "hexagon", "waves", "shards", "splatter", "topo", "gradient")
COVERAGES = ("full", "top", "bottom", "diagonal_band", "side_panels", "chest_band")
GARMENTS = ("jersey", "vneck", "shorts")
FONTS = ("block", "athletic", "modern")
COLOR_ROLES = ("primary", "secondary", "accent", "trim", "text")
SIZES = ("XS", "S", "M", "L", "XL", "XXL")          # Men's sizes before fits existed; kept for old clients
# Every size of every fit (Men XS-3XL, Women XS-XXL, Kids 4Y-14Y); engine/sizing.py has the lists and charts.
ALL_SIZES = ("XS", "S", "M", "L", "XL", "XXL", "3XL", "4Y", "6Y", "8Y", "10Y", "12Y", "14Y")
FIT_SIZES = {"men": ALL_SIZES[:7], "women": ALL_SIZES[:6], "kids": ALL_SIZES[7:]}
SPORTS = ("football", "cricket", "basketball", "rugby", "hockey", "volleyball",
          "kabaddi", "cycling", "running", "esports", "netball", "badminton")
PROVIDERS = ("auto", "rule", "claude", "slm")
# Garment options. Sleeves and collar apply to tops (jersey, vneck); a V-neck always has its V collar.
SLEEVES = ("short", "long", "none")          # none = sleeveless
COLLARS = ("crew", "polo", "mandarin")       # jersey only
FITS = ("men", "women", "kids")               # per order line: which size chart

HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

PatternType = Literal[PATTERNS]
Coverage = Literal[COVERAGES]
Garment = Literal[GARMENTS]
Sleeves = Literal[SLEEVES]
Collar = Literal[COLLARS]
Fit = Literal[FITS]
Font = Literal[FONTS]
ColorRole = Literal[COLOR_ROLES]


class Palette(BaseModel):
    model_config = ConfigDict(extra="allow")

    primary: str
    secondary: str
    accent: str
    trim: str
    text: str

    @field_validator("primary", "secondary", "accent", "trim", "text")
    @classmethod
    def _hex(cls, v: str) -> str:
        if not HEX_RE.match(v):
            raise ValueError(f"invalid hex colour {v!r}")
        return v.lower()


class PatternSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: PatternType = "stripes"
    colors: list[ColorRole] = Field(default_factory=lambda: ["secondary", "accent"], min_length=1, max_length=3)
    scale: float = Field(1.0, ge=0.4, le=2.5)
    angle: float = Field(0.0, ge=-90, le=90)
    density: float = Field(0.6, ge=0.1, le=1.0)
    opacity: float = Field(0.9, ge=0.15, le=1.0)
    coverage: Coverage = "full"


class Accents(BaseModel):
    model_config = ConfigDict(extra="allow")

    side_panels: bool = False
    shoulder_stripes: int = Field(0, ge=0, le=3)
    collar_role: ColorRole = "trim"
    cuff_role: ColorRole = "trim"


class Typography(BaseModel):
    model_config = ConfigDict(extra="allow")

    team_name: str = Field("", max_length=24)
    player_name: str = Field("", max_length=16)
    number: str = Field("", pattern=r"^\d{0,3}$")
    font: Font = "block"


# ----------------------------------------------------------------- layers
# Positions are in panel millimetres (size M pattern piece), measured from the
# piece's top-left; x/y is the layer's centre. Only front/back take layers;
# sleeves follow the garment style.

LAYER_PANELS = ("front", "back")
BINDS = ("team_name", "player_name", "number")
TEXT_LIMITS = {"team_name": 24, "player_name": 16, "number": 3, "free": 32}
MAX_LOGOS = 4
MAX_ELEMENTS = 16
MAX_LOGO_BYTES = 1_500_000
LOGO_MIME = ("image/png", "image/jpeg", "image/svg+xml")
DATA_URL_RE = re.compile(r"^data:(image/(?:png|jpeg|svg\+xml));base64,([A-Za-z0-9+/=]+)$")


class _Layer(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(..., min_length=1, max_length=40)
    panel: Literal[LAYER_PANELS] = "front"
    x: float = Field(270, ge=-200, le=900)
    y: float = Field(300, ge=-200, le=900)
    rotation: float = Field(0, ge=-180, le=180)


class TextElement(_Layer):
    type: Literal["text"] = "text"
    # A bound layer takes its text from typography, so roster rows can personalise it.
    bind: Literal[BINDS] | None = None
    text: str = Field("", max_length=32)
    size: float = Field(50, ge=8, le=320, description="font size in mm")
    max_width: float | None = Field(None, ge=10, le=520, description="squeeze text wider than this (mm)")
    font: Font | None = None
    color_role: ColorRole | None = "text"
    color: str | None = None

    @field_validator("color")
    @classmethod
    def _hexc(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        if not HEX_RE.match(v):
            raise ValueError(f"invalid hex colour {v!r}")
        return v.lower()


class LogoElement(_Layer):
    type: Literal["logo"] = "logo"
    src: str = Field(..., description="data:image/png|jpeg|svg+xml;base64,...")
    width: float = Field(80, ge=10, le=400, description="printed width in mm at size M")
    aspect: float = Field(1.0, gt=0.05, le=20, description="height / width")
    kind: Literal["raster", "vector"] = "raster"
    pixel_width: int | None = Field(None, ge=1, le=20000)
    pixel_height: int | None = Field(None, ge=1, le=20000)
    source: Literal["upload", "suggested"] = "upload"
    name: str = Field("", max_length=80)

    @field_validator("src")
    @classmethod
    def _data_url(cls, v: str) -> str:
        m = DATA_URL_RE.match(v)
        if not m:
            raise ValueError("logo src must be a base64 data URL of PNG, JPEG or SVG")
        if len(m.group(2)) * 3 // 4 > MAX_LOGO_BYTES:
            raise ValueError("logo is larger than 1.5 MB")
        return v

    @model_validator(mode="after")
    def _kind(self):
        if self.src.startswith("data:image/svg+xml"):
            self.kind = "vector"
        return self


Element = TextElement | LogoElement


class DesignSpec(BaseModel):
    # Unknown fields survive a round trip, so older/newer clients never lose data.
    model_config = ConfigDict(extra="allow")
    garment: Garment = "jersey"
    sleeves: Sleeves = "short"
    collar: Collar = "crew"
    sport: str = "football"
    style_name: str = Field("Untitled", max_length=48)
    base: Literal["solid", "gradient"] = "solid"
    palette: Palette
    pattern: PatternSpec = Field(default_factory=PatternSpec)
    accents: Accents = Field(default_factory=Accents)
    typography: Typography = Field(default_factory=Typography)
    seed: int = Field(0, ge=0, le=2**31 - 1)
    rationale: str = Field("", max_length=600)
    elements: list[Element] = Field(default_factory=list, max_length=MAX_ELEMENTS)

    @field_validator("elements", mode="before")
    @classmethod
    def _discriminate(cls, v):
        # Pick the layer class from "type" so validation errors are about the right model.
        if not isinstance(v, list):
            return v
        return [TextElement.model_validate(e) if isinstance(e, dict) and e.get("type", "text") == "text"
                else LogoElement.model_validate(e) if isinstance(e, dict) else e for e in v]

    @model_validator(mode="after")
    def _limits(self):
        if sum(1 for e in self.elements if e.type == "logo") > MAX_LOGOS:
            raise ValueError(f"a design can have at most {MAX_LOGOS} logos")
        ids = [e.id for e in self.elements]
        if len(ids) != len(set(ids)):
            raise ValueError("layer ids must be unique")
        return self


LANGUAGES = ("en", "hi", "te", "ta")
Language = Literal[LANGUAGES]


class GarmentChoice(BaseModel):
    """Options the customer picked before designing. None = decide from the brief, else the default."""
    sleeves: Sleeves | None = None
    collar: Collar | None = None


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=600)
    garment: Garment = "jersey"
    options: GarmentChoice = Field(default_factory=GarmentChoice)
    sport: str | None = None
    team_name: str = Field("", max_length=24)
    player_name: str = Field("", max_length=16)
    number: str = Field("", pattern=r"^\d{0,3}$")
    locked_colors: list[str] = Field(default_factory=list, max_length=4)
    variants: int = Field(4, ge=1, le=8)
    provider: Literal[PROVIDERS] | None = None
    seed: int | None = Field(None, ge=0, le=2**31 - 1)
    language: Language = "en"

    @field_validator("locked_colors")
    @classmethod
    def _hexes(cls, v: list[str]) -> list[str]:
        for c in v:
            if not HEX_RE.match(c):
                raise ValueError(f"invalid hex colour {c!r}")
        return [c.lower() for c in v]

    @field_validator("sport")
    @classmethod
    def _sport(cls, v: str | None) -> str | None:
        if v and v not in SPORTS:
            raise ValueError(f"sport must be one of {', '.join(SPORTS)}")
        return v or None


class UnderstandRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=600)
    garment: Garment | None = None
    sport: str | None = None
    team_name: str = Field("", max_length=24)
    player_name: str = Field("", max_length=16)
    number: str = Field("", pattern=r"^\d{0,3}$")
    locked_colors: list[str] = Field(default_factory=list, max_length=4)
    language: Language = "en"


class FeedbackRequest(BaseModel):
    rating: int | None = Field(None, ge=1, le=5)
    selected: bool | None = None
    edited_spec: DesignSpec | None = None
    comment: str = Field("", max_length=1000)
    # Current spec, so a serverless instance that never saw this design can restore it.
    spec: DesignSpec | None = None


class RenderRequest(BaseModel):
    spec: DesignSpec
    sizes: list[str] = Field(default_factory=list, max_length=20, description="\"M\" or \"fit:size\", e.g. \"kids:8Y\"")


class PanelsRequest(BaseModel):
    spec: DesignSpec
    include_elements: bool = True
    sizes: list[str] = Field(default_factory=list, max_length=20, description="\"M\" or \"fit:size\", e.g. \"kids:8Y\"")


class RefineRequest(BaseModel):
    spec: DesignSpec
    instruction: str = Field(..., min_length=1, max_length=300)
    language: Language = "en"


class FromImageRequest(BaseModel):
    image: str = Field(..., max_length=8_200_000, description="data:image/png|jpeg;base64,... up to 6 MB")
    garment: Garment = "jersey"
    options: GarmentChoice = Field(default_factory=GarmentChoice)
    sport: str | None = None
    team_name: str = Field("", max_length=24)
    player_name: str = Field("", max_length=16)
    number: str = Field("", pattern=r"^\d{0,3}$")
    language: Language = "en"

    @field_validator("sport")
    @classmethod
    def _sport(cls, v: str | None) -> str | None:
        return v if v in SPORTS else None


class LogoSuggestRequest(BaseModel):
    team_name: str = Field("", max_length=24)
    sport: str | None = None
    prompt: str = Field("", max_length=600)
    palette: Palette | None = None
    offset: int = Field(0, ge=0, le=56)
    limit: int = Field(8, ge=1, le=8)


class PrintRequest(BaseModel):
    spec: DesignSpec
    design_id: str = Field("", max_length=40)
    size: Literal[ALL_SIZES] = "M"
    fit: Fit = "men"
    mirror: bool = False
    roll_width: float = Field(1600, ge=600, le=3200)


class Check(BaseModel):
    id: str
    level: Literal["pass", "info", "warn", "fail"]
    message: str
    element_id: str | None = None


# ----------------------------------------------------------------- orders

def check_fit_size(fit: str, size: str) -> None:
    if size not in FIT_SIZES[fit]:
        raise ValueError(f"{size} is not a {fit} size; {fit} sizes are {', '.join(FIT_SIZES[fit])}")


class OrderItem(BaseModel):
    player_name: str = Field("", max_length=16)
    number: str = Field("", pattern=r"^\d{0,3}$")
    fit: Fit = "men"
    size: Literal[ALL_SIZES]
    quantity: int = Field(..., ge=1, le=500)

    @model_validator(mode="after")
    def _fit_size(self):
        check_fit_size(self.fit, self.size)
        return self


class Customer(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    phone: str = Field(..., min_length=6, max_length=24, pattern=r"^\+?[0-9 ()-]{6,24}$")
    email: str = Field("", max_length=120, pattern=r"^$|^[^@\s]+@[^@\s]+\.[^@\s]+$")


class Address(BaseModel):
    name: str = Field("", max_length=80)
    phone: str = Field("", max_length=24)
    line1: str = Field(..., min_length=3, max_length=160)
    line2: str = Field("", max_length=160)
    city: str = Field(..., min_length=2, max_length=60)
    state: str = Field(..., min_length=2, max_length=4, description="state code, e.g. TN")
    pincode: str = Field(..., pattern=r"^\d{6}$")


class OrderDelivery(BaseModel):
    method: Literal["ship", "pickup"] = "ship"
    address: Address | None = None

    @model_validator(mode="after")
    def _addr(self):
        if self.method == "ship" and self.address is None:
            raise ValueError("a delivery address is needed")
        return self


class OrderRequest(BaseModel):
    design_id: str = Field("", max_length=40)
    spec: DesignSpec
    items: list[OrderItem] = Field(..., min_length=1, max_length=200)
    customer: Customer
    language: Language = "en"
    idempotency_key: str = Field(..., min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    # Commerce options. Older app versions send none of these: standard fabric, no address yet.
    fabric: str = Field("standard", max_length=30)
    delivery: OrderDelivery | None = None
    rush: bool = False
    coupon: str = Field("", max_length=24)
    collection_id: str = Field("", max_length=40)
    channel: Literal["app", "web", "sales"] = "app"
    # Marketplace options: the seller (empty = the recommended one for the PIN code) and how to pay.
    seller_id: str = Field("", max_length=40)
    payment_method: Literal["online", "cod"] = "online"

    @model_validator(mode="after")
    def _total(self):
        if sum(i.quantity for i in self.items) > 5000:
            raise ValueError("an order can contain at most 5000 pieces")
        return self


class PaymentConfirmation(BaseModel):
    demo: bool = True
    reference: str = Field("", max_length=80)
