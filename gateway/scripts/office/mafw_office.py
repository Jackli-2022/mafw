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


def _load_workbook(path: str, **kwargs: Any):
    """openpyxl loader that preserves VBA for .xlsm (read_only cannot keep_vba)."""
    from openpyxl import load_workbook as _xlsx_load

    if kwargs.get("read_only"):
        kwargs.pop("keep_vba", None)
    else:
        kwargs.setdefault("keep_vba", str(path).lower().endswith(".xlsm"))
    return _xlsx_load(path, **kwargs)


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
                        "categories": [str(c) for c in chart.plots[0].categories],
                        "series_values": [[v for v in s.values] for s in chart.series],
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


def set_chart_data(
    path: str,
    slide_index: int,
    target: str | int,
    categories: Iterable[str],
    series: dict[str, Iterable[float]] | Iterable[dict[str, Any]],
    out: str | None = None,
) -> dict[str, Any]:
    """Replace a chart's data: categories + {series name: values} (or [{name,values}])."""
    from pptx.chart.data import CategoryChartData

    prs = _presentation(path)
    slide = _slide_at(prs, slide_index)
    shape = _find_shape(slide, target)
    if not getattr(shape, "has_chart", False) or not shape.has_chart:
        raise ValueError(f"shape is not a chart: {target!r}")
    data = CategoryChartData()
    data.categories = [str(c) for c in categories]
    if isinstance(series, dict):
        items = series.items()
    else:
        items = [
            (item.get("name", f"Series {index + 1}"), item.get("values", []))
            for index, item in enumerate(series)
        ]
    for name, values in items:
        data.add_series(str(name), [float(v) for v in values])
    shape.chart.replace_data(data)
    target_path = out or path
    atomic_save(prs, target_path)
    return {
        "ok": True,
        "slide": slide_index,
        "shape": shape.name,
        "series": len(list(items)),
        "out": os.path.abspath(target_path),
    }


# ── xlsx / docx ─────────────────────────────────────────────────────────────

def inspect_workbook(
    path: str,
    max_rows: int = 20,
    max_cols: int = 20,
    include_formulas: bool = False,
    include_charts: bool = True,
) -> dict[str, Any]:
    """Structural dump of an xlsx (cached values; formulas not executed).

    include_formulas adds a `formulas` list per sheet (cell + formula text).
    include_charts reads drawing parts (loads a normal workbook; set false for
    very large files).
    """
    from openpyxl import load_workbook

    wb = _load_workbook(path, read_only=True, data_only=True)
    wb_formulas = _load_workbook(path, read_only=True, data_only=False) if include_formulas else None
    wb_charts = _load_workbook(path, data_only=True) if include_charts else None
    try:
        sheets: list[dict[str, Any]] = []
        for ws in wb.worksheets:
            last_row = min(ws.max_row or 0, max_rows)
            last_col = min(ws.max_column or 0, max_cols)
            rows: list[list[Any]] = []
            for row in ws.iter_rows(min_row=1, max_row=last_row, max_col=last_col, values_only=True):
                rows.append(["" if v is None else v for v in row])
            item: dict[str, Any] = {
                "name": ws.title,
                "max_row": ws.max_row or 0,
                "max_col": ws.max_column or 0,
                "rows": rows,
            }
            meta_ws = (
                wb_charts[ws.title]
                if wb_charts is not None and ws.title in wb_charts.sheetnames
                else ws
            )
            try:
                item["merged"] = [str(r) for r in meta_ws.merged_cells.ranges]
            except Exception:
                item["merged"] = []
            try:
                item["conditional_formatting"] = [
                    {"range": str(cf.sqref), "rules": [type(rule).__name__ for rule in cf.rules]}
                    for cf in meta_ws.conditional_formatting
                ]
            except Exception:
                item["conditional_formatting"] = []
            try:
                item["data_validations"] = len(meta_ws.data_validations.dataValidation)
            except Exception:
                item["data_validations"] = 0
            try:
                item["protected"] = bool(meta_ws.protection.sheet)
            except Exception:
                item["protected"] = False
            item["charts"] = (
                [
                    {"type": type(chart).__name__}
                    for chart in getattr(meta_ws, "_charts", [])
                ]
                if wb_charts is not None
                else []
            )
            if wb_formulas is not None and ws.title in wb_formulas.sheetnames:
                formulas: list[dict[str, str]] = []
                fws = wb_formulas[ws.title]
                for row in fws.iter_rows(
                    min_row=1,
                    max_row=min(fws.max_row or 0, max_rows),
                    max_col=min(fws.max_column or 0, max_cols),
                ):
                    for cell in row:
                        if isinstance(cell.value, str) and cell.value.startswith("="):
                            formulas.append({"cell": cell.coordinate, "formula": cell.value})
                item["formulas"] = formulas
            sheets.append(item)
        return {
            "path": os.path.abspath(path),
            "macro_enabled": str(path).lower().endswith(".xlsm"),
            "sheets": sheets,
        }
    finally:
        wb.close()
        if wb_formulas is not None:
            wb_formulas.close()
        if wb_charts is not None:
            wb_charts.close()


def inspect_json_workbook(path: str, **kwargs: Any) -> str:
    return json.dumps(inspect_workbook(path, **kwargs), ensure_ascii=False, indent=2, default=str)


def set_cells(
    path: str,
    updates: Iterable[dict[str, Any]],
    out: str | None = None,
) -> dict[str, Any]:
    """Set cells: [{sheet?, cell, value}]. Keeps existing styles; first sheet by default."""
    from openpyxl import load_workbook

    wb = _load_workbook(path)
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


def _argb(value: Any) -> str:
    text = str(value).lstrip("#").upper()
    if len(text) == 6:
        return "FF" + text
    return text


def add_sheet(path: str, title: str | None = None, index: int | None = None, out: str | None = None) -> dict[str, Any]:
    from openpyxl import load_workbook

    wb = _load_workbook(path)
    ws = wb.create_sheet(title=title)
    if index is not None:
        wb._sheets.remove(ws)
        wb._sheets.insert(max(0, min(index - 1, len(wb._sheets))), ws)
    target = out or path
    atomic_save(wb, target)
    return {"ok": True, "sheets": wb.sheetnames, "out": os.path.abspath(target)}


def delete_sheet(path: str, sheet: str, out: str | None = None) -> dict[str, Any]:
    from openpyxl import load_workbook

    wb = _load_workbook(path)
    if sheet not in wb.sheetnames:
        raise ValueError(f"sheet not found: {sheet!r}; available: {wb.sheetnames}")
    if len(wb.sheetnames) <= 1:
        raise ValueError("cannot delete the last worksheet")
    wb.remove(wb[sheet])
    target = out or path
    atomic_save(wb, target)
    return {"ok": True, "sheets": wb.sheetnames, "out": os.path.abspath(target)}


def rename_sheet(path: str, sheet: str, new_title: str, out: str | None = None) -> dict[str, Any]:
    from openpyxl import load_workbook

    wb = _load_workbook(path)
    if sheet not in wb.sheetnames:
        raise ValueError(f"sheet not found: {sheet!r}; available: {wb.sheetnames}")
    wb[sheet].title = new_title
    target = out or path
    atomic_save(wb, target)
    return {"ok": True, "sheets": wb.sheetnames, "out": os.path.abspath(target)}


def set_cell_style(path: str, updates: Iterable[dict[str, Any]], out: str | None = None) -> dict[str, Any]:
    """Apply per-cell font/fill/alignment/number-format/border without resetting
    unspecified attributes. Each update: {sheet?, cell, bold?, italic?, size?,
    color?, fill?, number_format?, align?, valign?, wrap?, border?}."""
    import copy

    from openpyxl import load_workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    wb = _load_workbook(path)
    changed = 0
    for update in updates:
        ws = wb[update["sheet"]] if update.get("sheet") else wb.worksheets[0]
        cell = ws[str(update["cell"])]
        font = copy.copy(cell.font)
        if "bold" in update:
            font.bold = bool(update["bold"])
        if "italic" in update:
            font.italic = bool(update["italic"])
        if "size" in update:
            font.size = float(update["size"])
        if update.get("name"):
            font.name = str(update["name"])
        if update.get("color"):
            font.color = _argb(update["color"])
        cell.font = font
        if update.get("fill"):
            cell.fill = PatternFill(start_color=_argb(update["fill"]), end_color=_argb(update["fill"]), fill_type="solid")
        if update.get("number_format"):
            cell.number_format = str(update["number_format"])
        if any(k in update for k in ("align", "valign", "wrap")):
            alignment = copy.copy(cell.alignment)
            if update.get("align"):
                alignment.horizontal = str(update["align"])
            if update.get("valign"):
                alignment.vertical = str(update["valign"])
            if "wrap" in update:
                alignment.wrap_text = bool(update["wrap"])
            cell.alignment = alignment
        if update.get("border"):
            side = Side(style=str(update["border"]))
            cell.border = Border(left=side, right=side, top=side, bottom=side)
        changed += 1
    target = out or path
    atomic_save(wb, target)
    return {"ok": True, "changed": changed, "out": os.path.abspath(target)}


def set_formulas(path: str, updates: Iterable[dict[str, Any]], out: str | None = None) -> dict[str, Any]:
    """Set formulas: [{sheet?, cell, formula}] (leading '=' optional). Excel
    recalculates on open; openpyxl does not compute values."""
    from openpyxl import load_workbook

    wb = _load_workbook(path)
    changed = 0
    for update in updates:
        ws = wb[update["sheet"]] if update.get("sheet") else wb.worksheets[0]
        formula = str(update["formula"])
        ws[str(update["cell"])] = formula if formula.startswith("=") else "=" + formula
        changed += 1
    target = out or path
    atomic_save(wb, target)
    return {"ok": True, "changed": changed, "out": os.path.abspath(target)}


def set_sheet_layout(
    path: str,
    sheet: str | None = None,
    columns: dict[str, float] | None = None,
    rows: dict[str, float] | None = None,
    freeze: str | None = None,
    out: str | None = None,
) -> dict[str, Any]:
    from openpyxl import load_workbook

    wb = _load_workbook(path)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    for column, width in (columns or {}).items():
        ws.column_dimensions[str(column)].width = float(width)
    for row, height in (rows or {}).items():
        ws.row_dimensions[int(row)].height = float(height)
    if freeze is not None:
        ws.freeze_panes = freeze or None
    target = out or path
    atomic_save(wb, target)
    return {"ok": True, "sheet": ws.title, "out": os.path.abspath(target)}


def add_image(
    path: str,
    sheet: str | None,
    cell: str,
    image_path: str,
    width: int | None = None,
    height: int | None = None,
    out: str | None = None,
) -> dict[str, Any]:
    """Insert an image anchored at a cell (pixel width/height optional)."""
    from openpyxl import load_workbook
    from openpyxl.drawing.image import Image as XLImage

    wb = _load_workbook(path)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    image = XLImage(image_path)
    if width:
        image.width = int(width)
    if height:
        image.height = int(height)
    ws.add_image(image, cell)
    target = out or path
    atomic_save(wb, target)
    return {"ok": True, "sheet": ws.title, "cell": cell, "out": os.path.abspath(target)}


def add_chart(
    path: str,
    sheet: str | None,
    chart_type: str,
    data_range: str,
    categories: str | None = None,
    title: str | None = None,
    anchor: str = "E2",
    out: str | None = None,
) -> dict[str, Any]:
    """Add a chart from a cell range. chart_type: bar|column|line|pie|area.

    Existing charts follow their referenced cells, so update cells to refresh
    their data; use this helper to create new charts.
    """
    from openpyxl import load_workbook
    from openpyxl.chart import AreaChart, BarChart, LineChart, PieChart, Reference
    from openpyxl.utils import range_boundaries

    wb = _load_workbook(path)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    kind = chart_type.lower()
    if kind in ("bar", "column"):
        chart = BarChart()
        chart.type = "col" if kind == "column" else "bar"
    elif kind == "line":
        chart = LineChart()
    elif kind == "pie":
        chart = PieChart()
    elif kind == "area":
        chart = AreaChart()
    else:
        raise ValueError(f"unsupported chart type: {chart_type!r} (bar|column|line|pie|area)")

    min_col, min_row, max_col, max_row = range_boundaries(data_range)
    data = Reference(ws, min_col=min_col, min_row=min_row, max_col=max_col, max_row=max_row)
    chart.add_data(data, titles_from_data=True)
    if categories:
        c_min_col, c_min_row, c_max_col, c_max_row = range_boundaries(categories)
        chart.set_categories(Reference(
            ws, min_col=c_min_col, min_row=c_min_row, max_col=c_max_col, max_row=c_max_row,
        ))
    if title:
        chart.title = title
    ws.add_chart(chart, anchor)
    target = out or path
    atomic_save(wb, target)
    return {
        "ok": True,
        "sheet": ws.title,
        "chart": type(chart).__name__,
        "anchor": anchor,
        "out": os.path.abspath(target),
    }


def merge_cells(path: str, sheet: str | None, cell_range: str, out: str | None = None) -> dict[str, Any]:
    wb = _load_workbook(path)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    ws.merge_cells(cell_range)
    target = out or path
    atomic_save(wb, target)
    return {"ok": True, "sheet": ws.title, "range": cell_range, "out": os.path.abspath(target)}


def unmerge_cells(path: str, sheet: str | None, cell_range: str, out: str | None = None) -> dict[str, Any]:
    wb = _load_workbook(path)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    ws.unmerge_cells(cell_range)
    target = out or path
    atomic_save(wb, target)
    return {"ok": True, "sheet": ws.title, "range": cell_range, "out": os.path.abspath(target)}


def _rule_fill(options: dict[str, Any]):
    color = options.get("fill")
    if not color:
        return None
    from openpyxl.styles import PatternFill

    return PatternFill(start_color=_argb(color), end_color=_argb(color), fill_type="solid")


def _rule_font(options: dict[str, Any]):
    if not any(key in options for key in ("font_color", "bold", "italic", "font_size")):
        return None
    from openpyxl.styles import Font

    return Font(
        color=_argb(options["font_color"]) if options.get("font_color") else None,
        bold=bool(options.get("bold")) if "bold" in options else None,
        italic=bool(options.get("italic")) if "italic" in options else None,
        size=float(options["font_size"]) if options.get("font_size") else None,
    )


def add_conditional_format(
    path: str,
    sheet: str | None,
    cell_range: str,
    rule_type: str,
    options: dict[str, Any] | None = None,
    out: str | None = None,
) -> dict[str, Any]:
    """Add conditional formatting: color_scale | data_bar | icon_set | cell_is | formula."""
    from openpyxl.formatting.rule import CellIsRule, ColorScaleRule, DataBarRule, FormulaRule, IconSetRule

    opts = options or {}
    kind = rule_type.lower()
    if kind == "color_scale":
        rule = ColorScaleRule(
            start_type=opts.get("start_type", "min"),
            start_color=_argb(opts.get("start_color", "F8696B")),
            mid_type=opts.get("mid_type", "percentile"),
            mid_value=opts.get("mid_value", 50),
            mid_color=_argb(opts.get("mid_color", "FFEB84")),
            end_type=opts.get("end_type", "max"),
            end_color=_argb(opts.get("end_color", "63BE7B")),
        )
    elif kind == "data_bar":
        rule = DataBarRule(
            start_type="num",
            start_value=opts.get("start_value", 0),
            end_type="num",
            end_value=opts.get("end_value", 100),
            color=_argb(opts.get("color", "638EC6")),
            showValue=bool(opts.get("show_value", True)),
        )
    elif kind == "icon_set":
        rule = IconSetRule(
            icon_style=opts.get("icon_style", "3TrafficLights1"),
            type=opts.get("type", "percent"),
            values=opts.get("values", [0, 33, 67]),
            showValue=bool(opts.get("show_value", True)),
            reverse=bool(opts.get("reverse", False)),
        )
    elif kind == "cell_is":
        kwargs: dict[str, Any] = {
            "operator": opts.get("operator", "greaterThan"),
            "formula": [str(value) for value in opts.get("formula", ["0"])],
        }
        fill = _rule_fill(opts)
        font = _rule_font(opts)
        if fill is not None:
            kwargs["fill"] = fill
        if font is not None:
            kwargs["font"] = font
        rule = CellIsRule(**kwargs)
    elif kind == "formula":
        kwargs = {"formula": [str(value) for value in opts.get("formula", ["TRUE"])]}
        fill = _rule_fill(opts)
        font = _rule_font(opts)
        if fill is not None:
            kwargs["fill"] = fill
        if font is not None:
            kwargs["font"] = font
        rule = FormulaRule(**kwargs)
    else:
        raise ValueError(f"unsupported rule type: {rule_type!r} (color_scale|data_bar|icon_set|cell_is|formula)")
    wb = _load_workbook(path)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    ws.conditional_formatting.add(cell_range, rule)
    target = out or path
    atomic_save(wb, target)
    return {"ok": True, "sheet": ws.title, "range": cell_range, "rule": kind, "out": os.path.abspath(target)}


def add_data_validation(
    path: str,
    sheet: str | None,
    cell_range: str,
    validation_type: str = "list",
    options: dict[str, Any] | None = None,
    out: str | None = None,
) -> dict[str, Any]:
    """Add data validation (list|whole|decimal|date|time|textLength|custom)."""
    from openpyxl.worksheet.datavalidation import DataValidation

    opts = options or {}
    formula1 = opts.get("formula1")
    if validation_type == "list" and formula1 and not str(formula1).startswith(("=", '"')):
        formula1 = f'"{formula1}"'
    validation = DataValidation(
        type=validation_type,
        operator=opts.get("operator"),
        formula1=formula1,
        formula2=opts.get("formula2"),
        allow_blank=bool(opts.get("allow_blank", True)),
        showErrorMessage=bool(opts.get("show_error", True)),
        showInputMessage=bool(opts.get("show_input", True)),
        errorTitle=opts.get("error_title"),
        error=opts.get("error"),
        promptTitle=opts.get("prompt_title"),
        prompt=opts.get("prompt"),
    )
    validation.add(cell_range)
    wb = _load_workbook(path)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    ws.add_data_validation(validation)
    target = out or path
    atomic_save(wb, target)
    return {"ok": True, "sheet": ws.title, "range": cell_range, "type": validation_type, "out": os.path.abspath(target)}


def protect_sheet(
    path: str,
    sheet: str | None,
    password: str | None = None,
    options: dict[str, Any] | None = None,
    out: str | None = None,
) -> dict[str, Any]:
    """Protect a worksheet; true/false options map to SheetProtection fields."""
    wb = _load_workbook(path)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    ws.protection.sheet = True
    if password:
        ws.protection.set_password(str(password))
    for key, value in (options or {}).items():
        if hasattr(ws.protection, key):
            setattr(ws.protection, key, bool(value))
    target = out or path
    atomic_save(wb, target)
    return {"ok": True, "sheet": ws.title, "protected": True, "out": os.path.abspath(target)}


def inspect_document(path: str, max_paragraphs: int = 100) -> dict[str, Any]:
    """Paragraph + table + section header/footer dump of a docx."""
    import docx

    document = docx.Document(path)
    detail = [
        {"index": index, "text": p.text, "style": getattr(p.style, "name", "")}
        for index, p in enumerate(document.paragraphs, 1)
    ]
    paragraphs = [p["text"] for p in detail if p["text"].strip()][:max_paragraphs]
    tables = []
    for table in document.tables:
        tables.append({
            "rows": len(table.rows),
            "cols": len(table.columns),
            "cells": [[cell.text for cell in row.cells] for row in table.rows],
        })
    sections = []
    for index, section in enumerate(document.sections, 1):
        sections.append({
            "index": index,
            "header": "\n".join(p.text for p in section.header.paragraphs),
            "footer": "\n".join(p.text for p in section.footer.paragraphs),
        })
    comments = []
    try:
        for comment in document.comments:
            comments.append({
                "id": getattr(comment, "comment_id", None),
                "author": getattr(comment, "author", ""),
                "text": getattr(comment, "text", ""),
            })
    except Exception:
        pass
    return {
        "path": os.path.abspath(path),
        "paragraph_count": len(document.paragraphs),
        "paragraphs": paragraphs,
        "paragraphs_detail": detail[:max_paragraphs],
        "tables": tables,
        "sections": sections,
        "comments": comments,
    }


def inspect_json_document(path: str, **kwargs: Any) -> str:
    return json.dumps(inspect_document(path, **kwargs), ensure_ascii=False, indent=2)


def docx_add_comment(
    path: str,
    paragraph_index: int,
    text: str,
    author: str = "MAFW",
    initials: str | None = None,
    out: str | None = None,
) -> dict[str, Any]:
    """Attach a Word comment to a 1-based body paragraph's runs."""
    import docx

    document = docx.Document(path)
    paragraphs = document.paragraphs
    if paragraph_index < 1 or paragraph_index > len(paragraphs):
        raise ValueError(f"paragraph index out of range: {paragraph_index} (1..{len(paragraphs)})")
    paragraph = paragraphs[paragraph_index - 1]
    runs = list(paragraph.runs)
    if not runs:
        paragraph.add_run("")
        runs = list(paragraph.runs)
    comment = document.add_comment(runs, text=text, author=author, initials=initials)
    target = out or path
    atomic_save(document, target)
    return {
        "ok": True,
        "paragraph": paragraph_index,
        "comment_id": getattr(comment, "comment_id", None),
        "out": os.path.abspath(target),
    }


def _docx_set_update_fields(document, enabled: bool = True) -> None:
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    settings = document.settings.element
    existing = settings.find(qn("w:updateFields"))
    if existing is None:
        existing = OxmlElement("w:updateFields")
        settings.append(existing)
    existing.set(qn("w:val"), "true" if enabled else "false")


def _docx_append_field(paragraph, instruction: str, placeholder: str = "1") -> None:
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    field = OxmlElement("w:fldSimple")
    field.set(qn("w:instr"), instruction)
    run = OxmlElement("w:r")
    text = OxmlElement("w:t")
    text.text = placeholder
    run.append(text)
    field.append(run)
    paragraph._p.append(field)


def docx_insert_toc(
    path: str,
    levels: int = 3,
    title: str | None = None,
    out: str | None = None,
) -> dict[str, Any]:
    """Append a TOC field (Word updates it on open; w:updateFields is set)."""
    import docx

    document = docx.Document(path)
    if title:
        document.add_paragraph(title)
    paragraph = document.add_paragraph()
    _docx_append_field(
        paragraph,
        f'TOC \\o "1-{max(1, int(levels))}" \\h \\z \\u',
        "右键更新目录",
    )
    _docx_set_update_fields(document, True)
    target = out or path
    atomic_save(document, target)
    return {"ok": True, "levels": levels, "out": os.path.abspath(target)}


def docx_set_page_number_footer(
    path: str,
    template: str = "第 {PAGE} 页 / 共 {NUMPAGES} 页",
    section_index: int = 1,
    out: str | None = None,
) -> dict[str, Any]:
    """Replace a section footer with text + PAGE/NUMPAGES fields."""
    import re

    import docx

    document = docx.Document(path)
    if section_index < 1 or section_index > len(document.sections):
        raise ValueError(f"section index out of range: {section_index} (1..{len(document.sections)})")
    footer = document.sections[section_index - 1].footer
    footer.is_linked_to_previous = False
    paragraph = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
    for run in list(paragraph.runs):
        run._element.getparent().remove(run._element)
    for part in re.split(r"(\{PAGE\}|\{NUMPAGES\})", template):
        if part == "{PAGE}":
            _docx_append_field(paragraph, " PAGE ", "1")
        elif part == "{NUMPAGES}":
            _docx_append_field(paragraph, " NUMPAGES ", "1")
        elif part:
            paragraph.add_run(part)
    _docx_set_update_fields(document, True)
    target = out or path
    atomic_save(document, target)
    return {"ok": True, "section": section_index, "out": os.path.abspath(target)}


def docx_update_fields(path: str, out: str | None = None) -> dict[str, Any]:
    """Update Word fields/TOC via COM (Windows + Word)."""
    if os.name != "nt":
        return {"ok": False, "reason": "unsupported-platform", "error": "Word COM is Windows-only"}
    try:
        import win32com.client
    except Exception as exc:
        return {"ok": False, "reason": "pywin32-missing", "error": str(exc)}

    src = os.path.abspath(path)
    target = os.path.abspath(out or path)
    app = None
    document = None
    try:
        app = win32com.client.DispatchEx("Word.Application")
        try:
            app.Visible = False
        except Exception:
            pass
        try:
            app.DisplayAlerts = 0
        except Exception:
            pass
        document = app.Documents.Open(src, ReadOnly=False, AddToRecentFiles=False, Visible=False)
        fields = int(document.Fields.Count)
        document.Fields.Update()
        tocs = int(document.TablesOfContents.Count)
        for index in range(1, tocs + 1):
            document.TablesOfContents(index).Update()
        if target != src:
            document.SaveAs2(target)
        else:
            document.Save()
        return {"ok": True, "fields": fields, "tocs": tocs, "out": target}
    except Exception as exc:
        return {"ok": False, "reason": "update-failed", "error": str(exc)[:300]}
    finally:
        if document is not None:
            try:
                document.Close(False)
            except Exception:
                pass
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass


def _set_paragraph_text(paragraph, text: str) -> None:
    runs = list(paragraph.runs)
    if runs:
        runs[0].text = text
        for run in runs[1:]:
            run.text = ""
    else:
        paragraph.add_run(text)


def set_paragraph(
    path: str,
    index: int,
    text: str,
    style: str | None = None,
    out: str | None = None,
) -> dict[str, Any]:
    """Replace paragraph text by 1-based body index, keeping the first run's formatting."""
    import docx

    document = docx.Document(path)
    paragraphs = document.paragraphs
    if index < 1 or index > len(paragraphs):
        raise ValueError(f"paragraph index out of range: {index} (1..{len(paragraphs)})")
    paragraph = paragraphs[index - 1]
    _set_paragraph_text(paragraph, text)
    if style:
        paragraph.style = style
    target = out or path
    atomic_save(document, target)
    return {"ok": True, "index": index, "out": os.path.abspath(target)}


def add_paragraph(
    path: str,
    text: str,
    style: str | None = None,
    after: int | None = None,
    out: str | None = None,
) -> dict[str, Any]:
    """Append a paragraph, or insert after a 1-based body index."""
    import docx

    document = docx.Document(path)
    paragraph = document.add_paragraph(text, style=style)
    if after is not None:
        paragraphs = document.paragraphs
        if after < 1 or after > len(paragraphs):
            raise ValueError(f"after index out of range: {after} (1..{len(paragraphs)})")
        paragraphs[after - 1]._p.addnext(paragraph._p)
    target = out or path
    atomic_save(document, target)
    return {"ok": True, "out": os.path.abspath(target)}


def docx_set_table_cell(
    path: str,
    table_index: int,
    row: int,
    col: int,
    text: str,
    out: str | None = None,
) -> dict[str, Any]:
    """Set a table cell by 1-based table/row/col, keeping the cell's formatting."""
    import docx

    document = docx.Document(path)
    if table_index < 1 or table_index > len(document.tables):
        raise ValueError(f"table index out of range: {table_index} (1..{len(document.tables)})")
    table = document.tables[table_index - 1]
    if row < 1 or row > len(table.rows) or col < 1 or col > len(table.columns):
        raise ValueError(f"cell out of range: {row},{col} (table {len(table.rows)}x{len(table.columns)})")
    cell = table.cell(row - 1, col - 1)
    _set_paragraph_text(cell.paragraphs[0], text)
    target = out or path
    atomic_save(document, target)
    return {"ok": True, "table": table_index, "cell": [row, col], "out": os.path.abspath(target)}


def add_table_row(
    path: str,
    table_index: int,
    values: Iterable[str],
    out: str | None = None,
) -> dict[str, Any]:
    """Append a row to a table; values fill cells left to right."""
    import docx

    document = docx.Document(path)
    if table_index < 1 or table_index > len(document.tables):
        raise ValueError(f"table index out of range: {table_index} (1..{len(document.tables)})")
    table = document.tables[table_index - 1]
    row = table.add_row()
    for index, value in enumerate(values):
        if index >= len(row.cells):
            break
        _set_paragraph_text(row.cells[index].paragraphs[0], str(value))
    target = out or path
    atomic_save(document, target)
    return {"ok": True, "table": table_index, "rows": len(table.rows), "out": os.path.abspath(target)}


def docx_add_table(
    path: str,
    rows: Iterable[Iterable[str]],
    style: str | None = None,
    out: str | None = None,
) -> dict[str, Any]:
    """Append a table; rows is a list of row value lists."""
    import docx

    document = docx.Document(path)
    data = [[str(v) for v in row] for row in rows]
    if not data or not data[0]:
        raise ValueError("rows must be a non-empty 2D list")
    table = document.add_table(rows=len(data), cols=len(data[0]))
    if style:
        table.style = style
    for r, values in enumerate(data):
        for c, value in enumerate(values):
            if c >= len(table.columns):
                break
            _set_paragraph_text(table.cell(r, c).paragraphs[0], value)
    target = out or path
    atomic_save(document, target)
    return {"ok": True, "tables": len(document.tables), "out": os.path.abspath(target)}


def set_header(path: str, text: str, section_index: int = 1, out: str | None = None) -> dict[str, Any]:
    """Set a section header (1-based section)."""
    import docx

    document = docx.Document(path)
    if section_index < 1 or section_index > len(document.sections):
        raise ValueError(f"section index out of range: {section_index} (1..{len(document.sections)})")
    header = document.sections[section_index - 1].header
    header.is_linked_to_previous = False
    paragraphs = header.paragraphs
    if paragraphs:
        _set_paragraph_text(paragraphs[0], text)
    else:
        header.add_paragraph(text)
    target = out or path
    atomic_save(document, target)
    return {"ok": True, "section": section_index, "out": os.path.abspath(target)}


def set_footer(path: str, text: str, section_index: int = 1, out: str | None = None) -> dict[str, Any]:
    """Set a section footer (1-based section)."""
    import docx

    document = docx.Document(path)
    if section_index < 1 or section_index > len(document.sections):
        raise ValueError(f"section index out of range: {section_index} (1..{len(document.sections)})")
    footer = document.sections[section_index - 1].footer
    footer.is_linked_to_previous = False
    paragraphs = footer.paragraphs
    if paragraphs:
        _set_paragraph_text(paragraphs[0], text)
    else:
        footer.add_paragraph(text)
    target = out or path
    atomic_save(document, target)
    return {"ok": True, "section": section_index, "out": os.path.abspath(target)}


def docx_add_picture(
    path: str,
    image_path: str,
    width_inches: float | None = None,
    out: str | None = None,
) -> dict[str, Any]:
    """Append a picture, optionally constrained by width in inches."""
    import docx
    from docx.shared import Inches

    document = docx.Document(path)
    kwargs = {}
    if width_inches:
        kwargs["width"] = Inches(float(width_inches))
    document.add_picture(image_path, **kwargs)
    target = out or path
    atomic_save(document, target)
    return {"ok": True, "out": os.path.abspath(target)}


def replace_text_docx(
    path: str,
    replacements: dict[str, str],
    out: str | None = None,
) -> dict[str, Any]:
    """Run-aware replace across body paragraphs, table cells, headers and footers."""
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
    for section in document.sections:
        for paragraph in list(section.header.paragraphs) + list(section.footer.paragraphs):
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


def _pdf_to_pngs(pdf_path: str, out_dir: str, prefix: str, width: int) -> tuple[list[dict[str, Any]] | None, dict[str, Any] | None]:
    try:
        import pypdfium2 as pdfium
    except Exception as exc:
        return None, {"reason": "pypdfium2-missing", "error": str(exc)}
    pdf = pdfium.PdfDocument(pdf_path)
    images: list[dict[str, Any]] = []
    try:
        for index in range(len(pdf)):
            page = pdf[index]
            page_width, _ = page.get_size()
            scale = (float(width) / page_width) if page_width else 1.0
            bitmap = page.render(scale=scale)
            png = os.path.join(out_dir, f"{prefix}-{index + 1:02d}.png")
            bitmap.to_pil().save(png)
            images.append({"page": index + 1, "path": png, "bytes": os.path.getsize(png)})
    finally:
        pdf.close()
    return images, None


def _com_pdf_export(
    path: str,
    out_dir: str,
    prefix: str,
    width: int,
    program: str,
    opener,
) -> dict[str, Any]:
    """Shared COM → PDF → PNG pipeline. `opener(app, src, pdf)` returns a handle
    and must export the PDF before returning."""
    if os.name != "nt":
        return {"ok": False, "reason": "unsupported-platform", "error": f"{program} COM is Windows-only"}
    try:
        import win32com.client  # lazy: pywin32 is optional
    except Exception as exc:
        return {"ok": False, "reason": "pywin32-missing", "error": str(exc)}

    src = os.path.abspath(path)
    out = os.path.abspath(out_dir)
    os.makedirs(out, exist_ok=True)
    pdf_path = os.path.join(out, f"{prefix}.pdf")
    app = None
    handle = None
    try:
        app = win32com.client.DispatchEx(program)
        try:
            app.Visible = False
        except Exception:
            pass
        try:
            app.DisplayAlerts = False
        except Exception:
            pass
        handle = opener(app, src, pdf_path)
        images, error = _pdf_to_pngs(pdf_path, out, prefix, width)
        if error:
            return {"ok": False, **error}
        return {
            "ok": True,
            "engine": program,
            "out_dir": out,
            "pdf": pdf_path,
            "images": images or [],
        }
    except Exception as exc:
        return {"ok": False, "reason": "render-failed", "error": str(exc)[:300]}
    finally:
        if handle is not None:
            try:
                handle.Close(False)
            except Exception:
                pass
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass


def render_workbook(path: str, out_dir: str, width: int = 1280) -> dict[str, Any]:
    """Render an xlsx to page PNGs (Excel COM → PDF → pypdfium2)."""

    def opener(app, src: str, pdf_path: str):
        workbook = app.Workbooks.Open(src, ReadOnly=True, UpdateLinks=0)
        workbook.ExportAsFixedFormat(0, pdf_path)  # 0 = xlTypePDF
        return workbook

    return _com_pdf_export(path, out_dir, "sheet", width, "Excel.Application", opener)


def render_document(path: str, out_dir: str, width: int = 1280) -> dict[str, Any]:
    """Render a docx to page PNGs (Word COM → PDF → pypdfium2)."""

    def opener(app, src: str, pdf_path: str):
        document = app.Documents.Open(src, ReadOnly=True, AddToRecentFiles=False, Visible=False)
        document.ExportAsFixedFormat(pdf_path, 17)  # 17 = wdExportFormatPDF
        return document

    return _com_pdf_export(path, out_dir, "page", width, "Word.Application", opener)


def montage_images(
    paths: Iterable[str],
    out_path: str,
    cols: int = 2,
    gap: int = 8,
    max_cell_width: int = 1200,
) -> dict[str, Any]:
    """Combine rendered page PNGs into one image (fewer vision calls)."""
    from PIL import Image

    files = [p for p in paths if p and os.path.exists(p)]
    if not files:
        return {"ok": False, "reason": "no-images"}
    images = [Image.open(p).convert("RGB") for p in files]
    try:
        cell_w = min(max(im.width for im in images), int(max_cell_width))
        scaled = []
        for im in images:
            ratio = cell_w / im.width if im.width else 1.0
            scaled.append(im.resize((max(1, int(im.width * ratio)), max(1, int(im.height * ratio)))))
        cell_h = max(im.height for im in scaled)
        columns = max(1, int(cols))
        rows = (len(scaled) + columns - 1) // columns
        width = columns * cell_w + (columns + 1) * gap
        height = rows * cell_h + (rows + 1) * gap
        canvas = Image.new("RGB", (width, height), (255, 255, 255))
        for index, im in enumerate(scaled):
            row, col = divmod(index, columns)
            x = gap + col * (cell_w + gap) + (cell_w - im.width) // 2
            y = gap + row * (cell_h + gap) + (cell_h - im.height) // 2
            canvas.paste(im, (x, y))
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        canvas.save(out_path)
        return {
            "ok": True,
            "path": os.path.abspath(out_path),
            "pages": len(scaled),
            "width": width,
            "height": height,
        }
    finally:
        for im in images:
            try:
                im.close()
            except Exception:
                pass


def render_office(
    path: str,
    out_dir: str,
    width: int = 1280,
    slides: Iterable[int] | None = None,
    montage: bool = False,
) -> dict[str, Any]:
    """Render pptx/xlsx/docx by extension; unified entry point for the skill."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pptx":
        result = render_deck(path, out_dir, width=width, slides=slides)
    elif ext in (".xlsx", ".xlsm"):
        result = render_workbook(path, out_dir, width=width)
    elif ext == ".docx":
        result = render_document(path, out_dir, width=width)
    else:
        return {"ok": False, "reason": "unsupported-format", "error": f"unsupported Office extension: {ext or '(none)'}"}
    if montage and result.get("ok") and len(result.get("images", [])) > 1:
        combined = montage_images(
            [item["path"] for item in result["images"]],
            os.path.join(os.path.abspath(out_dir), "montage.png"),
        )
        if combined.get("ok"):
            result["montage"] = combined
    return result


def convert_legacy(path: str, out: str | None = None, overwrite: bool = False) -> dict[str, Any]:
    """Convert .xls/.doc/.ppt to modern Office formats via COM.

    Writes a new file by default; never overwrites the source. The agent should
    edit the converted copy and let the user decide whether to replace the
    original (legacy conversion can change layout).
    """
    if os.name != "nt":
        return {"ok": False, "reason": "unsupported-platform", "error": "Office COM is Windows-only"}
    try:
        import win32com.client  # lazy: pywin32 is optional
    except Exception as exc:
        return {"ok": False, "reason": "pywin32-missing", "error": str(exc)}

    src = os.path.abspath(path)
    ext = os.path.splitext(src)[1].lower()
    mapping = {
        ".xls": (".xlsx", "Excel.Application", 51),
        ".doc": (".docx", "Word.Application", 16),
        ".ppt": (".pptx", "PowerPoint.Application", 24),
    }
    if ext not in mapping:
        return {"ok": False, "reason": "not-legacy", "error": f"not a legacy Office extension: {ext or '(none)'}"}
    new_ext, program, file_format = mapping[ext]
    target = os.path.abspath(out) if out else os.path.splitext(src)[0] + new_ext
    if os.path.abspath(target) == src:
        return {"ok": False, "reason": "same-path", "error": "output must differ from the source"}
    if os.path.exists(target) and not overwrite:
        return {"ok": False, "reason": "exists", "error": f"output already exists: {target}"}

    app = None
    handle = None
    try:
        app = win32com.client.DispatchEx(program)
        try:
            app.Visible = False
        except Exception:
            pass
        try:
            app.DisplayAlerts = False
        except Exception:
            pass
        if ext == ".xls":
            handle = app.Workbooks.Open(src, ReadOnly=True, UpdateLinks=0)
            handle.SaveAs(target, FileFormat=file_format)
        elif ext == ".doc":
            handle = app.Documents.Open(src, ReadOnly=True, AddToRecentFiles=False, Visible=False)
            handle.SaveAs2(target, FileFormat=file_format)
        else:
            handle = app.Presentations.Open(src, ReadOnly=True, WithWindow=False)
            handle.SaveAs(target, file_format)
        return {"ok": True, "engine": program, "out": target}
    except Exception as exc:
        return {"ok": False, "reason": "convert-failed", "error": str(exc)[:300]}
    finally:
        if handle is not None:
            try:
                handle.Close(False)
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
