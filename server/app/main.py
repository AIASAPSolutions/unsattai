"""UrJersey API: the design engine behind the UrJersey mobile app.

JSON over HTTP under /api/v1, optionally protected by X-API-Key. The mobile app
is the only client; there is no web UI here.
"""
from __future__ import annotations

import json
import logging

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field

from . import ai_edit, from_image, logos, orders, service
from .background import remove_background
from .config import env_int, env_str, settings
from .engine.garments import GARMENT_PANELS
from .engine.i18n import LANGUAGE_NAMES
from .engine.renderer import render_print_sheet
from .engine.vocab import NAMED_COLORS, PALETTES
from .providers import PROVIDERS
from .providers.base import SLM_SYSTEM_PROMPT, build_user_message, creative_part
from .refine import refine as refine_spec
from .schemas import (COLOR_ROLES, COVERAGES, FONTS, GARMENTS, LOGO_MIME, MAX_LOGO_BYTES, MAX_LOGOS, PATTERNS, SIZES,
                      SPORTS, TEXT_LIMITS, DesignSpec, FeedbackRequest, FromImageRequest, GenerateRequest, LogoSuggestRequest,
                      OrderRequest, PanelsRequest, PaymentConfirmation, PrintRequest, RefineRequest, RenderRequest,
                      UnderstandRequest)
from .platform import notify
from .platform import api_market, api_ops, api_ops_market, api_shop, catalog, lifecycle, pricing, security, sellers
from .platform.config import ConfigInvalid
from .platform.db import PlatformStore
from .understand import understand as understand_brief

logging.basicConfig(level=env_str("LOG_LEVEL", "INFO").upper())

VERSION = "1.0.0"
MAX_BODY_BYTES = env_int("MAX_UPLOAD_MB", 12) * 1_000_000   # four 1.5 MB logos as base64 plus the spec

app = FastAPI(title="UrJersey API", version=VERSION)
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["*"],
                   allow_headers=["*"])
store = PlatformStore(settings.db_path)
security.bind(store)
security.bootstrap_admin(store)
sellers.ensure_house(store)
catalog.seed_products(store)
for _problem in notify.check_config():
    logging.getLogger("urjersey").warning("Messaging settings: %s", _problem)
if security.otp_echo():
    logging.getLogger("urjersey").warning("OTP_DEV_ECHO is on: sign-in codes are returned by the API. "
                                          "Set APP_ENV=production on a real server.")


@app.middleware("http")
async def limit_body(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
        return JSONResponse({"detail": f"Request is larger than {MAX_BODY_BYTES // 1_000_000} MB."}, status_code=413)
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    # Same shape as FastAPI's default, minus echoed input (it can hold multi-MB logo data URLs).
    errors = [{k: v for k, v in e.items() if k in ("loc", "msg", "type")} for e in exc.errors()]
    return JSONResponse({"detail": errors}, status_code=422)


@app.exception_handler(orders.OrderError)
async def order_error(_: Request, exc: orders.OrderError):
    return JSONResponse({"detail": {"message": exc.message, **exc.extra}}, status_code=exc.status)


def require_key(x_api_key: str | None = Header(default=None)) -> None:
    if settings.api_keys and x_api_key not in settings.api_keys:
        raise HTTPException(401, "invalid or missing X-API-Key")


def _design_or_404(design_id: str) -> dict:
    row = store.get_design(design_id)
    if not row:
        raise HTTPException(404, "design not found")
    return row


SVG = "image/svg+xml"
KEY = [Depends(require_key)]


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "app": "UrJersey API", "version": VERSION, "default_provider": settings.provider,
            "providers": {name: p.available() for name, p in PROVIDERS.items()},
            "factory_connected": bool(settings.factory_url), "auth_required": bool(settings.api_keys),
            "ai_edits": ai_edit.provider(), "messaging": notify.status()}


@app.get("/api/v1/meta")
def meta():
    return {
        "patterns": PATTERNS, "coverages": COVERAGES, "garments": GARMENTS, "fonts": FONTS, "sizes": SIZES,
        "sports": SPORTS, "color_roles": COLOR_ROLES,
        "colors": [{"name": n, "hex": h} for n, h in NAMED_COLORS.items()],
        "palettes": [{"name": p[0], "palette": dict(zip(COLOR_ROLES, p[1:6])), "tags": sorted(p[6])} for p in PALETTES],
        "languages": [{"code": c, "name": n, "native": nat} for c, (n, nat) in LANGUAGE_NAMES.items()],
        "limits": {"prompt": 600, "variants": [1, 8], "locked_colors": 4, "text": TEXT_LIMITS, "logos": MAX_LOGOS,
                   "logo_bytes": MAX_LOGO_BYTES, "logo_types": LOGO_MIME, "quantity": [1, 500], "order_rows": 200,
                   "undo": 60},
        "panels": {g: [p.name for p in ps] for g, ps in GARMENT_PANELS.items()},
    }


@app.post("/api/v1/brief/understand", dependencies=KEY)
def understand(req: UnderstandRequest):
    return understand_brief(req)


@app.post("/api/v1/designs/generate", dependencies=KEY)
def generate(req: GenerateRequest):
    return service.generate(store, req)


@app.post("/api/v1/render", dependencies=KEY)
def render(req: RenderRequest):
    """Stateless re-render for live editing."""
    return service.render_preview(req.spec, sizes=req.sizes)


@app.post("/api/v1/render/panels", dependencies=KEY)
def render_panels(req: PanelsRequest):
    """Flat art per pattern piece (mm units) plus safe zones, for the 2D editor and 3D textures."""
    return service.render_panels(req.spec, include_elements=req.include_elements, sizes=req.sizes)


def device_of(request: Request, x_device_id: str | None = Header(default=None)) -> str:
    return ai_edit.device_key(x_device_id, request.client.host if request.client else None)


@app.exception_handler(ai_edit.QuotaExceeded)
async def ai_quota(_: Request, exc: ai_edit.QuotaExceeded):
    headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
    return JSONResponse({"detail": {"message": exc.message, "code": exc.code, "ai": exc.status}},
                        status_code=429, headers=headers)


@app.get("/api/v1/ai/allowance", dependencies=KEY)
def ai_allowance(device: str = Depends(device_of)):
    return ai_edit.allowance(store, device)


@app.post("/api/v1/designs/refine", dependencies=KEY)
def refine(req: RefineRequest, device: str = Depends(device_of)):
    out = refine_spec(req)
    if out["understood"]:
        out = {**out, "source": "rules", "ai": {**ai_edit.allowance(store, device), "cached": False}}
    else:
        out = ai_edit.refine_with_ai(store, req, out, device)
    spec = DesignSpec.model_validate(out["spec"])
    return {**out, **service.render_preview(spec)}


@app.post("/api/v1/designs/from-image", dependencies=KEY)
def design_from_image(req: FromImageRequest, device: str = Depends(device_of)):
    """Recognise a picture designed elsewhere and rebuild it as editable, printable designs."""
    try:
        return from_image.from_image(store, req, device)
    except from_image.ImageRejected as e:
        raise HTTPException(422, str(e)) from e


@app.post("/api/v1/logos/suggest", dependencies=KEY)
def suggest_logos(req: LogoSuggestRequest):
    return logos.suggest(req)


class BackgroundRequest(BaseModel):
    data_url: str = Field(..., max_length=2_100_000)
    tolerance: int = Field(24, ge=0, le=80)


@app.post("/api/v1/logos/remove-background", dependencies=KEY)
def logo_remove_background(req: BackgroundRequest):
    """Optional plain-background removal for raster logo uploads; the original is never discarded."""
    try:
        return remove_background(req.data_url, req.tolerance)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@app.get("/api/v1/designs/{design_id}", dependencies=KEY)
def get_design(design_id: str):
    row = _design_or_404(design_id)
    spec = DesignSpec.model_validate_json(row["spec_json"])
    return {"id": row["id"], "generation_id": row["generation_id"], "provider": row["provider"],
            "rating": row["rating"], "selected": bool(row["selected"]), "edited": bool(row["edited"]),
            "spec": spec.model_dump(), **service.render_preview(spec, design_id)}


@app.get("/api/v1/designs/{design_id}/mockup.svg", dependencies=KEY)
def mockup_svg(design_id: str):
    spec = DesignSpec.model_validate_json(_design_or_404(design_id)["spec_json"])
    return Response(service.render_preview(spec, design_id)["mockup_svg"], media_type=SVG)


@app.get("/api/v1/designs/{design_id}/print.svg", dependencies=KEY)
def print_svg(design_id: str, size: str = Query("M", pattern="^(XS|S|M|L|XL|XXL)$"), mirror: bool = False,
              roll_width: float = Query(1600, ge=600, le=3200), download: bool = False):
    spec = DesignSpec.model_validate_json(_design_or_404(design_id)["spec_json"])
    try:
        svg, _ = render_print_sheet(spec, size=size, mirror=mirror, roll_width=roll_width, design_id=design_id)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    headers = {"Content-Disposition": f'attachment; filename="{design_id}_{size}{"_mirrored" if mirror else ""}.svg"'} \
        if download else {}
    return Response(svg, media_type=SVG, headers=headers)


@app.post("/api/v1/print", dependencies=KEY)
def print_from_spec(req: PrintRequest):
    """Stateless print sheet from a spec, so exports never depend on server storage."""
    try:
        svg, _ = render_print_sheet(req.spec, size=req.size, mirror=req.mirror, roll_width=req.roll_width,
                                    design_id=req.design_id)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return Response(svg, media_type=SVG)


@app.post("/api/v1/designs/{design_id}/feedback", dependencies=KEY)
def feedback(design_id: str, fb: FeedbackRequest):
    if not store.get_design(design_id):
        if fb.spec is None:
            raise HTTPException(404, "design not found")
        store.restore_design(design_id, fb.spec)
    store.update_feedback(design_id, fb.rating, fb.selected, fb.edited_spec, fb.comment)
    return {"ok": True}


# ----------------------------------------------------------------- orders

def order_seller(req: OrderRequest, quote: dict | None = None) -> tuple[dict, dict]:
    """The seller and service area for an order; 422 when nobody (or the chosen seller) can serve it."""
    d = req.delivery
    pincode = d.address.pincode if d and d.address else ""
    state = d.address.state if d and d.address else ""
    wanted = req.seller_id or (((quote or {}).get("pricing") or {}).get("seller") or {}).get("id") or ""
    seller, area, why = sellers.choose(store, wanted, pincode, state, req.spec.garment, req.fabric,
                                       sum(i.quantity for i in req.items), req.rush, pickup=bool(d and d.method == "pickup"))
    if why:
        raise HTTPException(422, {"message": sellers.problem_text(why), "code": why})
    return seller, area


def _cod_problem(req: OrderRequest, seller: dict) -> str | None:
    d = req.delivery
    q = pricing.quote(store, pricing.QuoteRequest(
        garment=req.spec.garment, fabric=req.fabric, rush=req.rush, coupon=req.coupon, seller_id=seller["id"],
        payment_method="cod", logos=min(4, sum(1 for e in req.spec.elements if e.type == "logo")),
        lines=[pricing.PriceLine(size=i.size, quantity=i.quantity, player_name=i.player_name, number=i.number)
               for i in req.items],
        delivery=pricing.DeliveryChoice(method=d.method if d else "ship",
                                        pincode=d.address.pincode if d and d.address else "",
                                        state=d.address.state if d and d.address else "")))
    return None if q["cod"]["available"] else next((p for p in q["problems"] if "ash on delivery" in p),
                                                    "Cash on delivery is not available.")


def place_order(req: OrderRequest, customer: dict | None = None, quote: dict | None = None,
                extra: dict | None = None) -> tuple[dict, bool]:
    """Create (or return the existing) order, then price it, link the customer and promise dates.

    extra: checkout details (checkout id, product id, this item's share of a cart coupon)."""
    if req.collection_id and customer is None:
        raise HTTPException(401, "Sign in to order a team collection.")
    existing = store.order_by_key(req.idempotency_key)
    if existing is None or not existing.get("pricing"):
        seller, area = order_seller(req, quote)
        if req.payment_method == "cod":
            problem = _cod_problem(req, seller)
            if problem:
                raise HTTPException(422, {"message": problem, "code": "cod_unavailable"})
    try:
        order, created = orders.create(store, req)
    except KeyError as e:
        raise HTTPException(409, "This idempotency key was already used for a different order.") from e
    if not order.get("pricing"):
        d = req.delivery
        extras = {"fabric": req.fabric, "rush": req.rush, "coupon": req.coupon, "collection_id": req.collection_id,
                  "address": d.address.model_dump() if d and d.address else None,
                  "delivery_choice": {"method": d.method if d else "ship",
                                      "pincode": d.address.pincode if d and d.address else "",
                                      "state": d.address.state if d and d.address else ""},
                  "seller": seller, "area": area, "payment_method": req.payment_method, **(extra or {})}
        if quote:
            extras.update(pricing=quote["pricing"], quote_id=quote["id"])
        order = lifecycle.on_created(store, order, extras, customer, req.channel)
        if req.payment_method == "cod":
            order = orders.confirm_payment(store, order["id"], PaymentConfirmation(demo=True), method="cod",
                                           recorded_by="customer")
    return order, created


@app.post("/api/v1/orders", dependencies=KEY)
def create_order(req: OrderRequest, device: str = Depends(device_of),
                 customer: dict | None = Depends(security.optional_customer)):
    order, created = place_order(req, customer)
    store.link_order_device(order["id"], device)
    return JSONResponse({**lifecycle.public_view(order), "duplicate": not created}, status_code=201 if created else 200)


@app.get("/api/v1/orders/{order_id}", dependencies=KEY)
def get_order(order_id: str, who: dict = Depends(security.order_viewer)):
    return lifecycle.public_view(security.check_order_access(store.get_order(order_id), who))


@app.post("/api/v1/orders/{order_id}/payment-confirmed", dependencies=KEY)
def payment_confirmed(order_id: str, pay: PaymentConfirmation, who: dict = Depends(security.order_viewer)):
    security.check_order_access(store.get_order(order_id), who)
    return lifecycle.public_view(orders.confirm_payment(store, order_id, pay))


@app.exception_handler(ConfigInvalid)
async def config_invalid(_: Request, exc: ConfigInvalid):
    return JSONResponse({"detail": [{"loc": ["body", *e["path"].split(".")], "msg": e["message"], "type": "value_error"}
                                    for e in exc.errors]}, status_code=422)


def _order_from_dict(body: dict, quote: dict | None = None) -> dict:
    order, _ = place_order(OrderRequest.model_validate(body), None, quote)
    return order


app.include_router(api_shop.router(store, KEY, _order_from_dict))
app.include_router(api_market.router(store, KEY, place_order))
app.include_router(api_ops.router(store, KEY))
app.include_router(api_ops_market.router(store))


@app.post("/api/v1/orders/{order_id}/files/{name}", dependencies=KEY)
def order_file(order_id: str, name: str, who: dict = Depends(security.order_viewer)):
    order = security.check_order_access(store.get_order(order_id), who)
    svg = orders.production_file(order, name)
    return Response(svg, media_type=SVG, headers={"Content-Disposition": f'attachment; filename="{order_id}_{name}"'})


# ----------------------------------------------------------------- staff

@app.get("/api/v1/factory/queue", dependencies=KEY)
def factory_queue(limit: int = Query(100, ge=1, le=500)):
    return {"factory_connected": bool(settings.factory_url), "jobs": store.factory_jobs(limit)}


@app.get("/api/v1/dataset/export", dependencies=KEY, response_class=PlainTextResponse)
def export_dataset(min_rating: int = Query(4, ge=1, le=5)):
    """Chat-format JSONL of human-endorsed designs, the SLM fine-tuning set."""
    lines = []
    for row in store.training_rows(min_rating):
        req = GenerateRequest.model_validate_json(row["request_json"])
        spec = DesignSpec.model_validate_json(row["spec_json"])
        lines.append(json.dumps({
            "messages": [
                {"role": "system", "content": SLM_SYSTEM_PROMPT},
                {"role": "user", "content": build_user_message(req, n=req.variants, variant_index=row["variant_index"])},
                {"role": "assistant", "content": json.dumps(creative_part(spec))},
            ],
            "meta": {"design_id": row["id"], "teacher": row["provider"], "rating": row["rating"],
                     "selected": bool(row["selected"]), "edited": bool(row["edited"])},
        }))
    return PlainTextResponse("\n".join(lines) + ("\n" if lines else ""), media_type="application/jsonl",
                             headers={"Content-Disposition": 'attachment; filename="sportswear_spec_sft.jsonl"'})


@app.get("/api/v1/stats", dependencies=KEY)
def stats():
    return store.stats()


