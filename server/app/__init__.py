"""UrJersey API."""
from __future__ import annotations

import os
import sys
from pathlib import Path


def read_env_file(path: Path) -> dict[str, str]:
    """KEY=value lines; blank lines and # comments are skipped, quotes are removed."""
    out: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, raw_value = line.removeprefix("export ").partition("=")
        key, value = key.strip(), raw_value.strip()
        if raw_value[:1].isspace() and value.startswith("#"):   # "KEY=   # just a comment"
            value = ""
        if value[:1] in ("'", '"') and value.endswith(value[0]) and len(value) >= 2:
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        out[key] = value
    return out


def _load_env_file() -> None:
    """Read server/.env (or ENV_FILE) into the environment for local runs.

    Real environment variables always win, so Docker, systemd or a hosting
    dashboard can override anything in the file. Tests never read it.
    """
    if "pytest" in sys.modules:
        return
    path = Path(os.environ.get("ENV_FILE") or Path(__file__).resolve().parents[1] / ".env")
    if path.is_file():
        for key, value in read_env_file(path).items():
            os.environ.setdefault(key, value)


_load_env_file()
