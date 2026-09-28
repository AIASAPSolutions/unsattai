"""Ask tab: rules first, the small model only as a fallback, with cache and per-phone limits."""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEVICE = {"X-Device-Id": "phone-aaaa-1111"}
OTHER = {"X-Device-Id": "phone-bbbb-2222"}


@pytest.fixture()
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "ai.db"))
    monkeypatch.setenv("DESIGN_PROVIDER", "rule")
    monkeypatch.setenv("AI_EDITS", "claude")
    monkeypatch.setenv("AI_FREE_EDITS_PER_DAY", "3")
    monkeypatch.setenv("AI_BONUS_EDITS_PER_ORDER", "5")
    monkeypatch.setenv("AI_EDITS_PER_MINUTE", "10")
    monkeypatch.delenv("FACTORY_URL", raising=False)
    monkeypatch.delenv("API_KEYS", raising=False)
    for m in [m for m in sys.modules if m.startswith("app")]:
        del sys.modules[m]
    from fastapi.testclient import TestClient
    from app import ai_edit
    from app.main import app

    calls = []

    def fake(req):
        calls.append(req.instruction)
        if "weather" in req.instruction:
            return {"understood": False, "changes": [], "message": "I can only change the design."}
        return {"understood": True, "message": "Made it feel like a sunset.",
                "changes": [{"field": "palette.primary", "value": "#ff5e3a"},
                            {"field": "pattern.type", "value": "gradient"},
                            {"field": "pattern.scale", "value": "9"},
                            {"field": "typography.player_name", "value": "Invented"},
                            {"field": "palette.secret", "value": "#000000"}]}

    monkeypatch.setattr(ai_edit, "ask_model", fake)
    client = TestClient(app)
    spec = client.post("/api/v1/designs/generate", json={"prompt": "navy cricket jersey", "variants": 1,
                                                         "player_name": "Arul"}).json()["designs"][0]["spec"]
    return SimpleNamespace(client=client, calls=calls, spec=spec, ai_edit=ai_edit, monkeypatch=monkeypatch)


def ask(api, text, headers=DEVICE, spec=None):
    return api.client.post("/api/v1/designs/refine", headers=headers,
                           json={"spec": spec or api.spec, "instruction": text})


def test_rules_handle_simple_edits_without_the_model(api):
    r = ask(api, "make the collar gold").json()
    assert r["source"] == "rules" and r["understood"] is True
    assert api.calls == [] and r["ai"]["remaining"] == 3


def test_model_is_used_only_when_rules_fail_and_its_answer_is_checked(api):
    r = ask(api, "make it feel like a sunset").json()
    assert api.calls == ["make it feel like a sunset"]
    assert r["source"] == "ai" and r["understood"] is True and r["message"] == "Made it feel like a sunset."
    assert r["spec"]["palette"]["primary"] == "#ff5e3a" and r["spec"]["pattern"]["type"] == "gradient"
    assert r["spec"]["pattern"]["scale"] == 2.5                       # clamped to the allowed range
    assert r["spec"]["typography"]["player_name"] == "Arul"          # names are never invented
    assert "secret" not in r["spec"]["palette"]
    assert r["ai"] == {"enabled": True, "limit": 3, "used": 1, "remaining": 2, "cached": False}
    assert "svg" in r or "preview" in r or "checks" in r


def test_same_request_is_answered_from_the_cache_for_free(api):
    ask(api, "make it feel like a sunset")
    r = ask(api, "Make it feel like  a sunset", headers=OTHER).json()
    assert len(api.calls) == 1 and r["ai"]["cached"] is True and r["ai"]["remaining"] == 3
    assert r["spec"]["palette"]["primary"] == "#ff5e3a"


def test_daily_allowance_then_429_but_rules_still_work(api):
    for i in range(3):
        assert ask(api, f"sunset vibe {i}").status_code == 200
    r = ask(api, "sunset vibe 4")
    assert r.status_code == 429 and r.json()["detail"]["code"] == "ai_quota"
    assert r.json()["detail"]["ai"]["remaining"] == 0 and len(api.calls) == 3
    assert ask(api, "make the collar gold").status_code == 200
    assert ask(api, "sunset vibe 4", headers=OTHER).status_code == 200    # other phones are separate
    assert api.client.get("/api/v1/ai/allowance", headers=DEVICE).json()["remaining"] == 0


def test_paid_order_unlocks_more_edits_but_unpaid_does_not(api):
    body = {"design_id": "dsn_1", "spec": api.spec, "language": "en", "idempotency_key": "key_ai_123456",
            "customer": {"name": "Asha", "phone": "+91 98765 43210"},
            "items": [{"player_name": "Arul", "number": "7", "size": "M", "quantity": 1}]}
    o = api.client.post("/api/v1/orders", json=body, headers=DEVICE).json()
    assert api.client.get("/api/v1/ai/allowance", headers=DEVICE).json()["limit"] == 3
    api.client.post(f"/api/v1/orders/{o['id']}/payment-confirmed", json={"demo": True})
    assert api.client.get("/api/v1/ai/allowance", headers=DEVICE).json()["limit"] == 8


def test_per_minute_limit(api):
    from dataclasses import replace
    api.monkeypatch.setattr(api.ai_edit, "settings", replace(api.ai_edit.settings, ai_edits_per_minute=2,
                                                             ai_free_edits_per_day=50))
    ask(api, "sunset a"), ask(api, "sunset b")
    r = ask(api, "sunset c")
    assert r.status_code == 429 and r.json()["detail"]["code"] == "ai_rate" and int(r.headers["Retry-After"]) >= 1


def test_model_that_does_not_understand_leaves_design_unchanged(api):
    r = ask(api, "what is the weather").json()
    assert r["understood"] is False and r["spec"] == api.spec and r["message"] == "I can only change the design."
    assert r["ai"]["used"] == 1


def test_model_failure_is_free_and_falls_back_to_the_rules_message(api):
    def boom(req):
        raise api.ai_edit.AIError("down")
    api.monkeypatch.setattr(api.ai_edit, "ask_model", boom)
    r = ask(api, "sunset please").json()
    assert r["understood"] is False and "collar" in r["message"] and r["ai"]["used"] == 0 and r["ai"]["error"]


def test_ai_off_means_rules_only(api):
    api.monkeypatch.setenv("AI_EDITS", "off")
    from dataclasses import replace
    api.monkeypatch.setattr(api.ai_edit, "settings", replace(api.ai_edit.settings, ai_edits="off"))
    r = ask(api, "sunset please").json()
    assert api.calls == [] and r["ai"]["enabled"] is False and r["source"] == "rules"


def test_names_typed_by_the_customer_are_kept_exactly(api):
    api.monkeypatch.setattr(api.ai_edit, "ask_model", lambda req: {
        "understood": True, "message": "ok",
        "changes": [{"field": "typography.player_name", "value": "அருள்"}, {"field": "typography.number", "value": "10"}]})
    r = ask(api, "பின்னால் அருள் 10 போடுங்கள்").json()
    assert r["source"] == "ai"
    assert r["spec"]["typography"]["player_name"] == "அருள்" and r["spec"]["typography"]["number"] == "10"


def test_real_claude_call_shape(monkeypatch):
    """The request sent to the API: small model, structured output, no thinking or effort."""
    for m in [m for m in sys.modules if m.startswith("app")]:
        del sys.modules[m]
    from app import ai_edit
    from app.schemas import DesignSpec, RefineRequest

    sent = {}

    class Msgs:
        def create(self, **kw):
            sent.update(kw)
            return SimpleNamespace(stop_reason="end_turn", usage=SimpleNamespace(input_tokens=900, output_tokens=40),
                                   content=[SimpleNamespace(type="text", text='{"understood": true, "changes": [], "message": "x"}')])

    monkeypatch.setattr(ai_edit, "_client", SimpleNamespace(messages=Msgs()))
    spec = DesignSpec.model_validate({"palette": {"primary": "#112233", "secondary": "#445566", "accent": "#778899",
                                                  "trim": "#aabbcc", "text": "#ffffff"}})
    out = ai_edit._ask_claude(RefineRequest(spec=spec, instruction="retro vibe", language="hi"))
    assert out["understood"] is True
    assert sent["model"] == "claude-haiku-4-5" and sent["max_tokens"] <= 1000
    assert sent["output_config"]["format"]["type"] == "json_schema"
    assert "thinking" not in sent and "effort" not in sent["output_config"]
    assert "Hindi" in sent["messages"][0]["content"]
