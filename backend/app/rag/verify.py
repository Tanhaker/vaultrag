"""Citation verifier. Deterministic checks always run (valid citation, every number in the claim
appears in a cited source, verbatim quotes are recognised); the LLM entailment judge runs on top
for paraphrased sentences when a model is available and the quota guard allows it."""

import re

from ..ai import gemini, llm

_NUM = re.compile(r"(?<![A-Za-z])\d[\d,]*(?:\.\d+)?")
_WS = re.compile(r"[\s ]+")


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


def _flat(text: str) -> str:
    return _WS.sub(" ", text).strip().lower().rstrip(".")


def verbatim(claim: str, sources: list[str]) -> bool:
    """The sentence is a direct quote of a cited source, so it is entailed by construction."""
    c = _flat(claim.removeprefix("Vision caption: "))
    return len(c) >= 12 and any(c in _flat(s) for s in sources)


def _figure_sources(claim: str, cites: list[int], source_text: dict[int, str]) -> list[int] | None:
    """The fewest supplied sources (at most two, keeping the model's own citation when it helps) that
    together contain every figure in the claim; None when no such set exists or it is ambiguous."""
    need = numbers(claim)
    if not need:
        return None
    have = {n: numbers(t) for n, t in source_text.items()}
    singles = [n for n in have if need <= have[n]]
    if len(singles) == 1:
        return singles
    if singles:
        return None  # several sources hold every figure: no basis to pick one
    pairs = [sorted({a, b}) for a in have for b in have if a < b and need <= have[a] | have[b]]
    own = [p for p in pairs if set(p) & set(cites)]
    pick = own if own else pairs
    return pick[0] if len(pick) == 1 else None


async def verify(sentences: list[dict], source_text: dict[int, str], *, use_llm: bool = True) -> tuple[list[dict], str]:
    """sentences: [{text, cites}] -> same list with removed/reason/check set; returns (sentences, method)."""
    for s in sentences:
        s["cites"] = [n for n in dict.fromkeys(s.get("cites", [])) if n in source_text]
        cited = [source_text[n] for n in s["cites"]]
        if not s["cites"]:
            s["removed"], s["reason"] = True, "No valid citation"
        elif not numeric_ok(s["text"], cited):
            # Citation repair: the model cited the wrong chunk of a document. When exactly one supplied
            # source holds every figure in the sentence, cite that one (shown to the user) instead of dropping it.
            holders = _figure_sources(s["text"], s["cites"], source_text)
            if holders:
                s["repaired"] = {"from": s["cites"], "to": holders}
                s["cites"] = holders
                cited = [source_text[n] for n in holders]
                if verbatim(s["text"], cited):
                    s["check"] = "verbatim"
            else:
                s["removed"], s["reason"] = True, "Figure not found in the cited source"
        elif verbatim(s["text"], cited):
            s["check"] = "verbatim"

    method = "citation + numeric checks"
    pending = [(i, s) for i, s in enumerate(sentences) if not s.get("removed") and s.get("check") != "verbatim"]
    if any(s.get("check") == "verbatim" for s in sentences) and not pending:
        method = "verbatim quote + numeric checks"
    if pending and use_llm:
        try:
            verdicts = await llm.verify([
                {"index": i, "text": s["text"], "sources": [{"n": n, "text": source_text[n]} for n in s["cites"]]}
                for i, s in pending
            ])
            for i, s in pending:
                ok, reason = verdicts.get(i, (True, ""))
                if ok:
                    s["check"] = "entailed"
                else:
                    s["removed"] = True
                    s["reason"] = f"Not entailed by [{', '.join(map(str, s['cites']))}]" + (f": {reason}" if reason else "")
            method = "LLM entailment + numeric checks"
        except gemini.LLMUnavailable:
            pass
    for s in sentences:
        if not s.get("removed") and not s.get("check"):
            s["check"] = "numeric"
    return sentences, method
