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
            text = _text_of(sh)
            if text is not None:
                item["text"] = text
            if getattr(sh, "has_table", False) and sh.has_table:
                item["table"] = [[c.text for c in row.cells] for row in sh.table.rows]
            if getattr(sh, "has_chart", False) and sh.has_chart:
                try:
                    item["chart"] = {
                        "type": str(sh.chart.chart_type),
                        "series": len(sh.chart.series),
                    }
                except Exception:
                    item["chart"] = {"type": "unknown"}
            if getattr(sh, "shape_type", None) == 13:  # MSO_SHAPE_TYPE.PICTURE
                item["picture"] = True
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
        slides.append({
            "index": index,
            "slide_id": slide.slide_id,
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
