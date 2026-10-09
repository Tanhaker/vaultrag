"""Collects red-team outcomes during a pytest run; conftest writes them to eval/results/."""

RESULTS: list[dict] = []


def record(**row) -> None:
    RESULTS.append(row)
