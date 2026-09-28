import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.engine.color import contrast_ratio  # noqa: E402
from app.engine.manufacturing import run_checks  # noqa: E402
from app.engine.renderer import render_mockup, render_print_sheet  # noqa: E402
from app.providers.base import ProviderError, parse_json_object, sanitize  # noqa: E402
from app.providers.rule import RuleProvider, parse_brief  # noqa: E402
from app.schemas import GARMENTS, PATTERNS, SIZES, GenerateRequest  # noqa: E402

REQ = GenerateRequest(prompt="aggressive navy and gold cricket jersey with lightning", team_name="Strikers",
                      player_name="Arul", number="7", variants=4, seed=7)


def xml(svg: str):
    return ET.fromstring(svg.split("\n", 1)[1] if svg.startswith("<?xml") else svg)


def test_parse_brief_extracts_colors_pattern_sport():
    b = parse_brief("Retro sky blue and navy football kit with pinstripes and a sash")
    assert b.colors[:2] == ["#5bb8ea", "#14213d"]      # "sky blue" wins over "blue"
    assert b.patterns[0] == "pinstripe"
    assert b.sport == "football"
    assert b.coverage == "diagonal_band"
    assert b.font == "athletic"


def test_rule_provider_is_deterministic_and_honours_brief():
    a = RuleProvider().generate(REQ, 4, 7)
    b = RuleProvider().generate(REQ, 4, 7)
    assert [s.model_dump() for s in a] == [s.model_dump() for s in b]
    assert all(s.pattern.type == "shards" for s in a)     # "lightning" -> shards
    assert {a[0].palette.primary, a[0].palette.secondary} == {"#14213d", "#c9a227"}
    assert all(s.sport == "cricket" for s in a)


def test_locked_colours_and_text_contrast_enforced():
    req = REQ.model_copy(update={"locked_colors": ["#ffff00"]})
    spec = sanitize({"palette": {"primary": "#000000", "text": "#fffff0"}}, req, 1)
    assert spec.palette.primary == "#ffff00"
    assert contrast_ratio(spec.palette.text, spec.palette.primary) >= 3


def test_sanitize_repairs_bad_model_output():
    raw = {"palette": {"primary": "f00", "secondary": "nope"}, "pattern": {"type": "plaid", "scale": 99, "colors": ["bogus"]},
           "accents": {"shoulder_stripes": 9}, "font": "comic"}
    s = sanitize(raw, REQ, 3)
    assert s.palette.primary == "#ff0000"
    assert s.pattern.type == "stripes" and s.pattern.scale == 2.5 and s.pattern.colors == ["secondary", "accent"]
    assert s.accents.shoulder_stripes == 3 and s.typography.font == "block"
    assert s.typography.team_name == "Strikers"


def test_parse_json_object_tolerates_fences():
    assert parse_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    with pytest.raises(ProviderError):
        parse_json_object("no json here")


@pytest.mark.parametrize("garment", GARMENTS)
@pytest.mark.parametrize("pattern", PATTERNS)
def test_every_pattern_renders_valid_svg(garment, pattern):
    spec = RuleProvider().generate(REQ, 1, 11)[0]
    spec.garment, spec.pattern.type = garment, pattern
    svg, ctx = render_mockup(spec)
    xml(svg)
    sheet, _ = render_print_sheet(spec, size="XXL", mirror=True)
    root = xml(sheet)
    assert root.get("width").endswith("mm")
    checks = {c.id: c.level for c in run_checks(spec, ctx.min_feature_mm)}
    assert checks["min_feature"] == "pass"


def test_render_is_deterministic():
    spec = RuleProvider().generate(REQ, 1, 5)[0]
    assert render_mockup(spec, "x")[0] == render_mockup(spec, "x")[0]


def test_print_sheet_grades_sizes():
    spec = RuleProvider().generate(REQ, 1, 5)[0]
    heights = [float(xml(render_print_sheet(spec, size=s)[0]).get("height")[:-2]) for s in SIZES]
    assert heights == sorted(heights) and heights[0] < heights[-1]
    with pytest.raises(ValueError):
        render_print_sheet(spec, roll_width=400)


# ------------------------------------------------------------------ API

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setenv("DESIGN_PROVIDER", "rule")
    for m in [m for m in sys.modules if m.startswith("app")]:
        del sys.modules[m]
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def test_api_generate_feedback_export(client):
    r = client.post("/api/v1/designs/generate", json={"prompt": "teal volleyball waves", "variants": 3, "number": "9"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provider"] == "rule" and len(body["designs"]) == 3
    d = body["designs"][0]
    assert d["mockup_svg"].startswith("<svg") and d["manufacturing_ready"]

    assert client.get(f"/api/v1/designs/{d['id']}/print.svg?size=L&mirror=true").headers["content-type"].startswith("image/svg")

    edited = dict(d["spec"], style_name="Edited Wave")
    assert client.post(f"/api/v1/designs/{d['id']}/feedback", json={"rating": 5, "edited_spec": edited}).json() == {"ok": True}
    assert client.get(f"/api/v1/designs/{d['id']}").json()["spec"]["style_name"] == "Edited Wave"

    lines = client.get("/api/v1/dataset/export").text.strip().splitlines()
    assert len(lines) == 1
    row = json.loads(lines[0])
    assert [m["role"] for m in row["messages"]] == ["system", "user", "assistant"]
    assert json.loads(row["messages"][2]["content"])["style_name"] == "Edited Wave"


def test_api_falls_back_when_provider_unavailable(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    r = client.post("/api/v1/designs/generate", json={"prompt": "camo rugby kit", "variants": 2, "provider": "claude"})
    assert r.status_code == 200
    assert r.json()["provider"] == "rule" and "not configured" in r.json()["fallback_reason"]


def test_api_validation(client):
    assert client.post("/api/v1/designs/generate", json={"prompt": "x"}).status_code == 422
    assert client.get("/api/v1/designs/nope").status_code == 404


def test_serverless_paths_work_without_stored_design(client):
    """On Vercel another instance may have generated the design; export and feedback must still work."""
    spec = client.post("/api/v1/designs/generate", json={"prompt": "hex esports", "variants": 1}).json()["designs"][0]["spec"]
    r = client.post("/api/v1/print", json={"spec": spec, "size": "S", "mirror": True, "design_id": "dsn_x"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg") and "MIRRORED" in r.text

    assert client.post("/api/v1/designs/dsn_unknown/feedback", json={"rating": 5}).status_code == 404
    r = client.post("/api/v1/designs/dsn_unknown/feedback", json={"rating": 5, "spec": spec})
    assert r.json() == {"ok": True}
    assert client.get("/api/v1/designs/dsn_unknown").json()["rating"] == 5
    assert client.get("/api/v1/dataset/export").text.strip() == ""   # restored rows have no brief
