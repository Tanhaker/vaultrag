"""Citation verifier. Deterministic checks always run (valid citation, every number in the claim
appears in a cited source); the LLM entailment judge runs on top when a model is available."""

import re

from ..ai import gemini, llm

_NUM = re.compile(r"(?<![A-Za-z])\d[\d,]*(?:\.\d+)?")


def numbers(text: str) -> set[str]:
    out = set()
    for n in _NUM.findall(text):
        n = n.replace(",", "").rstrip(".")
        if n:
            out.add(n.lstrip("0") or "0")
    return out


def numeric_ok(claim: str, sources: list[str]) -> bool:
    have = set()
    for s in sources:
        have |= numbers(s)
    return numbers(claim) <= have


async def verify(sentences: list[dict], source_text: dict[int, str]) -> tuple[list[dict], str]:
    """sentences: [{text, cites}] -> same list with removed/reason set; returns (sentences, method)."""
    for s in sentences:
        s["cites"] = [n for n in dict.fromkeys(s.get("cites", [])) if n in source_text]
        if not s["cites"]:
            s["removed"], s["reason"] = True, "No valid citation"
        elif not numeric_ok(s["text"], [source_text[n] for n in s["cites"]]):
            s["removed"], s["reason"] = True, "Figure not found in the cited source"

    method = "citation + numeric checks"
    pending = [(i, s) for i, s in enumerate(sentences) if not s.get("removed")]
    if pending:
        try:
            verdicts = await llm.verify([
                {"index": i, "text": s["text"], "sources": [{"n": n, "text": source_text[n]} for n in s["cites"]]}
                for i, s in pending
            ])
            for i, s in pending:
                ok, reason = verdicts.get(i, (True, ""))
                if not ok:
                    s["removed"] = True
                    s["reason"] = f"Not entailed by [{', '.join(map(str, s['cites']))}]" + (f": {reason}" if reason else "")
            method = "LLM entailment + numeric checks"
        except gemini.LLMUnavailable:
            pass
    return sentences, method
