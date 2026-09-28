from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
# Serverless (Vercel): only /tmp is writable, and it is per-instance and ephemeral.
_DEFAULT_DB = "/tmp/designs.db" if os.getenv("VERCEL") else str(ROOT_DIR / "data" / "designs.db")


def _list(name: str, default: str = "") -> tuple[str, ...]:
    return tuple(v.strip() for v in os.getenv(name, default).split(",") if v.strip())


@dataclass(frozen=True)
class Settings:
    provider: str = os.getenv("DESIGN_PROVIDER", "auto")            # auto | rule | claude | slm
    claude_model: str = os.getenv("CLAUDE_MODEL", "claude-opus-5")
    claude_effort: str = os.getenv("CLAUDE_EFFORT", "medium")
    slm_base_url: str = os.getenv("SLM_BASE_URL", "http://localhost:11434/v1").rstrip("/")
    slm_model: str = os.getenv("SLM_MODEL", "sportswear-spec")
    slm_timeout: float = float(os.getenv("SLM_TIMEOUT", "60"))
    db_path: Path = Path(os.getenv("DB_PATH", _DEFAULT_DB))
    api_keys: tuple[str, ...] = field(default_factory=lambda: _list("API_KEYS"))
    factory_url: str = os.getenv("FACTORY_URL", "").rstrip("/")        # empty: jobs go to the TEST queue
    factory_token: str = os.getenv("FACTORY_TOKEN", "")
    cors_origins: tuple[str, ...] = field(default_factory=lambda: _list("CORS_ORIGINS", "*"))


settings = Settings()
