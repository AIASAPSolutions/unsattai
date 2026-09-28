from __future__ import annotations

from .base import ProviderError, SpecProvider
from .claude import ClaudeProvider
from .rule import RuleProvider, parse_brief
from .slm import SLMProvider

PROVIDERS: dict[str, SpecProvider] = {"rule": RuleProvider(), "claude": ClaudeProvider(), "slm": SLMProvider()}

# "auto" prefers the in-house model once it is deployed, then Claude, then rules.
AUTO_ORDER = ("slm", "claude", "rule")


def resolve(name: str) -> SpecProvider:
    if name == "auto":
        return next(PROVIDERS[p] for p in AUTO_ORDER if PROVIDERS[p].available())
    return PROVIDERS[name]


__all__ = ["PROVIDERS", "ProviderError", "SpecProvider", "parse_brief", "resolve"]
