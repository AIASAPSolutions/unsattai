"""Garment options (sleeves, collar), Men/Women/Kids size charts, graded print files and the measurement sheet."""
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ADMIN = ("owner@urjersey.test", "Str0ngPassw0rd")


@pytest.fixture()
def c(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.setenv("DESIGN_PROVIDER", "rule")
    monkeypatch.setenv("AI_EDITS", "off")
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN[0])
    monkeypatch.setenv("ADMIN_PASSWORD", ADMIN[1])
    for k in ("API_KEYS", "FACTORY_URL", "APP_ENV", "DEMO_PAYMENTS"):
        monkeypatch.delenv(k, raising=False)
    for m in [m for m in sys.modules if m.startswith("app")]:
        del sys.modules[m]
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def design(c, prompt="navy and gold cricket jersey", **extra):
    body = {"prompt": prompt, "variants": 1, "team_name": "Strikers", **extra}
    spec = c.post("/api/v1/designs/generate", json=body).json()["designs"][0]["spec"]
    return dict(spec, elements=c.post("/api/v1/render/panels", json={"spec": spec}).json()["default_elements"])


def order(c, spec, items, key="key_sizing_1"):
    r = c.post("/api/v1/orders", json={"design_id": "dsn_1", "spec": spec, "language": "en", "idempotency_key": key,
                                       "customer": {"name": "Asha", "phone": "+91 98765 43210"}, "items": items})
    assert r.status_code == 201, r.text
    return r.json()


def svg_mm(svg):
    m = re.search(r'<svg[^>]*width="([\d.]+)mm" height="([\d.]+)mm"', svg)
    return float(m.group(1)), float(m.group(2))


# ------------------------------------------------------------------ options on the design

def test_sleeve_choices_change_the_pattern_pieces(c):
    base = design(c)
    assert base["sleeves"] == "short" and base["collar"] == "crew"
    short = c.post("/api/v1/render/panels", json={"spec": base}).json()["panels"]
    assert [p["name"] for p in short] == ["front", "back", "sleeve_left", "sleeve_right"]
    assert "separate pieces" in short[0]["note"]
    none = c.post("/api/v1/render/panels", json={"spec": dict(base, sleeves="none")}).json()
    assert [p["name"] for p in none["panels"]] == ["front", "back"]
    assert none["manufacturing_ready"] is True                       # default layers still fit the narrower body
    long_ = c.post("/api/v1/render/panels", json={"spec": dict(base, sleeves="long")}).json()["panels"]
    assert next(p for p in long_ if p["name"] == "sleeve_left")["height"] == 620
    crew = c.post("/api/v1/render", json={"spec": dict(base, sleeves="none")}).json()["mockup_svg"]
    polo = c.post("/api/v1/render", json={"spec": dict(base, sleeves="none", collar="polo")}).json()["mockup_svg"]
    assert polo.count('r="5"') == 3 and crew.count('r="5"') == 0      # polo buttons


def test_every_option_combination_renders_valid_svg(c):
    import xml.dom.minidom
    base = design(c)
    for garment in ("jersey", "vneck"):
        for sleeves in ("short", "long", "none"):
            for collar in ("crew", "polo", "mandarin"):
                s = dict(base, garment=garment, sleeves=sleeves, collar=collar)
                xml.dom.minidom.parseString(c.post("/api/v1/render", json={"spec": s}).json()["mockup_svg"])
                xml.dom.minidom.parseString(c.post("/api/v1/print", json={"spec": s, "size": "L"}).text)


def test_brief_and_ask_tab_understand_sleeves_and_collars(c):
    u = c.post("/api/v1/brief/understand", json={"prompt": "sleeveless basketball vest in red with a polo collar"}).json()
    assert u["options"] == {"sleeves": "none", "collar": "polo"}
    u = c.post("/api/v1/brief/understand", json={"prompt": "full sleeve cricket jersey for our band"}).json()
    assert u["options"] == {"sleeves": "long", "collar": None}         # "band" alone is not a mandarin collar
    spec = c.post("/api/v1/designs/generate", json={"prompt": "sleeveless red basketball vest", "variants": 1}).json()
    assert spec["designs"][0]["spec"]["sleeves"] == "none"
    chosen = c.post("/api/v1/designs/generate", json={"prompt": "sleeveless red vest", "variants": 1,
                                                      "options": {"sleeves": "long", "collar": "mandarin"}}).json()
    assert (chosen["designs"][0]["spec"]["sleeves"], chosen["designs"][0]["spec"]["collar"]) == ("long", "mandarin")
    s = design(c)
    r = c.post("/api/v1/designs/refine", json={"spec": s, "instruction": "remove the sleeves and give it a mandarin collar"}).json()
    assert r["spec"]["sleeves"] == "none" and r["spec"]["collar"] == "mandarin"
    r = c.post("/api/v1/designs/refine", json={"spec": dict(s, garment="vneck"), "instruction": "polo collar"}).json()
    assert r["spec"]["collar"] == "crew"                              # a V-neck keeps its V


# ------------------------------------------------------------------ size guide and pricing

def test_size_guide_covers_men_women_and_kids(c):
    g = c.get("/api/v1/shop/size-guide").json()
    assert [f["id"] for f in g["fits"]] == ["men", "women", "kids"] and g["unit"] == "cm"
    kids = next(f for f in g["fits"] if f["id"] == "kids")
    assert [r["size"] for r in kids["sizes"]] == ["4Y", "6Y", "8Y", "10Y", "12Y", "14Y"]
    assert kids["sizes"][2]["height"] == [122, 134] and kids["sizes"][2]["top"]["chest"] == 36
    assert {m["id"] for m in g["how_to_measure"]} >= {"chest", "length", "sleeve"}
    meta = c.get("/api/v1/meta").json()
    assert meta["fit_sizes"]["women"][-1] == "XXL" and meta["options"]["sleeves"] == ["short", "long", "none"]
    cat = c.get("/api/v1/shop/catalogue").json()
    assert {o["id"]: o["price"] for o in cat["options"]["sleeves"]} == {"short": 0, "long": 60, "none": -20}


def test_quote_prices_options_and_fit(c):
    q = c.post("/api/v1/shop/quote", json={"garment": "jersey", "sleeves": "long", "collar": "polo",
                                           "lines": [{"fit": "kids", "size": "8Y", "quantity": 1},
                                                     {"fit": "men", "size": "3XL", "quantity": 1}]}).json()
    kid, big = q["lines"]
    assert kid["parts"]["sleeves"] == 60 and kid["parts"]["collar"] == 90 and kid["parts"]["fit"] == -60
    assert kid["unit_price"] == 499 + 60 + 90 - 60
    assert big["parts"]["size"] == 90 and "fit" not in big["parts"]
    assert q["options"]["collar"] == {"id": "polo", "name": "Polo collar with buttons", "price": 90}
    shorts = c.post("/api/v1/shop/quote", json={"garment": "shorts", "sleeves": "long", "collar": "polo",
                                                "lines": [{"size": "M", "quantity": 1}]}).json()
    assert shorts["options"] == {} and shorts["lines"][0]["unit_price"] == 349
    bad = c.post("/api/v1/shop/quote", json={"lines": [{"fit": "kids", "size": "M", "quantity": 1}]})
    assert bad.status_code == 422


def test_size_charts_are_editable_but_sizes_are_fixed(c):
    h = {"Authorization": "Bearer " + c.post("/api/v1/ops/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]})
         .json()["token"]}
    cur = c.get("/api/v1/ops/settings/sizing", headers=h).json()
    value = cur["value"]
    value["fits"]["kids"]["sizes"][2]["top"]["chest"] = 37
    ok = c.put("/api/v1/ops/settings/sizing", headers=h, json={"value": value, "version": cur["version"]})
    assert ok.status_code == 200, ok.text
    assert c.get("/api/v1/shop/size-guide").json()["fits"][2]["sizes"][2]["top"]["chest"] == 37
    value["fits"]["kids"]["sizes"].pop()
    bad = c.put("/api/v1/ops/settings/sizing", headers=h, json={"value": value, "version": ok.json()["version"]})
    assert bad.status_code == 422 and "fixed" in bad.text


# ------------------------------------------------------------------ orders: graded files and measurements

def test_order_lines_carry_fit_measurements_and_graded_files(c):
    spec = dict(design(c), sleeves="long")
    o = order(c, spec, [{"player_name": "Arul", "number": "7", "fit": "men", "size": "M", "quantity": 1},
                        {"player_name": "Priya", "number": "9", "fit": "women", "size": "S", "quantity": 1},
                        {"player_name": "Kavin", "number": "4", "fit": "kids", "size": "8Y", "quantity": 2}])
    men, women, kid = o["lines"]
    assert o["options"] == {"sleeves": "long", "collar": "crew"}
    assert kid["fit"] == "kids" and kid["measurements"] == {"chest": 36, "length": 52, "shoulder": 32, "sleeve": 44}
    assert men["pieces_mm"]["front"] == [540, 720] and men["pieces_mm"]["sleeve_left"] == [460, 620]
    # kids 8Y: chest 36 cm (+ seam allowance) and length 52 cm against the Men's M block
    assert kid["pieces_mm"]["front"] == [380, 520]
    assert women["files"][0] == "L02_WS_front.svg" and kid["files"][0] == "L03_K8Y_front.svg"

    svg = c.post(f"/api/v1/orders/{o['id']}/files/L03_K8Y_front.svg").text
    w, h = svg_mm(svg)
    assert 400 < w < 540 and 540 < h < 720                              # piece + bleed + margins, never Men's size
    assert "KIDS 8Y" in svg and "380 x 520 mm" in svg and "Kavin" in svg
    men_svg = c.post(f"/api/v1/orders/{o['id']}/files/L01_M_front.svg").text
    assert svg_mm(men_svg)[0] > w

    sheet = c.post(f"/api/v1/orders/{o['id']}/files/measurements.svg")
    assert sheet.status_code == 200 and sheet.text.startswith("<svg") and 'width="210mm"' in sheet.text
    for text in ("Measurement sheet", "Women", "Kids", "8Y", ">36<", "front, back 380 x 520", "long sleeves"):
        assert text in sheet.text, text


def test_line_keeps_the_chart_it_was_ordered_with(c):
    h = {"Authorization": "Bearer " + c.post("/api/v1/ops/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]})
         .json()["token"]}
    o = order(c, design(c), [{"fit": "kids", "size": "8Y", "quantity": 1}])
    cur = c.get("/api/v1/ops/settings/sizing", headers=h).json()
    cur["value"]["fits"]["kids"]["sizes"][2]["top"]["length"] = 54
    assert c.put("/api/v1/ops/settings/sizing", headers=h,
                 json={"value": cur["value"], "version": cur["version"]}).status_code == 200
    again = c.get(f"/api/v1/ops/orders/{o['id']}", headers=h).json()["order"]
    assert again["lines"][0]["measurements"]["length"] == 52
    svg = c.get(f"/api/v1/ops/orders/{o['id']}/print-files/L01_K8Y_front.svg", headers=h).text
    assert "380 x 520 mm" in svg
    sheet = c.get(f"/api/v1/ops/orders/{o['id']}/print-files/measurements.svg", headers=h)
    assert sheet.status_code == 200 and ">52<" in sheet.text


def test_fit_and_size_must_match(c):
    spec = design(c)
    for fit, size in (("women", "3XL"), ("kids", "M"), ("men", "8Y")):
        r = c.post("/api/v1/orders", json={"design_id": "d", "spec": spec, "language": "en", "idempotency_key": f"k_{fit}_{size}x",
                                           "customer": {"name": "A", "phone": "+91 98765 43210"},
                                           "items": [{"fit": fit, "size": size, "quantity": 1}]})
        assert r.status_code == 422, (fit, size)


def test_print_endpoint_grades_by_fit_and_checks_logo_dpi(c):
    spec = design(c)
    m = c.post("/api/v1/print", json={"spec": spec, "size": "M"}).text
    k = c.post("/api/v1/print", json={"spec": spec, "size": "4Y", "fit": "kids"}).text
    assert "MEN / UNISEX M / 540 x 720 mm" in m and "KIDS 4Y / 340 x 440 mm" in k
    assert c.post("/api/v1/print", json={"spec": spec, "size": "4Y"}).status_code == 422   # 4Y is not a men's size


def test_demo_payments_are_off_in_production(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DB_PATH", str(tmp_path / "prod.db"))
    monkeypatch.setenv("DESIGN_PROVIDER", "rule")
    monkeypatch.delenv("DEMO_PAYMENTS", raising=False)
    monkeypatch.delenv("API_KEYS", raising=False)
    for m in [m for m in sys.modules if m.startswith("app")]:
        del sys.modules[m]
    from fastapi.testclient import TestClient
    from app.main import app
    c = TestClient(app)
    assert c.get("/api/v1/health").json()["demo_payments"] is False
    o = order(c, design(c), [{"size": "M", "quantity": 1}], key="key_prod_demo")
    r = c.post(f"/api/v1/orders/{o['id']}/payment-confirmed", json={"demo": True})
    assert r.status_code == 403 and "not available" in r.text
    assert c.get(f"/api/v1/orders/{o['id']}").json()["status"] == "awaiting_payment"


def test_products_offer_colourways_and_options(c):
    items = c.get("/api/v1/shop/products", params={"garment": "jersey"}).json()["items"]
    p = items[0]
    assert p["colourways"][0]["id"] == "original" and len(p["colourways"]) == 3
    detail = c.get(f"/api/v1/shop/products/{p['slug']}").json()
    cw = detail["colourways"][1]
    assert cw["palette"]["primary"].startswith("#")
    pic = c.get(f"/api/v1/shop/products/{p['slug']}/mockup.svg", params={"colourway": cw["id"], "sleeves": "none"})
    assert pic.status_code == 200 and cw["palette"]["primary"] in pic.text
    assert c.get(f"/api/v1/shop/products/{p['slug']}/mockup.svg", params={"colourway": "nope"}).status_code == 422
    q = c.post("/api/v1/shop/cart/quote", json={
        "items": [{"product_id": p["id"], "colourway": cw["id"], "sleeves": "long", "collar": "polo",
                   "lines": [{"fit": "kids", "size": "10Y", "quantity": 2}]}],
        "delivery": {"method": "ship", "pincode": "600028"}}).json()
    item = q["items"][0]
    assert item["options"] == {"sleeves": "long", "collar": "polo", "colourway": cw["id"]}
    assert "colourway=" in item["image_url"] and "sleeves=long" in item["image_url"]
    parts = item["quote"]["lines"][0]["parts"]
    assert parts["sleeves"] == 60 and parts["collar"] == 90 and parts["fit"] == -60
    h = {"Authorization": "Bearer " + c.post("/api/v1/ops/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]})
         .json()["token"]}
    bad = c.patch(f"/api/v1/ops/products/{p['id']}", headers=h,
                  json={"colourways": [{"id": "red", "name": "Red", "palette": cw["palette"]}] * 2})
    assert bad.status_code == 422
    ok = c.patch(f"/api/v1/ops/products/{p['id']}", headers=h,
                 json={"colourways": [{"id": "red", "name": "Red", "palette": dict(cw["palette"], primary="#d62828")}]})
    assert ok.status_code == 200, ok.text
    assert [x["id"] for x in c.get(f"/api/v1/shop/products/{p['slug']}").json()["colourways"]] == ["original", "red"]
