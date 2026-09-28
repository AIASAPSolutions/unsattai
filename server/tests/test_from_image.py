"""Design from a picture: recognise colours and layout, rebuild as printable designs."""
import base64
import io
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEVICE = {"X-Device-Id": "phone-img-0001"}
BODY = [(200, 100), (600, 100), (760, 250), (660, 330), (620, 280), (620, 850), (180, 850), (180, 280),
        (140, 330), (40, 250)]


def picture(kind="plain", background="white", fmt="PNG", size=(800, 900)):
    im = Image.new("RGB", (800, 900), "white" if background == "noise" else background)
    d = ImageDraw.Draw(im)
    if background == "noise":   # a photo-like, busy backdrop
        import random
        rnd = random.Random(3)
        for _ in range(400):
            x, y = rnd.randrange(800), rnd.randrange(900)
            d.rectangle([x, y, x + 60, y + 60], fill=tuple(rnd.randrange(256) for _ in range(3)))
    d.polygon(BODY, fill="#12235a")
    if kind == "hoops":
        for y in range(150, 850, 90):
            d.rectangle([180, y, 620, y + 35], fill="#e8b10c")
    if kind == "vertical":
        for x in range(200, 620, 70):
            d.rectangle([x, 110, x + 20, 850], fill="#c0392b")
    if kind == "chest":
        for y in range(300, 420, 30):
            d.rectangle([180, y, 620, y + 12], fill="#ffffff")
    if size != (800, 900):
        im = im.resize(size)
    b = io.BytesIO()
    im.save(b, fmt)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(b.getvalue()).decode()


def make_client(tmp_path, monkeypatch, ai="off"):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "img.db"))
    monkeypatch.setenv("DESIGN_PROVIDER", "rule")
    monkeypatch.setenv("AI_EDITS", ai)
    monkeypatch.setenv("AI_FREE_EDITS_PER_DAY", "2")
    monkeypatch.delenv("API_KEYS", raising=False)
    for m in [m for m in sys.modules if m.startswith("app")]:
        del sys.modules[m]
    from fastapi.testclient import TestClient
    from app import from_image
    from app.main import app
    return TestClient(app), from_image


@pytest.fixture()
def client(tmp_path, monkeypatch):
    return make_client(tmp_path, monkeypatch)[0]


def upload(client, image, **kw):
    return client.post("/api/v1/designs/from-image", headers=DEVICE,
                       json={"image": image, "garment": "jersey", "team_name": "Strikers", "number": "7", **kw})


@pytest.mark.parametrize("kind,pattern,angle,coverage,second", [
    ("hoops", "stripes", 90, "full", "#e8b10c"),
    ("vertical", "stripes", 0, "full", "#c1392b"),
    ("chest", "stripes", 90, "chest_band", None),
])
def test_pixels_recognise_colours_and_layout(client, kind, pattern, angle, coverage, second):
    r = upload(client, picture(kind))
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["source"] == "pixels" and j["colors"][0]["hex"] == "#12235a"
    d = j["designs"][0]["spec"]
    assert d["palette"]["primary"] == "#12235a"
    assert d["pattern"]["type"] == pattern and d["pattern"]["angle"] == angle and d["pattern"]["coverage"] == coverage
    if second:
        assert second in {c["hex"] for c in j["colors"]} and second in d["palette"].values()


def test_three_printable_interpretations_with_customer_text(client):
    j = upload(client, picture("hoops")).json()
    assert len(j["designs"]) == 3 and len({d["spec"]["pattern"]["type"] for d in j["designs"]}) == 3
    for d in j["designs"]:
        assert d["manufacturing_ready"] is True and d["mockup_svg"].startswith("<svg")
        assert d["spec"]["typography"]["team_name"] == "Strikers" and d["spec"]["typography"]["number"] == "7"
    # saved like any generated design, so ratings and orders work
    assert client.post(f"/api/v1/designs/{j['designs'][0]['id']}/feedback", json={"rating": 5}).status_code == 200


def test_plain_garment_gets_a_faint_pattern(client):
    d = upload(client, picture("plain")).json()["designs"][0]["spec"]
    assert d["pattern"]["opacity"] <= 0.2


def test_busy_background_and_small_pictures_are_flagged_but_still_work(client):
    j = upload(client, picture("hoops", background="noise", fmt="JPEG", size=(300, 340))).json()
    assert {"busy_background", "small_picture"} <= set(j["warnings"]) and len(j["designs"]) >= 1


@pytest.mark.parametrize("image", ["data:image/gif;base64,R0lGODlh", "data:image/png;base64,bm90IGFuIGltYWdl",
                                   "data:image/png;base64,***"])
def test_bad_pictures_are_rejected_clearly(client, image):
    r = upload(client, image)
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_vision_model_refines_with_snapped_colours_and_never_copies_lettering(tmp_path, monkeypatch):
    client, fi = make_client(tmp_path, monkeypatch, ai="claude")
    seen = []

    def fake(jpeg, colours, req):
        seen.append(colours)
        return {"is_garment": True, "garment_seen": "jersey", "alternatives": ["waves", "stripes"],
                "text_seen": ["CHENNAI", "10"], "notes": "Navy jersey with gold chevrons.",
                "changes": [{"field": "pattern.type", "value": "chevron"},
                            {"field": "pattern.angle", "value": "90"},
                            {"field": "palette.secondary", "value": "#e9b20e"},   # snaps to measured gold
                            {"field": "typography.team_name", "value": "CHENNAI"},
                            {"field": "sport", "value": "rugby"}]}

    monkeypatch.setattr(fi, "ask_vision", fake)
    j = upload(client, picture("hoops")).json()
    d = j["designs"][0]["spec"]
    assert j["source"] == "ai" and j["recognised"]["notes"].startswith("Navy")
    assert d["pattern"]["type"] == "chevron" and d["palette"]["secondary"] == "#e8b10c"
    assert d["typography"]["team_name"] == "Strikers" and d["sport"] == "football"
    assert [x["spec"]["pattern"]["type"] for x in j["designs"]] == ["chevron", "waves", "stripes"]
    assert "text_not_copied" in j["warnings"] and j["ai"]["used"] == 1
    # the same picture again is free
    j2 = upload(client, picture("hoops")).json()
    assert len(seen) == 1 and j2["ai"]["cached"] is True and j2["ai"]["used"] == 1


def test_out_of_ai_edits_falls_back_to_pixels(tmp_path, monkeypatch):
    client, fi = make_client(tmp_path, monkeypatch, ai="claude")
    monkeypatch.setattr(fi, "ask_vision", lambda *a: {"is_garment": False, "garment_seen": "other", "alternatives": [],
                                                      "text_seen": [], "notes": "", "changes": []})
    assert "not_garment" in upload(client, picture("hoops")).json()["warnings"]
    upload(client, picture("vertical"))
    j = upload(client, picture("chest")).json()
    assert j["source"] == "pixels" and "ai_limit" in j["warnings"] and j["designs"][0]["spec"]["pattern"]["type"] == "stripes"


def test_vision_request_shape(tmp_path, monkeypatch):
    _, fi = make_client(tmp_path, monkeypatch, ai="claude")
    from app import ai_edit
    from app.schemas import FromImageRequest
    sent = {}

    class Msgs:
        def create(self, **kw):
            sent.update(kw)
            return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(
                type="text", text='{"is_garment": true, "garment_seen": "jersey", "changes": [], "alternatives": [],'
                                  ' "text_seen": [], "notes": ""}')])

    monkeypatch.setattr(ai_edit, "_client", SimpleNamespace(messages=Msgs()))
    img, _ = fi._decode(picture("hoops", size=(1600, 1800)))
    fi._ask_claude_vision(fi._vision_jpeg(img), [{"hex": "#12235a", "share": 0.6}],
                          FromImageRequest(image="x", language="ta"))
    content = sent["messages"][0]["content"]
    assert content[0]["type"] == "image" and content[0]["source"]["media_type"] == "image/jpeg"
    shown = Image.open(io.BytesIO(base64.b64decode(content[0]["source"]["data"])))
    assert max(shown.size) <= 1024                     # downscaled before sending: fewer tokens
    assert sent["model"] == "claude-haiku-4-5" and "thinking" not in sent and "Tamil" in content[1]["text"]
