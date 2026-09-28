"""Offline rule-based provider: keyword parsing + curated vocabulary + seeded randomness.

It needs no model or network, so the prototype always works. It is also the
baseline that the Claude and SLM providers are evaluated against.
"""
from __future__ import annotations

import random
import re
from dataclasses import dataclass, field

from ..engine import i18n
from ..engine.color import best_text_color, darken, lighten, luminance, rotate_hue
from ..engine.vocab import (ADJECTIVES, MOOD_PATTERNS, NAMED_COLORS, NOUNS, PALETTES, PATTERN_KEYWORDS,
                            SPORT_ALIASES, SPORT_PATTERNS)
from ..schemas import PATTERNS, SPORTS, DesignSpec, GenerateRequest
from .base import SpecProvider, sanitize


@dataclass
class Brief:
    colors: list[str] = field(default_factory=list)
    patterns: list[str] = field(default_factory=list)
    moods: set[str] = field(default_factory=set)
    words: set[str] = field(default_factory=set)
    sport: str | None = None
    coverage: str | None = None
    font: str | None = None


def _find(text: str, kw: str) -> int:
    m = re.search(rf"\b{re.escape(kw)}s?\b", text)
    return m.start() if m else -1


def parse_brief(prompt: str) -> Brief:
    t = prompt.lower()
    b = Brief(words=set(re.findall(r"[a-z]+", t)))

    found: list[tuple[int, str]] = [(m.start(), m.group(0)) for m in re.finditer(r"#[0-9a-f]{6}\b", t)]
    masked = t
    for name in sorted(NAMED_COLORS, key=len, reverse=True):
        for m in re.finditer(rf"\b{re.escape(name)}\b", masked):
            found.append((m.start(), NAMED_COLORS[name]))
            masked = masked[:m.start()] + " " * len(name) + masked[m.end():]
    for _, c in sorted(found):
        if c not in b.colors:
            b.colors.append(c)

    hits = []
    for ptype, kws in PATTERN_KEYWORDS.items():
        pos = [p for p in (_find(t, kw) for kw in kws) if p >= 0]
        if pos:
            hits.append((min(pos), ptype))
    b.patterns = [p for _, p in sorted(hits)]

    b.moods = {m for m in MOOD_PATTERNS if m in b.words}
    for s in SPORTS:
        if s in b.words:
            b.sport = s
            break
    else:
        b.sport = next((v for k, v in SPORT_ALIASES.items() if k in b.words), None)

    if b.words & {"sash", "diagonal"}:
        b.coverage = "diagonal_band"
    elif b.words & {"band", "chestband", "hoop"}:
        b.coverage = "chest_band"
    elif "side" in b.words or "sides" in b.words:
        b.coverage = "side_panels"
    elif b.words & {"fade", "fading", "ombre"}:
        b.coverage = "top"

    if b.words & {"retro", "vintage", "classic", "college", "collegiate", "heritage"}:
        b.font = "athletic"
    elif b.words & {"futuristic", "esports", "tech", "minimal", "modern", "sleek"}:
        b.font = "modern"
    return b


def _palette_from_colors(colors: list[str], variant: int) -> dict:
    cs = list(colors)
    if variant % 2 == 1 and len(cs) >= 2:
        cs[0], cs[1] = cs[1], cs[0]
    primary = cs[0]
    secondary = cs[1] if len(cs) > 1 else (darken(primary, 0.35) if luminance(primary) > 0.3 else lighten(primary, 0.3))
    accent = cs[2] if len(cs) > 2 else best_text_color(
        primary, [rotate_hue(primary, 180, sat=0.85, val=0.95), "#f5c518", "#f7f7f5", "#111111"])
    trim = cs[3] if len(cs) > 3 else darken(primary, 0.5)
    text = best_text_color(primary, ["#f7f7f5", "#111111", accent, secondary])
    return {"primary": primary, "secondary": secondary, "accent": accent, "trim": trim, "text": text}


def _pick_palette(rng: random.Random, tags: set[str], used: set[str]) -> tuple[str, dict]:
    scored = []
    for name, pr, se, ac, tr, tx, ptags in PALETTES:
        score = 1 + 3 * len(ptags & tags) - (5 if name in used else 0)
        scored.append((max(score, 0.2), name, {"primary": pr, "secondary": se, "accent": ac, "trim": tr, "text": tx}))
    total = sum(s for s, _, _ in scored)
    x = rng.uniform(0, total)
    for s, name, pal in scored:
        x -= s
        if x <= 0:
            return name, pal
    return scored[-1][1], scored[-1][2]


_ANGLES = {"stripes": [0, 90, -30, 30, 45, -45], "pinstripe": [0, 90], "chevron": [0, 90],
           "waves": [0, -15, 15], "hexagon": [0, 30], "halftone": [0, 20, -20]}


class RuleProvider(SpecProvider):
    name = "rule"

    def available(self) -> bool:
        return True

    def generate(self, req: GenerateRequest, n: int, seed: int) -> list[DesignSpec]:
        brief = parse_brief(i18n.normalize(req.prompt))
        sport = req.sport or brief.sport or "football"
        tags = brief.moods | brief.words | {sport}
        candidates: list[str] = []
        for m in brief.moods:
            candidates += MOOD_PATTERNS[m]
        candidates += SPORT_PATTERNS.get(sport, [])
        candidates = list(dict.fromkeys(candidates))
        colors = list(dict.fromkeys(req.locked_colors + brief.colors))

        specs, used_patterns, used_palettes = [], set(), set()
        for i in range(n):
            r = random.Random(seed * 31 + i)
            if brief.patterns:
                ptype = brief.patterns[i % len(brief.patterns)]
            else:
                fresh = [c for c in candidates if c not in used_patterns] or [p for p in PATTERNS if p not in used_patterns] or list(PATTERNS)
                ptype = fresh[0] if i == 0 and fresh else r.choice(fresh)
            used_patterns.add(ptype)

            if colors:
                palette, pal_name = _palette_from_colors(colors, i), None
            else:
                pal_name, palette = _pick_palette(r, tags | {ptype}, used_palettes)
                used_palettes.add(pal_name)

            coverage = brief.coverage or r.choices(
                ["full", "top", "bottom", "diagonal_band", "side_panels", "chest_band"], [5, 2, 2, 2, 1, 1])[0]
            pcols = r.choice([["secondary", "accent"], ["secondary"], ["accent"], ["secondary", "accent", "trim"]])
            raw = {
                "style_name": f"{r.choice(ADJECTIVES)} {r.choice(NOUNS)}",
                "base": "gradient" if ptype == "gradient" or r.random() < 0.25 else "solid",
                "palette": palette,
                "pattern": {"type": ptype, "colors": pcols, "scale": round(r.uniform(0.7, 1.4), 2),
                            "angle": r.choice(_ANGLES.get(ptype, [0, -20, 20, 35, -35])),
                            "density": round(r.uniform(0.4, 0.85), 2), "opacity": round(r.uniform(0.65, 1.0), 2),
                            "coverage": coverage},
                "accents": {"side_panels": r.random() < 0.35, "shoulder_stripes": r.choice([0, 0, 1, 2, 3]),
                            "collar_role": r.choice(["trim", "secondary", "accent"]),
                            "cuff_role": r.choice(["trim", "secondary"])},
                "font": brief.font or r.choice(["block", "athletic", "modern"]),
            }
            raw["rationale"] = (f"{ptype.replace('_', ' ').title()} pattern with {coverage.replace('_', ' ')} coverage"
                                + (f" on the '{pal_name}' palette" if pal_name else " built from your colours")
                                + f", tuned for {sport}.")
            specs.append(sanitize(raw, req.model_copy(update={"sport": sport}), seed + i))
        return specs
