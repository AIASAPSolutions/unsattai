"""Orders: idempotent creation, per-roster production files, demo payment and factory release.

Production files are size-specific SVG pattern pieces (4 for tops, 2 for shorts)
per merged order line, with the roster name and number exactly as submitted.
Nothing is released while any manufacturing check fails, and an order is only
reported as sent to a real factory when the factory's own receipt says so.
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone

import httpx

from .config import settings
from .engine.garments import GARMENT_PANELS
from .engine.manufacturing import run_checks
from .engine.renderer import render_mockup, render_print_sheet
from .schemas import DesignSpec, OrderRequest, PaymentConfirmation
from .store import Store

log = logging.getLogger("design.orders")


class OrderError(Exception):
    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def personalise(spec: DesignSpec, player_name: str, number: str) -> DesignSpec:
    data = spec.model_dump()
    data["typography"]["player_name"] = player_name
    data["typography"]["number"] = number
    return DesignSpec.model_validate(data)


def merge_items(req: OrderRequest) -> list[dict]:
    """Identical name/number/size rows become one line; first-seen order is kept."""
    lines: dict[tuple, dict] = {}
    for it in req.items:
        k = (it.player_name, it.number, it.size)
        if k in lines:
            lines[k]["quantity"] += it.quantity
        else:
            lines[k] = {"player_name": it.player_name, "number": it.number, "size": it.size, "quantity": it.quantity}
    return [dict(line=i + 1, **v) for i, v in enumerate(lines.values())]


def _file_name(line: int, size: str, panel: str) -> str:
    return f"L{line:02d}_{size}_{panel}.svg"


def _checks_for(spec: DesignSpec, size: str) -> list[dict]:
    _, ctx = render_mockup(spec, "chk")
    return [c.model_dump() for c in run_checks(spec, ctx.min_feature_mm, [size])]


def request_hash(req: OrderRequest) -> str:
    body = req.model_dump(exclude={"idempotency_key"})
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def create(store: Store, req: OrderRequest) -> tuple[dict, bool]:
    lines = merge_items(req)
    failures, checks_by_size = [], {}
    for ln in lines:
        spec = personalise(req.spec, ln["player_name"], ln["number"])
        checks = _checks_for(spec, ln["size"])
        checks_by_size.setdefault(ln["size"], checks)
        bad = [c for c in checks if c["level"] == "fail"]
        if bad:
            failures.append({"line": ln["line"], "player_name": ln["player_name"], "number": ln["number"],
                             "size": ln["size"], "checks": bad})
    if failures:
        raise OrderError(422, "Some order lines fail manufacturing checks, so the order cannot be placed.",
                         failures=failures)

    panels = [p.name for p in GARMENT_PANELS[req.spec.garment]]
    files = []
    for ln in lines:
        ln["files"] = [_file_name(ln["line"], ln["size"], p) for p in panels]
        for p in panels:
            files.append({"name": _file_name(ln["line"], ln["size"], p), "line": ln["line"], "size": ln["size"],
                          "panel": p, "player_name": ln["player_name"], "number": ln["number"]})
    worst = max(checks_by_size, key=lambda s: ["XS", "S", "M", "L", "XL", "XXL"].index(s))
    checks = checks_by_size[worst]
    order = {
        "id": "ord_" + uuid.uuid4().hex[:12],
        "created_at": _now(),
        "status": "awaiting_payment",
        "design_id": req.design_id,
        "spec": req.spec.model_dump(),
        "garment": req.spec.garment,
        "lines": lines,
        "items_submitted": len(req.items),
        "total_pieces": sum(ln["quantity"] for ln in lines),
        "customer": req.customer.model_dump(),
        "language": req.language,
        "checks": checks,
        "manufacturing_ready": _ready(checks),
        "files": files,
        "payment": None,
        "factory": None,
        "notes": [
            "Pattern pieces are simplified blocks with uniform grading; the factory's graded pieces replace them.",
            "Each piece has 10 mm bleed past a magenta CutContour line.",
            "Proof colours with the printer's ICC profile; the gamut check is a heuristic.",
            "Sublimation has no white ink: white areas are the polyester fabric itself.",
        ],
    }
    return store.create_order(req.idempotency_key, request_hash(req), order)


def _ready(checks: list[dict]) -> bool:
    return not any(c["level"] == "fail" for c in checks)


def production_file(order: dict, name: str) -> str:
    f = next((f for f in order["files"] if f["name"] == name), None)
    if f is None:
        raise OrderError(404, "file not found")
    spec = personalise(DesignSpec.model_validate(order["spec"]), f["player_name"], f["number"])
    label = f"order {order['id']} | line {f['line']}" + (f" | {f['player_name']}" if f["player_name"] else "") \
        + (f" #{f['number']}" if f["number"] else "") + f" | {f['panel']}"
    svg, _ = render_print_sheet(spec, size=f["size"], design_id=order.get("design_id") or order["id"],
                                only=f["panel"], label=label)
    return svg


def _send_to_factory(order: dict) -> dict:
    """Real factory hand-off; the factory's response is the only proof of acceptance."""
    payload = {"order_id": order["id"], "garment": order["garment"], "lines": order["lines"],
               "files": [f["name"] for f in order["files"]], "customer": {"name": order["customer"]["name"]}}
    headers = {"Authorization": f"Bearer {settings.factory_token}"} if settings.factory_token else {}
    r = httpx.post(f"{settings.factory_url}/jobs", json=payload, headers=headers, timeout=20)
    r.raise_for_status()
    body = r.json()
    if not body.get("job_id"):
        raise ValueError("factory response had no job_id")
    return {"job_id": str(body["job_id"]), "queue": str(body.get("queue") or "PRODUCTION"),
            "accepted_at": str(body.get("accepted_at") or _now()), "factory_connected": True}


def confirm_payment(store: Store, order_id: str, pay: PaymentConfirmation, method: str = "demo",
                    amount: float | None = None, recorded_by: str | None = None) -> dict:
    """Demo payment from the apps, or a payment staff recorded (cash, UPI, bank transfer...)."""
    order = store.get_order(order_id)
    if order is None:
        raise OrderError(404, "order not found")
    if (order.get("fulfilment") or {}).get("status") == "cancelled":
        raise OrderError(409, "This order was cancelled.")
    if not pay.demo:
        raise OrderError(400, "Real payment confirmation is not configured on this server; only demo payments are accepted.")
    if not order["manufacturing_ready"]:
        raise OrderError(409, "The order has failing manufacturing checks and cannot be released.")

    existing = store.factory_job_for(order_id)
    if existing:
        order["factory"] = dict(existing, duplicate=True)
        return order

    if method == "demo":
        order["payment"] = {"demo": True, "method": "demo", "reference": pay.reference or "DEMO-" + uuid.uuid4().hex[:8].upper(),
                            "confirmed_at": _now(), "note": "Demo payment only. No money was taken."}
    else:
        order["payment"] = {"demo": False, "method": method, "reference": pay.reference, "amount": amount,
                            "confirmed_at": _now(), "recorded_by": recorded_by,
                            "note": "Payment recorded by staff."}
    if settings.factory_url:
        try:
            receipt = _send_to_factory(order)
        except Exception as e:  # payment is recorded; release can be retried
            log.warning("factory hand-off failed for %s: %s", order_id, e)
            order["status"] = "paid_release_failed"
            order["factory"] = {"error": f"The factory did not accept the job: {e}", "factory_connected": False}
            store.save_order(order)
            raise OrderError(502, "Payment recorded, but the factory did not accept the job. Try again.", order=order) from e
    else:
        receipt = {"job_id": "TEST-" + uuid.uuid4().hex[:10].upper(), "queue": "TEST", "accepted_at": _now(),
                   "factory_connected": False,
                   "note": "No factory is configured. The job went to the TEST queue and nothing will be produced."}
    receipt.update(order_id=order_id, duplicate=False)
    store.add_factory_job(receipt)
    stored = store.factory_job_for(order_id)
    if stored and stored["job_id"] != receipt["job_id"]:   # a concurrent confirmation released it first
        order = store.get_order(order_id) or order
        order["factory"] = dict(stored, duplicate=True)
        return order
    order["factory"] = receipt
    order["status"] = "released_to_factory" if receipt["factory_connected"] else "released_to_test_queue"
    store.save_order(order)
    if hasattr(store, "put"):   # platform store: schedule production and promise dates
        from .platform import lifecycle
        order = lifecycle.on_paid(store, order, recorded_by or "customer")
    return order


__all__ = ["OrderError", "create", "confirm_payment", "production_file", "merge_items", "personalise"]
