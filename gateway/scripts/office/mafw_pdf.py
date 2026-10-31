"""mafw_pdf — PDF editing helpers built on a BSD-friendly stack.

pypdf       structural edits (merge/split/reorder/rotate/delete/metadata/forms)
reportlab   text/image overlays and watermarks
pypdfium2   page rendering (PNG) for visual QA

True inline text replacement is intentionally not offered: PDF has no reflow
model. Use overlays/watermarks, form filling, or edit the source document
(pptx/docx) instead.
"""
from __future__ import annotations

import io
import json
import os
import tempfile
from typing import Any, Iterable


def _reader(path: str, password: str | None = None):
    from pypdf import PdfReader

    reader = PdfReader(path)
    if reader.is_encrypted:
        if not password:
            raise ValueError("PDF is encrypted; pass password")
        if not reader.decrypt(password):
            raise ValueError("PDF password incorrect")
    return reader


def _atomic_write(writer, path: str) -> None:
    directory = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".mafw-pdf-", suffix=".pdf", dir=directory)
    os.close(fd)
    try:
        with open(tmp, "wb") as handle:
            writer.write(handle)
        os.replace(tmp, path)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def _page_size(page) -> tuple[float, float]:
    return float(page.mediabox.width), float(page.mediabox.height)


def _select(pages: Iterable[int] | None, total: int) -> list[int]:
    if pages is None:
        return list(range(1, total + 1))
    selected = []
    for value in pages:
        index = int(value)
        if index < 1 or index > total:
            raise ValueError(f"page out of range: {index} (1..{total})")
        selected.append(index)
    return selected


def _overlay_reader(width: float, height: float, draw) -> Any:
    from reportlab.pdfgen import canvas
    from pypdf import PdfReader

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(width, height))
    draw(c, width, height)
    c.showPage()
    c.save()
    buffer.seek(0)
    return PdfReader(buffer)


def inspect_pdf(
    path: str,
    max_pages: int = 50,
    text_chars: int = 400,
    password: str | None = None,
) -> dict[str, Any]:
    """Page sizes, metadata, form fields and text excerpts."""
    reader = _reader(path, password)
    pages = []
    for index, page in enumerate(reader.pages[:max_pages], 1):
        text = page.extract_text() or ""
        width, height = _page_size(page)
        pages.append({
            "index": index,
            "width": round(width, 1),
            "height": round(height, 1),
            "rotation": int(page.rotation or 0),
            "chars": len(text),
            "text": text[:text_chars],
        })
    metadata = {}
    try:
        for key, value in (reader.metadata or {}).items():
            metadata[str(key).lstrip("/")] = str(value)
    except Exception:
        pass
    fields = []
    try:
        for name, field in (reader.get_fields() or {}).items():
            fields.append({
                "name": str(name),
                "type": str(field.get("/FT", "")),
                "value": str(field.get("/V", "")),
            })
    except Exception:
        pass
    return {
        "path": os.path.abspath(path),
        "page_count": len(reader.pages),
        "encrypted": bool(reader.is_encrypted),
        "metadata": metadata,
        "pages": pages,
        "form_fields": fields,
    }


def inspect_json_pdf(path: str, **kwargs: Any) -> str:
    return json.dumps(inspect_pdf(path, **kwargs), ensure_ascii=False, indent=2)


def extract_text(
    path: str,
    pages: Iterable[int] | None = None,
    password: str | None = None,
) -> dict[str, Any]:
    reader = _reader(path, password)
    selected = _select(pages, len(reader.pages))
    return {
        "ok": True,
        "pages": [
            {"index": index, "text": reader.pages[index - 1].extract_text() or ""}
            for index in selected
        ],
    }


def render_pdf(
    path: str,
    out_dir: str,
    width: int = 1280,
    pages: Iterable[int] | None = None,
) -> dict[str, Any]:
    try:
        import pypdfium2 as pdfium
    except Exception as exc:
        return {"ok": False, "reason": "pypdfium2-missing", "error": str(exc)}
    out = os.path.abspath(out_dir)
    os.makedirs(out, exist_ok=True)
    pdf = pdfium.PdfDocument(os.path.abspath(path))
    images: list[dict[str, Any]] = []
    try:
        selected = _select(pages, len(pdf))
        for index in selected:
            page = pdf[index - 1]
            page_width, _ = page.get_size()
            scale = (float(width) / page_width) if page_width else 1.0
            bitmap = page.render(scale=scale)
            png = os.path.join(out, f"page-{index:02d}.png")
            bitmap.to_pil().save(png)
            images.append({"page": index, "path": png, "bytes": os.path.getsize(png)})
        return {"ok": True, "engine": "pypdfium2", "out_dir": out, "images": images}
    except Exception as exc:
        return {"ok": False, "reason": "render-failed", "error": str(exc)[:300]}
    finally:
        pdf.close()


def merge_pdfs(paths: Iterable[str], out: str) -> dict[str, Any]:
    from pypdf import PdfWriter

    writer = PdfWriter()
    count = 0
    for path in paths:
        reader = _reader(path)
        writer.append(reader)
        count += len(reader.pages)
    _atomic_write(writer, out)
    return {"ok": True, "pages": count, "out": os.path.abspath(out)}


def split_pdf(path: str, out_dir: str, ranges: Iterable[str] | None = None) -> dict[str, Any]:
    from pypdf import PdfWriter

    reader = _reader(path)
    total = len(reader.pages)
    specs = list(ranges) if ranges else None
    if not specs:
        specs = [str(i) for i in range(1, total + 1)]
    os.makedirs(os.path.abspath(out_dir), exist_ok=True)
    files = []
    for spec_index, spec in enumerate(specs, 1):
        selected = _parse_ranges(spec, total)
        writer = PdfWriter()
        for index in selected:
            writer.add_page(reader.pages[index - 1])
        out = os.path.join(os.path.abspath(out_dir), f"part-{spec_index:02d}.pdf")
        _atomic_write(writer, out)
        files.append({"path": out, "pages": selected})
    return {"ok": True, "files": files}


def _parse_ranges(spec: str, total: int) -> list[int]:
    selected: list[int] = []
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start, end = part.split("-", 1)
            a, b = int(start), int(end)
            step = 1 if b >= a else -1
            selected.extend(range(a, b + step, step))
        else:
            selected.append(int(part))
    if not selected:
        raise ValueError(f"empty page range: {spec!r}")
    for index in selected:
        if index < 1 or index > total:
            raise ValueError(f"page out of range: {index} (1..{total})")
    return selected


def delete_pages(path: str, pages: Iterable[int], out: str | None = None) -> dict[str, Any]:
    from pypdf import PdfWriter

    reader = _reader(path)
    total = len(reader.pages)
    remove = set(_select(pages, total))
    keep = [index for index in range(1, total + 1) if index not in remove]
    if not keep:
        raise ValueError("cannot delete every page")
    writer = PdfWriter()
    for index in keep:
        writer.add_page(reader.pages[index - 1])
    target = out or path
    _atomic_write(writer, target)
    return {"ok": True, "pages": len(keep), "out": os.path.abspath(target)}


def reorder_pages(path: str, order: Iterable[int], out: str | None = None) -> dict[str, Any]:
    from pypdf import PdfWriter

    reader = _reader(path)
    total = len(reader.pages)
    wanted = [int(index) for index in order]
    if sorted(wanted) != list(range(1, total + 1)):
        raise ValueError(f"order must be a permutation of 1..{total}")
    writer = PdfWriter()
    for index in wanted:
        writer.add_page(reader.pages[index - 1])
    target = out or path
    _atomic_write(writer, target)
    return {"ok": True, "order": wanted, "out": os.path.abspath(target)}


def rotate_pages(path: str, pages: Iterable[int] | None = None, degrees: int = 90, out: str | None = None) -> dict[str, Any]:
    from pypdf import PdfWriter

    if degrees % 90 != 0:
        raise ValueError("degrees must be a multiple of 90")
    reader = _reader(path)
    total = len(reader.pages)
    selected = set(_select(pages, total))
    writer = PdfWriter()
    for index in range(1, total + 1):
        page = reader.pages[index - 1]
        if index in selected:
            page.rotate(degrees)
        writer.add_page(page)
    target = out or path
    _atomic_write(writer, target)
    return {"ok": True, "pages": len(selected), "degrees": degrees, "out": os.path.abspath(target)}


def add_blank_page(
    path: str,
    index: int,
    width: float | None = None,
    height: float | None = None,
    out: str | None = None,
) -> dict[str, Any]:
    from pypdf import PdfWriter

    reader = _reader(path)
    total = len(reader.pages)
    if index < 1 or index > total + 1:
        raise ValueError(f"insert index out of range: {index} (1..{total + 1})")
    if width is None or height is None:
        ref = reader.pages[min(max(index - 1, 0), total - 1)]
        default_w, default_h = _page_size(ref)
        width = width or default_w
        height = height or default_h
    writer = PdfWriter()
    for position in range(1, total + 2):
        if position == index:
            writer.add_blank_page(width=float(width), height=float(height))
        if position <= total:
            writer.add_page(reader.pages[position - 1])
    target = out or path
    _atomic_write(writer, target)
    return {"ok": True, "pages": total + 1, "out": os.path.abspath(target)}


def set_metadata(path: str, metadata: dict[str, Any], out: str | None = None) -> dict[str, Any]:
    from pypdf import PdfWriter

    reader = _reader(path)
    writer = PdfWriter()
    writer.append(reader)
    writer.add_metadata({
        (key if str(key).startswith("/") else f"/{key}"): str(value)
        for key, value in metadata.items()
    })
    target = out or path
    _atomic_write(writer, target)
    return {"ok": True, "metadata": metadata, "out": os.path.abspath(target)}


def fill_form(path: str, fields: dict[str, str], out: str | None = None, flatten: bool = False) -> dict[str, Any]:
    from pypdf import PdfWriter

    reader = _reader(path)
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    writer.update_page_form_field_values(None, fields, auto_regenerate=True, flatten=flatten)
    try:
        writer.set_need_appearances_writer(True)
    except Exception:
        pass
    target = out or path
    _atomic_write(writer, target)
    return {"ok": True, "fields": len(fields), "out": os.path.abspath(target)}


def add_text(
    path: str,
    text: str,
    x: float,
    y: float,
    pages: Iterable[int] | None = None,
    font_size: float = 12,
    color: str = "#000000",
    out: str | None = None,
) -> dict[str, Any]:
    """Stamp text at (x, y) in points from the top-left corner."""
    from pypdf import PdfWriter

    reader = _reader(path)
    total = len(reader.pages)
    selected = set(_select(pages, total))
    writer = PdfWriter()
    for index in range(1, total + 1):
        page = reader.pages[index - 1]
        if index in selected:
            width, height = _page_size(page)

            def draw(c, w, h):
                c.setFillColor(color)
                c.setFont("Helvetica", font_size)
                c.drawString(x, h - y - font_size, text)

            page.merge_page(_overlay_reader(width, height, draw).pages[0])
        writer.add_page(page)
    target = out or path
    _atomic_write(writer, target)
    return {"ok": True, "pages": len(selected), "out": os.path.abspath(target)}


def add_image(
    path: str,
    image_path: str,
    x: float,
    y: float,
    width: float,
    height: float,
    pages: Iterable[int] | None = None,
    out: str | None = None,
) -> dict[str, Any]:
    """Stamp an image at (x, y) points from the top-left corner."""
    from pypdf import PdfWriter

    reader = _reader(path)
    total = len(reader.pages)
    selected = set(_select(pages, total))
    writer = PdfWriter()
    for index in range(1, total + 1):
        page = reader.pages[index - 1]
        if index in selected:
            page_width, page_height = _page_size(page)

            def draw(c, w, h):
                c.drawImage(
                    image_path,
                    x,
                    h - y - height,
                    width=width,
                    height=height,
                    mask="auto",
                )

            page.merge_page(_overlay_reader(page_width, page_height, draw).pages[0])
        writer.add_page(page)
    target = out or path
    _atomic_write(writer, target)
    return {"ok": True, "pages": len(selected), "out": os.path.abspath(target)}


def watermark(
    path: str,
    text: str,
    out: str | None = None,
    opacity: float = 0.15,
    angle: float = 45,
    font_size: float = 48,
    color: str = "#888888",
) -> dict[str, Any]:
    from pypdf import PdfWriter

    reader = _reader(path)
    writer = PdfWriter()
    for page in reader.pages:
        width, height = _page_size(page)

        def draw(c, w, h):
            c.saveState()
            try:
                c.setFillAlpha(opacity)
            except Exception:
                pass
            c.setFillColor(color)
            c.setFont("Helvetica-Bold", font_size)
            c.translate(w / 2, h / 2)
            c.rotate(angle)
            c.drawCentredString(0, 0, text)
            c.restoreState()

        page.merge_page(_overlay_reader(width, height, draw).pages[0])
        writer.add_page(page)
    target = out or path
    _atomic_write(writer, target)
    return {"ok": True, "pages": len(reader.pages), "out": os.path.abspath(target)}
