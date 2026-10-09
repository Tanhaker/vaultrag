"""Minimal Gemini REST client (embeddings, JSON generation, vision). No SDK: one small dependency
surface that runs the same in Docker and in a Vercel function."""

import base64
import json

import httpx

from ..config import get_settings

BASE = "https://generativelanguage.googleapis.com/v1beta"


class LLMUnavailable(Exception):
    """No key, quota exhausted, timeout or provider error. Callers fall back to a local path."""


class RateLimited(LLMUnavailable):
    pass


async def _post(path: str, body: dict, timeout: float = 40.0) -> dict:
    key = get_settings().gemini_api_key
    if not key:
        raise LLMUnavailable("no GEMINI_API_KEY configured")
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(f"{BASE}/{path}", params={"key": key}, json=body)
    except httpx.HTTPError as e:
        raise LLMUnavailable(f"network: {e.__class__.__name__}") from e
    if r.status_code == 429:
        raise RateLimited("rate limited")
    if r.status_code >= 400:
        raise LLMUnavailable(f"{r.status_code}: {r.text[:300]}")
    return r.json()


async def embed(texts: list[str], task: str, dim: int) -> list[list[float]]:
    model = get_settings().embedding_model
    out: list[list[float]] = []
    for i in range(0, len(texts), 100):
        batch = texts[i : i + 100]
        body = {
            "requests": [
                {"model": f"models/{model}", "content": {"parts": [{"text": t[:8000]}]},
                 "taskType": task, "outputDimensionality": dim}
                for t in batch
            ]
        }
        data = await _post(f"models/{model}:batchEmbedContents", body)
        out.extend(e["values"] for e in data["embeddings"])
    return out


def _gen_config(schema: dict | None, temperature: float, max_tokens: int, model: str) -> dict:
    cfg: dict = {"temperature": temperature, "maxOutputTokens": max_tokens}
    if schema is not None:
        cfg["responseMimeType"] = "application/json"
        cfg["responseSchema"] = schema
    if "2.5" in model:
        cfg["thinkingConfig"] = {"thinkingBudget": 0}  # answers are extractive; skip reasoning latency
    return cfg


def _text_of(data: dict) -> str:
    try:
        parts = data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError) as e:
        raise LLMUnavailable(f"empty response: {json.dumps(data)[:200]}") from e
    return "".join(p.get("text", "") for p in parts)


async def generate(system: str, parts: list[dict], *, schema: dict | None = None,
                   temperature: float = 0.1, max_tokens: int = 1200) -> dict | str:
    model = get_settings().llm_model
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": _gen_config(schema, temperature, max_tokens, model),
    }
    data = await _post(f"models/{model}:generateContent", body)
    text = _text_of(data)
    if schema is None:
        return text
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise LLMUnavailable(f"non-JSON output: {text[:160]}") from e


def image_part(data: bytes, mime: str) -> dict:
    return {"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}}
