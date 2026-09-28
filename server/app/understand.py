"""POST /brief/understand: what the engine read from a brief, and what it still needs to ask.

The customer confirms this before any design is generated. Team, player and
number values are copied verbatim from the text (never re-cased or translated),
and a disagreement between the prompt and the form becomes a question instead
of a silent choice.
"""
from __future__ import annotations

import re

from .engine import i18n
from .engine.vocab import MOOD_PATTERNS, NAMED_COLORS
from .providers.rule import parse_brief
from .schemas import SPORTS, UnderstandRequest

THEME_WORDS = {
    "tiger", "lion", "eagle", "wolf", "dragon", "phoenix", "peacock", "lotus", "fire", "flame", "lightning",
    "thunder", "storm", "mountain", "ocean", "sea", "river", "sunset", "sun", "star", "stars", "galaxy", "tricolor",
    "tricolour", "india", "temple", "kolam", "maori", "aztec", "tribal", "graffiti", "holi", "monsoon", "jungle",
    "desert", "ice", "night", "city", "skyline", "wings", "shield", "crown",
}
_HEX_NAME = {v: k for k, v in reversed(list(NAMED_COLORS.items()))}

_NAME = r"[^\s\"“”'‘’,.;:!?()]+"
_QUOTED = r"[\"“'‘]([^\"”'’]{1,40})[\"”'’]"


def _cue_regex(kind: str) -> str:
    return "|".join(re.escape(c) for c in sorted(i18n.CUES[kind], key=len, reverse=True))


_NOT_A_NAME = set(SPORTS) | {"jersey", "shorts", "vneck"} | set(NAMED_COLORS)


def _plausible_name(value: str) -> bool:
    """A native word after a cue is a name unless it is a sport, garment or colour keyword."""
    return not any(w in _NOT_A_NAME for w in i18n.english_keywords(value.split()[0]))


def _clip(value: str, limit: int) -> str:
    return value.strip()[:limit].strip()


def extract_number(text: str) -> str | None:
    t = i18n.normalize_digits(text)
    cue = _cue_regex("number")
    for pat in (rf"(?:{cue})\s*[:#=-]?\s*(\d{{1,3}})(?!\d)", rf"(?<!\d)(\d{{1,3}})\s*(?:{cue})(?![A-Za-z])"):
        m = re.search(pat, t, flags=re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def extract_team(text: str) -> str | None:
    cue = _cue_regex("team")
    m = re.search(rf"(?:{cue})(?:\s+name)?\s*(?:called|named|is|:|-)?\s*{_QUOTED}", text, flags=re.IGNORECASE)
    if m:
        return _clip(m.group(1), 24)
    # "team called Chennai Strikers" / "team: Chennai Strikers" / "for team Chennai Strikers"
    m = re.search(r"\b(?:team|club)(?:\s+name)?\s*(?:called|named|is|:|-)?\s*([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,3})", text)
    if m:
        return _clip(m.group(1), 24)
    # "Chennai Strikers team"
    m = re.search(r"((?:[A-Z][\w'&.-]*\s+){0,3}[A-Z][\w'&.-]*)\s+(?:team|club|FC)\b", text)
    if m and m.group(1).split()[0].lower() not in {"the", "a", "my", "our", "for"}:
        return _clip(m.group(1), 24)
    # native script: "टीम <name>" or "<name> टीम"
    native = [c for c in i18n.CUES["team"] if not c.isascii()]
    ncue = "|".join(re.escape(c) for c in native)
    m = re.search(rf"(?:{ncue})\s*[:-]?\s*({_NAME}(?:\s+{_NAME})?)", text)
    if m and _plausible_name(m.group(1)):
        return _clip(m.group(1).split()[0] if not _plausible_name(" ".join(m.group(1).split()[1:]) or "x")
                     else m.group(1), 24)
    return None


def extract_player(text: str) -> str | None:
    cue = _cue_regex("player")
    m = re.search(rf"(?:{cue})\s*(?:is|called|:|-)?\s*{_QUOTED}", text, flags=re.IGNORECASE)
    if m:
        return _clip(m.group(1), 16)
    m = re.search(r"\b(?:player(?:\s+name)?|name)\s*(?:is|called|:|-)?\s*([A-Z][\w'.-]*)", text)
    if m and m.group(1).lower() not in {"on", "and", "with", "number"}:
        return _clip(m.group(1), 16)
    m = re.search(r"\b(?:add|put|print)\s+([A-Z][\w'.-]*)\s+on\s+(?:the\s+)?back\b", text)
    if m:
        return _clip(m.group(1), 16)
    native = [c for c in i18n.CUES["player"] if not c.isascii()]
    ncue = "|".join(re.escape(c) for c in native)
    m = re.search(rf"(?:{ncue})\s*[:-]?\s*({_NAME})", text)
    if m and _plausible_name(m.group(1)):
        return _clip(m.group(1), 16)
    return None


def extract_garment(normalized: str) -> str | None:
    t = normalized.lower()
    if re.search(r"\bshorts?\b", t):
        return "shorts"
    if re.search(r"\bv[\s-]?neck\b", t):
        return "vneck"
    if re.search(r"\b(round[\s-]?neck|crew[\s-]?neck)\b", t):
        return "jersey"
    # "jersey", "kit", "tee"... name a top but not its neckline: either jersey style fits.
    if re.search(r"\b(jersey|tee|t-shirt|shirt|kit|top)\b", t):
        return "top"
    return None


def _question(qid: str, field: str, kind: str, message: str, options: list[dict]) -> dict:
    return {"id": qid, "field": field, "kind": kind, "message": message, "options": options}


def understand(req: UnderstandRequest) -> dict:
    normalized = i18n.normalize(req.prompt)
    brief = parse_brief(normalized)
    detected_lang = i18n.detect_language(req.prompt)

    colors = []
    for c in req.locked_colors:
        colors.append({"hex": c, "name": _HEX_NAME.get(c, c), "source": "locked"})
    for c in brief.colors:
        if c not in {x["hex"] for x in colors}:
            colors.append({"hex": c, "name": _HEX_NAME.get(c, c), "source": "prompt"})

    themes = sorted({w for w in brief.words if w in THEME_WORDS} | set(brief.moods))
    questions: list[dict] = []

    # sport
    prompt_sport = brief.sport
    # an unknown form value is ignored, so the missing-sport question asks again
    form_sport = req.sport if req.sport in SPORTS else None
    sport, sport_source = form_sport or prompt_sport, "form" if form_sport else ("prompt" if prompt_sport else None)
    if form_sport and prompt_sport and form_sport != prompt_sport:
        questions.append(_question("sport_conflict", "sport", "conflict",
                                   f"Your brief mentions {prompt_sport} but {form_sport} is selected. Which is it?",
                                   [{"value": prompt_sport, "source": "prompt"}, {"value": form_sport, "source": "form"}]))
    elif not sport:
        questions.append(_question("sport_missing", "sport", "missing", "Which sport is this kit for?",
                                   [{"value": s, "source": "choice"} for s in SPORTS]))

    # garment
    prompt_garment = extract_garment(normalized)
    if prompt_garment == "top":
        # Only a real disagreement (a top described, shorts selected) is worth asking about.
        prompt_garment = None if req.garment in (None, "jersey", "vneck") else "jersey"
    garment = req.garment or prompt_garment or "jersey"
    if req.garment and prompt_garment and req.garment != prompt_garment:
        questions.append(_question("garment_conflict", "garment", "conflict",
                                   f"Your brief says {prompt_garment} but {req.garment} is selected. Which should we design?",
                                   [{"value": prompt_garment, "source": "prompt"}, {"value": req.garment, "source": "form"}]))

    # team / player / number: exact strings, never auto-resolved when they disagree
    extracted = {"team_name": extract_team(req.prompt), "player_name": extract_player(req.prompt),
                 "number": extract_number(req.prompt)}
    form = {"team_name": req.team_name.strip(), "player_name": req.player_name.strip(), "number": req.number.strip()}
    labels = {"team_name": "team name", "player_name": "player name", "number": "number"}
    values = {}
    for f in ("team_name", "player_name", "number"):
        p, v = extracted[f], form[f]
        if p and v and p != v:
            questions.append(_question(f"{f}_conflict", f, "conflict",
                                       f"The brief says {labels[f]} \"{p}\" but the form says \"{v}\". Which is correct?",
                                       [{"value": p, "source": "prompt"}, {"value": v, "source": "form"}]))
            values[f] = {"value": v, "source": "form"}
        elif v:
            values[f] = {"value": v, "source": "form"}
        elif p:
            values[f] = {"value": p, "source": "prompt"}
        else:
            values[f] = {"value": "", "source": None}

    return {
        "prompt": req.prompt,
        "normalized_prompt": normalized,
        "language": req.language,
        "detected_language": detected_lang,
        "sport": sport, "sport_source": sport_source,
        "garment": garment, "garment_source": "form" if req.garment else ("prompt" if prompt_garment else "default"),
        "colors": colors,
        "patterns": brief.patterns,
        "themes": themes,
        "coverage": brief.coverage,
        "font": brief.font,
        "team_name": values["team_name"], "player_name": values["player_name"], "number": values["number"],
        "extracted": extracted,
        "questions": questions,
        "ready": not questions,
    }


__all__ = ["understand", "extract_number", "extract_team", "extract_player", "MOOD_PATTERNS"]
