"""Operations routes for the marketplace: sellers and their coverage, products, review
moderation, the returns queue, cash on delivery collection, checkouts and the message
outbox. All under /api/v1/ops, with a staff session.

A seller login (role "seller") reaches only the routes marked seller=True, and only
for its own seller id.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..schemas import Garment
from . import catalog, commerce, lifecycle, pincodes, security, sellers
from .db import PlatformStore

need = security.need


class CodCollectIn(BaseModel):
    reference: str = Field("", max_length=80)


class ReviewModeration(BaseModel):
    hidden: bool
    reason: str = Field("", max_length=300)


def _page(rows: list, total: int, page: int, size: int) -> dict:
    return {"items": rows, "total": total, "page": page, "pages": max(1, -(-total // size))}


def router(store: PlatformStore) -> APIRouter:
    r = APIRouter(prefix="/api/v1/ops")

    def actor(s: dict) -> str:
        return f"staff:{s['id']}"

    # ------------------------------------------------------------- sellers

    @r.get("/sellers")
    def list_sellers(q: str | None = None, status: str | None = Query(None, pattern="^(active|inactive)$"),
                     s: dict = Depends(need("read", seller=True))):
        if s["role"] == "seller":
            own = store.get("seller", s["seller_id"])
            return {"items": [own] if own else [], "total": 1 if own else 0}
        rows, total = store.find("seller", q=q, status=status, order="created_at ASC", limit=500)
        return {"items": rows, "total": total}

    @r.post("/sellers", status_code=201)
    def add_seller(body: sellers.SellerIn, s: dict = Depends(need("settings"))):
        return sellers.save(store, None, body, actor(s))

    @r.get("/sellers/{sid}")
    def get_seller(sid: str, s: dict = Depends(need("read", seller=True))):
        if s["role"] == "seller" and sid != s["seller_id"]:
            raise HTTPException(404, "seller not found")
        sel = store.get("seller", sid)
        if not sel:
            raise HTTPException(404, "seller not found")
        staff = [x for x in store.list_staff() if x.get("seller_id") == sid] if s["role"] != "seller" else []
        counts = {}
        for row in store.find("order_index", owner=sid, limit=100_000)[0]:
            counts[row["fulfilment_status"]] = counts.get(row["fulfilment_status"], 0) + 1
        return {"seller": sel, "staff": staff, "orders_by_status": counts}

    @r.put("/sellers/{sid}")
    def edit_seller(sid: str, body: sellers.SellerIn, s: dict = Depends(need("settings"))):
        return sellers.save(store, sid, body, actor(s))

    @r.delete("/sellers/{sid}")
    def delete_seller(sid: str, s: dict = Depends(need("settings"))):
        """Sellers with orders are switched off instead, so their history stays."""
        sel = store.get("seller", sid)
        if not sel:
            raise HTTPException(404, "seller not found")
        if sid == security.HOUSE_SELLER:
            raise HTTPException(409, "The house seller can't be deleted.")
        if store.find("order_index", owner=sid, limit=1)[1]:
            sel["active"] = False
            sellers._put(store, sid, sel)
            store.audit(actor(s), "seller.deactivate", f"seller:{sid}")
            return {"ok": True, "deleted": False, "deactivated": True}
        store.delete("seller", sid)
        store.audit(actor(s), "seller.delete", f"seller:{sid}")
        return {"ok": True, "deleted": True, "deactivated": False}

    @r.get("/sellers/{sid}/pincode-check")
    def pincode_check(sid: str, pincode: str = Query(..., max_length=10), garment: Garment = "jersey",
                      fabric: str | None = None, pieces: int = Query(1, ge=1, le=100_000),
                      s: dict = Depends(need("read", seller=True))):
        """Coverage editor's test: does this seller serve this PIN code, through which area, and when?"""
        if s["role"] == "seller" and sid != s["seller_id"]:
            raise HTTPException(404, "seller not found")
        sel = store.get("seller", sid)
        if not sel:
            raise HTTPException(404, "seller not found")
        place = pincodes.place(pincode)
        if not place:
            return {"pincode": pincode, "place": None, "serviceable": False, "reason": "invalid_pincode",
                    "area": None, "blocked": False, "estimate": None}
        area, why = sellers.check(sel, pincode, place["state"], garment, fabric, pieces)
        from . import planning
        est = planning.promise(store, pieces, False, area["transit_days"], seller=sel) if area else None
        return {"pincode": pincode, "place": place, "serviceable": area is not None, "reason": why, "area": area,
                "blocked": pincode in sel.get("blocked_pincodes", []), "estimate": est,
                "matched_by": None if not area else "*" if area["match"] == "*" else
                "state" if area["match"] == place["state"] else "prefix"}

    # ------------------------------------------------------------- products

    @r.get("/products")
    def list_products(q: str | None = None, status: str | None = Query(None, pattern="^(draft|published)$"),
                      page: int = Query(1, ge=1), s: dict = Depends(need("read"))):
        rows, total = store.find("product", q=q, status=status, order="created_at DESC", limit=50, offset=(page - 1) * 50)
        return _page(rows, total, page, 50)

    @r.post("/products", status_code=201)
    def add_product(body: catalog.ProductIn, s: dict = Depends(need("pricing"))):
        return catalog.create_product(store, body, actor(s))

    @r.get("/products/{pid}")
    def get_product(pid: str, s: dict = Depends(need("read"))):
        return catalog.get_product(store, pid)

    @r.patch("/products/{pid}")
    def edit_product(pid: str, body: catalog.ProductPatch, s: dict = Depends(need("pricing"))):
        return catalog.update_product(store, pid, body, actor(s))

    @r.delete("/products/{pid}")
    def delete_product(pid: str, s: dict = Depends(need("pricing"))):
        catalog.get_product(store, pid)
        store.delete("product", pid)
        store.audit(actor(s), "product.delete", f"product:{pid}")
        return {"ok": True}

    @r.post("/products/{pid}/publish")
    def publish(pid: str, s: dict = Depends(need("pricing"))):
        return catalog.update_product(store, pid, catalog.ProductPatch(status="published"), actor(s))

    @r.post("/products/{pid}/unpublish")
    def unpublish(pid: str, s: dict = Depends(need("pricing"))):
        return catalog.update_product(store, pid, catalog.ProductPatch(status="draft"), actor(s))

    @r.post("/products/{pid}/feature")
    def feature(pid: str, featured: bool = True, s: dict = Depends(need("pricing"))):
        return catalog.update_product(store, pid, catalog.ProductPatch(featured=featured), actor(s))

    # ------------------------------------------------------------- reviews

    @r.get("/reviews")
    def reviews(status: str | None = Query(None, pattern="^(visible|hidden)$"), product_id: str | None = None,
                seller_id: str | None = None, q: str | None = None, page: int = Query(1, ge=1),
                s: dict = Depends(need("read"))):
        rows, total = store.find("review", status=status, parent=product_id, owner=seller_id, q=q,
                                 order="created_at DESC", limit=50, offset=(page - 1) * 50)
        return _page(rows, total, page, 50)

    @r.post("/reviews/{rid}/moderate")
    def moderate(rid: str, body: ReviewModeration, s: dict = Depends(need("crm"))):
        return catalog.set_review_hidden(store, rid, body.hidden, body.reason, actor(s))

    # ------------------------------------------------------------- returns

    @r.get("/returns")
    def returns(status: str | None = None, seller_id: str | None = None, q: str | None = None,
                page: int = Query(1, ge=1), s: dict = Depends(need("read", seller=True))):
        rows, total = store.find("return", status=status.split(",") if status else None,
                                 owner=security.seller_scope(s, seller_id), q=q, order="created_at DESC", limit=50,
                                 offset=(page - 1) * 50)
        return _page(rows, total, page, 50)

    @r.get("/returns/{rid}")
    def get_return(rid: str, s: dict = Depends(need("read", seller=True))):
        ret = store.get("return", rid)
        scope = security.seller_scope(s)
        if not ret or (scope and ret["seller_id"] != scope):
            raise HTTPException(404, "return not found")
        order = store.get_order(ret["order_id"])
        return {"return": ret, "order": lifecycle.public_view(order) if order else None}

    @r.post("/returns/{rid}/status")
    def return_status(rid: str, body: commerce.ReturnStatusIn, s: dict = Depends(need("orders", seller=True))):
        return commerce.set_return_status(store, rid, body, actor(s), security.seller_scope(s))

    # ------------------------------------------------------------- cash on delivery

    @r.get("/cod")
    def cod_orders(collected: bool | None = None, seller_id: str | None = None, page: int = Query(1, ge=1),
                   s: dict = Depends(need("read", seller=True))):
        """Cash on delivery orders, to reconcile what couriers and riders collected."""
        rows, _ = store.find("order_index", owner=security.seller_scope(s, seller_id), limit=100_000,
                             order="created_at DESC")
        rows = [x for x in rows if x.get("payment_method") == "cod" and x["fulfilment_status"] != "cancelled"
                and (collected is None or bool(x.get("cod_collected")) == collected)]
        return {**_page(rows[(page - 1) * 50: page * 50], len(rows), page, 50),
                "outstanding": round(sum(x.get("total") or 0 for x in rows if not x.get("cod_collected")), 2)}

    @r.post("/orders/{order_id}/cod-collected")
    def cod_collected(order_id: str, body: CodCollectIn, s: dict = Depends(need("delivery", seller=True))):
        order = security.check_seller_order(s, store.get_order(order_id))
        return lifecycle.collect_cod(store, order, actor(s), body.reference)

    # ------------------------------------------------------------- checkouts and messages

    @r.get("/checkouts/{cid}")
    def get_checkout(cid: str, s: dict = Depends(need("read"))):
        ck = store.get("checkout", cid)
        if not ck:
            raise HTTPException(404, "checkout not found")
        return {**{k: v for k, v in ck.items() if k not in ("request_hash",)},
                "orders": [store.get("order_index", oid) for oid in ck["order_ids"]]}

    @r.get("/messages")
    def messages(channel: str | None = Query(None, pattern="^(sms|email)$"),
                 status: str | None = Query(None, pattern="^(logged|sent|failed)$"), order_id: str | None = None,
                 q: str | None = None, page: int = Query(1, ge=1), s: dict = Depends(need("read"))):
        """The SMS and email outbox. "logged" means no provider is connected yet."""
        rows, total = store.find("message", status=status, ref=order_id, q=q, order="created_at DESC, id DESC",
                                 limit=100_000)
        if channel:
            rows = [x for x in rows if x["channel"] == channel]
        total = len(rows)
        return _page(rows[(page - 1) * 50: page * 50], total, page, 50)

    return r
