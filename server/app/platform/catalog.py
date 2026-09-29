"""Ready-made products, search with facets, reviews and wishlists.

A product is a finished design (kind "product") customers can buy as it is or open in
the designer to customise. The operations app creates them from a spec, a brief, a
past order or a sales quote, then publishes and features them. About a dozen are
seeded on first start from the rule-based design engine, so the store is never empty.

Reviews come only from delivered orders (verified purchase), one per order, and count
toward both the product's and the seller's rating. Operations can hide a review.
"""
from __future__ import annotations

import math
import re

from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from ..engine.color import to_lab
from ..schemas import GARMENTS, SPORTS, DesignSpec, Garment, GenerateRequest, Palette
from . import config, sellers
from .db import PlatformStore, new_id, now

SORTS = ("popular", "new", "price_asc", "price_desc", "rating")
PAGE_SIZE = 24

# Colour families for the colour filter: each design is tagged with the families nearest
# to its primary and secondary colours.
COLOUR_FAMILIES = {
    "black": "#111111", "white": "#f5f5f5", "grey": "#8a8d91", "silver": "#b8bcc2", "red": "#d62828",
    "maroon": "#6d1a2a", "orange": "#f07c1b", "yellow": "#f5c518", "gold": "#c9a227", "green": "#2a9d4b",
    "lime": "#9bd62a", "teal": "#0e7c7b", "sky blue": "#5bb8ea", "blue": "#1f5fbf", "navy": "#14213d",
    "purple": "#6a2c91", "pink": "#ef6fa7", "brown": "#6b4226",
}


def colour_family(hex_colour: str) -> str:
    lab = to_lab(hex_colour)
    return min(COLOUR_FAMILIES, key=lambda k: math.dist(lab, to_lab(COLOUR_FAMILIES[k])))


def colours_of(spec: dict, colourways: list[dict] | None = None) -> list[str]:
    """Colour families for search and filters, from the product's palette and every colourway."""
    pals = [spec.get("palette") or {}] + [c["palette"] for c in colourways or []]
    return list(dict.fromkeys(colour_family(pal[r]) for pal in pals for r in ("primary", "secondary") if pal.get(r)))


def colourway_list(p: dict) -> list[dict]:
    """The colour choices customers see; "original" is the product's own palette."""
    return [{"id": "original", "name": "Original", "palette": (p.get("spec") or {}).get("palette")}] + \
        [dict(c) for c in p.get("colourways") or []]


def apply_choice(p: dict, colourway: str = "", sleeves: str | None = None, collar: str | None = None) -> dict:
    """The product's spec with a colourway and garment options applied (raises 422 for an unknown colourway)."""
    spec = dict(p["spec"])
    if colourway and colourway != "original":
        cw = next((c for c in p.get("colourways") or [] if c["id"] == colourway), None)
        if cw is None:
            raise HTTPException(422, f"This product has no colourway {colourway!r}.")
        spec["palette"] = {**spec.get("palette", {}), **cw["palette"]}
    if sleeves and spec.get("garment") != "shorts":
        spec["sleeves"] = sleeves
    if collar and spec.get("garment") == "jersey":
        spec["collar"] = collar
    return spec


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "design"


# ----------------------------------------------------------------- inputs

class Brief(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=600)
    sport: str | None = None
    garment: Garment = "jersey"
    team_name: str = Field("", max_length=24)
    seed: int | None = Field(None, ge=0, le=2**31 - 1)


class Colourway(BaseModel):
    """Another colour choice for a product: the same design with a different palette."""
    id: str = Field(..., pattern=r"^[a-z0-9][a-z0-9-]{1,30}$")
    name: str = Field(..., min_length=1, max_length=40)
    palette: Palette

    @model_validator(mode="after")
    def _not_original(self):
        if self.id == "original":
            raise ValueError('"original" is the product\'s own colours; choose another id')
        return self


def _unique_ids(v: list[Colourway] | None) -> list[Colourway] | None:
    if v and len({c.id for c in v}) != len(v):
        raise ValueError("colourway ids must be unique")
    return v


class ProductIn(BaseModel):
    """Exactly one source: a spec, a brief to design from, a past order, or a sales quote."""
    title: str = Field(..., min_length=2, max_length=80)
    slug: str = Field("", pattern=r"^$|^[a-z0-9][a-z0-9-]{1,60}$")
    description: str = Field("", max_length=2000)
    sport: str | None = None
    tags: list[str] = Field(default_factory=list, max_length=20)
    fabric: str = Field("standard", max_length=30)
    featured: bool = False
    status: str = Field("draft", pattern="^(draft|published)$")
    spec: DesignSpec | None = None
    brief: Brief | None = None
    order_id: str = Field("", max_length=40)
    quote_id: str = Field("", max_length=40)
    colourways: list[Colourway] = Field(default_factory=list, max_length=8)

    @field_validator("colourways")
    @classmethod
    def _cw(cls, v):
        return _unique_ids(v)

    @model_validator(mode="after")
    def _one_source(self):
        n = sum(bool(x) for x in (self.spec, self.brief, self.order_id, self.quote_id))
        if n != 1:
            raise ValueError("give exactly one of spec, brief, order_id or quote_id")
        if self.sport and self.sport not in SPORTS:
            raise ValueError(f"sport must be one of {', '.join(SPORTS)}")
        return self


class ProductPatch(BaseModel):
    title: str | None = Field(None, min_length=2, max_length=80)
    description: str | None = Field(None, max_length=2000)
    sport: str | None = None
    tags: list[str] | None = Field(None, max_length=20)
    fabric: str | None = Field(None, max_length=30)
    featured: bool | None = None
    status: str | None = Field(None, pattern="^(draft|published)$")
    spec: DesignSpec | None = None
    colourways: list[Colourway] | None = Field(None, max_length=8)

    @field_validator("colourways")
    @classmethod
    def _cw(cls, v):
        return _unique_ids(v)


class ReviewIn(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    title: str = Field("", max_length=120)
    body: str = Field("", max_length=4000)


# ----------------------------------------------------------------- products

def _save(store: PlatformStore, p: dict) -> dict:
    return store.put("product", p["id"], p, status=p["status"], ref=p["slug"],
                     search=" ".join([p["title"], p["sport"], p["garment"], *p.get("colours", []), *p.get("tags", [])]))


def _unique_slug(store: PlatformStore, base: str, own_id: str | None = None) -> str:
    slug, n = base, 1
    while True:
        hit, _ = store.find("product", ref=slug, limit=1)
        if not hit or hit[0]["id"] == own_id:
            return slug
        n += 1
        slug = f"{base}-{n}"


def _spec_from(store: PlatformStore, body: ProductIn) -> tuple[dict, dict]:
    if body.spec:
        return body.spec.model_dump(), {"kind": "spec"}
    if body.brief:
        from .. import service
        b = body.brief
        out = service.generate(store, GenerateRequest(prompt=b.prompt, sport=b.sport, garment=b.garment,
                                                      team_name=b.team_name, variants=1, seed=b.seed))
        return out["designs"][0]["spec"], {"kind": "brief", "ref": out["designs"][0]["id"]}
    if body.order_id:
        o = store.get_order(body.order_id)
        if not o:
            raise HTTPException(404, "order not found")
        return _plain(o["spec"]), {"kind": "order", "ref": o["id"]}
    q = store.get("quote", body.quote_id)
    if not q:
        raise HTTPException(404, "quote not found")
    return _plain(q["spec"]), {"kind": "quote", "ref": q["id"]}


def _plain(spec: dict) -> dict:
    """A product is sold to many teams: drop one customer's player name and number."""
    spec = {**spec, "typography": {**spec.get("typography", {}), "player_name": "", "number": ""}}
    return spec


def create_product(store: PlatformStore, body: ProductIn, actor: str) -> dict:
    spec, source = _spec_from(store, body)
    _check_fabric(store, body.fabric, spec["garment"])
    p = {"id": new_id("prd"), "slug": _unique_slug(store, body.slug or slugify(body.title)), "title": body.title,
         "description": body.description, "sport": body.sport or spec.get("sport") or "football",
         "garment": spec["garment"], "spec": spec, "tags": body.tags, "fabric": body.fabric,
         "colourways": [c.model_dump() for c in body.colourways],
         "colours": colours_of(spec, [c.model_dump() for c in body.colourways]),
         "featured": body.featured, "status": body.status, "orders_count": 0,
         "rating": {"average": None, "count": 0}, "source": source,
         "published_at": now() if body.status == "published" else None}
    out = _save(store, p)
    store.audit(actor, "product.create", f"product:{p['id']}", {"source": source["kind"]})
    return out


def _check_fabric(store: PlatformStore, fabric: str, garment: str) -> None:
    fab = next((f for f in config.get(store, "price_book")["fabrics"] if f["id"] == fabric), None)
    if not fab or garment not in fab["garments"]:
        raise HTTPException(422, f"Fabric {fabric!r} is not available for {garment}.")


def update_product(store: PlatformStore, pid: str, body: ProductPatch, actor: str) -> dict:
    p = get_product(store, pid)
    patch = body.model_dump(exclude_none=True)
    if "sport" in patch and patch["sport"] not in SPORTS:
        raise HTTPException(422, f"sport must be one of {', '.join(SPORTS)}")
    if "spec" in patch:
        patch["garment"] = patch["spec"]["garment"]
    p.update(patch)
    p["colours"] = colours_of(p["spec"], p.get("colourways"))
    _check_fabric(store, p["fabric"], p["garment"])
    if patch.get("status") == "published" and not p.get("published_at"):
        p["published_at"] = now()
    store.audit(actor, "product.update", f"product:{pid}", {k: v for k, v in patch.items() if k != "spec"})
    return _save(store, p)


def get_product(store: PlatformStore, pid: str) -> dict:
    p = store.get("product", pid)
    if not p:
        raise HTTPException(404, "product not found")
    return p


def by_slug(store: PlatformStore, slug: str, published_only: bool = True) -> dict:
    rows, _ = store.find("product", ref=slug, limit=1)
    p = rows[0] if rows else store.get("product", slug)
    if not p or (published_only and p["status"] != "published"):
        raise HTTPException(404, "product not found")
    return p


def price_from(store: PlatformStore, p: dict, pb: dict | None = None, active: list[dict] | None = None) -> float | None:
    """The lowest one-piece price any active seller offers for this design's garment and fabric."""
    pb = pb or config.get(store, "price_book")
    active = active if active is not None else sellers.active(store)
    prices = [sellers.unit_price(pb, s, p["garment"], p.get("fabric"), 1) for s in active
              if p["garment"] in s.get("garments", GARMENTS) and (not s.get("fabrics") or p.get("fabric") in s["fabrics"])]
    return min(prices) if prices else None


def public_product(p: dict, price: float | None, currency: str, detail: bool = False) -> dict:
    out = {k: p.get(k) for k in ("id", "slug", "title", "description", "sport", "garment", "colours", "tags", "fabric",
                                 "featured", "rating", "orders_count", "published_at")}
    out.update(price_from=price, currency=currency, image_url=f"/api/v1/shop/products/{p['slug']}/mockup.svg",
               style_name=(p.get("spec") or {}).get("style_name"))
    out["colourways"] = [{"id": c["id"], "name": c["name"], "swatch": [(c["palette"] or {}).get("primary"),
                                                                     (c["palette"] or {}).get("secondary")]}
                         for c in colourway_list(p)]
    if detail:
        out["spec"] = p["spec"]
        out["colourways"] = colourway_list(p)
    return out


def search(store: PlatformStore, q: str = "", sport: str = "", garment: str = "", colour: str = "",
           min_price: float | None = None, max_price: float | None = None, sort: str = "popular", page: int = 1,
           size: int = PAGE_SIZE, featured: bool | None = None) -> dict:
    rows, _ = store.find("product", status="published", limit=10_000)
    pb = config.get(store, "price_book")
    active = sellers.active(store)
    items = [(p, price_from(store, p, pb, active)) for p in rows]
    words = [w for w in re.split(r"\s+", q.lower().strip()) if w]

    def text_ok(p: dict) -> bool:
        hay = " ".join([p["title"], p.get("description", ""), p["sport"], p["garment"], *p.get("colours", []),
                        *p.get("tags", []), (p.get("spec") or {}).get("style_name", "")]).lower()
        return all(w in hay for w in words)

    def keep(pair, skip: str = "") -> bool:
        p, price = pair
        return (text_ok(p)
                and (skip == "sport" or not sport or p["sport"] == sport)
                and (skip == "garment" or not garment or p["garment"] == garment)
                and (skip == "colour" or not colour or colour in p.get("colours", []))
                and (min_price is None or (price is not None and price >= min_price))
                and (max_price is None or (price is not None and price <= max_price))
                and (featured is None or bool(p.get("featured")) == featured))

    def facet(key: str) -> list[dict]:
        counts: dict[str, int] = {}
        for pair in items:
            if keep(pair, skip=key):
                vals = pair[0].get("colours", []) if key == "colour" else [pair[0][key]]
                for v in vals:
                    counts[v] = counts.get(v, 0) + 1
        return [{"value": k, "count": n} for k, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]

    hits = [pair for pair in items if keep(pair)]
    keys = {
        "popular": lambda x: (-x[0].get("orders_count", 0), -int(bool(x[0].get("featured"))),
                              -((x[0].get("rating") or {}).get("count") or 0), x[0]["created_at"]),
        "new": lambda x: (x[0].get("published_at") or x[0]["created_at"]),
        "price_asc": lambda x: (x[1] if x[1] is not None else 1e12, x[0]["title"]),
        "price_desc": lambda x: (-(x[1] or 0), x[0]["title"]),
        "rating": lambda x: (-((x[0].get("rating") or {}).get("average") or 0),
                             -((x[0].get("rating") or {}).get("count") or 0), x[0]["title"]),
    }
    hits.sort(key=keys[sort], reverse=sort == "new")
    total = len(hits)
    page_rows = hits[(page - 1) * size: page * size]
    prices = [x[1] for x in items if x[1] is not None]
    return {"items": [public_product(p, price, pb["currency"]) for p, price in page_rows],
            "total": total, "page": page, "pages": max(1, -(-total // size)), "sort": sort,
            "facets": {"sport": facet("sport"), "garment": facet("garment"), "colour": facet("colour"),
                       "price": {"min": min(prices) if prices else None, "max": max(prices) if prices else None}}}


def product_detail(store: PlatformStore, slug: str) -> dict:
    p = by_slug(store, slug)
    pb = config.get(store, "price_book")
    out = public_product(p, price_from(store, p, pb), pb["currency"], detail=True)
    rows, total = store.find("review", parent=p["id"], status="visible", order="created_at DESC", limit=10_000)
    dist = {str(n): sum(1 for r in rows if r["rating"] == n) for n in range(5, 0, -1)}
    out["review_summary"] = {"average": (p.get("rating") or {}).get("average"), "count": total, "distribution": dist}
    out["reviews"] = [public_review(r) for r in rows[:10]]
    out["fabrics"] = [{"id": f["id"], "name": f["name"], "surcharge": f["surcharge"]} for f in pb["fabrics"]
                      if p["garment"] in f["garments"]]
    return out


# ----------------------------------------------------------------- seeding

SEED = [
    ("Royal Strikers", "football", "jersey", "royal blue and white football jersey with chevrons"),
    ("Crimson Kings", "cricket", "jersey", "crimson and gold cricket jersey"),
    ("Court Blaze", "basketball", "vneck", "orange and black basketball jersey"),
    ("Scrum Force", "rugby", "jersey", "green and white rugby jersey with stripes"),
    ("Ice Hawks", "hockey", "vneck", "navy and silver hockey jersey"),
    ("Spike Squad", "volleyball", "vneck", "teal and yellow volleyball jersey"),
    ("Raid Masters", "kabaddi", "jersey", "saffron and maroon kabaddi jersey"),
    ("Road Rush", "cycling", "jersey", "neon green and black cycling jersey"),
    ("Pace Setters", "running", "vneck", "sky blue running top with waves"),
    ("Pixel Legion", "esports", "jersey", "purple and black geometric esports jersey"),
    ("Match Point", "badminton", "shorts", "white and navy badminton shorts"),
    ("Goal Line", "football", "shorts", "black football shorts with red stripes"),
]


def _seed_colourways(spec: dict, i: int) -> list[dict]:
    """Two other curated palettes for a seeded product, so every starter product has colour choices."""
    from ..engine.vocab import PALETTES
    own = (spec.get("palette") or {}).get("primary")
    picks = [pal for pal in PALETTES if pal[1] != own]
    out = []
    for name, primary, secondary, accent, trim, text, _ in (picks[(i * 3) % len(picks)], picks[(i * 3 + 7) % len(picks)]):
        out.append({"id": slugify(name), "name": name, "palette": {"primary": primary, "secondary": secondary,
                                                                    "accent": accent, "trim": trim, "text": text}})
    return out


def seed_products(store: PlatformStore) -> int:
    """First start only (a marker record stops it re-running after staff delete products).
    Uses the rule engine with fixed seeds, so every install gets the same, fast result."""
    if store.get("meta", "catalog_seeded"):
        return 0
    from ..providers import PROVIDERS
    made = 0
    for i, (title, sport, garment, prompt) in enumerate(SEED):
        req = GenerateRequest(prompt=prompt, sport=sport, garment=garment, team_name=title, variants=1)
        spec = PROVIDERS["rule"].generate(req, 1, 7001 + i)[0].model_dump()
        colourways = _seed_colourways(spec, i)
        p = {"id": f"prd_seed{i + 1:02d}", "slug": slugify(title), "title": title,
             "description": f"{spec.get('style_name', title)}: a ready-made {sport} "
                            f"{'shorts' if garment == 'shorts' else 'jersey'} design. Order it as it is or change "
                            "the colours, names and numbers in the designer.",
             "sport": sport, "garment": garment, "spec": spec, "tags": [sport, garment],
             "colourways": colourways, "colours": colours_of(spec, colourways),
             "fabric": "standard", "featured": i < 4, "status": "published", "orders_count": 0,
             "rating": {"average": None, "count": 0}, "source": {"kind": "seed"}, "published_at": now()}
        _save(store, p)
        made += 1
    store.put("meta", "catalog_seeded", {"at": now(), "count": made})
    return made


# ----------------------------------------------------------------- reviews

def _short_name(name: str) -> str:
    parts = (name or "").split()
    if not parts:
        return "Customer"
    return parts[0] + (f" {parts[-1][0]}." if len(parts) > 1 else "")


def public_review(r: dict) -> dict:
    return {k: r.get(k) for k in ("id", "rating", "title", "body", "customer_name", "created_at", "verified_purchase",
                                  "garment", "seller_name")}


def add_review(store: PlatformStore, order: dict, customer: dict, body: ReviewIn) -> dict:
    if (order.get("fulfilment") or {}).get("status") != "delivered":
        raise HTTPException(409, "You can review an order once it is delivered.")
    if order.get("review"):
        raise HTTPException(409, "You have already reviewed this order.")
    from .security import seller_id_of
    seller_id = seller_id_of(order)
    rid = new_id("rev")
    r = {"id": rid, "order_id": order["id"], "product_id": order.get("product_id") or "", "seller_id": seller_id,
         "seller_name": (order.get("seller") or {}).get("name"), "customer_id": customer["id"],
         "customer_name": _short_name(customer.get("name") or order["customer"]["name"]), "rating": body.rating,
         "title": body.title.strip(), "body": body.body.strip(), "verified_purchase": True, "hidden": False,
         "garment": order.get("garment")}
    r = store.put("review", rid, r, status="visible", parent=r["product_id"], owner=seller_id, ref=order["id"],
                  search=f"{r['title']} {r['body']} {r['customer_name']}")
    order["review"] = {"id": rid, "rating": body.rating, "title": r["title"], "body": r["body"],
                       "created_at": r["created_at"], "hidden": False}
    _refresh(store, r)
    return r


def set_review_hidden(store: PlatformStore, rid: str, hidden: bool, reason: str, actor: str) -> dict:
    r = store.get("review", rid)
    if not r:
        raise HTTPException(404, "review not found")
    r["hidden"], r["hidden_reason"] = hidden, reason if hidden else ""
    r = store.put("review", rid, r, status="hidden" if hidden else "visible", parent=r["product_id"],
                  owner=r["seller_id"], ref=r["order_id"], search=f"{r['title']} {r['body']} {r['customer_name']}")
    order = store.get_order(r["order_id"])
    if order and order.get("review"):
        order["review"]["hidden"] = hidden
        store.save_order(order)
    store.audit(actor, "review.hide" if hidden else "review.show", f"review:{rid}", {"reason": reason})
    _refresh(store, r)
    return r


def _refresh(store: PlatformStore, r: dict) -> None:
    sellers.refresh_rating(store, r["seller_id"])
    if r.get("product_id"):
        p = store.get("product", r["product_id"])
        if p:
            rows, _ = store.find("review", parent=p["id"], status="visible", limit=100_000)
            p["rating"] = {"average": round(sum(x["rating"] for x in rows) / len(rows), 2) if rows else None,
                           "count": len(rows)}
            _save(store, p)


def count_order(store: PlatformStore, product_id: str | None) -> None:
    """A paid order of a product makes it more popular."""
    p = store.get("product", product_id) if product_id else None
    if p:
        p["orders_count"] = p.get("orders_count", 0) + 1
        _save(store, p)


# ----------------------------------------------------------------- wishlist

def wishlist_ids(store: PlatformStore, customer_id: str) -> list[str]:
    return (store.get("wishlist", customer_id) or {}).get("product_ids", [])


def set_wishlist(store: PlatformStore, customer_id: str, ids: list[str]) -> list[str]:
    store.put("wishlist", customer_id, {"customer_id": customer_id, "product_ids": ids[:200]}, parent=customer_id)
    return ids[:200]
