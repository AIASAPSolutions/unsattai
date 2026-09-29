"""Low-cost AI fallback for the "Ask" tab.

The rule engine in refine.py handles most edits for free. Only when it understands
nothing does this module ask a small model, and even then the model returns a short
list of field changes (never a whole design, never an image). Costs are kept down by:

- caching: the same instruction on the same design is answered from the database;
- a daily free allowance per phone (more after a paid order) and a per-minute limit;
- a daily cap across all phones (AI_DAILY_BUDGET) as a last line of defence.

Only calls that reach the model count against the allowance. Rule edits, cache hits
and failed calls are free.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone

from .config import settings
from .engine import i18n
from .engine.color import best_text_color, contrast_ratio
from .engine.vocab import NAMED_COLORS
from .refine import _Edit
from .schemas import COLLARS, COLOR_ROLES, COVERAGES, FONTS, PATTERNS, SLEEVES, SPORTS, DesignSpec, RefineRequest
from .store import Store

log = logging.getLogger("urjersey.ai_edit")

DEVICE_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

# field -> kind. Anything else the model returns is ignored.
FIELDS: dict[str, tuple] = {
    **{f"palette.{r}": ("color",) for r in COLOR_ROLES},
    "pattern.type": ("enum", PATTERNS),
    "pattern.coverage": ("enum", COVERAGES),
    "pattern.scale": ("num", 0.4, 2.5),
    "pattern.opacity": ("num", 0.15, 1.0),
    "pattern.angle": ("num", -90, 90),
    "pattern.density": ("num", 0.1, 1.0),
    "base": ("enum", ("solid", "gradient")),
    "accents.side_panels": ("bool",),
    "accents.shoulder_stripes": ("int", 0, 3),
    "accents.collar_role": ("enum", COLOR_ROLES),
    "accents.cuff_role": ("enum", COLOR_ROLES),
    "typography.font": ("enum", FONTS),
    "typography.team_name": ("name", 24),
    "typography.player_name": ("name", 16),
    "typography.number": ("number",),
    "sport": ("enum", SPORTS),
    "style_name": ("text", 48),
    "sleeves": ("enum", SLEEVES),
    "collar": ("enum", COLLARS),
}

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "understood": {"type": "boolean"},
        "changes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"field": {"type": "string", "enum": list(FIELDS)}, "value": {"type": "string"}},
                "required": ["field", "value"],
                "additionalProperties": False,
            },
        },
        "message": {"type": "string"},
    },
    "required": ["understood", "changes", "message"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = f"""You edit sportswear designs for the UrJersey app. The customer describes a change in
English, Hindi, Telugu or Tamil. Reply only with the smallest list of field changes that does what they asked.

Fields and allowed values:
- palette.primary|secondary|accent|trim|text: hex colour like #1a2b3c. primary is the body, secondary the
  pattern and panels, accent highlights, trim the collar and cuffs, text the names and numbers.
- pattern.type: {", ".join(PATTERNS)}
- pattern.coverage: {", ".join(COVERAGES)}
- pattern.scale 0.4-2.5, pattern.opacity 0.15-1, pattern.angle -90-90, pattern.density 0.1-1 (numbers as text)
- base: solid, gradient
- accents.side_panels: true/false; accents.shoulder_stripes: 0-3; accents.collar_role, accents.cuff_role: a palette role
- typography.font: {", ".join(FONTS)}
- typography.team_name (24 chars), typography.player_name (16 chars), typography.number (0-3 digits):
  only when the customer typed the exact name or number; copy it exactly, never translate or invent one.
  An empty value removes it.
- sport: {", ".join(SPORTS)}
- style_name: short name for the look (48 chars)
- sleeves: {", ".join(SLEEVES)} (none = sleeveless; not for shorts)
- collar: {", ".join(COLLARS)} (crew-neck jersey only; a V-neck keeps its V)

Rules: change only what was asked; use the current design to judge relative requests such as "a bit darker"
or "bigger pattern"; keep names and numbers readable against the body colour. If the request is not about
the garment's look or you cannot map it to these fields, return understood=false with no changes.
message: one short sentence in the customer's language saying what changed, or what to try instead."""


class AIError(Exception):
    pass


class QuotaExceeded(Exception):
    def __init__(self, code: str, message: str, retry_after: int | None = None, status: dict | None = None):
        super().__init__(message)
        self.code, self.message, self.retry_after, self.status = code, message, retry_after, status or {}


# ----------------------------------------------------------------- which model

def provider() -> str:
    """'claude', 'slm' or 'off'."""
    mode = settings.ai_edits.lower()
    if mode in ("off", "slm"):
        return mode
    has_key = bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))
    if mode == "claude":
        return "claude"
    return "claude" if has_key else "off"


_client = None


def _claude_client():
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic()
    return _client


def _user_message(req: RefineRequest) -> str:
    s = req.spec
    current = {"garment": s.garment, "sleeves": s.sleeves, "collar": s.collar, "sport": s.sport, "style_name": s.style_name, "base": s.base,
               "palette": s.palette.model_dump(), "pattern": s.pattern.model_dump(),
               "accents": s.accents.model_dump(), "typography": s.typography.model_dump()}
    lang = i18n.LANGUAGE_NAMES.get(req.language, ("English",))[0]
    return (f"Current design:\n{json.dumps(current, ensure_ascii=False)}\n\n"
            f"Customer language: {lang}\nRequest: {req.instruction}")


def _ask_claude(req: RefineRequest) -> dict:
    import anthropic

    try:
        response = _claude_client().messages.create(
            model=settings.ai_edit_model,
            max_tokens=700,
            system=SYSTEM_PROMPT,
            output_config={"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
            messages=[{"role": "user", "content": _user_message(req)}],
        )
    except anthropic.RateLimitError as e:
        raise AIError("rate limited") from e
    except anthropic.APIStatusError as e:
        raise AIError(f"API error {e.status_code}") from e
    except anthropic.APIConnectionError as e:
        raise AIError("could not reach the API") from e
    except anthropic.AnthropicError as e:
        raise AIError(str(e)) from e
    if response.stop_reason in ("refusal", "max_tokens"):
        raise AIError(f"stopped: {response.stop_reason}")
    text = next((b.text for b in response.content if b.type == "text"), None)
    if text is None:
        raise AIError("no text in reply")
    u = response.usage
    log.info("ai edit: in=%s out=%s", u.input_tokens, u.output_tokens)
    return json.loads(text)


def _ask_slm(req: RefineRequest) -> dict:
    import httpx

    from .providers.base import parse_json_object

    try:
        with httpx.Client(timeout=settings.slm_timeout) as client:
            r = client.post(f"{settings.slm_base_url}/chat/completions", json={
                "model": settings.slm_model,
                "messages": [{"role": "system", "content": SYSTEM_PROMPT + "\nReply with one JSON object: "
                              '{"understood": bool, "changes": [{"field": str, "value": str}], "message": str}'},
                             {"role": "user", "content": _user_message(req)}],
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
            })
            r.raise_for_status()
            return parse_json_object(r.json()["choices"][0]["message"]["content"])
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as e:
        raise AIError(f"SLM: {e}") from e


def ask_model(req: RefineRequest) -> dict:
    """Swapped out in tests."""
    return _ask_slm(req) if provider() == "slm" else _ask_claude(req)


# ----------------------------------------------------------------- applying the answer

def _coerce(field: str, raw, instruction: str):
    kind = FIELDS[field]
    v = str(raw).strip()
    if kind[0] == "color":
        v = v.lower()
        if v in NAMED_COLORS:
            return NAMED_COLORS[v]
        return v if HEX.match(v) else None
    if kind[0] == "enum":
        return v if v in kind[1] else None
    if kind[0] in ("num", "int"):
        try:
            n = float(v)
        except ValueError:
            return None
        n = min(kind[2], max(kind[1], n))
        return int(round(n)) if kind[0] == "int" else round(n, 2)
    if kind[0] == "bool":
        return {"true": True, "false": False, "yes": True, "no": False}.get(v.lower())
    if kind[0] == "name":
        # Names are only ever copied from what the customer typed.
        if v == "" or v.casefold() in instruction.casefold():
            return v[: kind[1]]
        return None
    if kind[0] == "number":
        v = i18n.normalize_digits(v)
        return v if re.fullmatch(r"\d{0,3}", v) and (v == "" or v in i18n.normalize_digits(instruction)) else None
    if kind[0] == "text":
        return v[: kind[1]] or None
    return None


def apply_changes(spec: DesignSpec, changes: list[dict], instruction: str) -> tuple[DesignSpec, list[dict]]:
    e = _Edit(spec)
    for c in changes[:12]:
        field = c.get("field")
        if field not in FIELDS:
            continue
        value = _coerce(field, c.get("value", ""), instruction)
        if value is None:
            continue
        if (field == "sleeves" and e.data["garment"] == "shorts") or (field == "collar" and e.data["garment"] != "jersey"):
            continue
        label = field.split(".")[-1].replace("_", " ")
        e.set(field, value, f"{label.capitalize()} set to {value}" if value != "" else f"{label.capitalize()} removed")
    pal = e.data["palette"]
    if contrast_ratio(pal["text"], pal["primary"]) < 3 and not any(c["field"] == "palette.text" for c in e.changes):
        e.set("palette.text", best_text_color(pal["primary"], [pal["text"], "#f7f7f5", "#111111", pal["accent"]]),
              "Text colour adjusted to stay readable")
    try:
        return DesignSpec.model_validate(e.data), e.changes
    except ValueError:
        return spec, []


# ----------------------------------------------------------------- allowance

def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def device_key(device_id: str | None, client_host: str | None) -> str:
    if device_id and DEVICE_RE.match(device_id):
        return "dev:" + device_id
    return "ip:" + (client_host or "unknown")


def allowance(store: Store, device: str) -> dict:
    enabled = provider() != "off"
    limit = settings.ai_free_edits_per_day + settings.ai_bonus_edits_per_order * min(store.device_paid_orders(device), 3)
    used = store.ai_used(device, _today())
    return {"enabled": enabled, "limit": limit, "used": used, "remaining": max(0, limit - used) if enabled else 0}


def _check(store: Store, device: str) -> dict:
    status = allowance(store, device)
    if status["remaining"] <= 0:
        raise QuotaExceeded("ai_quota", "You have used today's free AI edits. Simple edits like \"make the collar "
                            "gold\" still work, and more AI edits unlock tomorrow or after an order.", status=status)
    now = time.time()
    recent = store.ai_calls_since(device, now - 60)
    if len(recent) >= settings.ai_edits_per_minute:
        raise QuotaExceeded("ai_rate", "Too many AI edits in a minute. Please wait a moment and try again.",
                            retry_after=max(1, int(60 - (now - recent[0])) + 1), status=status)
    if settings.ai_daily_budget and store.ai_used_total(_today()) >= settings.ai_daily_budget:
        raise QuotaExceeded("ai_busy", "AI edits are paused for today. Simple edits still work.", status=status)
    return status


def _cache_key(req: RefineRequest) -> str:
    s = req.spec
    basis = {"i": " ".join(i18n.normalize(req.instruction).lower().split()), "l": req.language, "m": settings.ai_edit_model,
             "s": [s.garment, s.sport, s.base, s.palette.model_dump(), s.pattern.model_dump(), s.accents.model_dump(),
                   s.typography.model_dump()]}
    return hashlib.sha256(json.dumps(basis, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def refine_with_ai(store: Store, req: RefineRequest, rules_out: dict, device: str) -> dict:
    """Called only when the rules understood nothing. Returns a refine response."""
    status = allowance(store, device)
    base = {**rules_out, "source": "rules", "ai": {**status, "cached": False}}
    if not status["enabled"]:
        return base

    key = _cache_key(req)
    answer = store.ai_cache_get(key)
    cached = answer is not None
    if not cached:
        status = _check(store, device)
        try:
            answer = ask_model(req)
        except (AIError, json.JSONDecodeError) as e:
            log.warning("ai edit failed: %s", e)
            return {**base, "ai": {**status, "cached": False, "error": True}}
        store.ai_record_call(device, _today(), time.time())
        status = allowance(store, device)
        store.ai_cache_put(key, answer)

    spec, changes = apply_changes(req.spec, answer.get("changes") or [], req.instruction) \
        if answer.get("understood") else (req.spec, [])
    ai = {**status, "cached": cached}
    if not changes:
        msg = str(answer.get("message") or "").strip()[:300]
        return {**base, "source": "ai", "ai": ai, "message": msg or rules_out["message"]}
    msg = str(answer.get("message") or "").strip()[:300] or "; ".join(c["message"] for c in changes) + "."
    return {"spec": spec.model_dump(), "changes": changes, "understood": True, "message": msg,
            "source": "ai", "ai": ai}
