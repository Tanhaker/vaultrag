"""Verifiable answer receipts.

Every answer carries a receipt: what was asked, a hash of exactly what was answered, and for each
citation the chunk id and a SHA-256 of the source text the answer was grounded on, signed by the
server. Anyone holding the receipt can later ask the server to check that

  - the signature is genuine (the receipt was not edited),
  - the answer text they were shown is the one that was signed,
  - each cited source still says what it said then (re-read under the checker's own RLS).
"""

import datetime as dt
import hashlib
import hmac
import json

from ..config import get_settings

VERSION = 1


def _key() -> bytes:
    # Derived, so the receipt key is never the JWT key itself.
    return hashlib.sha256(b"vaultrag-receipt-v1:" + get_settings().jwt_secret.encode()).digest()


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def answer_digest(sentences: list[str]) -> str:
    return sha("\n".join(s.strip() for s in sentences))


def _canonical(body: dict) -> bytes:
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sign(body: dict) -> str:
    return hmac.new(_key(), _canonical(body), hashlib.sha256).hexdigest()


def issue(answer: dict, kb_version: int | None, model: str | None) -> dict:
    kept = [s["text"] for s in answer["sentences"] if not s.get("removed")]
    body = {
        "v": VERSION,
        "answer_id": answer["id"],
        "issued_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "user": answer["user"]["uid"],
        "question_sha256": sha(answer["question"]),
        "answer_sha256": answer_digest(kept),
        "mode": answer["mode"],
        "model": model,
        "kb_version": kb_version,
        "citations": [
            {"n": c["n"], "chunk_id": c["chunk"]["id"], "title": c["doc"]["title"],
             "content_sha256": sha(json.dumps(c["chunk"].get("rows"), default=str) if c["chunk"]["modality"] == "sql"
                                   else c["chunk"]["content"])}
            for c in answer["citations"]
        ],
    }
    return {**body, "sig": sign(body)}


def check_signature(receipt: dict) -> bool:
    body = {k: v for k, v in receipt.items() if k != "sig"}
    return hmac.compare_digest(sign(body), str(receipt.get("sig", "")))
