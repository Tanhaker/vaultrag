"""Minimal Gemini REST client (embeddings, JSON generation, vision). No SDK: one small dependency
surface that runs the same in Docker and in a Vercel function."""

import asyncio
import base64
import json
import time
from contextvars import ContextVar

import httpx

from ..config import get_settings

BASE = "https://generativelanguage.googleapis.com/v1beta"


class LLMUnavailable(Exception):
    """No key, quota exhausted, timeout or provider error. Callers fall back to a local path."""


class RateLimited(LLMUnavailable):
    def __init__(self, msg: str, retry_after: float | None = None):
        super().__init__(msg)
        self.retry_after = retry_after


def _retry_delay(r: httpx.Response) -> float | None:
    """Seconds Google asks us to wait, from google.rpc.RetryInfo ("37s") or Retry-After."""
    try:
        for d in r.json().get("error", {}).get("details", []):
            if str(d.get("@type", "")).endswith("RetryInfo") and str(d.get("retryDelay", "")).endswith("s"):
                return float(d["retryDelay"][:-1])
    except (ValueError, AttributeError):
        pass
    ra = r.headers.get("retry-after")
    return float(ra) if ra and ra.replace(".", "", 1).isdigit() else None


async def _post(path: str, body: dict, timeout: float = 40.0) -> dict:
    key = get_settings().gemini_api_key
    if not key:
        raise LLMUnavailable("no GEMINI_API_KEY configured")
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            # Key in a header, not the query string, so it never lands in URL logs.
            r = await client.post(f"{BASE}/{path}", headers={"x-goog-api-key": key}, json=body)
    except httpx.HTTPError as e:
        raise LLMUnavailable(f"network: {e.__class__.__name__}") from e
    if r.status_code == 429:
        raise RateLimited("rate limited", _retry_delay(r))
    if r.status_code >= 400:
        raise LLMUnavailable(f"{r.status_code}: {r.text[:300]}")
    return r.json()


async def embed(texts: list[str], task: str, dim: int, *, wait_budget: float = 0.0) -> list[list[float]]:
    """Batch-embed. Free-tier quotas count every text in a batch, so bulk ingestion passes a
    wait_budget (seconds) and sleeps out 429s; the query path passes 0 and fails fast."""
    model = get_settings().embedding_model
    out: list[list[float]] = []
    batch_size = 50 if wait_budget else 100
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        body = {
            "requests": [
                {"model": f"models/{model}", "content": {"parts": [{"text": t[:8000]}]},
                 "taskType": task, "outputDimensionality": dim}
                for t in batch
            ]
        }
        while True:
            try:
                data = await _post(f"models/{model}:batchEmbedContents", body)
                break
            except RateLimited as e:
                delay = min(max(e.retry_after or 20.0, 2.0) + 1.0, 65.0)
                if delay > wait_budget:
                    raise
                wait_budget -= delay
                await asyncio.sleep(delay)
        out.extend(e["values"] for e in data["embeddings"])
    return out


def _gen_config(schema: dict | None, temperature: float, max_tokens: int, model: str) -> dict:
    cfg: dict = {"temperature": temperature, "maxOutputTokens": max_tokens}
    if schema is not None:
        cfg["responseMimeType"] = "application/json"
        cfg["responseSchema"] = schema
    # Answers are extractive; skip reasoning latency (lite models don't think by default).
    if model.startswith("gemini-2.5"):
        cfg["thinkingConfig"] = {"thinkingBudget": 0}
    elif model.startswith("gemini-3") and "lite" not in model and "pro" not in model:
        cfg["thinkingConfig"] = {"thinkingLevel": "minimal"}
    return cfg


# Model -> unix time its quota resets. Free-tier quotas are per model, so a 429 parks that model
# and the next one in the chain takes over. Per process; a cold instance re-learns with one 429.
_parked: dict[str, float] = {}
_used: ContextVar[str | None] = ContextVar("gemini_model", default=None)


def last_model() -> str | None:
    """The model that served the most recent generate() in this request."""
    return _used.get()


def models() -> list[str]:
    s = get_settings()
    chain = [s.llm_model, *(m.strip() for m in s.llm_fallback_models.split(","))]
    return list(dict.fromkeys(m.removeprefix("gemini/") for m in chain if m))


def _text_of(data: dict) -> str:
    try:
        parts = data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError) as e:
        raise LLMUnavailable(f"empty response: {json.dumps(data)[:200]}") from e
    return "".join(p.get("text", "") for p in parts)


async def generate(system: str, parts: list[dict], *, schema: dict | None = None,
                   temperature: float = 0.1, max_tokens: int = 1200) -> dict | str:
    """First model in the chain that is not parked and returns usable output. Raises
    LLMUnavailable (RateLimited when every model is out of quota) so callers fall back."""
    last: LLMUnavailable = LLMUnavailable("no generation model configured")
    for model in models():
        if _parked.get(model, 0.0) > time.time():
            last = RateLimited(f"{model} parked")
            continue
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": _gen_config(schema, temperature, max_tokens, model),
        }
        try:
            text = _text_of(await _post(f"models/{model}:generateContent", body))
            out = text if schema is None else json.loads(text)
            _used.set(model)
            return out
        except RateLimited as e:
            _parked[model] = time.time() + min(e.retry_after or 60.0, 86400.0)
            last = e
        except json.JSONDecodeError:
            last = LLMUnavailable(f"{model}: non-JSON output")
        except LLMUnavailable as e:  # unknown model, 5xx, timeout: try the next one
            last = e
            if str(e).startswith("no GEMINI_API_KEY"):
                break
    raise last


def image_part(data: bytes, mime: str) -> dict:
    return {"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}}
