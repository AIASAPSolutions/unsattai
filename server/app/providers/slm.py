"""In-house small language model provider.

Talks to any OpenAI-compatible chat endpoint, which covers the usual ways to
self-host a fine-tuned small model: Ollama, llama.cpp `llama-server`, vLLM, or
TGI. Point SLM_BASE_URL / SLM_MODEL at your fine-tuned model (see slm/README.md).
One request per variant: small models are far more reliable emitting a single
object than an array of them.
"""
from __future__ import annotations

import time

import httpx

from ..config import settings
from ..schemas import DesignSpec, GenerateRequest
from .base import SLM_SYSTEM_PROMPT, ProviderError, SpecProvider, build_user_message, parse_json_object, sanitize


class SLMProvider(SpecProvider):
    name = "slm"

    def __init__(self) -> None:
        self._avail: tuple[float, bool] = (0.0, False)

    def available(self) -> bool:
        checked_at, ok = self._avail
        if time.monotonic() - checked_at < 30:
            return ok
        try:
            ok = httpx.get(f"{settings.slm_base_url}/models", timeout=1.5).status_code == 200
        except httpx.HTTPError:
            ok = False
        self._avail = (time.monotonic(), ok)
        return ok

    def generate(self, req: GenerateRequest, n: int, seed: int) -> list[DesignSpec]:
        specs = []
        try:
            with httpx.Client(timeout=settings.slm_timeout) as client:
                for i in range(n):
                    r = client.post(f"{settings.slm_base_url}/chat/completions", json={
                        "model": settings.slm_model,
                        "messages": [{"role": "system", "content": SLM_SYSTEM_PROMPT},
                                     {"role": "user", "content": build_user_message(req, n=n, variant_index=i)}],
                        "temperature": 0.8,
                        "seed": seed + i,
                        "response_format": {"type": "json_object"},
                    })
                    r.raise_for_status()
                    content = r.json()["choices"][0]["message"]["content"]
                    specs.append(sanitize(parse_json_object(content), req, seed + i))
        except httpx.HTTPError as e:
            raise ProviderError(f"SLM endpoint error: {e}") from e
        except (KeyError, IndexError) as e:
            raise ProviderError(f"Unexpected SLM response shape: {e}") from e
        return specs
