"""Unit tests for mafw_office helpers (run inside the pykernel venv).

Run:
  "%USERPROFILE%/.mafw/pykernel/Scripts/python.exe" -m unittest gateway/tests/python/test_mafw_office.py -v
or on POSIX:
  ~/.mafw/pykernel/bin/python -m unittest gateway/tests/python/test_mafw_office.py -v
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
HELPER_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "scripts", "office"))
if HELPER_DIR not in sys.path:
    sys.path.insert(0, HELPER_DIR)

import mafw_office as mo  # noqa: E402


def make_png(path: str, color: tuple[int, int, int]) -> None:
    from PIL import Image

    Image.new("RGB", (64, 48), color).save(path)


def make_deck(path: str, image_path: str) -> None:
    from pptx import Presentation
    from pptx.util import Inches, Pt

    prs = Presentation()
    prs.slide_width = 12192000
    prs.slide_height = 6858000
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "Deck 2025"
    title_run = slide.shapes.title.text_frame.paragraphs[0].runs[0]
    title_run.font.size = Pt(40)
    title_run.font.name = "Arial"
    slide.placeholders[1].text = "Body text"
    table = slide.shapes.add_table(2, 2, Inches(1), Inches(4), Inches(4), Inches(1)).table
    table.cell(0, 0).text = "A1"
    table.cell(1, 1).text = "B2"
    slide.shapes.add_picture(image_path, Inches(6), Inches(4), Inches(1), Inches(0.75))
    slide.notes_slide.notes_text_frame.text = "notes-before"
    prs.save(path)


class DeckTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="mafw-office-test-")
        self.img1 = os.path.join(self.tmp, "one.png")
        self.img2 = os.path.join(self.tmp, "two.png")
        make_png(self.img1, (255, 0, 0))
        make_png(self.img2, (0, 0, 255))
        self.deck = os.path.join(self.tmp, "deck.pptx")
        make_deck(self.deck, self.img1)

    def test_inspect_enriches_layout_geometry_and_placeholders(self) -> None:
        info = mo.inspect_deck(self.deck)
        slide = info["slides"][0]
        self.assertTrue(slide["layout"])
        title = slide["shapes"][0]
        self.assertEqual(title["placeholder"]["idx"], 0)
        self.assertGreater(title["width"], 0)
        table = next(s for s in slide["shapes"] if s.get("table_size"))
        self.assertEqual(table["table_size"], [2, 2])
        picture = next(s for s in slide["shapes"] if s.get("picture"))
        self.assertEqual(picture["picture"]["size"], [64, 48])

    def test_set_text_preserves_run_format(self) -> None:
        result = mo.set_text(self.deck, 1, "Title 1", "New Deck 2026")
        self.assertTrue(result["ok"])
        from pptx import Presentation

        run = Presentation(self.deck).slides[0].shapes.title.text_frame.paragraphs[0].runs[0]
        self.assertEqual(run.text, "New Deck 2026")
        self.assertEqual(run.font.name, "Arial")
        self.assertEqual(run.font.size.pt, 40)

    def test_slide_ops_add_move_delete(self) -> None:
        self.assertEqual(len(mo.inspect_deck(self.deck)["slides"]), 1)
        mo.add_slide(self.deck, layout_index=1, index=1)
        self.assertEqual(len(mo.inspect_deck(self.deck)["slides"]), 2)
        mo.move_slide(self.deck, 1, 2)
        self.assertEqual(len(mo.inspect_deck(self.deck)["slides"]), 2)
        mo.delete_slide(self.deck, 2)
        self.assertEqual(len(mo.inspect_deck(self.deck)["slides"]), 1)

    def test_table_cell_and_image_replace(self) -> None:
        before = mo.inspect_deck(self.deck)["slides"][0]["shapes"]
        table_name = next(s["name"] for s in before if s.get("table_size"))
        mo.set_table_cell(self.deck, 1, table_name, 1, 1, "changed")
        table = next(s for s in mo.inspect_deck(self.deck)["slides"][0]["shapes"] if s.get("table_size"))
        self.assertEqual(table["table"][0][0], "changed")
        picture_name = next(
            s["name"] for s in mo.inspect_deck(self.deck)["slides"][0]["shapes"] if s.get("picture")
        )
        mo.replace_image(self.deck, 1, picture_name, self.img2)
        self.assertTrue(mo.inspect_deck(self.deck)["slides"][0]["shapes"][-1]["picture"])

    @unittest.skipUnless(
        os.environ.get("MAFW_TEST_PPT_COM") == "1",
        "set MAFW_TEST_PPT_COM=1 (Windows + PowerPoint) to run the COM render test",
    )
    def test_render_deck_powerpoint_com(self) -> None:
        result = mo.render_deck(self.deck, os.path.join(self.tmp, "render"), width=640, height=360, slides=[1])
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["images"][0]["slide"], 1)
        self.assertGreater(os.path.getsize(result["images"][0]["path"]), 1000)


class WorkbookTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="mafw-office-xlsx-")
        self.path = os.path.join(self.tmp, "book.xlsx")
        from openpyxl import Workbook

        wb = Workbook()
        ws = wb.active
        ws.title = "Sheet1"
        ws["A1"] = "name"
        ws["B2"] = 42
        wb.save(self.path)

    def test_inspect_and_set_cells(self) -> None:
        info = mo.inspect_workbook(self.path)
        self.assertEqual(info["sheets"][0]["name"], "Sheet1")
        self.assertEqual(info["sheets"][0]["rows"][0][0], "name")
        mo.set_cells(self.path, [{"sheet": "Sheet1", "cell": "B2", "value": 99}])
        self.assertEqual(mo.inspect_workbook(self.path)["sheets"][0]["rows"][1][1], 99)


class DocumentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="mafw-office-docx-")
        self.path = os.path.join(self.tmp, "doc.docx")
        import docx

        document = docx.Document()
        document.add_paragraph("Hello 2025 world")
        table = document.add_table(rows=1, cols=1)
        table.cell(0, 0).text = "cell 2025"
        document.save(self.path)

    def test_inspect_and_replace(self) -> None:
        info = mo.inspect_document(self.path)
        self.assertIn("Hello 2025 world", info["paragraphs"])
        result = mo.replace_text_docx(self.path, {"2025": "2026"})
        self.assertEqual(result["replacements"], 2)
        info2 = mo.inspect_document(self.path)
        self.assertIn("Hello 2026 world", info2["paragraphs"])
        self.assertIn("cell 2026", info2["tables"][0]["cells"][0][0])


if __name__ == "__main__":
    unittest.main()
