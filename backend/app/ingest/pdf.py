"""PDF extraction: layout-aware text blocks and ruled tables with bounding boxes; pages without a
text layer are rendered and OCR'd."""

import io
import re

import pdfplumber
import pymupdf as fitz

from .blocks import Block, clean, pct
from .ocr import ocr_image


def _inside(box, tables) -> bool:
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return any(t[0] <= cx <= t[2] and t[1] <= cy <= t[3] for t in tables)


_PAGE_NO = re.compile(r"\s*\bp(age)?\.?\s*\d+\s*$", re.I)


def _repeated_margin(text: str, seen: set[str]) -> bool:
    core = _PAGE_NO.sub("", text).strip()
    if not core:
        return True
    key = re.sub(r"\d+", "#", core.lower())
    if key in seen:
        return True
    seen.add(key)
    return False


async def extract_pdf(data: bytes) -> tuple[list[Block], dict]:
    blocks: list[Block] = []
    seen_margins: set[str] = set()
    info = {"pages": 0, "ocr_pages": 0, "tables": 0, "ocr_engine": None}
    with fitz.open(stream=data, filetype="pdf") as doc, pdfplumber.open(io.BytesIO(data)) as plumb:
        info["pages"] = doc.page_count
        for i, page in enumerate(doc):
            w, h = page.rect.width, page.rect.height
            if len(page.get_text("text").strip()) < 25:
                pix = page.get_pixmap(dpi=200)
                ocr_blocks, _, engine = await ocr_image(pix.tobytes("png"))
                info["ocr_pages"] += 1
                info["ocr_engine"] = engine
                for b in ocr_blocks:
                    b.page = i + 1
                    blocks.append(b)
                continue

            table_boxes = []
            for t in plumb.pages[i].find_tables():
                rows = [r for r in t.extract() if any((c or "").strip() for c in r)]
                if len(rows) < 2:
                    continue
                md = "\n".join(" | ".join(clean(c or "") for c in r) for r in rows)
                table_boxes.append(t.bbox)
                blocks.append(Block(md, i + 1, pct(t.bbox, w, h), "table"))
                info["tables"] += 1

            for x0, y0, x1, y1, text, _no, btype in page.get_text("blocks", sort=True):
                if btype != 0 or _inside((x0, y0, x1, y1), table_boxes):
                    continue
                text = clean(text)
                if y1 < 0.08 * h:
                    continue  # running header: document title and page number, already in metadata
                if y0 > 0.92 * h and _repeated_margin(text, seen_margins):
                    continue  # footer already indexed once (it carries the reference number)
                if len(text) >= 2:
                    blocks.append(Block(text, i + 1, pct((x0, y0, x1, y1), w, h), "text"))
    blocks.sort(key=lambda b: (b.page or 0, b.bbox[1] if b.bbox else 0))
    return blocks, info
