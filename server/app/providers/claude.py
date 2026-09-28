"""Claude provider: the high-quality 'teacher' during the prototype phase.

Every spec it produces (plus customer ratings/edits) is logged, and later becomes
distillation data for the in-house SLM (see slm/).
"""
from __future__ import annotations

import json
import os

from ..config import settings
from ..schemas import DesignSpec, GenerateRequest
from .base import VARIANTS_SCHEMA, SYSTEM_PROMPT, ProviderError, SpecProvider, build_user_message, sanitize


class ClaudeProvider(SpecProvider):
    name = "claude"

    def __init__(self) -> None:
        self._client = None

    def available(self) -> bool:
        try:
            import anthropic  # noqa: F401
        except ImportError:
            return False
        # An explicit DESIGN_PROVIDER=claude also allows `ant auth login` profile credentials.
        return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")
                    or settings.provider == "claude")

    def _get_client(self):
        if self._client is None:
            import anthropic
            self._client = anthropic.Anthropic()
        return self._client

    def generate(self, req: GenerateRequest, n: int, seed: int) -> list[DesignSpec]:
        import anthropic

        try:
            response = self._get_client().messages.create(
                model=settings.claude_model,
                max_tokens=16000,
                system=SYSTEM_PROMPT,
                thinking={"type": "adaptive"},
                output_config={"effort": settings.claude_effort,
                               "format": {"type": "json_schema", "schema": VARIANTS_SCHEMA}},
                messages=[{"role": "user", "content": build_user_message(req, n=n)}],
            )
        except anthropic.RateLimitError as e:
            raise ProviderError(f"Claude rate limited: {e}") from e
        except anthropic.APIStatusError as e:
            raise ProviderError(f"Claude API error {e.status_code}: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise ProviderError(f"Could not reach Claude API: {e}") from e

        if response.stop_reason == "refusal":
            raise ProviderError("Claude declined this brief")
        if response.stop_reason == "max_tokens":
            raise ProviderError("Claude response was truncated")
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise ProviderError("Claude returned no text block")
        variants = json.loads(text).get("variants") or []
        if not variants:
            raise ProviderError("Claude returned no variants")
        return [sanitize(v, req, seed + i) for i, v in enumerate(variants[:n])]
