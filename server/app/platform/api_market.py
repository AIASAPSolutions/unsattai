"""Marketplace routes for the web store and the mobile app: PIN code serviceability, offers,
products, cart and checkout, password sign-in, identifiers, sessions, wishlist,
notifications, and cancel / return / review on an order.

Like the rest of the customer API, everything needs the channel's X-API-Key when the
server sets API_KEYS.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, model_validator

from ..config import env_int
from ..schemas import Garment
from . import accounts, catalog, commerce, config, lifecycle, security, sellers
from .db import PlatformStore

PASSWORD_RESET_MINUTES = env_int("PASSWORD_RESET_MINUTES", 15)


class LoginIn(BaseModel):
    identifier: str = Field(..., min_length=3, max_length=120, description="a mobile number or an email")
    password: str = Field(..., min_length=1, max_length=200)


class PasswordIn(BaseModel):
    current: str | None = Field(None, max_length=200)
    new: str = Field(..., max_length=200)


class IdentifierIn(BaseModel):
    phone: str | None = Field(None, min_length=6, max_length=24)
    email: str | None = Field(None, min_length=3, max_length=120)

    @model_validator(mode="after")
    def _one(self):
        if bool(self.phone) == bool(self.email):
            raise ValueError("give a phone or an email")
        return self


class IdentifierVerify(IdentifierIn):
    code: str = Field(..., min_length=4, max_length=8)


class WishlistIn(BaseModel):
    product_id: str = Field(..., min_length=3, max_length=40)


class ReadIn(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=500)
    all: bool = False


def router(store: PlatformStore, key_dep, place_order) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=key_dep)

    def device_of(request: Request, x_device_id: str | None = Header(default=None)) -> str:
        from ..ai_edit import device_key
        return device_key(x_device_id, request.client.host if request.client else None)

    # ------------------------------------------------------------- delivery and offers

    @r.get("/shop/serviceability")
    def serviceability(pincode: str = Query(..., max_length=10), garment: Garment = "jersey",
                       fabric: str | None = Query(None, max_length=30), pieces: int = Query(1, ge=1, le=100_000),
                       rush: bool = False):
        """Which sellers can deliver this garment to this PIN code, and when. Never an error for a
        bad PIN code: `serviceable` is false with a `reason`."""
        return sellers.serviceability(store, pincode.strip(), garment, fabric or None, pieces, rush)

    @r.get("/shop/offers")
    def offers():
        """Active public coupons, for the checkout's "Available offers" list."""
        today = date.today().isoformat()
        pb = config.get(store, "price_book")
        return {"currency": pb["currency"], "items": [
            {k: c.get(k) for k in ("code", "title", "kind", "value", "max_discount", "min_subtotal", "expires")}
            for c in pb["coupons"] if c.get("public") and c["active"] and not (c["expires"] and c["expires"] < today)]}

    @r.get("/shop/sellers/{seller_id}")
    def seller_profile(seller_id: str):
        s = store.get("seller", seller_id)
        if not s or not s.get("active", True):
            raise HTTPException(404, "seller not found")
        return {"id": s["id"], "name": s["name"], "rating": s.get("rating"), "city": (s.get("address") or {}).get("city"),
                "state": (s.get("address") or {}).get("state"), "garments": s.get("garments")}

    # ------------------------------------------------------------- products

    @r.get("/shop/products")
    def products(q: str = Query("", max_length=100), sport: str = Query("", max_length=20),
                 garment: str = Query("", max_length=10), colour: str = Query("", max_length=20),
                 min_price: float | None = Query(None, ge=0), max_price: float | None = Query(None, ge=0),
                 sort: str = Query("popular", pattern="^(popular|new|price_asc|price_desc|rating)$"),
                 page: int = Query(1, ge=1, le=1000), size: int = Query(catalog.PAGE_SIZE, ge=1, le=60),
                 featured: bool | None = None):
        return catalog.search(store, q, sport, garment, colour, min_price, max_price, sort, page, size, featured)

    @r.get("/shop/products/{slug}")
    def product(slug: str):
        return catalog.product_detail(store, slug)

    mockups: dict[tuple[str, str], str] = {}

    @r.get("/shop/products/{slug}/mockup.svg")
    def product_mockup(slug: str):
        """The product's picture. Rendered once per product version and kept in memory."""
        from .. import service
        from ..schemas import DesignSpec
        p = catalog.by_slug(store, slug)
        key = (p["id"], p["updated_at"])
        if key not in mockups:
            if len(mockups) > 200:
                mockups.clear()
            mockups[key] = service.render_preview(DesignSpec.model_validate(p["spec"]), f"p{p['id'][-6:]}")["mockup_svg"]
        return Response(mockups[key], media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=3600"})

    @r.get("/shop/products/{slug}/reviews")
    def product_reviews(slug: str, page: int = Query(1, ge=1)):
        p = catalog.by_slug(store, slug)
        rows, total = store.find("review", parent=p["id"], status="visible", order="created_at DESC", limit=20,
                                 offset=(page - 1) * 20)
        return {"items": [catalog.public_review(x) for x in rows], "total": total, "page": page,
                "pages": max(1, -(-total // 20))}

    # ------------------------------------------------------------- cart and checkout

    @r.post("/shop/cart/quote")
    def cart_quote(body: commerce.CartQuoteIn):
        return commerce.cart_quote(store, body)

    @r.post("/checkout")
    def checkout(body: commerce.CheckoutIn, device: str = Depends(device_of),
                 customer: dict | None = Depends(security.optional_customer)):
        ck, created = commerce.checkout(store, body, customer, device, place_order)
        return JSONResponse({**commerce.view(store, ck), "duplicate": not created}, status_code=201 if created else 200)

    def _checkout(cid: str, who: dict, phone: str | None) -> dict:
        return security.check_checkout_access(store.get("checkout", cid), who, phone)

    @r.get("/checkouts/{checkout_id}")
    def get_checkout(checkout_id: str, phone: str | None = Query(None, max_length=24),
                     who: dict = Depends(security.order_viewer)):
        return commerce.view(store, _checkout(checkout_id, who, phone))

    @r.post("/checkouts/{checkout_id}/pay")
    def pay_checkout(checkout_id: str, phone: str | None = Query(None, max_length=24),
                     who: dict = Depends(security.order_viewer)):
        """Demo payment for every online order in the checkout at once."""
        ck = _checkout(checkout_id, who, phone)
        return commerce.view(store, commerce.pay(store, ck))

    @r.get("/me/checkouts")
    def my_checkouts(customer: dict = Depends(security.require_customer)):
        rows, total = store.find("checkout", parent=customer["id"], order="created_at DESC", limit=50)
        return {"items": [{k: v for k, v in x.items() if k not in ("request_hash", "device", "idempotency_key")}
                          for x in rows], "total": total}

    @r.get("/me/cart")
    def get_cart(customer: dict = Depends(security.require_customer)):
        return {"items": commerce.get_cart(store, customer["id"]), "max_items": commerce.MAX_CART_ITEMS}

    @r.put("/me/cart")
    def put_cart(body: commerce.CartIn, customer: dict = Depends(security.require_customer)):
        return {"items": commerce.put_cart(store, customer["id"], body.items), "max_items": commerce.MAX_CART_ITEMS}

    @r.post("/me/cart/merge")
    def merge_cart(body: commerce.CartIn, customer: dict = Depends(security.require_customer)):
        """After sign-in: add the device's guest cart to the saved cart (duplicates skipped)."""
        return {"items": commerce.merge_cart(store, customer["id"], body.items), "max_items": commerce.MAX_CART_ITEMS}

    # ------------------------------------------------------------- password sign-in

    @r.post("/auth/login")
    def login(body: LoginIn, user_agent: str | None = Header(default=None)):
        ident = body.identifier.strip()
        security.check_lock(store, "customer", ident)
        if "@" in ident:
            cust = lifecycle.customer_by_email(store, security.normalize_email(ident))
        else:
            cust = accounts.owner_of_phone(store, security.normalize_phone(ident))
            cust = cust if cust and cust.get("phone_verified") else None
        stored = accounts.password_hash(store, cust["id"]) if cust else None
        if not stored or not security.check_password(body.password, stored):
            security.login_failed(store, "customer", ident)
            raise HTTPException(401, "The mobile number, email or password is not right.")
        if cust.get("status") == "blocked":
            raise HTTPException(403, "This account is blocked. Contact support.")
        security.login_ok(store, "customer", ident)
        return {**security.issue_token(store, "customer", cust["id"], user_agent, "password"), "customer": accounts.me_view(cust)}

    @r.post("/me/password")
    def set_password(body: PasswordIn, customer: dict = Depends(security.require_customer),
                     session: dict = Depends(security.current_session)):
        """Set or change the password. The current one is needed, except just after signing in with a
        code (that is how a forgotten password is reset)."""
        stored = accounts.password_hash(store, customer["id"])
        if stored:
            fresh_otp = session.get("auth_method") == "otp" and session.get("created_at") and (
                datetime.now(timezone.utc) - datetime.fromisoformat(session["created_at"])
                < timedelta(minutes=PASSWORD_RESET_MINUTES))
            if not fresh_otp:
                if not body.current or not security.check_password(body.current, stored):
                    raise HTTPException(401, "Your current password is not right. Forgot it? Sign in with a code, "
                                             "then set a new one.")
        problem = security.password_problem(body.new)
        if problem:
            raise HTTPException(422, problem)
        accounts.set_password(store, customer, body.new)
        others = store.drop_other_sessions("customer", customer["id"], session["token_hash"])
        store.audit(f"customer:{customer['id']}", "customer.password", f"customer:{customer['id']}")
        return {"ok": True, "other_sessions_signed_out": others}

    # ------------------------------------------------------------- phone and email on the account

    @r.post("/me/identifiers/request")
    def identifier_request(body: IdentifierIn, customer: dict = Depends(security.require_customer)):
        """Send a code to a phone or email to add it to this account (409 if another account has it)."""
        phone = security.normalize_phone(body.phone) if body.phone else None
        email = security.normalize_email(body.email) if body.email else None
        accounts.claim_identifier(store, customer, phone, email, check_only=True)
        return security.request_code(store, phone=phone, email=email)

    @r.post("/me/identifiers/verify")
    def identifier_verify(body: IdentifierVerify, customer: dict = Depends(security.require_customer)):
        ident = security.verify_code(store, body.code, phone=body.phone, email=body.email)
        cust = accounts.claim_identifier(store, customer, None if body.email else ident, ident if body.email else None,
                                         check_only=False)
        return accounts.me_view(cust)

    # ------------------------------------------------------------- sessions

    @r.get("/me/sessions")
    def my_sessions(customer: dict = Depends(security.require_customer),
                    session: dict = Depends(security.current_session)):
        return {"items": [{"id": s["id"], "created_at": s["created_at"], "last_seen_at": s["last_seen_at"],
                           "device_label": s["device_label"] or "Unknown device", "current": s["id"] == session["id"]}
                          for s in store.sessions_for("customer", customer["id"])]}

    @r.delete("/me/sessions/{session_id}")
    def drop_session(session_id: str, customer: dict = Depends(security.require_customer)):
        if not store.drop_session_id("customer", customer["id"], session_id):
            raise HTTPException(404, "session not found")
        return {"ok": True}

    @r.post("/me/sessions/revoke-others")
    def revoke_others(customer: dict = Depends(security.require_customer),
                      session: dict = Depends(security.current_session)):
        return {"ok": True, "signed_out": store.drop_other_sessions("customer", customer["id"], session["token_hash"])}

    # ------------------------------------------------------------- wishlist

    def _wishlist(customer: dict) -> dict:
        ids = catalog.wishlist_ids(store, customer["id"])
        pb = config.get(store, "price_book")
        items = []
        for pid in ids:
            p = store.get("product", pid)
            if p and p["status"] == "published":
                items.append(catalog.public_product(p, catalog.price_from(store, p, pb), pb["currency"]))
        return {"product_ids": ids, "items": items}

    @r.get("/me/wishlist")
    def wishlist(customer: dict = Depends(security.require_customer)):
        return _wishlist(customer)

    @r.post("/me/wishlist")
    def wishlist_add(body: WishlistIn, customer: dict = Depends(security.require_customer)):
        p = store.get("product", body.product_id)
        if not p or p["status"] != "published":
            raise HTTPException(404, "product not found")
        ids = catalog.wishlist_ids(store, customer["id"])
        if body.product_id not in ids:
            catalog.set_wishlist(store, customer["id"], [body.product_id, *ids])
        return _wishlist(customer)

    @r.delete("/me/wishlist/{product_id}")
    def wishlist_remove(product_id: str, customer: dict = Depends(security.require_customer)):
        catalog.set_wishlist(store, customer["id"], [i for i in catalog.wishlist_ids(store, customer["id"]) if i != product_id])
        return _wishlist(customer)

    # ------------------------------------------------------------- after the order

    def _mine(order_id: str, customer: dict) -> dict:
        order = store.get_order(order_id)
        if not order or order.get("customer_id") != customer["id"]:
            raise HTTPException(404, "order not found")
        return order

    @r.post("/me/orders/{order_id}/cancel")
    def cancel(order_id: str, body: commerce.CancelIn, customer: dict = Depends(security.require_customer)):
        order = commerce.customer_cancel(store, _mine(order_id, customer), body.reason, customer)
        return lifecycle.public_view(order)

    @r.post("/me/orders/{order_id}/returns", status_code=201)
    def request_return(order_id: str, body: commerce.ReturnIn, customer: dict = Depends(security.require_customer)):
        r_ = commerce.request_return(store, _mine(order_id, customer), body, customer)
        return {"return": commerce._return_public(r_), "order": lifecycle.public_view(store.get_order(order_id))}

    @r.post("/me/orders/{order_id}/review", status_code=201)
    def review(order_id: str, body: catalog.ReviewIn, customer: dict = Depends(security.require_customer)):
        order = _mine(order_id, customer)
        rv = catalog.add_review(store, order, customer, body)
        lifecycle.event(order, "reviewed", f"customer:{customer['id']}")
        store.save_order(order)
        return {"review": catalog.public_review(rv), "order": lifecycle.public_view(order)}

    @r.get("/me/returns")
    def my_returns(customer: dict = Depends(security.require_customer)):
        rows, _ = store.find("return", limit=200, order="created_at DESC", q=customer["id"])
        mine = [commerce._return_public(x) | {"order_id": x["order_id"], "order_number": x.get("order_number")}
                for x in rows if x["customer_id"] == customer["id"]]
        return {"items": mine, "total": len(mine)}

    # ------------------------------------------------------------- notifications

    @r.get("/me/notifications")
    def notifications(customer: dict = Depends(security.require_customer), unread_only: bool = False,
                      page: int = Query(1, ge=1)):
        rows, total = store.find("notification", parent=customer["id"], status="unread" if unread_only else None,
                                 order="created_at DESC, id DESC", limit=30, offset=(page - 1) * 30)
        unread = store.find("notification", parent=customer["id"], status="unread", limit=1)[1]
        return {"items": [{k: x.get(k) for k in ("id", "code", "title", "body", "order_id", "read", "created_at")}
                          for x in rows], "total": total, "unread": unread, "page": page}

    @r.post("/me/notifications/read")
    def notifications_read(body: ReadIn, customer: dict = Depends(security.require_customer)):
        rows = store.find("notification", parent=customer["id"], status="unread", limit=10_000)[0] if body.all else \
            [x for x in (store.get("notification", i) for i in body.ids) if x and x["customer_id"] == customer["id"]]
        for x in rows:
            x["read"] = True
            store.put("notification", x["id"], x, status="read", parent=customer["id"], ref=x.get("order_id") or "")
        return {"ok": True, "marked": len(rows),
                "unread": store.find("notification", parent=customer["id"], status="unread", limit=1)[1]}

    return r
