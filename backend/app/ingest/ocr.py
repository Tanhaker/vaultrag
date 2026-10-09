"""OCR: Tesseract when the binary is installed (Docker), Gemini vision otherwise (serverless)."""

import io
import re
from functools import lru_cache

from PIL import Image

from ..ai import gemini, llm
from ..config import get_settings
from .blocks import Block, clean, pct

# Tesseract's English model has no rupee glyph and reads "₹1,35,000" as "#1,35,000" or "%1,15,000".
_RUPEE = re.compile(r"(?<![\w,])[#%&?Zz]\s?(?=\d{1,3}(?:,\d{2})*,\d{3}\b)")


@lru_cache
def tesseract_available() -> bool:
    try:
        import pytesseract

        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def _tesseract(img: Image.Image) -> list[Block]:
    import pytesseract
    from pytesseract import Output

    d = pytesseract.image_to_data(img, output_type=Output.DICT, config="--psm 3")
    groups: dict[tuple[int, int], list[int]] = {}
    for i, word in enumerate(d["text"]):
        if word.strip() and float(d["conf"][i]) > 0:
            groups.setdefault((d["block_num"][i], d["par_num"][i]), []).append(i)
    w, h = img.size
    blocks = []
    for idx in groups.values():
        text = _RUPEE.sub("₹", clean(" ".join(d["text"][i] for i in idx)))
        if len(text) < 3:
            continue
        x0 = min(d["left"][i] for i in idx)
        y0 = min(d["top"][i] for i in idx)
        x1 = max(d["left"][i] + d["width"][i] for i in idx)
        y1 = max(d["top"][i] + d["height"][i] for i in idx)
        conf = sum(float(d["conf"][i]) for i in idx) / len(idx) / 100
        blocks.append(Block(text, None, pct((x0, y0, x1, y1), w, h), "ocr", round(conf, 3)))
    return blocks


async def _vision(img: Image.Image) -> tuple[list[Block], str | None]:
    out = await llm.read_image(_png(img, 1600), "image/png")
    blocks = []
    for p in out.get("paragraphs", []):
        box = p.get("box_2d")
        bbox = [round(box[1] / 10, 1), round(box[0] / 10, 1), round(box[3] / 10, 1), round(box[2] / 10, 1)]             if box and len(box) == 4 else None
        if clean(p.get("text", "")):
            blocks.append(Block(clean(p["text"]), None, bbox, "ocr", None))
    return blocks, out.get("caption")


async def ocr_image(data: bytes) -> tuple[list[Block], str | None, str]:
    """Returns (paragraph blocks, vision caption or None, engine name).

    Gemini vision is preferred when configured (reads ₹ and handwriting, returns boxes and a
    caption); Tesseract is the offline fallback."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    if get_settings().llm_enabled:
        try:
            blocks, caption = await _vision(img)
            if blocks:
                return blocks, caption, "gemini-vision"
        except gemini.LLMUnavailable:
            pass
    if tesseract_available():
        return _tesseract(img), None, "tesseract"
    blocks, caption = await _vision(img)  # raises LLMUnavailable when neither engine exists
    return blocks, caption, "gemini-vision"


def _png(img: Image.Image, max_side: int) -> bytes:
    im = img.copy()
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def preview(data: bytes, max_side: int = 1400) -> tuple[bytes, int, int]:
    """Downscaled JPEG kept for the source viewer."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85, optimize=True)
    return buf.getvalue(), img.width, img.height
