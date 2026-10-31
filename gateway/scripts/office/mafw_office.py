"""mafw_office — PPTX editing helpers for the MAFW persistent Python kernel.

Installed into the kernel venv by gateway/scripts/setup-pykernel.mjs.
Python-pptx based; keeps unsupported parts (SmartArt/animations/OLE) untouched.
"""
from __future__ import annotations

import json
import os
import tempfile
import urllib.request
from typing import Any, Iterable


def _presentation(path: str):
    from pptx import Presentation  # lazy: import cost only when used

    return Presentation(path)


def _shape_type(sh) -> str:
    try:
        return str(sh.shape_type)
    except Exception:
        return "UNKNOWN"


def _text_of(sh) -> str | None:
    if not getattr(sh, "has_text_frame", False):
        return None
    try:
        return "\n".join(p.text for p in sh.text_frame.paragraphs)
    except Exception:
        return None


def inspect_deck(path: str, max_slides: int = 200) -> dict[str, Any]:
    """Structural read-only dump (slides, shapes, text, tables, charts, notes)."""
    prs = _presentation(path)
    slides: list[dict[str, Any]] = []
    for index, slide in enumerate(prs.slides, 1):
        if index > max_slides:
            break
        shapes: list[dict[str, Any]] = []
        for sh in slide.shapes:
            item: dict[str, Any] = {
                "name": sh.name,
                "id": sh.shape_id,
                "type": _shape_type(sh),
            }
            for key in ("left", "top", "width", "height", "rotation"):
                try:
                    value = getattr(sh, key)
                    if value is not None:
                        item[key] = int(value)
                except Exception:
                    pass
            if getattr(sh, "is_placeholder", False):
                try:
                    item["placeholder"] = {
                        "idx": sh.placeholder_format.idx,
                        "type": str(sh.placeholder_format.type),
                    }
                except Exception:
                    pass
            text = _text_of(sh)
            if text is not None:
                item["text"] = text
            if getattr(sh, "has_table", False) and sh.has_table:
                item["table"] = [[c.text for c in row.cells] for row in sh.table.rows]
                item["table_size"] = [len(sh.table.rows), len(sh.table.columns)]
            if getattr(sh, "has_chart", False) and sh.has_chart:
                try:
                    chart = sh.chart
                    item["chart"] = {
                        "type": str(chart.chart_type),
                        "series": len(chart.series),
                        "series_names": [str(s.name) for s in chart.series if s.name is not None],
                    }
                except Exception:
                    item["chart"] = {"type": "unknown"}
            if getattr(sh, "shape_type", None) == 13:  # MSO_SHAPE_TYPE.PICTURE
                pic: dict[str, Any] = {}
                try:
                    image = sh.image
                    pic["filename"] = image.filename
                    pic["size"] = [int(image.size[0]), int(image.size[1])]
                except Exception:
                    pass
                item["picture"] = pic or True
            shapes.append(item)
        notes = ""
        try:
            if slide.has_notes_slide:
                notes = slide.notes_slide.notes_text_frame.text
        except Exception:
            notes = ""
        title = ""
        try:
            if slide.shapes.title is not None:
                title = slide.shapes.title.text
        except Exception:
            title = ""
        layout = ""
        try:
            layout = slide.slide_layout.name
        except Exception:
            layout = ""
        slides.append({
            "index": index,
            "slide_id": slide.slide_id,
            "layout": layout,
            "title": title,
            "notes": notes,
            "shapes": shapes,
        })
    core = {}
    try:
        cp = prs.core_properties
        core = {"title": cp.title, "subject": cp.subject, "author": cp.author}
    except Exception:
        pass
    return {
        "path": os.path.abspath(path),
        "slide_count": len(prs.slides),
        "slide_size": [prs.slide_width, prs.slide_height],
        "core": core,
        "slides": slides,
    }


def inspect_json(path: str, **kwargs: Any) -> str:
    return json.dumps(inspect_deck(path, **kwargs), ensure_ascii=False, indent=2)


def _replace_in_paragraph(paragraph, old: str, new: str) -> int:
    """Run-aware replace. Single-run matches keep all run formatting; a match
    split across runs collapses that paragraph's runs into the first run."""
    runs = list(paragraph.runs)
    if not runs:
        return 0
    joined = "".join(r.text for r in runs)
    if old not in joined:
        return 0
    count = joined.count(old)
    for run in runs:
        if old in run.text:
            run.text = run.text.replace(old, new)
            return count
    runs[0].text = joined.replace(old, new)
    for run in runs[1:]:
        run.text = ""
    return count


def replace_text(
    path: str,
    replacements: dict[str, str],
    out: str | None = None,
    slides: Iterable[int] | None = None,
    include_notes: bool = True,
    include_tables: bool = True,
) -> dict[str, Any]:
    """Bulk text replacement preserving run formatting where possible."""
    prs = _presentation(path)
    wanted = set(slides or [])
    total = 0

    def apply_frame(frame) -> None:
        nonlocal total
        try:
            paragraphs = list(frame.paragraphs)
        except Exception:
            return
        for paragraph in paragraphs:
            for old, new in replacements.items():
                total += _replace_in_paragraph(paragraph, old, new)

    for index, slide in enumerate(prs.slides, 1):
        if wanted and index not in wanted:
            continue
        for sh in slide.shapes:
            if getattr(sh, "has_text_frame", False):
                apply_frame(sh.text_frame)
            if include_tables and getattr(sh, "has_table", False) and sh.has_table:
                for row in sh.table.rows:
                    for cell in row.cells:
                        apply_frame(cell.text_frame)
        if include_notes and getattr(slide, "has_notes_slide", False) and slide.has_notes_slide:
            try:
                apply_frame(slide.notes_slide.notes_text_frame)
            except Exception:
                pass

    target = out or path
    atomic_save(prs, target)
    return {"ok": True, "replacements": total, "out": os.path.abspath(target)}


def set_notes(path: str, slide_index: int, text: str, out: str | None = None) -> dict[str, Any]:
    prs = _presentation(path)
    if slide_index < 1 or slide_index > len(prs.slides):
        raise ValueError(f"slide index out of range: {slide_index}")
    prs.slides[slide_index - 1].notes_slide.notes_text_frame.text = text
    target = out or path
    atomic_save(prs, target)
    return {"ok": True, "slide": slide_index, "out": os.path.abspath(target)}


def _find_shape(slide, target: str | int):
    """Find a shape by id (int) or exact name (str); helpful error lists names."""
    if isinstance(target, int):
        for sh in slide.shapes:
            if sh.shape_id == target:
                return sh
    else:
        for sh in slide.shapes:
            if sh.name == target:
                return sh
        lowered = str(target).lower()
        for sh in slide.shapes:
            if sh.name.lower() == lowered:
                return sh
    names = [f"{sh.name}#{sh.shape_id}" for sh in slide.shapes]
    raise ValueError(f"shape not found: {target!r}; available: {names}")


def _slide_at(prs, slide_index: int):
    if slide_index < 1 or slide_index > len(prs.slides):
        raise ValueError(f"slide index out of range: {slide_index} (1..{len(prs.slides)})")
    return prs.slides[slide_index - 1]


def _move_slide_id_list(prs, from_index: int, to_index: int) -> None:
    lst = prs.slides._sldIdLst
    ids = list(lst)
    if from_index < 1 or from_index > len(ids) or to_index < 1 or to_index > len(ids):
        raise ValueError(f"slide move out of range: {from_index}->{to_index} (1..{len(ids)})")
    element = ids[from_index - 1]
    lst.remove(element)
    lst.insert(to_index - 1, element)


def set_paragraphs(
    path: str,
    slide_index: int,
    target: str | int,
    texts: Iterable[str],
    out: str | None = None,
) -> dict[str, Any]:
    """Replace a text frame's paragraphs, keeping the first run's formatting per paragraph."""
    prs = _presentation(path)
    slide = _slide_at(prs, slide_index)
    shape = _find_shape(slide, target)
    if not getattr(shape, "has_text_frame", False):
        raise ValueError(f"shape has no text frame: {target!r}")
    frame = shape.text_frame
    wanted = [str(t) for t in texts]
    paragraphs = list(frame.paragraphs)
    if not paragraphs:
        frame.text = "\n".join(wanted)
    else:
        for index, text in enumerate(wanted):
            paragraph = paragraphs[index] if index < len(paragraphs) else frame.add_paragraph()
            runs = list(paragraph.runs)
            if runs:
                runs[0].text = text
                for run in runs[1:]:
                    run.text = ""
            else:
                paragraph.add_run().text = text
        for paragraph in paragraphs[len(wanted):]:
            element = paragraph._p
            element.getparent().remove(element)
    target_path = out or path
    atomic_save(prs, target_path)
    return {"ok": True, "slide": slide_index, "shape": shape.name, "out": os.path.abspath(target_path)}


def set_text(
    path: str,
    slide_index: int,
    target: str | int,
    text: str,
    out: str | None = None,
) -> dict[str, Any]:
    """Single-paragraph text replacement (keeps the first run's formatting)."""
    return set_paragraphs(path, slide_index, target, [text], out=out)


def add_slide(
    path: str,
    layout_index: int = 1,
    index: int | None = None,
    out: str | None = None,
) -> dict[str, Any]:
    """Append a slide (layout index from inspect) and optionally move it to `index`."""
    prs = _presentation(path)
    if layout_index < 0 or layout_index >= len(prs.slide_layouts):
        raise ValueError(f"layout index out of range: {layout_index} (0..{len(prs.slide_layouts) - 1})")
    prs.slides.add_slide(prs.slide_layouts[layout_index])
    if index is not None:
        _move_slide_id_list(prs, len(prs.slides), index)
    target = out or path
    atomic_save(prs, target)
    return {"ok": True, "slides": len(prs.slides), "out": os.path.abspath(target)}


def delete_slide(path: str, slide_index: int, out: str | None = None) -> dict[str, Any]:
    prs = _presentation(path)
    slide = _slide_at(prs, slide_index)
    slide_id = prs.slides._sldIdLst[slide_index - 1]
    rel_id = slide_id.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
    prs.slides._sldIdLst.remove(slide_id)
    if rel_id:
        try:
            prs.part.drop_rel(rel_id)
        except Exception:
            pass
    target = out or path
    atomic_save(prs, target)
    return {"ok": True, "deleted": slide_index, "slides": len(prs.slides), "out": os.path.abspath(target)}


def move_slide(path: str, from_index: int, to_index: int, out: str | None = None) -> dict[str, Any]:
    prs = _presentation(path)
    _move_slide_id_list(prs, from_index, to_index)
    target = out or path
    atomic_save(prs, target)
    return {"ok": True, "from": from_index, "to": to_index, "out": os.path.abspath(target)}


def replace_image(
    path: str,
    slide_index: int,
    target: str | int,
    image_path: str,
    out: str | None = None,
) -> dict[str, Any]:
    """Replace a picture's bytes, keeping its position/size."""
    prs = _presentation(path)
    slide = _slide_at(prs, slide_index)
    shape = _find_shape(slide, target)
    if getattr(shape, "shape_type", None) != 13:
        raise ValueError(f"shape is not a picture: {target!r}")
    blip = shape._element.blipFill.blip
    embed_attr = "rEmbed" if hasattr(blip, "rEmbed") else "embed"
    old_rid = getattr(blip, embed_attr)
    if hasattr(slide.part, "get_or_add_image_part"):
        _new_part, new_rid = slide.part.get_or_add_image_part(image_path)
    else:  # python-pptx < 1.0
        _new_part, new_rid = slide.part.get_or_add_image(image_path)
    setattr(blip, embed_attr, new_rid)
    try:
        prs.part.drop_rel(old_rid)
    except Exception:
        pass
    target_path = out or path
    atomic_save(prs, target_path)
    return {"ok": True, "slide": slide_index, "shape": shape.name, "out": os.path.abspath(target_path)}


def set_table_cell(
    path: str,
    slide_index: int,
    target: str | int,
    row: int,
    col: int,
    text: str,
    out: str | None = None,
) -> dict[str, Any]:
    """Set one table cell (1-based row/col), keeping the first run's formatting."""
    prs = _presentation(path)
    slide = _slide_at(prs, slide_index)
    shape = _find_shape(slide, target)
    if not getattr(shape, "has_table", False) or not shape.has_table:
        raise ValueError(f"shape is not a table: {target!r}")
    table = shape.table
    if row < 1 or row > len(table.rows) or col < 1 or col > len(table.columns):
        raise ValueError(f"cell out of range: {row},{col} (table {len(table.rows)}x{len(table.columns)})")
    cell = table.cell(row - 1, col - 1)
    paragraphs = list(cell.text_frame.paragraphs)
    if paragraphs and paragraphs[0].runs:
        paragraphs[0].runs[0].text = text
        for run in paragraphs[0].runs[1:]:
            run.text = ""
    else:
        cell.text = text
    target_path = out or path
    atomic_save(prs, target_path)
    return {"ok": True, "slide": slide_index, "cell": [row, col], "out": os.path.abspath(target_path)}


# ── xlsx / docx ─────────────────────────────────────────────────────────────

def inspect_workbook(path: str, max_rows: int = 20, max_cols: int = 20) -> dict[str, Any]:
    """Structural dump of an xlsx (cached values; formulas not executed)."""
    from openpyxl import load_workbook

    wb = load_workbook(path, read_only=True, data_only=True)
    try:
        sheets: list[dict[str, Any]] = []
        for ws in wb.worksheets:
            rows: list[list[Any]] = []
            for row in ws.iter_rows(
                min_row=1,
                max_row=min(ws.max_row or 0, max_rows),
                max_col=min(ws.max_column or 0, max_cols),
                values_only=True,
            ):
                rows.append(["" if v is None else v for v in row])
            sheets.append({
                "name": ws.title,
                "max_row": ws.max_row or 0,
                "max_col": ws.max_column or 0,
                "rows": rows,
            })
        return {"path": os.path.abspath(path), "sheets": sheets}
    finally:
        wb.close()


def inspect_json_workbook(path: str, **kwargs: Any) -> str:
    return json.dumps(inspect_workbook(path, **kwargs), ensure_ascii=False, indent=2, default=str)


def set_cells(
    path: str,
    updates: Iterable[dict[str, Any]],
    out: str | None = None,
) -> dict[str, Any]:
    """Set cells: [{sheet?, cell, value}]. Keeps existing styles; first sheet by default."""
    from openpyxl import load_workbook

    wb = load_workbook(path)
    changed = 0
    for update in updates:
        name = update.get("sheet")
        ws = wb[name] if name else wb.worksheets[0]
        cell = str(update["cell"])
        ws[cell] = update.get("value")
        changed += 1
    target = out or path
    atomic_save(wb, target)
    return {"ok": True, "changed": changed, "out": os.path.abspath(target)}


def inspect_document(path: str, max_paragraphs: int = 100) -> dict[str, Any]:
    """Paragraph + table dump of a docx."""
    import docx

    document = docx.Document(path)
    paragraphs = [p.text for p in document.paragraphs if p.text.strip()][:max_paragraphs]
    tables = []
    for table in document.tables:
        tables.append({
            "rows": len(table.rows),
            "cols": len(table.columns),
            "cells": [[cell.text for cell in row.cells] for row in table.rows],
        })
    return {
        "path": os.path.abspath(path),
        "paragraph_count": len(document.paragraphs),
        "paragraphs": paragraphs,
        "tables": tables,
    }


def inspect_json_document(path: str, **kwargs: Any) -> str:
    return json.dumps(inspect_document(path, **kwargs), ensure_ascii=False, indent=2)


def replace_text_docx(
    path: str,
    replacements: dict[str, str],
    out: str | None = None,
) -> dict[str, Any]:
    """Run-aware replace across paragraphs and table cells."""
    import docx

    document = docx.Document(path)
    total = 0
    for paragraph in document.paragraphs:
        for old, new in replacements.items():
            total += _replace_in_paragraph(paragraph, old, new)
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    for old, new in replacements.items():
                        total += _replace_in_paragraph(paragraph, old, new)
    target = out or path
    atomic_save(document, target)
    return {"ok": True, "replacements": total, "out": os.path.abspath(target)}


def render_deck(
    path: str,
    out_dir: str,
    width: int = 1280,
    height: int = 720,
    slides: Iterable[int] | None = None,
) -> dict[str, Any]:
    """Render slides to PNG via PowerPoint COM (Windows + PowerPoint only).

    Uses a dedicated PowerPoint instance (DispatchEx) so Quit never closes a
    user's running PowerPoint. Fail-open: returns {ok: False, reason, error}.
    """
    if os.name != "nt":
        return {"ok": False, "reason": "unsupported-platform", "error": "PowerPoint COM is Windows-only"}
    try:
        import win32com.client  # lazy: pywin32 is optional
    except Exception as exc:
        return {"ok": False, "reason": "pywin32-missing", "error": str(exc)}

    src = os.path.abspath(path)
    out = os.path.abspath(out_dir)
    os.makedirs(out, exist_ok=True)
    wanted = sorted({int(s) for s in slides}) if slides else None
    app = None
    pres = None
    images: list[dict[str, Any]] = []
    try:
        app = win32com.client.DispatchEx("PowerPoint.Application")
        try:
            app.Visible = True
        except Exception:
            pass
        pres = app.Presentations.Open(src, ReadOnly=True, WithWindow=False)
        total = int(pres.Slides.Count)
        indices = wanted if wanted is not None else list(range(1, total + 1))
        for index in indices:
            if index < 1 or index > total:
                continue
            png = os.path.join(out, f"slide-{index:02d}.png")
            pres.Slides(index).Export(png, "PNG", int(width), int(height))
            images.append({"slide": index, "path": png, "bytes": os.path.getsize(png)})
        return {
            "ok": True,
            "engine": "powerpoint-com",
            "out_dir": out,
            "slides": total,
            "images": images,
        }
    except Exception as exc:
        return {"ok": False, "reason": "render-failed", "error": str(exc)[:300]}
    finally:
        if pres is not None:
            try:
                pres.Close()
            except Exception:
                pass
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass


def atomic_save(prs, path: str) -> None:
    """Save to a temp file in the same directory, then os.replace (no partial reads)."""
    directory = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(directory, exist_ok=True)
    suffix = os.path.splitext(path)[1] or ".pptx"
    fd, tmp = tempfile.mkstemp(prefix=".mafw-office-", suffix=suffix, dir=directory)
    os.close(fd)
    try:
        prs.save(tmp)
        os.replace(tmp, path)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def snapshot(paths: Iterable[str], session_id: str | None = None, reason: str = "office-edit") -> dict[str, Any]:
    """Record pre-edit content via the gateway file-history API (best effort).

    The kernel gets MAFW_SESSION_ID from the gateway at spawn time; paths may be
    absolute (the API resolves them relative to the session directory).
    """
    sid = session_id or os.environ.get("MAFW_SESSION_ID", "")
    if not sid:
        return {"ok": False, "error": "MAFW_SESSION_ID missing (not running inside the MAFW kernel?)"}
    port = os.environ.get("MAFW_SERVER_API_PORT") or os.environ.get("MAFW_GATEWAY_PORT") or "3000"
    body = json.dumps({
        "sessionID": sid,
        "paths": [os.path.abspath(p) for p in paths],
        "reason": reason,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/file-history/snapshot",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return {"ok": True, "result": json.loads(resp.read().decode("utf-8"))}
    except Exception as exc:  # fail-open: editing may proceed, history is best effort
        return {"ok": False, "error": str(exc)}
