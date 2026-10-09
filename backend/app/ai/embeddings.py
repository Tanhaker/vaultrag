"""768-d embeddings. Gemini when configured; otherwise a deterministic feature-hashing embedding so
the pipeline (and CI) still works offline. The provider is recorded on every chunk."""

import hashlib
import math
import re

from ..config import get_settings
from . import gemini

_TOKEN = re.compile(r"[a-z0-9]+(?:[.\-][a-z0-9]+)*")
_STOP = set("a an the is are was were be of for to in on at by with and or what who how when where why do does did i "
            "me my our we you your it its this that these those their them they please tell can could would".split())


def provider() -> str:
    s = get_settings()
    if s.embedding_provider == "hash":
        return "hash"
    if s.embedding_provider == "gemini":
        return "gemini"
    return "gemini" if s.gemini_api_key else "hash"


def model_tag() -> str:
    s = get_settings()
    return f"{s.embedding_model}@{s.embedding_dim}" if provider() == "gemini" else f"hash@{s.embedding_dim}"


def _normalise(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def hash_embed(text: str, dim: int | None = None) -> list[float]:
    dim = dim or get_settings().embedding_dim
    toks = [t for t in _TOKEN.findall(text.lower()) if t not in _STOP]
    feats = toks + [f"{a} {b}" for a, b in zip(toks, toks[1:])] + [t[:5] for t in toks if len(t) > 5]
    v = [0.0] * dim
    for f in feats:
        h = int.from_bytes(hashlib.blake2b(f.encode(), digest_size=8).digest(), "little")
        v[h % dim] += 1.0 if (h >> 63) & 1 else -1.0
    return _normalise([math.copysign(math.log1p(abs(x)), x) for x in v])


async def embed_documents(texts: list[str]) -> list[list[float]]:
    if provider() == "gemini":
        s = get_settings()
        vecs = await gemini.embed(texts, "RETRIEVAL_DOCUMENT", s.embedding_dim, wait_budget=s.embed_wait_seconds)
        return [_normalise(v) for v in vecs]
    return [hash_embed(t) for t in texts]


async def embed_query(text: str) -> list[float] | None:
    """None means the vector leg is unavailable right now (e.g. quota); retrieval goes lexical-only."""
    if provider() == "gemini":
        try:
            return _normalise((await gemini.embed([text], "RETRIEVAL_QUERY", get_settings().embedding_dim))[0])
        except gemini.LLMUnavailable:
            return None
    return hash_embed(text)


def literal(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"
