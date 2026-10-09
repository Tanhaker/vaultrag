"""Extracted blocks and the chunker. A block keeps its page and a bounding box in percent of the
page or image, which is what the source viewer highlights."""

import re
from dataclasses import dataclass, field

INJECTION = re.compile(
    r"(ignore|disregard|forget)\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts?)"
    r"|you\s+are\s+now\s+(in\s+)?(admin|developer|dan|root)"
    r"|(reveal|print|list|show)\s+(the\s+)?(system\s+prompt|every\s+employee'?s?\s+salar)"
    r"|act\s+as\s+(an?\s+)?(admin|administrator|system)",
    re.I,
)


@dataclass
class Block:
    text: str
    page: int | None
    bbox: list[float] | None  # [x0, y0, x1, y1] percent
    modality: str  # text | table | ocr | caption | record
    conf: float | None = None
    meta: dict = field(default_factory=dict)


def pct(box: tuple[float, float, float, float], w: float, h: float) -> list[float]:
    x0, y0, x1, y1 = box
    return [round(100 * x0 / w, 1), round(100 * y0 / h, 1), round(100 * x1 / w, 1), round(100 * y1 / h, 1)]


def clean(text: str) -> str:
    text = text.replace("­", "").replace("-\n", "")
    return re.sub(r"\s+", " ", text).strip()


def _words(t: str) -> int:
    return len(t.split())


def _is_heading(t: str) -> bool:
    return _words(t) <= 10 and not t.rstrip().endswith((".", ":", ";")) and bool(re.match(r"^[\dA-Z]", t))


def _union(a: list[float] | None, b: list[float] | None) -> list[float] | None:
    if not a:
        return b
    if not b:
        return a
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def chunk_blocks(blocks: list[Block], max_words: int = 170) -> list[Block]:
    """Heading-aware merge: a heading joins the paragraph after it; short paragraphs on the same page
    merge until ~170 words; tables and captions always stand alone."""
    out: list[Block] = []
    pending_heading: Block | None = None
    for b in blocks:
        if b.modality in ("table", "caption", "record"):
            if pending_heading:
                out.append(pending_heading)
                pending_heading = None
            out.append(b)
            continue
        if b.modality == "text" and _is_heading(b.text):
            if pending_heading:
                out.append(pending_heading)
            pending_heading = b
            continue
        if pending_heading and pending_heading.page == b.page:
            b = Block(f"{pending_heading.text}. {b.text}", b.page, _union(pending_heading.bbox, b.bbox), b.modality, b.conf)
            pending_heading = None
            out.append(b)
            continue
        if pending_heading:
            out.append(pending_heading)
            pending_heading = None
        prev = out[-1] if out else None
        if (prev and prev.modality == b.modality and prev.page == b.page and prev.modality in ("text", "ocr")
                and (_words(prev.text) < 40 or _words(b.text) < 25) and _words(prev.text) + _words(b.text) <= max_words):
            out[-1] = Block(f"{prev.text} {b.text}", b.page, _union(prev.bbox, b.bbox), b.modality,
                            _avg(prev.conf, b.conf))
        else:
            out.append(b)
    if pending_heading:
        out.append(pending_heading)
    return [b for b in out if b.text.strip()]


def _avg(a: float | None, b: float | None) -> float | None:
    vals = [x for x in (a, b) if x is not None]
    return round(sum(vals) / len(vals), 3) if vals else None


def looks_injected(text: str) -> bool:
    return bool(INJECTION.search(text))
