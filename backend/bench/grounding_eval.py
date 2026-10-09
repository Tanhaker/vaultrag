"""Grounding evaluation over eval/gold.json, through the full pipeline as each persona.

    python -m bench.grounding_eval            # verbatim composer, no generative model (no AI quota)
    python -m bench.grounding_eval --llm      # with the model chain (~2 calls per case)

Metrics: decision accuracy (answer vs refuse), citation precision (cited sources from the expected
document), fact recall (the expected figure is in the answer), retrieval hit@5 (the expected
document is among the top 5 RLS-filtered candidates) and latency. Writes eval/results/grounding.json.
"""

import argparse
import asyncio
import datetime as dt
import json
import statistics
from pathlib import Path

from app import db
from app.ai import embeddings
from app.rag import answer
from app.rag.retrieve import hybrid
from bench.demo_probe import user_for

ROOT = Path(__file__).resolve().parents[1]


def _norm(t: str) -> str:
    return t.replace(" ", " ").replace(" ", " ").lower()


def _mean(xs: list[float]) -> float | None:
    return round(statistics.fmean(xs), 3) if xs else None


async def main(use_llm: bool) -> None:
    gold = json.loads((ROOT / "eval" / "gold.json").read_text(encoding="utf-8"))["cases"]
    rows: list[dict] = []
    users: dict = {}
    await db.open_pools()
    try:
        for c in gold:
            if c["as"] not in users:
                users[c["as"]] = await user_for(c["as"])
            u = users[c["as"]]
            a = await answer.run(u, c["q"], verbatim=not use_llm, use_cache=False)
            kept = [s for s in a["sentences"] if not s.get("removed")]
            text = " ".join(s["text"] for s in kept)
            cited = [x["doc"]["title"] for x in a["citations"]]
            r = {"as": c["as"].split("@")[0], "q": c["q"], "expect": c["expect"], "refused": a["refused"],
                 "mode": a["mode"], "latencyMs": a["latencyMs"], "groundedness": a["groundedness"], "cited": cited,
                 "checks": [s.get("check") for s in kept if not a["refused"]],
                 "decision_ok": (c["expect"] == "refuse") == a["refused"]}
            if c["expect"] == "answer":
                r["citation_precision"] = (sum(c["doc"].lower() in t.lower() for t in cited) / len(cited)) if cited else 0.0
                r["fact_ok"] = all(_norm(f) in _norm(text) for f in c["fact"])
                if c["doc"] != "Live query":
                    qvec = await embeddings.embed_query(c["q"])
                    async with db.secure_session(u) as conn:
                        h = await hybrid(conn, c["q"], qvec)
                    r["hit_at_5"] = any(c["doc"].lower() in x["title"].lower() for x in h["candidates"][:5])
            rows.append(r)
            mark = "ok " if r["decision_ok"] and r.get("fact_ok", True) else "XX "
            print(f"{mark}{r['as']:14s} {c['expect']:6s} -> {a['mode']:10s} {a['latencyMs']:5d}ms  {c['q']}", flush=True)
    finally:
        await db.close_pools()

    should_answer = [r for r in rows if r["expect"] == "answer"]
    should_refuse = [r for r in rows if r["expect"] == "refuse"]
    answered = [r for r in should_answer if not r["refused"]]
    lat = sorted(r["latencyMs"] for r in rows)
    summary = {
        "cases": len(rows),
        "decision_accuracy": _mean([1.0 if r["decision_ok"] else 0.0 for r in rows]),
        "answered_when_expected": f"{len(answered)}/{len(should_answer)}",
        "refused_when_expected": f"{sum(r['refused'] for r in should_refuse)}/{len(should_refuse)}",
        "citation_precision": _mean([r["citation_precision"] for r in answered]),
        "fact_recall": _mean([1.0 if r["fact_ok"] else 0.0 for r in should_answer]),
        "hit_at_5": _mean([1.0 if r["hit_at_5"] else 0.0 for r in should_answer if "hit_at_5" in r]),
        "groundedness": _mean([r["groundedness"] for r in answered]),
        "verbatim_sentences": _mean([1.0 if ch == "verbatim" else 0.0 for r in answered for ch in r["checks"]]),
        "p50_ms": lat[len(lat) // 2] if lat else None,
        "p95_ms": lat[min(len(lat) - 1, int(len(lat) * 0.95))] if lat else None,
    }
    out = {"at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "mode": "llm" if use_llm else "verbatim", "summary": summary, "rows": rows}
    path = ROOT / "eval" / "results" / "grounding.json"
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--llm", action="store_true")
    asyncio.run(main(p.parse_args().llm))
