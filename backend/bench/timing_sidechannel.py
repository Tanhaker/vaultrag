"""Timing side-channel test.

A uniform refusal text hides whether a document exists, but response time could still give it away.
For a student, this compares refusals for questions about documents that exist but are forbidden
with questions about documents that do not exist at all. RLS removes forbidden rows inside the
index scans, so both cases should see the same candidate set and take the same time.

    python -m bench.timing_sidechannel     (verbatim mode, no cache; writes eval/results/timing.json)

The verdict uses a two-sided permutation test on the difference in median latency."""

import asyncio
import datetime as dt
import json
import random
import statistics
import time
from pathlib import Path

from app import db
from app.rag import answer
from bench.demo_probe import user_for

ROOT = Path(__file__).resolve().parents[1]
REPEATS = 3

FORBIDDEN = [
    "What is the CSE department budget for 2026-27?",
    "How much of the CSE budget has been utilised?",
    "What is the MECH department budget for 2026-27?",
    "Summarise the faculty appraisal results.",
    "How many faculty are recommended for promotion?",
    "How early must question papers be submitted to the examination cell?",
    "What does the moderation policy say about answer keys?",
    "What are the CSE lab infrastructure allocations?",
]
MISSING = [
    "What is the Mars campus budget for 2026-27?",
    "How much of the Jupiter lab budget has been utilised?",
    "What is the AERO department budget for 2026-27?",
    "Summarise the cafeteria inspection results.",
    "How many drivers are recommended for promotion?",
    "How early must sports trophies be submitted to the games office?",
    "What does the parking policy say about bicycles?",
    "What are the CHEM lab infrastructure allocations?",
]


def _stats(xs: list[float]) -> dict:
    xs = sorted(xs)
    return {"n": len(xs), "median_ms": round(statistics.median(xs), 1), "mean_ms": round(statistics.fmean(xs), 1),
            "p95_ms": round(xs[min(len(xs) - 1, int(len(xs) * 0.95))], 1), "stdev_ms": round(statistics.pstdev(xs), 1)}


def _permutation_p(a: list[float], b: list[float], rounds: int = 5000, seed: int = 7) -> float:
    rng = random.Random(seed)
    observed = abs(statistics.median(a) - statistics.median(b))
    pool, n = a + b, len(a)
    hits = 0
    for _ in range(rounds):
        rng.shuffle(pool)
        if abs(statistics.median(pool[:n]) - statistics.median(pool[n:])) >= observed:
            hits += 1
    return (hits + 1) / (rounds + 1)


async def main() -> None:
    trials = [("forbidden", q) for q in FORBIDDEN for _ in range(REPEATS)] + \
             [("missing", q) for q in MISSING for _ in range(REPEATS)]
    random.Random(11).shuffle(trials)  # interleave, so drift affects both groups alike
    times: dict[str, list[float]] = {"forbidden": [], "missing": []}
    refusals = {"forbidden": 0, "missing": 0}
    texts: set[str] = set()
    await db.open_pools()
    try:
        student = await user_for("aarav.student@atmiya.test")
        await answer.run(student, "warm-up question about the library", verbatim=True, use_cache=False)
        for group, q in trials:
            t = time.perf_counter()
            a = await answer.run(student, q, verbatim=True, use_cache=False)
            times[group].append((time.perf_counter() - t) * 1000)
            refusals[group] += a["refused"]
            if a["refused"]:
                texts.add(json.dumps(a["sentences"]))
    finally:
        await db.close_pools()
    p = _permutation_p(times["forbidden"], times["missing"])
    out = {
        "at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "persona": "Student (public only)", "repeats": REPEATS,
        "forbidden": {**_stats(times["forbidden"]), "refused": refusals["forbidden"]},
        "missing": {**_stats(times["missing"]), "refused": refusals["missing"]},
        "median_gap_ms": round(statistics.median(times["forbidden"]) - statistics.median(times["missing"]), 1),
        "p_value": round(p, 4),
        "identical_refusal_text": len(texts) == 1,
        "verdict": "no detectable difference" if p >= 0.05 else "timing differs: investigate",
    }
    (ROOT / "eval" / "results" / "timing.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
