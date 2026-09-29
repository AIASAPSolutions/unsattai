"""Marketplace: sellers and PIN code serviceability, per-seller planning, phone and email
accounts, products, carts and checkout, cash on delivery, cancel, returns, reviews,
notifications and the seller login's scope."""
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ADMIN = ("owner@urjersey.test", "Str0ngPassw0rd")
PHONE = "+91 90000 00001"
ADDRESS = {"name": "Test Buyer", "phone": PHONE, "line1": "1 Test Street", "city": "Chennai", "state": "TN",
           "pincode": "600028"}
STAGES = ["prepress", "print", "press", "cut", "stitch", "qc", "pack"]


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "m.db"))
    monkeypatch.setenv("DESIGN_PROVIDER", "rule")
    monkeypatch.setenv("AI_EDITS", "off")
    monkeypatch.setenv("OTP_DEV_ECHO", "1")
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN[0])
    monkeypatch.setenv("ADMIN_PASSWORD", ADMIN[1])
    for k in ("API_KEYS", "FACTORY_URL", "SMS_WEBHOOK_URL", "EMAIL_WEBHOOK_URL"):
        monkeypatch.delenv(k, raising=False)
    for m in [m for m in sys.modules if m.startswith("app")]:
        del sys.modules[m]
    from fastapi.testclient import TestClient
    from app.main import app, store
    c = TestClient(app)
    spec = c.post("/api/v1/designs/generate", json={"prompt": "navy and gold cricket jersey", "variants": 1,
                                                    "team_name": "Testers"}).json()["designs"][0]["spec"]
    return c, store, spec


def staff(c, email=ADMIN[0], password=ADMIN[1]):
    r = c.post("/api/v1/ops/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def seller_body(name, areas, **extra):
    return {"name": name, "service_areas": areas, **extra}


def add_seller(c, h, name, areas, **extra):
    r = c.post("/api/v1/ops/sellers", headers=h, json=seller_body(name, areas, **extra))
    assert r.status_code == 201, r.text
    return r.json()


def set_house(c, h, **changes):
    house = c.get("/api/v1/ops/sellers/sel_house", headers=h).json()["seller"]
    keep = {k: house[k] for k in ("name", "legal_name", "gstin", "email", "phone", "address", "active", "garments",
                                  "fabrics", "service_areas", "blocked_pincodes", "capacity_factor", "holidays",
                                  "handling_days", "min_pieces", "max_pieces", "price_adjust")}
    r = c.put("/api/v1/ops/sellers/sel_house", headers=h, json={**keep, **changes})
    assert r.status_code == 200, r.text
    return r.json()


def sign_in(c, phone=None, email=None, name="Test Buyer", ua="pytest"):
    ident = {"phone": phone} if phone else {"email": email}
    code = c.post("/api/v1/auth/otp/request", json=ident).json()["dev_code"]
    r = c.post("/api/v1/auth/otp/verify", json={**ident, "code": code, "name": name}, headers={"User-Agent": ua})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}, r.json()


def order_body(spec, key, qty=2, **extra):
    return {"design_id": "", "spec": spec, "idempotency_key": key,
            "customer": {"name": "Test Buyer", "phone": PHONE},
            "items": [{"player_name": "Arul", "number": "7", "size": "M", "quantity": qty}],
            "delivery": {"method": "ship", "address": ADDRESS}, **extra}


def deliver(c, h, order_id, pay=True):
    if pay:
        assert c.post(f"/api/v1/orders/{order_id}/payment-confirmed", json={"demo": True}).status_code == 200
    for st in STAGES:
        assert c.post(f"/api/v1/ops/orders/{order_id}/stages/{st}", headers=h).status_code == 200
    shp = c.post(f"/api/v1/ops/orders/{order_id}/shipments", headers=h, json={"carrier": "air", "tracking_no": "TRK1"}).json()
    for status in ("dispatched", "delivered"):
        assert c.patch(f"/api/v1/ops/shipments/{shp['id']}", headers=h, json={"status": status}).status_code == 200
    return shp


def products(c, **params):
    return c.get("/api/v1/shop/products", params=params).json()


# ------------------------------------------------------------------ sellers and serviceability

def test_house_seller_is_created_from_the_delivery_zones(env):
    c, store, spec = env
    house = store.get("seller", "sel_house")
    areas = {a["match"]: a["transit_days"] for a in house["service_areas"]}
    assert areas["60"] == 2 and areas["KL"] == 3 and areas["11"] == 4 and areas["*"] == 6
    o = c.post("/api/v1/orders", json=order_body(spec, "key_house_1")).json()
    assert o["seller"] == {"id": "sel_house", "name": "UrJersey"} and o["delivery"]["transit_days"] == 2
    assert o["payment_method"] == "online" and o["can_cancel"] is True and o["checkout_id"] is None


def test_serviceability_blocked_specific_match_limits_and_ranking(env):
    c, _, spec = env
    h = staff(c)
    set_house(c, h, service_areas=[{"match": "60", "transit_days": 2}, {"match": "TN", "transit_days": 3}],
              blocked_pincodes=["600119"], max_pieces=1000)
    b = add_seller(c, h, "Fast Prints", [{"match": "6000", "transit_days": 1, "cod": False},
                                         {"match": "KL", "transit_days": 2}, {"match": "*", "transit_days": 7}],
                   garments=["jersey", "vneck"], price_adjust=0.1, min_pieces=10)

    def svc(pin, **kw):
        return c.get("/api/v1/shop/serviceability", params={"pincode": pin, **kw}).json()

    r = svc("600028", pieces=20)
    assert r["serviceable"] and r["place"] == {"state": "TN", "state_name": "Tamil Nadu"}
    by = {o["seller_id"]: o for o in r["offers"]}
    assert by[b["id"]]["transit_days"] == 1 and by["sel_house"]["transit_days"] == 2   # "6000" beats "60"
    assert r["offers"][0]["seller_id"] == b["id"] == r["recommended_seller_id"]        # earliest delivery first
    assert by[b["id"]]["recommended"] and by[b["id"]]["fastest"] and by["sel_house"]["cheapest"]
    assert by[b["id"]]["unit_price"] > by["sel_house"]["unit_price"]
    assert by[b["id"]]["cod_available"] is False and by["sel_house"]["cod_available"] is True

    assert [o["seller_id"] for o in svc("600119", pieces=20)["offers"]] == [b["id"]]     # blocked for the house
    tn = {o["seller_id"]: o["transit_days"] for o in svc("641601", pieces=20)["offers"]}
    assert tn == {"sel_house": 3, b["id"]: 7}                                           # state beats "*"
    assert svc("682001", pieces=20)["offers"][0]["transit_days"] == 2                   # KL state area

    assert svc("110001", pieces=20)["recommended_seller_id"] == b["id"]
    assert svc("110001", pieces=5)["reason"] == "pieces_out_of_range"
    assert svc("110001", pieces=20, garment="shorts")["reason"] == "garment_unavailable"
    assert svc("000000")["reason"] == "invalid_pincode" and svc("12345")["reason"] == "invalid_pincode"
    set_house(c, h, max_pieces=10)
    assert [o["seller_id"] for o in svc("641601", pieces=20)["offers"]] == [b["id"]]

    # A seller that can't serve the PIN code: a quote problem, and a 422 on order.
    q = c.post("/api/v1/shop/quote", json={"lines": [{"size": "M", "quantity": 20}], "seller_id": "sel_house",
                                           "delivery": {"method": "ship", "pincode": "110001"}}).json()
    assert q["seller"] is None and q["seller_problem"] == "not_serviceable" and q["problems"]
    delhi = {**ADDRESS, "state": "DL", "pincode": "110001", "city": "Delhi"}
    r = c.post("/api/v1/orders", json={**order_body(spec, "key_delhi_1", qty=12), "seller_id": "sel_house",
                                       "delivery": {"method": "ship", "address": delhi}})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "not_serviceable"
    o = c.post("/api/v1/orders", json={**order_body(spec, "key_delhi_2", qty=12),
                                       "delivery": {"method": "ship", "address": delhi}}).json()
    assert o["seller"]["id"] == b["id"] and o["delivery"]["transit_days"] == 7
    assert o["pricing"]["lines"][0]["parts"]["seller"] > 0


def test_seller_settings_are_validated(env):
    c, _, _ = env
    h = staff(c)
    bad = c.post("/api/v1/ops/sellers", headers=h, json=seller_body("X Prints", [{"match": "Chennai", "transit_days": 2}]))
    assert bad.status_code == 422 and "PIN code prefix" in str(bad.json())
    bad = c.post("/api/v1/ops/sellers", headers=h, json=seller_body("X Prints", [{"match": "*", "transit_days": 2}],
                                                                   min_pieces=50, max_pieces=10))
    assert bad.status_code == 422
    bad = c.post("/api/v1/ops/sellers", headers=h, json=seller_body("X Prints", [{"match": "*", "transit_days": 2}],
                                                                   fabrics=["silk"]))
    assert bad.status_code == 422 and "silk" in bad.json()["detail"]
    pb = c.get("/api/v1/ops/settings/price_book", headers=h).json()
    pb["value"]["coupons"][0]["title"] = ""
    r = c.put("/api/v1/ops/settings/price_book", headers=h, json={"value": pb["value"], "version": pb["version"]})
    assert r.status_code == 422 and "title" in str(r.json())
    crm = c.get("/api/v1/ops/settings/crm", headers=h).json()
    crm["value"]["returnable_reasons"] = ["Changed my mind"]
    r = c.put("/api/v1/ops/settings/crm", headers=h, json={"value": crm["value"], "version": crm["version"]})
    assert r.status_code == 422


def test_pincode_check_for_the_coverage_editor(env):
    c, _, _ = env
    h = staff(c)
    r = c.get("/api/v1/ops/sellers/sel_house/pincode-check", headers=h, params={"pincode": "682001"}).json()
    assert r["serviceable"] and r["area"]["match"] == "68" and r["matched_by"] == "prefix" and r["estimate"]
    r = c.get("/api/v1/ops/sellers/sel_house/pincode-check", headers=h, params={"pincode": "999999"}).json()
    assert r["reason"] == "invalid_pincode"


def test_pincode_table_is_approximate_but_sensible():
    from app.platform import pincodes
    assert pincodes.state_for("600028") == "TN" and pincodes.state_for("605001") == "PY"
    assert pincodes.state_for("110001") == "DL" and pincodes.state_for("400001") == "MH"
    assert pincodes.state_for("403001") == "GA" and pincodes.state_for("682555") == "LD"
    assert pincodes.state_for("560001") == "KA" and pincodes.state_for("500001") == "TS"
    assert pincodes.state_for("999999") is None and pincodes.state_for("06000") is None


# ------------------------------------------------------------------ planning per seller

def test_each_seller_is_planned_against_its_own_capacity(env):
    c, _, spec = env
    h = staff(c)
    half = add_seller(c, h, "Half Unit", [{"match": "*", "transit_days": 2}], capacity_factor=0.5)

    def offers(pieces):
        r = c.get("/api/v1/shop/serviceability", params={"pincode": "600028", "pieces": pieces}).json()
        return {o["seller_id"]: o for o in r["offers"]}

    before = offers(500)
    assert before[half["id"]]["ship_date"] > before["sel_house"]["ship_date"]      # half the stitching capacity

    items = [{"player_name": "", "number": "", "size": "L", "quantity": 450},
             {"player_name": "", "number": "", "size": "XL", "quantity": 450}]
    o = c.post("/api/v1/orders", json={**order_body(spec, "key_big_house"), "items": items, "seller_id": "sel_house"}).json()
    c.post(f"/api/v1/orders/{o['id']}/payment-confirmed", json={"demo": True})
    after = offers(500)
    assert after["sel_house"]["ship_date"] > before["sel_house"]["ship_date"]      # the house is busy now
    assert after[half["id"]]["ship_date"] == before[half["id"]]["ship_date"]       # the other seller is not

    util = c.get("/api/v1/ops/production/utilisation", headers=h, params={"seller_id": half["id"]}).json()
    stitch = next(s for s in util["stages"] if s["stage"] == "stitch")
    assert stitch["days"][0]["capacity"] == 125 and stitch["days"][0]["load"] == 0
    house_plan = c.get("/api/v1/ops/production/plan", headers=h, params={"seller_id": "sel_house"}).json()
    assert [p["order_id"] for p in house_plan["orders"]] == [o["id"]]
    assert c.get("/api/v1/ops/production/plan", headers=h, params={"seller_id": half["id"]}).json()["orders"] == []
    everything = c.get("/api/v1/ops/production/utilisation", headers=h).json()
    assert next(s for s in everything["stages"] if s["stage"] == "stitch")["days"][0]["capacity"] == 250 + 125


# ------------------------------------------------------------------ accounts

def test_email_code_sign_in_password_and_lockout(env):
    c, _, _ = env
    a = c.post("/api/v1/auth/otp/request", json={"email": "new.person@example.com"}).json()
    r = c.post("/api/v1/auth/otp/verify", json={"email": "New.Person@example.com", "code": a["dev_code"]})
    h, out = {"Authorization": f"Bearer {r.json()['token']}"}, r.json()
    b = c.post("/api/v1/auth/otp/request", json={"email": "someone.else@example.com"}).json()
    again = c.post("/api/v1/auth/otp/request", json={"email": "someone.else@example.com"})
    assert set(a) == set(b) == {"sent", "email", "expires_in", "dev_code"}       # no hint an account exists
    assert again.status_code == 429
    assert out["customer"]["email"] == "new.person@example.com" and out["customer"]["email_verified"]
    assert c.post("/api/v1/me/password", headers=h, json={"new": "short"}).status_code == 422
    assert c.post("/api/v1/me/password", headers=h, json={"new": "Better0ne1234"}).status_code == 200

    ok = c.post("/api/v1/auth/login", json={"identifier": "new.person@example.com", "password": "Better0ne1234"})
    assert ok.status_code == 200 and ok.json()["customer"]["has_password"]
    for _ in range(5):
        assert c.post("/api/v1/auth/login", json={"identifier": "NEW.person@example.com",
                                                  "password": "wrong-one"}).status_code == 401
    locked = c.post("/api/v1/auth/login", json={"identifier": "new.person@example.com", "password": "Better0ne1234"})
    assert locked.status_code == 429
    unknown = c.post("/api/v1/auth/login", json={"identifier": "nobody@example.com", "password": "Better0ne1234"})
    assert unknown.status_code == 401 and unknown.json()["detail"] == c.post(
        "/api/v1/auth/login", json={"identifier": "+91 90000 00009", "password": "x"}).json()["detail"]
    # changing the password later needs the current one (the code session is no longer fresh)
    h2 = {"Authorization": f"Bearer {ok.json()['token']}"}
    assert c.post("/api/v1/me/password", headers=h2, json={"new": "Another0ne123"}).status_code == 401


def test_staff_login_locks_after_five_wrong_passwords(env):
    c, _, _ = env
    for _ in range(5):
        assert c.post("/api/v1/ops/auth/login", json={"email": ADMIN[0], "password": "nope"}).status_code == 401
    assert c.post("/api/v1/ops/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]}).status_code == 429


def test_adding_a_verified_email_and_conflicts(env):
    c, _, _ = env
    h, _ = sign_in(c, phone=PHONE)
    r = c.post("/api/v1/me/identifiers/request", headers=h, json={"email": "buyer@example.com"})
    assert r.status_code == 200
    me = c.post("/api/v1/me/identifiers/verify", headers=h, json={"email": "buyer@example.com", "code": r.json()["dev_code"]})
    assert me.status_code == 200 and me.json()["email_verified"] and me.json()["phone_verified"]
    assert c.post("/api/v1/me/identifiers/verify", headers=h,
                  json={"email": "buyer@example.com", "code": "000000"}).status_code == 401
    other, _ = sign_in(c, phone="+91 90000 00002")
    assert c.post("/api/v1/me/identifiers/request", headers=other, json={"email": "buyer@example.com"}).status_code == 409
    assert c.post("/api/v1/me/identifiers/request", headers=other, json={"phone": PHONE}).status_code == 409
    # the same person can now sign in by email and lands on the same account
    _, out = sign_in(c, email="buyer@example.com")
    assert out["customer"]["phone"] == "+919000000001"


def test_sessions_list_and_revoke(env):
    c, store, _ = env
    phone_ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36"
    h1, _ = sign_in(c, phone=PHONE, ua=phone_ua)
    store.drop_otp("+919000000001")
    h2, _ = sign_in(c, phone=PHONE, ua="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15")
    rows = c.get("/api/v1/me/sessions", headers=h1).json()["items"]
    assert len(rows) == 2 and sum(r["current"] for r in rows) == 1
    labels = {r["device_label"] for r in rows}
    assert labels == {"Chrome on Android", "Safari on Mac"}
    other = next(r for r in rows if not r["current"])
    assert all(r["created_at"] and r["last_seen_at"] and r["id"].startswith("ses_") for r in rows)
    assert c.delete(f"/api/v1/me/sessions/{other['id']}", headers=h1).status_code == 200
    assert c.get("/api/v1/me", headers=h2).status_code == 401
    assert c.delete(f"/api/v1/me/sessions/{other['id']}", headers=h1).status_code == 404
    store.drop_otp("+919000000001")
    h3, _ = sign_in(c, phone=PHONE)
    assert c.post("/api/v1/me/sessions/revoke-others", headers=h3).json()["signed_out"] == 1
    assert c.get("/api/v1/me", headers=h1).status_code == 401 and c.get("/api/v1/me", headers=h3).status_code == 200


def test_old_sessions_table_is_migrated(tmp_path):
    db = tmp_path / "old.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, subject_kind TEXT NOT NULL, "
                "subject_id TEXT NOT NULL, expires_at TEXT NOT NULL)")
    con.execute("INSERT INTO sessions VALUES ('abc', 'customer', 'cus_1', '2999-01-01T00:00:00+00:00')")
    con.commit()
    con.close()
    from app.platform.db import PlatformStore
    store = PlatformStore(db)
    row = store.get_session("abc")
    assert row["id"].startswith("ses_") and row["created_at"] and row["device_label"] == ""
    PlatformStore(db)   # a second start changes nothing
    assert store.sessions_for("customer", "cus_1")[0]["id"] == row["id"]


def test_guest_orders_link_by_verified_email(env):
    c, _, spec = env
    body = order_body(spec, "key_guest_email")
    body["customer"] = {"name": "Guest", "phone": "+91 90000 00077", "email": "guest@example.com"}
    o = c.post("/api/v1/orders", json=body).json()
    h, _ = sign_in(c, email="GUEST@example.com")
    assert [x["id"] for x in c.get("/api/v1/me/orders", headers=h).json()["orders"]] == [o["id"]]
    assert [n["code"] for n in c.get("/api/v1/me/notifications", headers=h).json()["items"]] == ["placed"]
    other, _ = sign_in(c, email="other@example.com")
    assert c.get("/api/v1/me/orders", headers=other).json()["orders"] == []


# ------------------------------------------------------------------ products, wishlist

def test_seeded_products_search_facets_sort_and_wishlist(env):
    c, _, _ = env
    everything = products(c, size=60)
    assert everything["total"] == 12
    sports = {f["value"]: f["count"] for f in everything["facets"]["sport"]}
    garments = {f["value"]: f["count"] for f in everything["facets"]["garment"]}
    assert sports["football"] == 2 and len(sports) >= 10 and set(garments) == {"jersey", "vneck", "shorts"}
    shorts = products(c, garment="shorts")
    assert shorts["total"] == 2 and all(p["garment"] == "shorts" for p in shorts["items"])
    # the garment facet ignores its own filter, so the other choices stay visible
    assert {f["value"] for f in shorts["facets"]["garment"]} == {"jersey", "vneck", "shorts"}
    assert [p["sport"] for p in products(c, q="cricket")["items"]] == ["cricket"]
    prices = [p["price_from"] for p in products(c, sort="price_asc", size=60)["items"]]
    assert prices == sorted(prices) and prices[0] == 349
    assert [p["price_from"] for p in products(c, sort="price_desc", size=60)["items"]] == sorted(prices, reverse=True)
    assert all(p["price_from"] <= 400 for p in products(c, max_price=400)["items"])
    colour = everything["facets"]["colour"][0]
    assert products(c, colour=colour["value"])["total"] == colour["count"]
    page2 = products(c, size=5, page=3)
    assert len(page2["items"]) == 2 and page2["pages"] == 3

    slug = everything["items"][0]["slug"]
    detail = c.get(f"/api/v1/shop/products/{slug}").json()
    assert detail["spec"]["garment"] == detail["garment"] and detail["review_summary"]["count"] == 0
    assert c.get(detail["image_url"]).headers["content-type"].startswith("image/svg+xml")

    h, _ = sign_in(c, phone=PHONE)
    pid = detail["id"]
    assert c.post("/api/v1/me/wishlist", headers=h, json={"product_id": pid}).json()["product_ids"] == [pid]
    assert c.post("/api/v1/me/wishlist", headers=h, json={"product_id": pid}).json()["product_ids"] == [pid]
    assert c.get("/api/v1/me/wishlist", headers=h).json()["items"][0]["slug"] == slug
    assert c.delete(f"/api/v1/me/wishlist/{pid}", headers=h).json()["product_ids"] == []

    ops = staff(c)
    assert c.post(f"/api/v1/ops/products/{pid}/unpublish", headers=ops).json()["status"] == "draft"
    assert products(c)["total"] == 11 and c.get(f"/api/v1/shop/products/{slug}").status_code == 404
    assert c.post("/api/v1/me/wishlist", headers=h, json={"product_id": pid}).status_code == 404
    made = c.post("/api/v1/ops/products", headers=ops, json={"title": "Brief Tee", "status": "published",
                                                             "brief": {"prompt": "black and orange hockey jersey",
                                                                       "sport": "hockey", "seed": 5}})
    assert made.status_code == 201 and made.json()["sport"] == "hockey"
    featured = c.post(f"/api/v1/ops/products/{made.json()['id']}/feature", headers=ops).json()
    assert featured["featured"] and products(c, q="brief tee")["items"][0]["featured"]


# ------------------------------------------------------------------ cart and checkout

def _items(c, n=2):
    ps = products(c, garment="jersey", size=60)["items"][:n]
    qty = [10, 5, 3]
    return [{"product_id": p["id"], "fabric": "standard",
             "lines": [{"player_name": "", "number": "", "size": "M", "quantity": qty[i]}]} for i, p in enumerate(ps)]


def test_cart_quote_splits_the_coupon_by_value(env):
    c, _, _ = env
    items = _items(c)
    q = c.post("/api/v1/shop/cart/quote", json={"items": items, "coupon": "WELCOME10",
                                               "delivery": {"method": "ship", "pincode": "600028"}}).json()
    after = [x["quote"]["subtotal"] - x["quote"]["quantity_discount"]["amount"] for x in q["items"]]
    expected = round(min(sum(after) * 0.10, 500), 2)
    assert q["coupon"]["amount"] == expected == q["totals"]["coupon"]
    shares = [s["amount"] for s in q["coupon"]["split"]]
    assert round(sum(shares), 2) == expected and shares[0] > shares[1]
    assert abs(shares[0] / shares[1] - after[0] / after[1]) < 0.01
    assert [x["quote"]["coupon"]["amount"] for x in q["items"]] == shares
    assert q["totals"]["total"] == round(sum(x["quote"]["total"] for x in q["items"]), 2)
    assert all(x["seller"]["id"] == "sel_house" and x["delivery_date"] for x in q["items"])
    offers = c.get("/api/v1/shop/offers").json()["items"]
    assert offers[0]["code"] == "WELCOME10" and offers[0]["title"]


def test_cart_pays_one_delivery_per_seller_and_one_cod_fee(env):
    c, _, _ = env
    items = _items(c)
    body = {"items": items, "delivery": {"method": "ship", "pincode": "600028"}}
    one = c.post("/api/v1/shop/cart/quote", json={**body, "items": items[:1]}).json()
    both = c.post("/api/v1/shop/cart/quote", json=body).json()
    ships = [x["quote"]["shipping"]["amount"] for x in both["items"]]
    assert ships[1] == 0 and both["totals"]["shipping"] == ships[0]
    assert both["totals"]["shipping"] <= one["totals"]["shipping"] + 20 * sum(x["quote"]["pieces"] for x in both["items"])
    cod = c.post("/api/v1/shop/cart/quote", json={**body, "payment_method": "cod"}).json()
    fees = [x["quote"]["cod"]["fee"] for x in cod["items"]]
    assert fees[1] == 0 and cod["totals"]["cod_fee"] == fees[0]
    assert cod["totals"]["total"] == round(sum(x["quote"]["total"] for x in cod["items"]), 2)


def test_checkout_is_all_or_nothing_and_guarded(env):
    c, store, spec = env
    items = _items(c)
    bad_spec = {**spec, "palette": {**spec["palette"], "text": spec["palette"]["primary"]}}
    bad = {"spec": bad_spec, "lines": [{"player_name": "", "number": "9", "size": "M", "quantity": 2}]}
    body = {"items": [items[0], bad], "customer": {"name": "Test Buyer", "phone": PHONE},
            "delivery": {"method": "ship", "address": ADDRESS}, "coupon": "WELCOME10", "idempotency_key": "ck_fail_001"}
    r = c.post("/api/v1/checkout", json=body)
    assert r.status_code == 422
    assert [(e["index"], e["code"]) for e in r.json()["detail"]["items"]] == [(1, "print_check_failed")]
    assert store.all_orders() == []

    body = {**body, "items": items, "idempotency_key": "ck_good_001"}
    r = c.post("/api/v1/checkout", json=body, headers={"X-Device-Id": "device-one"})
    assert r.status_code == 201, r.text
    ck = r.json()
    assert ck["number"] == "CK-00001" and len(ck["orders"]) == 2 and ck["status"] == "open"
    assert all(o["checkout_id"] == ck["id"] for o in ck["orders"])
    assert round(sum(o["pricing"]["coupon"]["amount"] for o in ck["orders"]), 2) == ck["coupon"]["amount"]
    again = c.post("/api/v1/checkout", json=body, headers={"X-Device-Id": "device-one"})
    assert again.status_code == 200 and again.json()["duplicate"] and again.json()["id"] == ck["id"]
    assert c.post("/api/v1/checkout", json={**body, "rush": True}).status_code == 409

    assert c.get(f"/api/v1/checkouts/{ck['id']}", headers={"X-Device-Id": "device-two"}).status_code == 404
    assert c.get(f"/api/v1/checkouts/{ck['id']}", params={"phone": "9000000001"},
                 headers={"X-Device-Id": "device-two"}).status_code == 200
    assert c.post(f"/api/v1/checkouts/{ck['id']}/pay", headers={"X-Device-Id": "device-two"}).status_code == 404
    paid = c.post(f"/api/v1/checkouts/{ck['id']}/pay", headers={"X-Device-Id": "device-one"}).json()
    assert paid["status"] == "paid" and all(o["fulfilment"]["status"] == "queued" for o in paid["orders"])
    ops = staff(c)
    grouped = c.get("/api/v1/ops/orders", headers=ops, params={"checkout_id": ck["id"]}).json()
    assert grouped["total"] == 2
    detail = c.get(f"/api/v1/ops/orders/{ck['orders'][0]['id']}", headers=ops).json()
    assert detail["checkout"]["number"] == "CK-00001"
    assert products(c, size=60)["items"][0]["orders_count"] == 1                  # popular sort follows orders


def test_cash_on_delivery_through_delivery(env):
    c, store, spec = env
    h = staff(c)
    items = _items(c, 1)
    body = {"items": items, "customer": {"name": "Test Buyer", "phone": PHONE},
            "delivery": {"method": "ship", "address": ADDRESS}, "payment_method": "cod", "idempotency_key": "ck_cod_0001"}
    ck = c.post("/api/v1/checkout", json=body).json()
    o = ck["orders"][0]
    assert o["payment_method"] == "cod" and o["fulfilment"]["status"] == "queued"
    assert o["payment"]["method"] == "cod" and o["payment"]["collected"] is False
    assert o["pricing"]["cod"]["fee"] == 49 and ck["status"] == "paid"
    assert "Proforma invoice" in c.get(f"/api/v1/ops/orders/{o['id']}/invoice", headers=h).text
    assert c.get("/api/v1/ops/cod", headers=h, params={"collected": False}).json()["total"] == 1
    deliver(c, h, o["id"], pay=False)
    done = store.get_order(o["id"])
    assert done["payment"]["collected"] and done["fulfilment"]["status"] == "delivered"
    assert "Tax invoice" in c.get(f"/api/v1/ops/orders/{o['id']}/invoice", headers=h).text
    assert c.get("/api/v1/ops/cod", headers=h, params={"collected": True}).json()["total"] == 1

    # by hand, and refused where the seller area has no cash on delivery
    one = c.post("/api/v1/orders", json=order_body(spec, "key_cod_hand", payment_method="cod")).json()
    assert c.post(f"/api/v1/ops/orders/{one['id']}/cod-collected", headers=h, json={"reference": "RCPT-9"}).json()[
        "payment"]["collected"]
    set_house(c, h, service_areas=[{"match": "*", "transit_days": 3, "cod": False}])
    r = c.post("/api/v1/orders", json=order_body(spec, "key_cod_none", payment_method="cod"))
    assert r.status_code == 422 and r.json()["detail"]["code"] == "cod_unavailable"


# ------------------------------------------------------------------ cancel, return, review

def test_cancel_rules(env):
    c, store, spec = env
    h = staff(c)
    ch, _ = sign_in(c, phone=PHONE)
    unpaid = c.post("/api/v1/orders", json=order_body(spec, "key_cancel_1"), headers=ch).json()
    r = c.post(f"/api/v1/me/orders/{unpaid['id']}/cancel", headers=ch, json={"reason": "Ordered twice"})
    assert r.status_code == 200 and r.json()["fulfilment"]["status"] == "cancelled" and r.json()["refunds"] == []
    assert c.post(f"/api/v1/me/orders/{unpaid['id']}/cancel", headers=ch, json={"reason": "again"}).status_code == 409

    paid = c.post("/api/v1/orders", json=order_body(spec, "key_cancel_2"), headers=ch).json()
    c.post(f"/api/v1/orders/{paid['id']}/payment-confirmed", json={"demo": True})
    view = c.get(f"/api/v1/me/orders/{paid['id']}", headers=ch).json()
    assert view["can_cancel"] is True
    r = c.post(f"/api/v1/me/orders/{paid['id']}/cancel", headers=ch, json={"reason": "Changed plans"}).json()
    assert r["refunds"][0]["method"] == "demo" and r["refunds"][0]["amount"] == paid["pricing"]["total"]

    started = c.post("/api/v1/orders", json=order_body(spec, "key_cancel_3"), headers=ch).json()
    c.post(f"/api/v1/orders/{started['id']}/payment-confirmed", json={"demo": True})
    c.post(f"/api/v1/ops/orders/{started['id']}/stages/prepress", headers=h)
    assert c.get(f"/api/v1/me/orders/{started['id']}", headers=ch).json()["can_cancel"] is False
    assert c.post(f"/api/v1/me/orders/{started['id']}/cancel", headers=ch, json={"reason": "Too late"}).status_code == 409
    other, _ = sign_in(c, phone="+91 90000 00003")
    assert c.post(f"/api/v1/me/orders/{paid['id']}/cancel", headers=other, json={"reason": "not mine"}).status_code == 404


def test_return_window_and_reasons(env):
    c, store, spec = env
    h = staff(c)
    ch, _ = sign_in(c, phone=PHONE)
    o = c.post("/api/v1/orders", json=order_body(spec, "key_return_1", qty=3), headers=ch).json()
    early = c.post(f"/api/v1/me/orders/{o['id']}/returns", headers=ch, json={"reason": "damaged"})
    assert early.status_code == 409
    deliver(c, h, o["id"])
    view = c.get(f"/api/v1/me/orders/{o['id']}", headers=ch).json()
    assert view["can_return"] and view["return_until"] and view["can_cancel"] is False
    assert c.post(f"/api/v1/me/orders/{o['id']}/returns", headers=ch,
                  json={"reason": "changed_mind"}).status_code == 422
    assert c.post(f"/api/v1/me/orders/{o['id']}/returns", headers=ch,
                  json={"reason": "damaged", "lines": [{"line": 1, "quantity": 9}]}).status_code == 422
    r = c.post(f"/api/v1/me/orders/{o['id']}/returns", headers=ch,
               json={"reason": "print_quality", "details": "Number peeling", "lines": [{"line": 1, "quantity": 1}]})
    assert r.status_code == 201 and r.json()["return"]["number"] == "R-00001"
    assert c.post(f"/api/v1/me/orders/{o['id']}/returns", headers=ch, json={"reason": "damaged"}).status_code == 409
    rid = r.json()["return"]["id"]
    assert c.post(f"/api/v1/ops/returns/{rid}/status", headers=h, json={"status": "resolved",
                                                                        "resolution": "refund"}).status_code == 409
    for st in ("approved", "picked_up"):
        assert c.post(f"/api/v1/ops/returns/{rid}/status", headers=h, json={"status": st}).status_code == 200
    assert c.post(f"/api/v1/ops/returns/{rid}/status", headers=h, json={"status": "resolved"}).status_code == 422
    done = c.post(f"/api/v1/ops/returns/{rid}/status", headers=h,
                  json={"status": "resolved", "resolution": "refund", "refund_amount": 500}).json()
    assert done["refund_amount"] == 500
    view = c.get(f"/api/v1/me/orders/{o['id']}", headers=ch).json()
    assert view["returns"][0]["status"] == "resolved" and view["refunds"][0]["amount"] == 500
    assert c.get("/api/v1/ops/returns", headers=h, params={"status": "resolved"}).json()["total"] == 1

    # after the window closes
    order = store.get_order(o["id"])
    order["fulfilment"]["return_until"] = "2020-01-01"
    order["returns"] = []
    store.save_order(order)
    late = c.post(f"/api/v1/me/orders/{o['id']}/returns", headers=ch, json={"reason": "damaged"})
    assert late.status_code == 409 and "2020-01-01" in late.json()["detail"]

    # the business can turn returns off
    crm = c.get("/api/v1/ops/settings/crm", headers=h).json()
    crm["value"]["return_window_days"] = 0
    assert c.put("/api/v1/ops/settings/crm", headers=h, json={"value": crm["value"], "version": crm["version"]}).status_code == 200
    o2 = c.post("/api/v1/orders", json=order_body(spec, "key_return_2"), headers=ch).json()
    deliver(c, h, o2["id"])
    assert c.get(f"/api/v1/me/orders/{o2['id']}", headers=ch).json()["can_return"] is False


def test_review_after_delivery_and_seller_rating(env):
    c, store, _ = env
    h = staff(c)
    ch, _ = sign_in(c, phone=PHONE, name="Asha Kumar")
    item = _items(c, 1)
    ck = c.post("/api/v1/checkout", headers=ch, json={
        "items": item, "customer": {"name": "Asha Kumar", "phone": PHONE}, "delivery": {"method": "ship", "address": ADDRESS},
        "idempotency_key": "ck_review_01"}).json()
    oid = ck["orders"][0]["id"]
    assert c.post(f"/api/v1/me/orders/{oid}/review", headers=ch, json={"rating": 5}).status_code == 409
    deliver(c, h, oid)
    r = c.post(f"/api/v1/me/orders/{oid}/review", headers=ch, json={"rating": 4, "title": "Great", "body": "Fits well"})
    assert r.status_code == 201 and r.json()["review"]["customer_name"] == "Asha K." and r.json()["order"]["review"]["rating"] == 4
    assert c.post(f"/api/v1/me/orders/{oid}/review", headers=ch, json={"rating": 5}).status_code == 409
    assert c.post(f"/api/v1/me/orders/{oid}/review", headers=ch, json={"rating": 6}).status_code == 422
    assert store.get("seller", "sel_house")["rating"] == {"average": 4.0, "count": 1}
    slug = store.get("product", item[0]["product_id"])["slug"]
    detail = c.get(f"/api/v1/shop/products/{slug}").json()
    assert detail["rating"]["average"] == 4.0 and detail["reviews"][0]["verified_purchase"]
    rid = r.json()["review"]["id"]
    assert c.post(f"/api/v1/ops/reviews/{rid}/moderate", headers=h, json={"hidden": True, "reason": "abuse"}).status_code == 200
    assert store.get("seller", "sel_house")["rating"] == {"average": None, "count": 0}
    assert c.get(f"/api/v1/shop/products/{slug}").json()["reviews"] == []
    assert c.get("/api/v1/ops/reviews", headers=h, params={"status": "hidden"}).json()["total"] == 1
    assert c.get("/api/v1/ops/reviews", headers=h, params={"min_rating": 4, "max_rating": 4}).json()["total"] == 1
    assert c.get("/api/v1/ops/reviews", headers=h, params={"min_rating": 5}).json()["total"] == 0


# ------------------------------------------------------------------ notifications

def test_notifications_and_outbox(env):
    c, _, spec = env
    h = staff(c)
    ch, _ = sign_in(c, phone=PHONE)
    body = order_body(spec, "key_notify_1")
    body["customer"]["email"] = "buyer@example.com"
    o = c.post("/api/v1/orders", json=body, headers=ch).json()
    deliver(c, h, o["id"])
    notes = c.get("/api/v1/me/notifications", headers=ch).json()
    assert [n["code"] for n in notes["items"]][::-1] == ["placed", "confirmed", "dispatched", "delivered"]
    assert notes["unread"] == 4 and "TRK1" in notes["items"][1]["body"]
    out = c.get("/api/v1/ops/messages", headers=h, params={"order_id": o["id"]}).json()
    assert out["total"] == 8 and {m["channel"] for m in out["items"]} == {"sms", "email"}
    assert all(m["status"] == "logged" for m in out["items"])
    assert c.get("/api/v1/ops/messages", headers=h, params={"channel": "email"}).json()["total"] == 4
    first = notes["items"][0]["id"]
    assert c.post("/api/v1/me/notifications/read", headers=ch, json={"ids": [first]}).json()["unread"] == 3
    assert c.post("/api/v1/me/notifications/read", headers=ch, json={"all": True}).json()["unread"] == 0


# ------------------------------------------------------------------ the seller login

def test_seller_login_is_scoped_to_its_own_seller(env):
    c, _, spec = env
    h = staff(c)
    b = add_seller(c, h, "Partner Prints", [{"match": "6000", "transit_days": 1}, {"match": "*", "transit_days": 5}])
    assert c.post("/api/v1/ops/staff", headers=h, json={"email": "p@partner.test", "name": "P", "role": "seller",
                                                        "password": "Partn3rPassword"}).status_code == 422
    r = c.post("/api/v1/ops/staff", headers=h, json={"email": "p@partner.test", "name": "P", "role": "seller",
                                                     "password": "Partn3rPassword", "seller_id": b["id"]})
    assert r.status_code == 201 and r.json()["seller_id"] == b["id"]
    mine = c.post("/api/v1/orders", json=order_body(spec, "key_scope_b", seller_id=b["id"])).json()
    house = c.post("/api/v1/orders", json=order_body(spec, "key_scope_h", seller_id="sel_house")).json()
    for o in (mine, house):
        c.post(f"/api/v1/orders/{o['id']}/payment-confirmed", json={"demo": True})
    sh = staff(c, "p@partner.test", "Partn3rPassword")

    listed = c.get("/api/v1/ops/orders", headers=sh, params={"seller_id": "sel_house"}).json()
    assert [x["id"] for x in listed["items"]] == [mine["id"]]
    assert c.get(f"/api/v1/ops/orders/{mine['id']}", headers=sh).status_code == 200
    assert c.get(f"/api/v1/ops/orders/{house['id']}", headers=sh).status_code == 404
    assert c.get(f"/api/v1/ops/orders/{house['id']}/invoice", headers=sh).status_code == 404
    assert c.post(f"/api/v1/ops/orders/{house['id']}/stages/prepress", headers=sh).status_code == 404
    assert c.post(f"/api/v1/ops/orders/{mine['id']}/stages/prepress", headers=sh).status_code == 200
    assert c.post(f"/api/v1/ops/orders/{house['id']}/shipments", headers=sh, json={"carrier": "air"}).status_code == 404
    plan = c.get("/api/v1/ops/production/plan", headers=sh).json()
    assert [p["order_id"] for p in plan["orders"]] == [mine["id"]] and plan["seller_id"] == b["id"]
    # a partner can read carrier names and download the artwork for its own orders only
    assert any(x["id"] == "air" for x in c.get("/api/v1/ops/carriers", headers=sh).json()["items"])
    fname = c.get(f"/api/v1/ops/orders/{mine['id']}", headers=sh).json()["order"]["files"][0]["name"]
    art = c.get(f"/api/v1/ops/orders/{mine['id']}/print-files/{fname}", headers=sh)
    assert art.status_code == 200 and art.text.lstrip().startswith("<")
    hname = c.get(f"/api/v1/ops/orders/{house['id']}", headers=h).json()["order"]["files"][0]["name"]
    assert c.get(f"/api/v1/ops/orders/{house['id']}/print-files/{hname}", headers=sh).status_code == 404
    board = c.get("/api/v1/ops/production/board", headers=sh, params={"seller_id": "sel_house"}).json()
    assert [o["id"] for col in board["columns"] for o in col["orders"]] == [mine["id"]]
    assert c.get("/api/v1/ops/production/utilisation", headers=sh).json()["seller_id"] == b["id"]
    assert all(i["order_id"] == mine["id"] for i in c.get(
        "/api/v1/ops/production/worklist", headers=sh, params={"stage": "print"}).json()["items"])
    assert [s["id"] for s in c.get("/api/v1/ops/sellers", headers=sh).json()["items"]] == [b["id"]]
    assert c.get("/api/v1/ops/sellers/sel_house", headers=sh).status_code == 404
    # no settings, prices, other sellers, customers or dashboard
    for path in ("/api/v1/ops/settings", "/api/v1/ops/settings/price_book", "/api/v1/ops/customers",
                 "/api/v1/ops/dashboard", "/api/v1/ops/products", "/api/v1/ops/messages", "/api/v1/ops/staff"):
        assert c.get(path, headers=sh).status_code == 403, path
    pb = c.get("/api/v1/ops/settings/production", headers=h).json()
    assert c.put("/api/v1/ops/settings/production", headers=sh,
                 json={"value": pb["value"], "version": pb["version"]}).status_code == 403
    assert c.put(f"/api/v1/ops/sellers/{b['id']}", headers=sh,
                 json=seller_body("Partner Prints", [{"match": "*", "transit_days": 1}], price_adjust=-0.5)).status_code == 403
    assert c.post("/api/v1/ops/sellers", headers=sh, json=seller_body("Mine Too", [{"match": "*", "transit_days": 1}])).status_code == 403
    assert c.post(f"/api/v1/ops/orders/{mine['id']}/cancel", headers=sh, json={"reason": "no stock"}).status_code == 403
    # customer-facing order routes treat a seller login like any stranger
    elsewhere = {**sh, "X-Device-Id": "partner-tablet"}
    assert c.get(f"/api/v1/orders/{house['id']}", headers=elsewhere).status_code == 404
    assert c.post(f"/api/v1/orders/{mine['id']}/payment-confirmed", headers=elsewhere, json={"demo": True}).status_code == 404
