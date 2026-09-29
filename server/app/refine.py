"""POST /designs/refine: apply a plain-language edit ("make the collar gold") to a spec.

Rule-based so it works offline and is predictable; every change it makes is
reported back so the app can confirm it and keep undo working. When nothing is
understood the spec comes back unchanged with understood=false.
"""
from __future__ import annotations

import re

from .engine import i18n
from .engine.color import best_text_color, contrast_ratio
from .engine.vocab import NAMED_COLORS, PATTERN_KEYWORDS
from .schemas import FONTS, PATTERNS, SPORTS, DesignSpec, RefineRequest

_COLOR_NAMES = sorted(NAMED_COLORS, key=len, reverse=True)
_COLOR_RE = r"(#[0-9a-f]{6}|" + "|".join(re.escape(c) for c in _COLOR_NAMES) + r")"

# target words -> palette role (and, for collar/cuffs, the accent role that points at it)
_TARGETS = [
    (r"collars?|necks?|neckline", "trim", "collar_role"),
    (r"cuffs?|sleeve ends?|waistband|waist", "trim", "cuff_role"),
    (r"trim", "trim", None),
    (r"names?|numbers?|text|letters?|lettering|font colou?r", "text", None),
    (r"patterns?|stripes?|design", "secondary", None),
    (r"accents?|highlights?|details?", "accent", None),
    (r"secondary|second colou?r|panels?|sides?", "secondary", None),
    (r"base|body|main colou?r|background|primary|shirt|jersey|kit|shorts|it", "primary", None),
]

_COVERAGE_WORDS = {
    "full": r"full|all over|everywhere|whole",
    "top": r"top|upper|shoulders?",
    "bottom": r"bottom|lower|hem",
    "diagonal_band": r"diagonal|sash",
    "side_panels": r"side panels?|sides",
    "chest_band": r"chest band|chest|hoop|band",
}


def _hex(name: str) -> str:
    return name if name.startswith("#") else NAMED_COLORS[name]


class _Edit:
    def __init__(self, spec: DesignSpec):
        self.data = spec.model_dump()
        self.changes: list[dict] = []

    def set(self, path: str, value, message: str) -> None:
        node = self.data
        *parents, leaf = path.split(".")
        for p in parents:
            node = node[p]
        if node.get(leaf) == value:
            return
        self.changes.append({"field": path, "from": node.get(leaf), "to": value, "message": message})
        node[leaf] = value


def _colors(t: str, e: _Edit) -> None:
    # "make the collar gold", "gold collar", "change the base to navy", "numbers in white"
    handled_roles: set[str] = set()
    for target, role, accent_key in _TARGETS:
        pats = [rf"\b(?:{target})\b[^.,;]*?\b{_COLOR_RE}\b", rf"\b{_COLOR_RE}\s+(?:{target})\b"]
        for pat in pats:
            m = re.search(pat, t)
            if not m or role in handled_roles:
                continue
            if target.endswith("|it") and not re.search(r"\b(make|turn|change|colou?r)\b", t):
                continue
            hexv = _hex(m.group(1))
            if accent_key:
                e.set(f"accents.{accent_key}", role, f"{accent_key.split('_')[0].title()} uses the {role} colour")
            e.set(f"palette.{role}", hexv, f"{role.title()} colour set to {m.group(1)}")
            handled_roles.add(role)
            break
    if "primary" in handled_roles or "text" in handled_roles:
        pal = e.data["palette"]
        if contrast_ratio(pal["text"], pal["primary"]) < 3 and "text" not in handled_roles:
            new = best_text_color(pal["primary"], [pal["text"], "#f7f7f5", "#111111", pal["accent"]])
            e.set("palette.text", new, "Text colour adjusted to stay readable")


def _pattern(t: str, e: _Edit) -> None:
    t = re.sub(r"\bshoulder stripes?\b|\b\w+ stripes? (?:on|to) (?:the )?(?:shoulders?|sleeves?)", " ", t)
    if re.search(r"\b(no|remove|without|plain)\b[^.,;]*\bpattern\b", t):
        e.set("pattern.opacity", 0.15, "Pattern faded right back")
        return
    for ptype in PATTERNS:
        kws = [ptype] + PATTERN_KEYWORDS.get(ptype, [])
        if any(re.search(rf"\b{re.escape(k)}s?\b", t) for k in kws):
            if re.search(r"\b(pattern|style|design|switch|change|use|try|make|add)\b", t) or ptype in t:
                e.set("pattern.type", ptype, f"Pattern changed to {ptype}")
                if ptype == "gradient":
                    e.set("base", "gradient", "Base set to gradient")
                return


def _coverage(t: str, e: _Edit) -> None:
    if not re.search(r"\b(coverage|pattern|only|on the|across|over)\b", t):
        return
    for cov, words in _COVERAGE_WORDS.items():
        if re.search(rf"\b(?:{words})\b", t) and ("pattern" in t or "coverage" in t):
            e.set("pattern.coverage", cov, f"Pattern coverage set to {cov.replace('_', ' ')}")
            return


def _scale(t: str, e: _Edit) -> None:
    p = e.data["pattern"]
    if re.search(r"\b(bigger|larger|bolder|chunkier)\b[^.,;]*\bpattern\b|\bpattern\b[^.,;]*\b(bigger|larger|bolder)\b", t):
        e.set("pattern.scale", round(min(2.5, p["scale"] * 1.3), 2), "Pattern scaled up")
    elif re.search(r"\b(smaller|finer|tighter)\b[^.,;]*\bpattern\b|\bpattern\b[^.,;]*\b(smaller|finer|tighter)\b", t):
        e.set("pattern.scale", round(max(0.4, p["scale"] / 1.3), 2), "Pattern scaled down")
    if re.search(r"\b(subtle|softer|lighter|quieter|fainter)\b", t):
        e.set("pattern.opacity", round(max(0.15, p["opacity"] - 0.25), 2), "Pattern made more subtle")
    elif re.search(r"\b(stronger|louder|brighter|more visible|more contrast)\b", t):
        e.set("pattern.opacity", round(min(1.0, p["opacity"] + 0.25), 2), "Pattern made stronger")


def _font(t: str, e: _Edit) -> None:
    for f in FONTS:
        if re.search(rf"\b{f}\b[^.,;]*\b(font|letters|lettering|type)\b|\b(font|lettering)\b[^.,;]*\b{f}\b", t):
            e.set("typography.font", f, f"Font changed to {f}")
            return
    if re.search(r"\b(collegiate|varsity|slab)\b", t):
        e.set("typography.font", "athletic", "Font changed to athletic")


def _accents(t: str, e: _Edit) -> None:
    m = re.search(r"\b(add|with|put)\s+(\d|one|two|three)\s+(?:shoulder\s+)?stripes?\s+(?:on|to)\s+(?:the\s+)?(?:shoulders?|sleeves?)", t)
    if m:
        n = {"one": 1, "two": 2, "three": 3}.get(m.group(2)) or int(m.group(2))
        e.set("accents.shoulder_stripes", max(0, min(3, n)), f"{n} shoulder stripes")
    elif re.search(r"\b(remove|no|without)\b[^.,;]*\bshoulder stripes?\b", t):
        e.set("accents.shoulder_stripes", 0, "Shoulder stripes removed")
    if re.search(r"\b(add|with)\b[^.,;]*\bside panels?\b", t):
        e.set("accents.side_panels", True, "Side panels added")
    elif re.search(r"\b(remove|no|without)\b[^.,;]*\bside panels?\b", t):
        e.set("accents.side_panels", False, "Side panels removed")
    if re.search(r"\bgradient (base|background|body)\b|\bfade\b", t):
        e.set("base", "gradient", "Base set to gradient")
    elif re.search(r"\bsolid (base|background|body|colou?r)\b", t):
        e.set("base", "solid", "Base set to solid")


def _names(original: str, t: str, e: _Edit) -> None:
    # Names are read from the original text so their spelling and script are preserved.
    src = i18n.normalize_digits(original)
    m = re.search(r"\b(?:add|put|print|write)\s+[\"“']?([^\s\"”']{1,16}(?:\s[^\s\"”']{1,16})?)[\"”']?\s+on\s+(?:the\s+)?back\b", src, re.I)
    if m and not re.fullmatch(r"\d{1,3}", m.group(1)) and m.group(1).lower() not in {"number", "the", "a", "name"}:
        e.set("typography.player_name", m.group(1)[:16], f"Player name set to {m.group(1)[:16]}")
    m = re.search(r"\b(?:player\s+name|(?<!team )name)\s+(?:to|is|as|:)\s*[\"“']?([^\"”'.,;]{1,16})[\"”']?", src, re.I)
    if m:
        e.set("typography.player_name", m.group(1).strip()[:16], f"Player name set to {m.group(1).strip()[:16]}")
    m = re.search(r"\b(?:team\s+name|team|club)\s+(?:to|is|as|called|:)\s*[\"“']?([^\"”'.,;]{1,24})[\"”']?", src, re.I)
    if m:
        e.set("typography.team_name", m.group(1).strip()[:24], f"Team name set to {m.group(1).strip()[:24]}")
    m = re.search(r"\b(?:number|no\.?|#)\s*(?:to|is|as|:)?\s*(\d{1,3})\b", src, re.I) or \
        re.search(r"\b(?:add|put|make it)\s+(\d{1,3})\b(?!\s*(?:shoulder|stripes?|side))", src, re.I) or \
        re.search(r"(?:नंबर|నంబర్|எண்)\s*(\d{1,3})", src)
    if m:
        e.set("typography.number", m.group(1), f"Number set to {m.group(1)}")
    if re.search(r"\b(remove|delete|no)\b[^.,;]*\bplayer name\b|\bremove\b[^.,;]*\bname\b(?! and number)", t):
        e.set("typography.player_name", "", "Player name removed")
    if re.search(r"\b(remove|delete|no)\b[^.,;]*\bnumbers?\b", t):
        e.set("typography.number", "", "Number removed")
    if re.search(r"\b(remove|delete|no)\b[^.,;]*\bteam name\b", t):
        e.set("typography.team_name", "", "Team name removed")


def _sport(t: str, e: _Edit) -> None:
    m = re.search(r"\b(?:for|make it|change (?:it|the sport) to)\s+(" + "|".join(SPORTS) + r")\b", t)
    if m:
        e.set("sport", m.group(1), f"Sport set to {m.group(1)}")


_SLEEVE_LABEL = {"short": "Short sleeves", "long": "Long sleeves", "none": "Sleeveless"}
_COLLAR_LABEL = {"crew": "Crew neck", "polo": "Polo collar", "mandarin": "Mandarin collar"}


def _garment_options(t: str, e: _Edit) -> None:
    from .understand import extract_collar, extract_sleeves
    g = e.data["garment"]
    if g == "shorts":
        return
    if re.search(r"\b(remove|no|without|drop|take off) (the )?sleeves?\b", t):
        sl = "none"
    elif re.search(r"\badd (long|full)[\s-]?sleeves?\b", t):
        sl = "long"
    elif re.search(r"\badd (the )?sleeves?\b", t):
        sl = "short"
    else:
        sl = extract_sleeves(t)
    if sl:
        e.set("sleeves", sl, _SLEEVE_LABEL[sl])
    c = extract_collar(t)
    if c and g == "jersey":
        e.set("collar", c, _COLLAR_LABEL[c])


def refine(req: RefineRequest) -> dict:
    t = i18n.normalize(req.instruction).lower()
    e = _Edit(req.spec)
    _names(req.instruction, t, e)
    _colors(t, e)
    _pattern(t, e)
    _coverage(t, e)
    _scale(t, e)
    _font(t, e)
    _accents(t, e)
    _sport(t, e)
    _garment_options(t, e)
    if not e.changes:
        return {"spec": req.spec.model_dump(), "changes": [], "understood": False,
                "message": "No change was made. Try naming a part and a value, for example "
                           "\"make the collar gold\", \"change the pattern to waves\" or \"add Priya on the back\"."}
    spec = DesignSpec.model_validate(e.data)
    return {"spec": spec.model_dump(), "changes": e.changes, "understood": True,
            "message": "; ".join(c["message"] for c in e.changes) + "."}

