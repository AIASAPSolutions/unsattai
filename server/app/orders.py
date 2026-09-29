"""Orders: idempotent creation, per-roster production files, demo payment and factory release.

Production files are SVG pattern pieces (front, back and any sleeves) per merged
order line, graded to that line's fit and size from the size chart, with the roster
name and number exactly as submitted. Each line keeps the chart measurements it was
ordered with, so a later chart change never alters an order already placed.
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
from .engine import sizing
from .engine.garments import spec_panels
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
        k = (it.player_name, it.number, it.fit, it.size)
        if k in lines:
            lines[k]["quantity"] += it.quantity
        else:
            lines[k] = {"player_name": it.player_name, "number": it.number, "fit": it.fit, "size": it.size,
                        "quantity": it.quantity}
    return [dict(line=i + 1, **v) for i, v in enumerate(lines.values())]


def _file_name(line: int, size: str, panel: str, fit: str = "men") -> str:
    return f"L{line:02d}_{'' if fit == 'men' else fit[0].upper()}{size}_{panel}.svg"


def _checks_for(spec: DesignSpec, fit: str, size: str) -> list[dict]:
    _, ctx = render_mockup(spec, "chk")
    return [c.model_dump() for c in run_checks(spec, ctx.min_feature_mm, [f"{fit}:{size}"])]


def request_hash(req: OrderRequest) -> str:
    body = req.model_dump(exclude={"idempotency_key"})
    # Fields added later are left out at their defaults, so retries of older requests still match.
    for k, default in (("seller_id", ""), ("payment_method", "online")):
        if body.get(k) == default:
            body.pop(k, None)
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def check_lines(req: OrderRequest) -> list[dict]:
    """Manufacturing-check failures per merged line, without creating anything."""
    return _check(req, merge_items(req))[0]


def _check(req: OrderRequest, lines: list[dict]) -> tuple[list[dict], dict]:
    failures, checks_by_size = [], {}
    for ln in lines:
        spec = personalise(req.spec, ln["player_name"], ln["number"])
        checks = _checks_for(spec, ln["fit"], ln["size"])
        checks_by_size.setdefault((ln["fit"], ln["size"]), checks)
        bad = [c for c in checks if c["level"] == "fail"]
        if bad:
            failures.append({"line": ln["line"], "player_name": ln["player_name"], "number": ln["number"],
                             "fit": ln["fit"], "size": ln["size"], "checks": bad})
    return failures, checks_by_size


def create(store: Store, req: OrderRequest, sizing_chart: dict | None = None) -> tuple[dict, bool]:
    lines = merge_items(req)
    failures, checks_by_size = _check(req, lines)
    if failures:
        raise OrderError(422, "Some order lines fail manufacturing checks, so the order cannot be placed.",
                         failures=failures)

    spec = req.spec
    pieces = spec_panels(spec)
    files = []
    for ln in lines:
        row = sizing.row(sizing_chart, ln["fit"], ln["size"])
        ln["measurements"] = sizing.measurements(spec.garment, spec.sleeves, row)
        ln["chart_row"] = row           # the exact chart values this line is made to
        ln["pieces_mm"] = {}
        for p in pieces:
            sx, sy = sizing.grade(p.kind, spec.sleeves, row)
            ln["pieces_mm"][p.name] = [round(p.w * sx), round(p.h * sy)]
        ln["files"] = [_file_name(ln["line"], ln["size"], p.name, ln["fit"]) for p in pieces]
        for p in pieces:
            files.append({"name": _file_name(ln["line"], ln["size"], p.name, ln["fit"]), "line": ln["line"],
                          "fit": ln["fit"], "size": ln["size"], "panel": p.name, "player_name": ln["player_name"],
                          "number": ln["number"]})
    # Show the checks of the line whose logo prints worst (the biggest size, where artwork grows most).
    rank = {"pass": 0, "info": 0, "warn": 1, "fail": 2}
    worst = max(checks_by_size, key=lambda k: max((rank[c["level"]] for c in checks_by_size[k] if c["id"] == "logo_dpi"),
                                                  default=0))
    checks = checks_by_size[worst]
    order = {
        "id": "ord_" + uuid.uuid4().hex[:12],
        "created_at": _now(),
        "status": "awaiting_payment",
        "design_id": req.design_id,
        "spec": req.spec.model_dump(),
        "garment": req.spec.garment,
        "options": {"sleeves": spec.sleeves, "collar": spec.collar} if spec.garment != "shorts" else {},
        "lines": lines,
        "items_submitted": len(req.items),
        "total_pieces": sum(ln["quantity"] for ln in lines),
        "customer": req.customer.model_dump(),
        "language": req.language,
        "checks": checks,
        "manufacturing_ready": _ready(checks),
        "files": files,
        "sheets": [SHEET_NAME],
        "payment": None,
        "factory": None,
        "notes": [
            "Pattern pieces are simplified blocks graded to the size chart (chest and length, sleeve length, hip and "
            "length for shorts); replace them with the factory's own graded pieces if it has them.",
            "Each piece has 10 mm bleed past a magenta CutContour line.",
            "Proof colours with the printer's ICC profile; the gamut check is a heuristic.",
            "Sublimation has no white ink: white areas are the polyester fabric itself.",
        ],
    }
    return store.create_order(req.idempotency_key, request_hash(req), order)


def _ready(checks: list[dict]) -> bool:
    return not any(c["level"] == "fail" for c in checks)


SHEET_NAME = "measurements.svg"
_MEASURE_COLS = (("chest", "Chest"), ("length", "Length"), ("shoulder", "Shoulder"), ("sleeve", "Sleeve"),
                 ("waist", "Waist"), ("hip", "Hip"))


def _esc(t) -> str:
    return str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _line_sizes(order: dict, ln: dict) -> tuple[dict, dict]:
    """The measurements and piece sizes a line is made to (worked out again for orders placed before they were stored)."""
    if ln.get("measurements") and ln.get("pieces_mm"):
        return ln["measurements"], ln["pieces_mm"]
    spec = DesignSpec.model_validate(order["spec"])
    row = sizing.row(None, ln.get("fit", "men"), ln["size"])
    pieces = {}
    for p in spec_panels(spec):
        sx, sy = sizing.grade(p.kind, spec.sleeves, row)
        pieces[p.name] = [round(p.w * sx), round(p.h * sy)]
    return sizing.measurements(spec.garment, spec.sleeves, row), pieces


def _piece_lines(pieces: dict) -> list[str]:
    """Pieces grouped by size: "front, back 600 x 760", "sleeves (2) 511 x 650"."""
    groups: dict[tuple, list[str]] = {}
    for name, wh in pieces.items():
        groups.setdefault(tuple(wh), []).append(name)
    out = []
    for (w, h), names in groups.items():
        if set(names) == {"sleeve_left", "sleeve_right"}:
            label = "sleeves (2)"
        else:
            label = ", ".join(n.replace("_", " ") for n in names)
        out.append(f"{label} {w} x {h}")
    return out[:2] if len(out) <= 2 else [out[0], "; ".join(out[1:])]


def measurement_sheet(order: dict) -> str:
    """One A4-wide vector sheet for the cutting and sewing tables: every line's fit, size, quantity, finished
    garment measurements (cm), flat piece sizes (mm, before bleed) and its print files."""
    spec = order["spec"]
    opts = order.get("options") or {}
    W, M, row_h = 210, 10, 11
    cols = [c for c in _MEASURE_COLS if any(c[0] in _line_sizes(order, ln)[0] for ln in order["lines"])]
    head = ["Line", "Name / No.", "Fit", "Size", "Qty"] + [c[1] for c in cols] + ["Pieces (mm)"]
    widths = [9, 30, 14, 10, 8] + [15] * len(cols)
    widths.append(W - 2 * M - sum(widths))
    H = 50 + row_h * (len(order["lines"]) + 1) + 24
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{H}mm" viewBox="0 0 {W} {H}" '
           'font-family="Helvetica, Arial, sans-serif">',
           f'<rect width="{W}" height="{H}" fill="#fff"/>',
           f'<text x="{M}" y="16" font-size="6" font-weight="700">Measurement sheet</text>',
           f'<text x="{W - M}" y="16" font-size="3.4" text-anchor="end">Order {_esc(order.get("number") or order["id"])}'
           f' | {_esc(order["created_at"][:10])}</text>']
    garment = {"jersey": "Crew-neck jersey", "vneck": "V-neck jersey", "shorts": "Shorts"}.get(order["garment"], order["garment"])
    bits = [garment]
    if opts.get("sleeves"):
        bits.append({"short": "short sleeves", "long": "long sleeves", "none": "sleeveless"}[opts["sleeves"]])
    if opts.get("collar") not in (None, "crew") and order["garment"] == "jersey":
        bits.append({"crew": "crew neck", "polo": "polo collar", "mandarin": "mandarin collar"}[opts["collar"]])
    fabric = ((order.get("pricing") or {}).get("fabric") or {}).get("name")
    if fabric:
        bits.append(fabric)
    out.append(f'<text x="{M}" y="25" font-size="3.6">{_esc(", ".join(bits))}. '
               f'{order["total_pieces"]} pieces in {len(order["lines"])} lines.</text>')
    pal = spec.get("palette") or {}
    x = M
    for k in ("primary", "secondary", "accent", "trim", "text"):
        if pal.get(k):
            out.append(f'<rect x="{x}" y="29" width="6" height="6" fill="{_esc(pal[k])}" stroke="#999" stroke-width="0.2"/>'
                       f'<text x="{x + 7.5}" y="33.5" font-size="2.8">{k} {_esc(pal[k])}</text>')
            x += 36
    out.append(f'<text x="{M}" y="41" font-size="2.9" fill="#444">Finished garment measurements in cm, laid flat: '
               'chest, waist and hip across; length from the highest shoulder point.</text>')
    out.append(f'<text x="{M}" y="45.5" font-size="2.9" fill="#444">Tolerance +/- 1 cm. Piece sizes are the cut '
               'line in mm (width x height), without the 10 mm bleed.</text>')
    y = 50
    out.append(f'<rect x="{M}" y="{y}" width="{W - 2 * M}" height="{row_h}" fill="#14225c"/>')
    x = M
    for h, w in zip(head, widths):
        out.append(f'<text x="{x + 1.2}" y="{y + 7}" font-size="2.9" font-weight="700" fill="#fff">{_esc(h)}</text>')
        x += w
    for i, ln in enumerate(order["lines"]):
        y += row_h
        meas, pieces = _line_sizes(order, ln)
        if i % 2:
            out.append(f'<rect x="{M}" y="{y}" width="{W - 2 * M}" height="{row_h}" fill="#f1f3f8"/>')
        who = " ".join(b for b in (ln["player_name"], f'#{ln["number"]}' if ln["number"] else "") if b) or "-"
        fit = ln.get("fit", "men")
        cells = [str(ln["line"]), who, sizing.FIT_NAMES.get(fit, fit).split(" /")[0], ln["size"], str(ln["quantity"])]
        cells += [f'{meas[c[0]]:g}' if c[0] in meas else "-" for c in cols]
        x = M
        for c, w in zip(cells, widths):
            out.append(f'<text x="{x + 1.2}" y="{y + 7}" font-size="3.2">{_esc(c)}</text>')
            x += w
        for k, txt in enumerate(_piece_lines(pieces)):
            out.append(f'<text x="{x + 1.2}" y="{y + 4.4 + 4 * k}" font-size="2.7">{_esc(txt)}</text>')
    y += row_h + 8
    example = (order["lines"][0].get("files") or ["L01_M_front.svg"])[0].rsplit("_", 1)[0]
    out.append(f'<text x="{M}" y="{y}" font-size="2.9" fill="#444">Print files: one SVG per piece and line, named '
               f'line_size_piece (e.g. {_esc(example)}_front.svg), vector at 1:1 in millimetres.</text>')
    out.append(f'<text x="{M}" y="{y + 4.5}" font-size="2.9" fill="#444">Cut line = magenta CutContour. Raster logos '
               'are checked for at least 300 dpi at the printed size.</text>')
    out.append(f'<text x="{M}" y="{y + 9}" font-size="2.9" fill="#444">Check each piece against the 100 mm ruler on '
               'its file before cutting: print at 100%, no scaling.</text>')
    out.append("</svg>")
    return "\n".join(out)


def production_file(order: dict, name: str) -> str:
    if name == SHEET_NAME:
        return measurement_sheet(order)
    f = next((f for f in order["files"] if f["name"] == name), None)
    if f is None:
        raise OrderError(404, "file not found")
    spec = personalise(DesignSpec.model_validate(order["spec"]), f["player_name"], f["number"])
    label = f"order {order['id']} | line {f['line']}" + (f" | {f['player_name']}" if f["player_name"] else "") \
        + (f" #{f['number']}" if f["number"] else "") + f" | {f['panel']}"
    line = next((ln for ln in order["lines"] if ln["line"] == f["line"]), {})
    fit = f.get("fit", "men")
    chart = {"fits": {fit: {"sizes": [line["chart_row"]]}}} if line.get("chart_row") else None
    svg, _ = render_print_sheet(spec, size=f["size"], design_id=order.get("design_id") or order["id"],
                                only=f["panel"], label=label, fit=fit, sizing_chart=chart)
    return svg


def _send_to_factory(order: dict) -> dict:
    """Real factory hand-off; the factory's response is the only proof of acceptance."""
    payload = {"order_id": order["id"], "garment": order["garment"], "lines": order["lines"],
               "options": order.get("options") or {}, "files": [f["name"] for f in order["files"]],
               "sheets": [SHEET_NAME], "customer": {"name": order["customer"]["name"]}}
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
    if method == "demo" and not settings.demo_payments:
        raise OrderError(403, "Online payment is not available yet. Choose cash on delivery or contact us to pay.",
                         code="demo_payments_off")
    if not order["manufacturing_ready"]:
        raise OrderError(409, "The order has failing manufacturing checks and cannot be released.")

    existing = store.factory_job_for(order_id)
    if existing:
        order["factory"] = dict(existing, duplicate=True)
        return order

    if method == "cod":
        order["payment"] = {"demo": False, "method": "cod", "collected": False, "collected_at": None,
                            "amount": (order.get("pricing") or {}).get("total"), "reference": "",
                            "confirmed_at": _now(), "note": "Cash on delivery: collected when the order is delivered."}
    elif method == "demo":
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


__all__ = ["OrderError", "SHEET_NAME", "measurement_sheet", "create", "confirm_payment", "production_file", "merge_items", "personalise"]
