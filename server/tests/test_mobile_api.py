"""API contract the UrJersey app relies on: understanding, layers, refinement, logos and orders."""
import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

PNG_1PX = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 64).decode()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setenv("DESIGN_PROVIDER", "rule")
    monkeypatch.delenv("FACTORY_URL", raising=False)
    monkeypatch.delenv("API_KEYS", raising=False)
    monkeypatch.setenv("AI_EDITS", "off")
    for m in [m for m in sys.modules if m.startswith("app")]:
        del sys.modules[m]
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


@pytest.fixture()
def spec(client):
    r = client.post("/api/v1/designs/generate", json={"prompt": "navy and gold cricket jersey", "variants": 1,
                                                      "team_name": "Strikers", "player_name": "Arul", "number": "7"})
    return r.json()["designs"][0]["spec"]


def with_layers(client, spec):
    defaults = client.post("/api/v1/render/panels", json={"spec": spec}).json()["default_elements"]
    return dict(spec, elements=defaults)


# ------------------------------------------------------------------ meta / health

def test_meta_lists_vocabularies_and_languages(client):
    m = client.get("/api/v1/meta").json()
    assert {l["code"] for l in m["languages"]} == {"en", "hi", "te", "ta"}
    assert len(m["sports"]) == 12 and len(m["patterns"]) == 12
    assert m["palettes"][0]["palette"].keys() == {"primary", "secondary", "accent", "trim", "text"}
    assert m["limits"]["text"] == {"team_name": 24, "player_name": 16, "number": 3, "free": 32}
    assert client.get("/api/v1/health").json()["factory_connected"] is False


def test_api_key_is_enforced_when_configured(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "k.db"))
    monkeypatch.setenv("API_KEYS", "secret1")
    for m in [m for m in sys.modules if m.startswith("app")]:
        del sys.modules[m]
    from fastapi.testclient import TestClient
    from app.main import app
    c = TestClient(app)
    body = {"prompt": "red football"}
    assert c.post("/api/v1/brief/understand", json=body).status_code == 401
    assert c.post("/api/v1/brief/understand", json=body, headers={"X-API-Key": "secret1"}).status_code == 200
    assert c.get("/api/v1/meta").status_code == 200   # public vocabularies


# ------------------------------------------------------------------ understand

def test_understand_reads_english_brief(client):
    r = client.post("/api/v1/brief/understand", json={
        "prompt": 'Navy and gold cricket jersey with lightning for team "Chennai Strikers", number 7'}).json()
    assert r["sport"] == "cricket" and r["garment"] == "jersey"
    assert [c["name"] for c in r["colors"]] == ["navy", "gold"]
    assert "shards" in r["patterns"] and "lightning" in r["themes"]
    assert r["team_name"] == {"value": "Chennai Strikers", "source": "prompt"}
    assert r["number"]["value"] == "7" and r["ready"] is True


@pytest.mark.parametrize("prompt,lang,sport,color,number", [
    ("लाल और सुनहरी कबड्डी जर्सी, टीम शेर, नंबर १०", "hi", "kabaddi", "red", "10"),
    ("నీలం మరియు బంగారు క్రికెట్ జెర్సీ మెరుపు చారలు నంబర్ 18", "te", "cricket", "blue", "18"),
    ("சிவப்பு புலி கால்பந்து ஜெர்சி எண் 9", "ta", "football", "red", "9"),
])
def test_understand_native_scripts(client, prompt, lang, sport, color, number):
    r = client.post("/api/v1/brief/understand", json={"prompt": prompt, "language": lang}).json()
    assert r["detected_language"] == lang
    assert r["sport"] == sport and r["colors"][0]["name"] == color and r["number"]["value"] == number


def test_understand_keeps_native_team_spelling(client):
    r = client.post("/api/v1/brief/understand", json={"prompt": "टीम शेर कबड्डी जर्सी", "language": "hi"}).json()
    assert r["team_name"]["value"] == "शेर"


def test_understand_asks_on_conflict_instead_of_choosing(client):
    r = client.post("/api/v1/brief/understand", json={
        "prompt": "Chennai Strikers team football jersey number 12", "team_name": "Chennai Kings", "number": "9"}).json()
    ids = {q["id"]: q for q in r["questions"]}
    assert set(ids) == {"team_name_conflict", "number_conflict"} and r["ready"] is False
    assert {o["value"] for o in ids["team_name_conflict"]["options"]} == {"Chennai Strikers", "Chennai Kings"}


def test_understand_asks_for_missing_sport(client):
    r = client.post("/api/v1/brief/understand", json={"prompt": "retro tiger kit with waves"}).json()
    q = r["questions"][0]
    assert q["id"] == "sport_missing" and len(q["options"]) == 12 and not r["ready"]


def test_understand_reads_team_after_bare_cue(client):
    r = client.post("/api/v1/brief/understand", json={
        "prompt": "navy and gold cricket jersey with lightning shards for team Chennai Strikers, number 7"}).json()
    assert r["team_name"] == {"value": "Chennai Strikers", "source": "prompt"} and r["number"]["value"] == "7"
    r = client.post("/api/v1/brief/understand", json={"prompt": "Neon esports jersey with hexagon pattern for team Night Owls"}).json()
    assert r["team_name"]["value"] == "Night Owls"


def test_generic_jersey_word_does_not_conflict_with_vneck(client):
    r = client.post("/api/v1/brief/understand", json={"prompt": "Teal volleyball jersey with ocean waves", "garment": "vneck"}).json()
    assert r["garment"] == "vneck" and not [q for q in r["questions"] if q["id"] == "garment_conflict"]
    r = client.post("/api/v1/brief/understand", json={"prompt": "Teal volleyball jersey with waves", "garment": "shorts"}).json()
    assert [q["id"] for q in r["questions"]] == ["garment_conflict"]
    r = client.post("/api/v1/brief/understand", json={"prompt": "round neck cricket kit", "garment": "vneck"}).json()
    assert "garment_conflict" in [q["id"] for q in r["questions"]]


def test_generate_rejects_unknown_sport_and_too_many_locked_colours(client):
    assert client.post("/api/v1/designs/generate", json={"prompt": "abc kit", "sport": "curling"}).status_code == 422
    body = {"prompt": "abc kit", "locked_colors": ["#000000"] * 5}
    assert client.post("/api/v1/designs/generate", json=body).status_code == 422


def test_generate_understands_hindi_prompt(client):
    r = client.post("/api/v1/designs/generate", json={"prompt": "लाल क्रिकेट जर्सी लहरें", "variants": 2}).json()
    assert all(d["spec"]["sport"] == "cricket" and d["spec"]["pattern"]["type"] == "waves" for d in r["designs"])


# ------------------------------------------------------------------ layers / panels

def test_spec_round_trips_unknown_fields_and_layers(client, spec):
    s = with_layers(client, spec)
    s["future_field"] = {"keep": True}
    s["palette"]["future_role"] = "#123456"
    s["elements"].append({"id": "t1", "type": "text", "text": "Since 1999", "panel": "back", "x": 270, "y": 600,
                          "size": 30, "custom_meta": 1})
    back = client.post("/api/v1/designs/dsn_x/feedback", json={"rating": 4, "spec": s, "edited_spec": s})
    assert back.status_code == 200
    got = client.get("/api/v1/designs/dsn_x").json()["spec"]
    assert got["future_field"] == {"keep": True} and got["palette"]["future_role"] == "#123456"
    assert got["elements"][-1]["custom_meta"] == 1 and got["elements"][-1]["text"] == "Since 1999"


def test_panels_for_jersey_and_shorts(client, spec):
    r = client.post("/api/v1/render/panels", json={"spec": spec}).json()
    assert [p["name"] for p in r["panels"]] == ["front", "back", "sleeve_left", "sleeve_right"]
    assert [p["editable"] for p in r["panels"]] == [True, True, False, False]
    assert r["panels"][0]["svg"].startswith("<svg") and len(r["default_elements"]) == 4
    shorts = dict(spec, garment="shorts")
    r = client.post("/api/v1/render/panels", json={"spec": shorts}).json()
    assert [p["name"] for p in r["panels"]] == ["front", "back"] and len(r["default_elements"]) == 1


def test_default_layers_are_safe_and_render_names(client, spec):
    s = with_layers(client, spec)
    r = client.post("/api/v1/render/panels", json={"spec": s}).json()
    assert all(l["safe"] for l in r["layers"]) and r["manufacturing_ready"]
    assert "ARUL" in r["panels"][1]["svg"] and ">7<" in r["panels"][1]["svg"]
    bg = client.post("/api/v1/render/panels", json={"spec": s, "include_elements": False}).json()
    assert "ARUL" not in bg["panels"][1]["svg"]


def test_deleting_every_text_layer_keeps_names_off_the_art(client, spec):
    classic = client.post("/api/v1/render/panels", json={"spec": spec, "include_elements": False}).json()
    assert "ARUL" in classic["panels"][1]["svg"]
    s = dict(spec, elements=[], text_layers=True)
    r = client.post("/api/v1/render/panels", json={"spec": s, "include_elements": True}).json()
    assert "ARUL" not in r["panels"][1]["svg"]


def test_unsafe_layer_fails_checks(client, spec):
    s = with_layers(client, spec)
    s["elements"][0]["x"] = 10   # team name across the side seam
    r = client.post("/api/v1/render", json={"spec": s}).json()
    fails = [c for c in r["checks"] if c["level"] == "fail"]
    assert fails and fails[0]["id"] == "seam_safe" and fails[0]["element_id"] == "team_front"
    assert r["manufacturing_ready"] is False


def test_logo_validation_limits_and_dpi(client, spec):
    logo = {"id": "l1", "type": "logo", "src": PNG_1PX, "panel": "front", "x": 380, "y": 200, "width": 60,
            "pixel_width": 400, "pixel_height": 400}
    s = dict(spec, elements=[logo])
    checks = client.post("/api/v1/render", json={"spec": s, "sizes": ["XXL"]}).json()["checks"]
    dpi = next(c for c in checks if c["id"] == "logo_dpi")
    assert dpi["level"] == "warn" and "XXL" in dpi["message"]         # 400 px over 71 mm = 143 DPI

    svg_logo = dict(logo, id="l2", src="data:image/svg+xml;base64," + base64.b64encode(b"<svg/>").decode())
    checks = client.post("/api/v1/render", json={"spec": dict(spec, elements=[svg_logo])}).json()["checks"]
    assert next(c for c in checks if c["id"] == "logo_dpi")["level"] == "pass"

    bad = dict(logo, src="data:image/gif;base64,R0lGOD")
    assert client.post("/api/v1/render", json={"spec": dict(spec, elements=[bad])}).status_code == 422
    big = dict(logo, src="data:image/png;base64," + "A" * 2_100_000)
    r = client.post("/api/v1/render", json={"spec": dict(spec, elements=[big])})
    assert r.status_code == 422 and "1.5 MB" in r.text and len(r.text) < 2000   # input is not echoed back
    five = [dict(logo, id=f"l{i}") for i in range(5)]
    assert client.post("/api/v1/render", json={"spec": dict(spec, elements=five)}).status_code == 422


# ------------------------------------------------------------------ refine / logos / feedback

@pytest.mark.parametrize("instruction,field,value", [
    ("make the collar gold", "palette.trim", "#c9a227"),
    ("add Priya on the back", "typography.player_name", "Priya"),
    ("change the pattern to waves", "pattern.type", "waves"),
    ("कॉलर सुनहरा करो", "palette.trim", "#c9a227"),
])
def test_refine_applies_and_reports_changes(client, spec, instruction, field, value):
    r = client.post("/api/v1/designs/refine", json={"spec": spec, "instruction": instruction}).json()
    assert r["understood"]
    node = r["spec"]
    for k in field.split("."):
        node = node[k]
    assert node == value and any(c["field"] == field for c in r["changes"])
    assert r["mockup_svg"].startswith("<svg")


def test_refine_leaves_spec_unchanged_when_not_understood(client, spec):
    r = client.post("/api/v1/designs/refine", json={"spec": spec, "instruction": "hello there"}).json()
    assert r["understood"] is False and r["changes"] == [] and r["spec"] == spec and "collar" in r["message"]


def test_logo_suggestions_page_by_eight(client, spec):
    body = {"team_name": "Chennai Strikers", "sport": "cricket", "palette": spec["palette"]}
    p1 = client.post("/api/v1/logos/suggest", json=body).json()
    p2 = client.post("/api/v1/logos/suggest", json=dict(body, offset=p1["next_offset"])).json()
    assert len(p1["logos"]) == 8 and len(p2["logos"]) == 8 and p1["next_offset"] == 8
    assert not {l["id"] for l in p1["logos"]} & {l["id"] for l in p2["logos"]}
    assert p1 == client.post("/api/v1/logos/suggest", json=body).json()     # stable when paging back
    assert p1["logos"][0]["data_url"].startswith("data:image/svg+xml;base64,")
    last = client.post("/api/v1/logos/suggest", json=dict(body, offset=56)).json()
    assert last["next_offset"] is None


def test_rating_feedback(client):
    d = client.post("/api/v1/designs/generate", json={"prompt": "teal volleyball", "variants": 1}).json()["designs"][0]
    assert client.post(f"/api/v1/designs/{d['id']}/feedback", json={"rating": 5}).json() == {"ok": True}
    assert client.post(f"/api/v1/designs/{d['id']}/feedback", json={"rating": 6}).status_code == 422
    assert client.get(f"/api/v1/designs/{d['id']}").json()["rating"] == 5


# ------------------------------------------------------------------ orders

def order_body(spec, key="key_12345678", items=None):
    return {"design_id": "dsn_1", "spec": spec, "language": "en", "idempotency_key": key,
            "customer": {"name": "Asha", "phone": "+91 98765 43210"},
            "items": items or [{"player_name": "Arul", "number": "7", "size": "M", "quantity": 2}]}


def test_team_order_merges_lines_and_builds_files(client, spec):
    s = with_layers(client, spec)
    items = [{"player_name": "Arul", "number": "7", "size": "M", "quantity": 1},
             {"player_name": "Priya", "number": "10", "size": "S", "quantity": 1},
             {"player_name": "Arul", "number": "7", "size": "M", "quantity": 2},
             {"player_name": "செல்வி", "number": "99", "size": "XL", "quantity": 1}]
    r = client.post("/api/v1/orders", json=order_body(s, items=items))
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["status"] == "awaiting_payment" and o["duplicate"] is False
    assert [(l["player_name"], l["quantity"]) for l in o["lines"]] == [("Arul", 3), ("Priya", 1), ("செல்வி", 1)]
    assert o["total_pieces"] == 5 and len(o["files"]) == 12            # 3 lines x 4 panels
    back = next(f for f in o["files"] if f["line"] == 3 and f["panel"] == "back")
    svg = client.post(f"/api/v1/orders/{o['id']}/files/{back['name']}")
    assert svg.status_code == 200 and "செல்வி" in svg.text and ">99<" in svg.text and 'height="' in svg.text
    assert 'width="' in svg.text and "mm" in svg.text and "#ff00ff" in svg.text
    assert client.post(f"/api/v1/orders/{o['id']}/files/nope.svg").status_code == 404


def test_shorts_order_has_two_files_per_line(client, spec):
    o = client.post("/api/v1/orders", json=order_body(dict(spec, garment="shorts"))).json()
    assert [f["panel"] for f in o["files"]] == ["front", "back"]


def test_order_retry_is_idempotent(client, spec):
    a = client.post("/api/v1/orders", json=order_body(spec))
    b = client.post("/api/v1/orders", json=order_body(spec))
    assert a.status_code == 201 and b.status_code == 200
    assert a.json()["id"] == b.json()["id"] and b.json()["duplicate"] is True
    changed = order_body(spec, items=[{"player_name": "X", "number": "1", "size": "L", "quantity": 1}])
    assert client.post("/api/v1/orders", json=changed).status_code == 409


def test_failing_checks_block_order(client, spec):
    s = with_layers(client, spec)
    s["elements"][1]["x"] = 5
    r = client.post("/api/v1/orders", json=order_body(s))
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["failures"][0]["checks"][0]["id"] == "seam_safe"


def test_order_validation(client, spec):
    assert client.post("/api/v1/orders", json=order_body(spec, items=[{"size": "M", "quantity": 501}])).status_code == 422
    assert client.post("/api/v1/orders", json=order_body(spec, items=[{"size": "XXXL", "quantity": 1}])).status_code == 422
    assert client.post("/api/v1/orders", json=order_body(spec, items=[{"number": "1234", "size": "M", "quantity": 1}])).status_code == 422
    assert client.post("/api/v1/orders", json=order_body(spec, key="short")).status_code == 422
    body = order_body(spec)
    body["customer"]["phone"] = "call me"
    assert client.post("/api/v1/orders", json=body).status_code == 422


def test_demo_payment_goes_to_test_queue_once(client, spec):
    o = client.post("/api/v1/orders", json=order_body(spec)).json()
    assert client.post(f"/api/v1/orders/{o['id']}/payment-confirmed", json={"demo": False}).status_code == 400
    paid = client.post(f"/api/v1/orders/{o['id']}/payment-confirmed", json={"demo": True}).json()
    f = paid["factory"]
    assert paid["status"] == "released_to_test_queue" and paid["payment"]["demo"] is True
    assert f["queue"] == "TEST" and f["factory_connected"] is False and f["duplicate"] is False
    again = client.post(f"/api/v1/orders/{o['id']}/payment-confirmed", json={"demo": True}).json()
    assert again["factory"]["job_id"] == f["job_id"] and again["factory"]["duplicate"] is True
    assert len(client.get("/api/v1/factory/queue").json()["jobs"]) == 1
    assert client.get(f"/api/v1/orders/{o['id']}").json()["status"] == "released_to_test_queue"


def test_remove_plain_background(client):
    import io
    from PIL import Image
    img = Image.new("RGB", (40, 40), (255, 255, 255))
    for x in range(10, 30):
        for y in range(10, 30):
            img.putpixel((x, y), (200, 0, 0))
    img.putpixel((20, 20), (255, 255, 255))           # enclosed white stays opaque
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    r = client.post("/api/v1/logos/remove-background", json={"data_url": url}).json()
    assert r["applied"] and r["background"] == "#ffffff" and 0.7 < r["removed_ratio"] < 0.8
    out = Image.open(io.BytesIO(base64.b64decode(r["data_url"].split(",", 1)[1])))
    assert out.getpixel((0, 0))[3] == 0 and out.getpixel((20, 20))[3] == 255

    noisy = Image.new("RGB", (20, 20))
    for x in range(20):
        for y in range(20):
            noisy.putpixel((x, y), ((x * 37) % 256, (y * 91) % 256, 128))
    buf = io.BytesIO()
    noisy.save(buf, format="PNG")
    url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    r = client.post("/api/v1/logos/remove-background", json={"data_url": url}).json()
    assert r["applied"] is False and r["data_url"] == url and "plain" in r["reason"]
    svg = "data:image/svg+xml;base64," + base64.b64encode(b"<svg/>").decode()
    assert client.post("/api/v1/logos/remove-background", json={"data_url": svg}).status_code == 422
