"""Commerce and operations: pricing, sign-in, order lifecycle, planning, delivery, CRM and settings."""
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ADMIN = ("owner@urjersey.test", "Str0ngPassw0rd")
ADDRESS = {"name": "Asha", "phone": "+91 98765 43210", "line1": "12 Stadium Road", "city": "Chennai", "state": "TN",
           "pincode": "600028"}


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "p.db"))
    monkeypatch.setenv("DESIGN_PROVIDER", "rule")
    monkeypatch.setenv("AI_EDITS", "off")
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN[0])
    monkeypatch.setenv("ADMIN_PASSWORD", ADMIN[1])
    monkeypatch.delenv("API_KEYS", raising=False)
    monkeypatch.delenv("FACTORY_URL", raising=False)
    for m in [m for m in sys.modules if m.startswith("app")]:
        del sys.modules[m]
    from fastapi.testclient import TestClient
    from app.main import app, store
    c = TestClient(app)
    spec = c.post("/api/v1/designs/generate", json={"prompt": "navy and gold cricket jersey", "variants": 1,
                                                    "team_name": "Strikers"}).json()["designs"][0]["spec"]
    return c, store, spec


def staff(c, email=ADMIN[0], password=ADMIN[1]):
    r = c.post("/api/v1/ops/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def order_body(spec, key="key_platform_1", items=None, **extra):
    return {"design_id": "dsn_1", "spec": spec, "language": "en", "idempotency_key": key,
            "customer": {"name": "Asha", "phone": "+91 98765 43210"},
            "items": items or [{"player_name": "Arul", "number": "7", "size": "M", "quantity": 2},
                               {"player_name": "Ravi", "number": "", "size": "XXL", "quantity": 1}],
            "delivery": {"method": "ship", "address": ADDRESS}, **extra}


# ------------------------------------------------------------------ pricing

def test_quote_itemises_every_amount(env):
    c, _, _ = env
    q = c.post("/api/v1/shop/quote", json={
        "garment": "jersey", "fabric": "premium", "logos": 1,
        "lines": [{"size": "M", "quantity": 10, "player_name": "Arul", "number": "7"},
                  {"size": "XXL", "quantity": 2, "player_name": "", "number": ""}],
        "delivery": {"method": "ship", "pincode": "600028"}, "coupon": "WELCOME10"}).json()
    # jersey 499 + premium 120 + 1 logo 25 = 644; line 1 + name 40 + number 30 = 714; XXL +60 = 704
    assert q["lines"][0]["unit_price"] == 714 and q["lines"][1]["unit_price"] == 704
    assert q["subtotal"] == 714 * 10 + 704 * 2 == 8548
    assert q["pieces"] == 12 and q["quantity_discount"]["rate"] == 0.05 and q["quantity_discount"]["amount"] == 427.4
    assert q["quantity_discount"]["next"] == {"min": 25, "rate": 0.10, "pieces_needed": 13}
    assert q["coupon"]["amount"] == 500                                     # 10%, capped at 500
    assert q["shipping"]["zone"] == "home" and q["shipping"]["free"] is True  # 7620.6 >= 5000
    assert q["tax"]["rate"] == 0.05                                         # under 1000 per piece
    assert q["total"] == round((8548 - 427.4 - 500) * 1.05, 2)
    assert q["estimate"]["delivery_date"] >= date.today().isoformat()


def test_bad_coupon_and_fabric_are_explained(env):
    c, _, _ = env
    q = c.post("/api/v1/shop/quote", json={"garment": "shorts", "fabric": "pro", "coupon": "NOPE",
                                           "lines": [{"size": "M", "quantity": 1}]}).json()
    assert q["coupon"]["error"] and q["problems"] and q["fabric"]["id"] == "standard"
    assert q["shipping"]["zone"] == "rest"


def test_express_costs_more_and_ships_sooner_when_busy(env):
    c, store, spec = env
    # fill the stitching line with a big paid order
    big = order_body(spec, key="key_big_order", items=[{"player_name": "", "number": "", "size": "L", "quantity": 450},
                                                     {"player_name": "", "number": "", "size": "XL", "quantity": 450}])
    o = c.post("/api/v1/orders", json=big).json()
    c.post(f"/api/v1/orders/{o['id']}/payment-confirmed", json={"demo": True})
    lines = [{"size": "M", "quantity": 20}]
    normal = c.post("/api/v1/shop/quote", json={"lines": lines}).json()
    rush = c.post("/api/v1/shop/quote", json={"lines": lines, "rush": True}).json()
    assert rush["rush"]["amount"] > 0 and rush["total"] > normal["total"]
    assert rush["estimate"]["ship_date"] < normal["estimate"]["ship_date"]


# ------------------------------------------------------------------ orders through their life

def test_order_is_priced_numbered_scheduled_and_tracked(env):
    c, store, spec = env
    r = c.post("/api/v1/orders", json=order_body(spec, coupon="WELCOME10"))
    assert r.status_code == 201
    o = r.json()
    assert o["number"].startswith("UJ-") and o["pricing"]["pieces"] == 3 and o["delivery"]["zone"] == "home"
    assert o["fulfilment"]["status"] == "awaiting_payment" and o["fulfilment"]["estimate"]["delivery_date"]
    assert o["timeline"][0]["code"] == "placed" and "events" not in o
    paid = c.post(f"/api/v1/orders/{o['id']}/payment-confirmed", json={"demo": True}).json()
    f = paid["fulfilment"]
    assert f["status"] == "queued" and f["promised_delivery_date"] >= f["promised_ship_date"]
    assert [s["id"] for s in f["stages"]][:2] == ["prepress", "print"]
    tracked = c.get(f"/api/v1/orders/{o['id']}/track", params={"phone": "9876543210"}).json()
    assert [t["code"] for t in tracked["timeline"]] == ["placed", "paid", "planned"]
    assert c.get(f"/api/v1/orders/{o['id']}/track", params={"phone": "9999999999"}).status_code == 404
    inv = c.get(f"/api/v1/orders/{o['id']}/invoice").text
    assert "Tax invoice" in inv and o["number"] in inv and "Demo payment" in inv


def test_production_stages_in_order_then_ship_and_deliver(env):
    c, store, spec = env
    h = staff(c)
    o = c.post("/api/v1/orders", json=order_body(spec)).json()
    c.post(f"/api/v1/orders/{o['id']}/payment-confirmed", json={"demo": True})
    assert c.post(f"/api/v1/ops/orders/{o['id']}/stages/print", headers=h).status_code == 409   # prepress first
    ship = c.post(f"/api/v1/ops/orders/{o['id']}/shipments", headers=h, json={"carrier": "air", "tracking_no": "AX1"}).json()
    assert c.patch(f"/api/v1/ops/shipments/{ship['id']}", headers=h, json={"status": "dispatched"}).status_code == 409
    board = c.get("/api/v1/ops/production/board", headers=h).json()["columns"]
    assert board[0]["stage"] == "prepress" and board[0]["orders"][0]["id"] == o["id"]
    for st in ["prepress", "print", "press", "cut", "stitch", "qc", "pack"]:
        r = c.post(f"/api/v1/ops/orders/{o['id']}/stages/{st}", headers=h)
        assert r.status_code == 200, r.text
    assert r.json()["fulfilment"]["status"] == "ready"
    c.patch(f"/api/v1/ops/shipments/{ship['id']}", headers=h, json={"status": "dispatched"})
    c.patch(f"/api/v1/ops/shipments/{ship['id']}", headers=h, json={"status": "delivered"})
    mine = c.get(f"/api/v1/orders/{o['id']}").json()
    assert mine["fulfilment"]["status"] == "delivered"
    assert [t["code"] for t in mine["timeline"]][-3:] == ["ready", "dispatched", "delivered"]
    assert "Label" in c.get(f"/api/v1/ops/shipments/{ship['id']}/label", headers=h).text


def test_manual_payment_hold_and_cancel(env):
    c, store, spec = env
    h = staff(c)
    o = c.post("/api/v1/orders", json=order_body(spec)).json()
    paid = c.post(f"/api/v1/ops/orders/{o['id']}/payments", headers=h,
                  json={"method": "upi", "reference": "UPI123", "amount": o["pricing"]["total"]}).json()
    assert paid["payment"]["method"] == "upi" and paid["payment"]["demo"] is False and paid["fulfilment"]["status"] == "queued"
    c.post(f"/api/v1/ops/orders/{o['id']}/hold", headers=h, json={"hold": True, "reason": "size check"})
    assert o["id"] not in {x["order_id"] for x in c.get("/api/v1/ops/production/plan", headers=h).json()["orders"]}
    public = c.get(f"/api/v1/orders/{o['id']}").json()
    assert "hold_reason" not in public["fulfilment"] and all(t["code"] != "hold" for t in public["timeline"])
    c.post(f"/api/v1/ops/orders/{o['id']}/cancel", headers=h, json={"reason": "customer asked"})
    assert c.get(f"/api/v1/orders/{o['id']}").json()["fulfilment"]["status"] == "cancelled"


def test_scheduler_respects_capacity_priority_and_working_days():
    from app.platform import defaults
    from app.platform.planning import schedule
    prod = {**defaults.PRODUCTION, "stages": [{"id": "stitch", "name": "Stitch", "capacity_per_day": 100, "fixed_days": 0}],
            "working_days": [0, 1, 2, 3, 4], "holidays": ["2026-10-02"]}
    paid = datetime(2026, 9, 28, 4, tzinfo=timezone.utc).isoformat()    # Monday 09:30 in India

    def order(oid, pieces, rush=False, due="2026-12-01"):
        return {"id": oid, "total_pieces": pieces, "created_at": paid, "delivery": {"transit_days": 2},
                "fulfilment": {"status": "queued", "rush": rush, "paid_at": paid, "promised_ship_date": due, "stages": []}}

    out = schedule([order("a", 250), order("b", 50, rush=True, due="2026-12-30")], prod, defaults.DELIVERY,
                   today=date(2026, 9, 28))
    b, a = out["plans"]["b"], out["plans"]["a"]
    assert b["stages"][0] == {"id": "stitch", "name": "Stitch", "start": "2026-09-28", "end": "2026-09-28", "pieces": 50}
    # a gets the other 50 on Monday, then 100 Tue, 100 Wed
    assert a["stages"][0]["start"] == "2026-09-28" and a["stages"][0]["end"] == "2026-09-30"
    assert out["load"]["stitch"] == {"2026-09-28": 100, "2026-09-29": 100, "2026-09-30": 100}
    big = schedule([order("c", 450)], prod, defaults.DELIVERY, today=date(2026, 9, 28))["plans"]["c"]
    assert big["stages"][0]["end"] == "2026-10-05"                       # skips the 2 Oct holiday and the weekend
    assert big["delivery_date"] == "2026-10-08"                          # ships next dispatch day, 2 days transit


# ------------------------------------------------------------------ customers

def test_otp_sign_in_links_guest_orders_and_lists_them(env):
    c, store, spec = env
    o = c.post("/api/v1/orders", json=order_body(spec)).json()
    code = c.post("/api/v1/auth/otp/request", json={"phone": "98765 43210"}).json()["dev_code"]
    assert c.post("/api/v1/auth/otp/verify", json={"phone": "9876543210", "code": "000000" if code != "000000" else "111111"}).status_code == 401
    r = c.post("/api/v1/auth/otp/verify", json={"phone": "9876543210", "code": code}).json()
    h = {"Authorization": f"Bearer {r['token']}"}
    assert r["customer"]["phone"] == "+919876543210"
    mine = c.get("/api/v1/me/orders", headers=h).json()
    assert [x["id"] for x in mine["orders"]] == [o["id"]]
    assert c.get(f"/api/v1/me/orders/{o['id']}", headers=h).json()["number"] == o["number"]
    re = c.post(f"/api/v1/me/orders/{o['id']}/reorder", headers=h).json()
    assert re["items"][0]["player_name"] == "Arul"
    c.patch("/api/v1/me", headers=h, json={"name": "Asha K", "addresses": [ADDRESS]})
    assert c.get("/api/v1/me", headers=h).json()["addresses"][0]["pincode"] == "600028"
    saved = c.post("/api/v1/me/designs", headers=h, json={"name": "Home kit", "spec": spec}).json()
    assert c.get("/api/v1/me/designs", headers=h).json()["total"] == 1
    assert c.delete(f"/api/v1/me/designs/{saved['id']}", headers=h).json()["ok"]
    c.post("/api/v1/auth/logout", headers=h)
    assert c.get("/api/v1/me", headers=h).status_code == 401


def _customer(c, phone="9000000001", name="Coach Ravi"):
    code = c.post("/api/v1/auth/otp/request", json={"phone": phone}).json()["dev_code"]
    r = c.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": code, "name": name}).json()
    return {"Authorization": f"Bearer {r['token']}"}


def test_team_collection_link_to_order(env):
    c, store, spec = env
    h = _customer(c)
    col = c.post("/api/v1/collections", headers=h, json={"title": "Strikers 2026 kit", "spec": spec}).json()
    pub = c.get(f"/api/v1/collections/{col['token']}").json()
    assert pub["title"] == "Strikers 2026 kit" and pub["count"] == 0 and "customer_id" not in pub
    e1 = c.post(f"/api/v1/collections/{col['token']}/entries", json={"player_name": "Arul", "number": "7", "size": "M"}).json()
    assert c.post(f"/api/v1/collections/{col['token']}/entries",
                  json={"player_name": "Bala", "number": "7", "size": "L"}).status_code == 409
    c.post(f"/api/v1/collections/{col['token']}/entries", json={"player_name": "Bala", "number": "9", "size": "L"})
    assert c.put(f"/api/v1/collections/{col['token']}/entries/{e1['id']}", params={"key": "wrongwrongwrong"},
                 json={"player_name": "Arul", "number": "8", "size": "M"}).status_code == 404
    c.put(f"/api/v1/collections/{col['token']}/entries/{e1['id']}", params={"key": e1["edit_key"]},
          json={"player_name": "Arul", "number": "8", "size": "S"})
    full = c.get(f"/api/v1/me/collections/{col['id']}", headers=h).json()
    assert sorted((e["number"], e["size"]) for e in full["entries"]) == [("8", "S"), ("9", "L")]
    c.post(f"/api/v1/me/collections/{col['id']}/status", headers=h, params={"status": "locked"})
    assert c.post(f"/api/v1/collections/{col['token']}/entries",
                  json={"player_name": "Late", "number": "1", "size": "M"}).status_code == 409
    items = [{k: e[k] for k in ("player_name", "number", "size", "quantity")} for e in full["entries"]]
    body = order_body(spec, key="key_collection_1", items=items, collection_id=col["id"], channel="web")
    body["customer"]["phone"] = "9000000001"
    assert c.post("/api/v1/orders", json=body).status_code == 401                 # needs the organiser signed in
    o = c.post("/api/v1/orders", json=body, headers=h).json()
    assert o["collection_id"] == col["id"]
    assert c.get(f"/api/v1/collections/{col['token']}").json()["status"] == "ordered"


def test_enquiry_becomes_lead_and_task_then_quote_is_accepted_online(env):
    c, store, spec = env
    h = staff(c)
    ref = c.post("/api/v1/shop/enquiries", json={"name": "Priya", "phone": "9123456780", "organisation": "Sunrise School",
                                                 "pieces": 60, "message": "House jerseys"}).json()["reference"]
    lead = c.get(f"/api/v1/ops/leads/{ref}", headers=h).json()
    assert lead["lead"]["stage"] == "new" and lead["lead"]["source"] == "web" and lead["activities"][0]["kind"] == "task"
    assert c.get("/api/v1/ops/tasks", headers=h).json()["items"]
    cust = lead["customer"]
    q = c.post("/api/v1/ops/quotes", headers=h, json={
        "customer_id": cust["id"], "lead_id": ref, "title": "House jerseys", "spec": spec,
        "lines": [{"size": "M", "quantity": 30}, {"size": "L", "quantity": 30}], "extra_discount": 1000,
        "delivery": {"method": "pickup"}}).json()
    assert q["number"].startswith("Q-") and q["pricing"]["sales_discount"] == 1000
    assert c.get(f"/api/v1/quotes/{q['token']}").status_code == 404                  # drafts are private
    sent = c.post(f"/api/v1/ops/quotes/{q['id']}/send", headers=h).json()
    assert sent["path"] == f"/quote/{q['token']}"
    assert c.get(f"/api/v1/ops/leads/{ref}", headers=h).json()["lead"]["stage"] == "quoted"
    pub = c.get(f"/api/v1/quotes/{q['token']}").json()
    assert pub["pricing"]["total"] == q["pricing"]["total"] and "created_by" not in pub
    acc = c.post(f"/api/v1/quotes/{q['token']}/accept", json={}).json()
    order = c.get(f"/api/v1/orders/{acc['order_id']}").json()
    assert order["pricing"]["total"] == q["pricing"]["total"] and order["channel"] == "sales"
    assert c.post(f"/api/v1/quotes/{q['token']}/accept", json={}).status_code == 409
    assert c.get(f"/api/v1/ops/quotes/{q['id']}", headers=h).json()["status"] == "converted"


def test_support_ticket_hides_internal_notes(env):
    c, store, spec = env
    ch = _customer(c)
    t = c.post("/api/v1/me/tickets", headers=ch, json={"subject": "Size exchange", "body": "Need L instead of M"}).json()
    h = staff(c)
    c.post(f"/api/v1/ops/tickets/{t['id']}", headers=h, json={"body": "check stock first", "internal": True})
    c.post(f"/api/v1/ops/tickets/{t['id']}", headers=h, json={"body": "Sure, we will swap it.", "status": "pending"})
    mine = c.get("/api/v1/me/tickets", headers=ch).json()["tickets"][0]
    assert [m["body"] for m in mine["messages"]] == ["Need L instead of M", "Sure, we will swap it."]
    assert mine["status"] == "pending"
    rr = c.post(f"/api/v1/me/tickets/{t['id']}/reply", headers=ch, json={"body": "Thanks"})
    assert rr.status_code == 200, rr.text
    assert c.get(f"/api/v1/ops/tickets/{t['id']}", headers=h).json()["status"] == "open"


# ------------------------------------------------------------------ staff, settings, reports

def test_roles_limit_what_staff_can_change(env):
    c, store, spec = env
    h = staff(c)
    assert c.post("/api/v1/ops/staff", headers=h, json={"email": "p@x.in", "name": "Prod", "role": "production",
                                                       "password": "weak"}).status_code == 422
    c.post("/api/v1/ops/staff", headers=h, json={"email": "p@x.in", "name": "Prod", "role": "production",
                                                "password": "Producti0nLine"})
    p = staff(c, "p@x.in", "Producti0nLine")
    pb = c.get("/api/v1/ops/settings/price_book", headers=p).json()
    assert c.put("/api/v1/ops/settings/price_book", headers=p, json={"value": pb["value"], "version": 0}).status_code == 403
    assert c.post("/api/v1/ops/leads", headers=p, json={"title": "x"}).status_code == 403
    prod = c.get("/api/v1/ops/settings/production", headers=p).json()
    assert c.put("/api/v1/ops/settings/production", headers=p, json={"value": prod["value"], "version": 0}).status_code == 200
    assert c.get("/api/v1/ops/dashboard").status_code == 401


def test_settings_are_validated_versioned_and_used_at_checkout(env):
    c, store, spec = env
    h = staff(c)
    pb = c.get("/api/v1/ops/settings/price_book", headers=h).json()
    assert pb["version"] == 0
    bad = {**pb["value"], "quantity_tiers": [{"min": 5, "discount": 0.1}]}
    r = c.put("/api/v1/ops/settings/price_book", headers=h, json={"value": bad, "version": 0})
    assert r.status_code == 422 and "tiers" in r.json()["detail"][0]["msg"]
    new = {**pb["value"], "garments": {**pb["value"]["garments"], "jersey": {"name": "Jersey", "base": 600}}}
    sim = c.post("/api/v1/ops/pricing/simulate", headers=h,
                 json={"price_book": new, "request": {"lines": [{"size": "M", "quantity": 1}]}}).json()
    assert sim["draft"]["subtotal"] == 600 and sim["current"]["subtotal"] == 499
    assert c.put("/api/v1/ops/settings/price_book", headers=h, json={"value": new, "version": 0}).json()["version"] == 1
    assert c.put("/api/v1/ops/settings/price_book", headers=h, json={"value": new, "version": 0}).status_code == 409
    assert c.post("/api/v1/shop/quote", json={"lines": [{"size": "M", "quantity": 1}]}).json()["subtotal"] == 600
    assert c.get("/api/v1/shop/catalogue").json()["garments"]["jersey"]["base"] == 600
    assert "coupons" not in c.get("/api/v1/shop/catalogue").json()
    hist = c.get("/api/v1/ops/settings/price_book/history", headers=h).json()["items"]
    assert hist[0]["version"] == 1 and hist[0]["updated_by"].startswith("staff:")
    d = c.get("/api/v1/ops/settings/delivery", headers=h).json()["value"]
    d["zones"] = [z for z in d["zones"] if z["id"] != "rest"]
    assert c.put("/api/v1/ops/settings/delivery", headers=h, json={"value": d, "version": 0}).status_code == 422


def test_dashboard_reports_exports_and_crm_views(env):
    c, store, spec = env
    h = staff(c)
    o = c.post("/api/v1/orders", json=order_body(spec)).json()
    c.post(f"/api/v1/orders/{o['id']}/payment-confirmed", json={"demo": True})
    d = c.get("/api/v1/ops/dashboard", headers=h).json()
    assert d["orders"]["today"] == 1 and d["revenue"]["today"] == o["pricing"]["total"]
    assert d["production"]["active"] == 1 and d["production"]["bottleneck"]
    today = date.today().isoformat()
    rep = c.get("/api/v1/ops/reports/sales", headers=h, params={"since": today, "until": today}).json()
    assert rep["orders"] == 1 and rep["by_channel"] == {"app": o["pricing"]["total"]}
    csv_text = c.get("/api/v1/ops/exports/orders.csv", headers=h).text
    assert o["number"] in csv_text.splitlines()[1]
    custs = c.get("/api/v1/ops/customers", headers=h, params={"q": "asha"}).json()
    assert custs["total"] == 1 and custs["items"][0]["orders_count"] == 1
    view = c.get(f"/api/v1/ops/customers/{custs['items'][0]['id']}", headers=h).json()
    assert view["orders"][0]["id"] == o["id"]
    assert c.get("/api/v1/ops/production/utilisation", headers=h, params={"days": 5}).json()["dates"]
    assert c.get("/api/v1/ops/delivery/plan", headers=h).json()["days"]
    wl = c.get("/api/v1/ops/production/worklist", headers=h, params={"stage": "print"}).json()
    assert wl["items"] and wl["items"][0]["files"]
    org = c.post("/api/v1/ops/organisations", headers=h, json={"name": "Chennai Strikers", "kind": "club"}).json()
    lead = c.post("/api/v1/ops/leads", headers=h, json={"title": "Season kit", "organisation_id": org["id"], "value": 40000}).json()
    c.put(f"/api/v1/ops/leads/{lead['id']}", headers=h, json={"title": "Season kit", "organisation_id": org["id"],
                                                              "value": 40000, "stage": "won"})
    pipe = c.get("/api/v1/ops/leads/pipeline", headers=h).json()
    assert pipe["win_rate"] == 1.0
    assert c.get("/api/v1/ops/audit", headers=h).json()["items"]



def test_returned_shipment_lockout_quote_expiry_and_filters(env):
    c, store, spec = env
    h = staff(c)
    o = c.post("/api/v1/orders", json=order_body(spec, key="key_ret_1")).json()
    c.post(f"/api/v1/orders/{o['id']}/payment-confirmed", json={"demo": True})
    for st in ["prepress", "print", "press", "cut", "stitch", "qc", "pack"]:
        c.post(f"/api/v1/ops/orders/{o['id']}/stages/{st}", headers=h)
    ship = c.post(f"/api/v1/ops/orders/{o['id']}/shipments", headers=h, json={"carrier": "air", "tracking_no": "AX9"}).json()
    c.patch(f"/api/v1/ops/shipments/{ship['id']}", headers=h, json={"status": "dispatched"})
    c.patch(f"/api/v1/ops/shipments/{ship['id']}", headers=h, json={"status": "returned"})
    back = c.get(f"/api/v1/orders/{o['id']}").json()
    assert back["fulfilment"]["status"] == "ready"
    assert back["timeline"][-1]["code"] == "returned"

    # A new role or password signs the person out at once.
    new = c.post("/api/v1/ops/staff", headers=h, json={"email": "p@urjersey.test", "name": "P", "role": "production",
                                                        "password": "Pr0ductionPass"}).json()
    hp = staff(c, "p@urjersey.test", "Pr0ductionPass")
    assert c.get("/api/v1/ops/me", headers=hp).status_code == 200
    c.patch(f"/api/v1/ops/staff/{new['id']}", headers=h, json={"password": "N3wProductionPass"})
    assert c.get("/api/v1/ops/me", headers=hp).status_code == 401

    # Quote expiry is kept on edit unless changed; quotes filter by customer and lead.
    cust = c.post("/api/v1/ops/customers", headers=h, json={"name": "Club", "phone": "+91 90000 00001"}).json()
    body = {"customer_id": cust["id"], "lead_id": "led_x", "spec": spec, "lines": [{"size": "M", "quantity": 2}],
            "valid_until": "2031-01-31"}
    q = c.post("/api/v1/ops/quotes", headers=h, json=body).json()
    assert q["valid_until"] == "2031-01-31"
    body.pop("valid_until")
    assert c.put(f"/api/v1/ops/quotes/{q['id']}", headers=h, json={**body, "title": "edited"}).json()["valid_until"] == "2031-01-31"
    assert [x["id"] for x in c.get(f"/api/v1/ops/quotes?customer_id={cust['id']}", headers=h).json()["items"]] == [q["id"]]
    assert c.get("/api/v1/ops/quotes?lead_id=led_other", headers=h).json()["items"] == []


def test_orders_are_only_shown_to_their_owner(env):
    c, store, spec = env
    mine = {"X-Device-Id": "uj-phone-a"}
    o = c.post("/api/v1/orders", json=order_body(spec, key="key_own_1"), headers=mine).json()
    assert c.get(f"/api/v1/orders/{o['id']}", headers=mine).status_code == 200
    stranger = {"X-Device-Id": "uj-phone-b"}
    assert c.get(f"/api/v1/orders/{o['id']}", headers=stranger).status_code == 404
    assert c.post(f"/api/v1/orders/{o['id']}/payment-confirmed", json={"demo": True}, headers=stranger).status_code == 404
    assert c.get(f"/api/v1/orders/{o['id']}/invoice", headers=stranger).status_code == 404
    assert c.get(f"/api/v1/orders/{o['id']}/invoice?phone=9876543210", headers=stranger).status_code == 200
    assert c.get(f"/api/v1/orders/{o['id']}", headers={**stranger, **staff(c)}).status_code == 200
    # Guests track with the order number (or reference) and their phone.
    assert c.get(f"/api/v1/orders/{o['number']}/track?phone=%2B919876543210").json()["id"] == o["id"]
    assert c.get(f"/api/v1/orders/{o['number']}/track?phone=9000000000").status_code == 404

    # Shipment details and translatable timeline parameters reach the customer.
    h = staff(c)
    c.post(f"/api/v1/orders/{o['id']}/payment-confirmed", json={"demo": True}, headers=mine)
    for st in ["prepress", "print", "press", "cut", "stitch", "qc", "pack"]:
        c.post(f"/api/v1/ops/orders/{o['id']}/stages/{st}", headers=h)
    ship = c.post(f"/api/v1/ops/orders/{o['id']}/shipments", headers=h, json={"carrier": "air", "tracking_no": "AX5"}).json()
    c.patch(f"/api/v1/ops/shipments/{ship['id']}", headers=h, json={"status": "dispatched"})
    v = c.get(f"/api/v1/orders/{o['id']}", headers=mine).json()
    assert v["fulfilment"]["shipment"]["tracking_no"] == "AX5" and v["fulfilment"]["shipment"]["status"] == "dispatched"
    assert v["timeline"][-1]["params"]["tracking"] == "AX5"
    q = c.post("/api/v1/shop/quote", json={"lines": [{"size": "M", "quantity": 2}]}).json()
    assert "estimate_express" in q
