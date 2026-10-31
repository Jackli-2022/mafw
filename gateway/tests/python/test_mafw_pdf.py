"""Unit tests for mafw_pdf (pypdf + reportlab + pypdfium2).

Run with the pykernel venv:
  "%USERPROFILE%/.mafw/pykernel/Scripts/python.exe" -m unittest gateway/tests/python/test_mafw_pdf.py -v
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

import mafw_pdf as pdf  # noqa: E402


def make_pdf(path: str) -> None:
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(path, pagesize=(595, 842))
    c.drawString(72, 750, "Hello 2025 page one")
    c.acroForm.textfield(name="customer", x=72, y=700, width=200, height=20, value="")
    c.showPage()
    c.drawString(72, 750, "Page two content")
    c.showPage()
    c.save()


def make_png(path: str) -> None:
    from PIL import Image

    Image.new("RGB", (64, 48), (0, 128, 255)).save(path)


class PdfTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="mafw-pdf-test-")
        self.path = os.path.join(self.tmp, "doc.pdf")
        self.img = os.path.join(self.tmp, "logo.png")
        make_pdf(self.path)
        make_png(self.img)

    def test_inspect_extract_render(self) -> None:
        info = pdf.inspect_pdf(self.path)
        self.assertEqual(info["page_count"], 2)
        self.assertIn("Hello 2025", info["pages"][0]["text"])
        self.assertEqual(info["pages"][0]["width"], 595.0)
        self.assertEqual(len(info["form_fields"]), 1)

        text = pdf.extract_text(self.path, pages=[2])
        self.assertEqual(len(text["pages"]), 1)
        self.assertIn("Page two", text["pages"][0]["text"])

        rendered = pdf.render_pdf(self.path, os.path.join(self.tmp, "render"), width=640)
        self.assertTrue(rendered["ok"], rendered)
        self.assertEqual(len(rendered["images"]), 2)
        self.assertGreater(os.path.getsize(rendered["images"][0]["path"]), 1000)

    def test_page_operations(self) -> None:
        split = pdf.split_pdf(self.path, os.path.join(self.tmp, "parts"), ranges=["1", "2"])
        self.assertEqual(len(split["files"]), 2)
        merged = pdf.merge_pdfs([f["path"] for f in split["files"]], os.path.join(self.tmp, "merged.pdf"))
        self.assertEqual(merged["pages"], 2)

        deleted = pdf.delete_pages(self.path, [2], out=os.path.join(self.tmp, "one.pdf"))
        self.assertEqual(pdf.inspect_pdf(deleted["out"])["page_count"], 1)

        rotated = pdf.rotate_pages(self.path, [1], 90, out=os.path.join(self.tmp, "rotated.pdf"))
        self.assertEqual(pdf.inspect_pdf(rotated["out"])["page_count"], 2)

        reordered = pdf.reorder_pages(self.path, [2, 1], out=os.path.join(self.tmp, "reordered.pdf"))
        self.assertIn("Page two", pdf.inspect_pdf(reordered["out"])["pages"][0]["text"])

        blank = pdf.add_blank_page(self.path, 2, out=os.path.join(self.tmp, "blank.pdf"))
        self.assertEqual(blank["pages"], 3)

    def test_metadata_and_forms(self) -> None:
        out = os.path.join(self.tmp, "meta.pdf")
        pdf.set_metadata(self.path, {"Title": "Contract", "Author": "MAFW"}, out=out)
        info = pdf.inspect_pdf(out)
        self.assertEqual(info["metadata"].get("Title"), "Contract")

        filled = os.path.join(self.tmp, "filled.pdf")
        pdf.fill_form(self.path, {"customer": "Alice"}, out=filled)
        fields = pdf.inspect_pdf(filled)["form_fields"]
        self.assertEqual(fields[0]["name"], "customer")
        self.assertEqual(fields[0]["value"], "Alice")

    def test_overlays(self) -> None:
        text = os.path.join(self.tmp, "text.pdf")
        pdf.add_text(self.path, "APPROVED", 72, 100, pages=[1], out=text)
        self.assertEqual(pdf.inspect_pdf(text)["page_count"], 2)

        watermarked = os.path.join(self.tmp, "wm.pdf")
        pdf.watermark(self.path, "DRAFT", out=watermarked, opacity=0.2)
        self.assertEqual(pdf.inspect_pdf(watermarked)["page_count"], 2)

        image = os.path.join(self.tmp, "img.pdf")
        pdf.add_image(self.path, self.img, 72, 200, 96, 72, pages=[1], out=image)
        self.assertEqual(pdf.inspect_pdf(image)["page_count"], 2)


if __name__ == "__main__":
    unittest.main()
