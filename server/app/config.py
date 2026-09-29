from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
# Serverless (Vercel): only /tmp is writable, and it is per-instance and ephemeral.
_DEFAULT_DB = "/tmp/designs.db" if os.getenv("VERCEL") else str(ROOT_DIR / "data" / "designs.db")


def _list(name: str, default: str = "") -> tuple[str, ...]:
    return tuple(v.strip() for v in os.getenv(name, default).split(",") if v.strip())


def env_str(name: str, default: str = "") -> str:
    """A text setting; blank counts as not set, so the default applies."""
    return os.getenv(name, "").strip() or default


def env_int(name: str, default: int) -> int:
    """An integer setting; a blank or broken value falls back to the default."""
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def is_production() -> bool:
    """APP_ENV=production turns off every development shortcut (such as showing sign-in codes)."""
    return os.getenv("APP_ENV", "development").strip().lower() in ("production", "prod")


def env_bool(name: str, default: bool) -> bool:
    v = os.getenv(name, "").strip().lower()
    return default if not v else v not in ("0", "false", "no", "off")


@dataclass(frozen=True)
class Settings:
    provider: str = env_str("DESIGN_PROVIDER", "auto")            # auto | rule | claude | slm
    claude_model: str = env_str("CLAUDE_MODEL", "claude-opus-5")
    claude_effort: str = env_str("CLAUDE_EFFORT", "medium")
    slm_base_url: str = env_str("SLM_BASE_URL", "http://localhost:11434/v1").rstrip("/")
    slm_model: str = env_str("SLM_MODEL", "sportswear-spec")
    slm_timeout: float = float(env_int("SLM_TIMEOUT", 60))
    db_path: Path = Path(env_str("DB_PATH", _DEFAULT_DB))
    api_keys: tuple[str, ...] = field(default_factory=lambda: _list("API_KEYS"))
    factory_url: str = env_str("FACTORY_URL").rstrip("/")        # empty: jobs go to the TEST queue
    factory_token: str = env_str("FACTORY_TOKEN")
    cors_origins: tuple[str, ...] = field(default_factory=lambda: _list("CORS_ORIGINS") or ("*",))
    # "Ask" tab: rules first, a small model only for what the rules don't understand.
    ai_edits: str = env_str("AI_EDITS", "auto")                    # auto | claude | slm | off
    ai_edit_model: str = env_str("AI_EDIT_MODEL", "claude-haiku-4-5")
    ai_free_edits_per_day: int = env_int("AI_FREE_EDITS_PER_DAY", 10)
    ai_bonus_edits_per_order: int = env_int("AI_BONUS_EDITS_PER_ORDER", 20)
    ai_edits_per_minute: int = env_int("AI_EDITS_PER_MINUTE", 4)
    ai_daily_budget: int = env_int("AI_DAILY_BUDGET", 2000)  # all phones together; 0 = no cap
    # "Pay (demo)" marks an order paid without taking money. Off in production unless switched on on purpose
    # (a closed pilot); real online payment needs a payment gateway.
    demo_payments: bool = field(default_factory=lambda: env_bool("DEMO_PAYMENTS", not is_production()))


settings = Settings()
