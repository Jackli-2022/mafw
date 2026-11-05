from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
LORE = ROOT / "assets" / "brand" / "lore"
EXPORT = LORE / "export"
RENDERER = ROOT / "packages" / "desktop" / "src" / "renderer" / "mafw" / "assets" / "lore"
PACK_SIZES = (16, 20, 24, 28, 32, 40, 48, 64, 80, 96, 128, 160, 256, 512, 1024)


def test_avatar_pack_sizes_and_variants():
    for size in PACK_SIZES:
        for path in (
            LORE / "avatar" / "circle" / f"Lore_avatar_{size}.png",
            LORE / "avatar" / "transparent" / f"Lore_avatar_transparent_{size}.png",
        ):
            im = Image.open(path)
            assert im.size == (size, size)
            assert im.mode == "RGBA"


def test_export_avatar_copies():
    for size in PACK_SIZES:
        assert (EXPORT / "avatar" / "circle" / f"Lore_avatar_{size}.png").exists()
        assert (EXPORT / "avatar" / "transparent" / f"Lore_avatar_transparent_{size}.png").exists()


def test_ui_avatar_copies():
    for size in (16, 32, 64):
        im = Image.open(RENDERER / f"lead-avatar-{size}.png")
        assert im.size == (size, size)
        assert im.mode == "RGBA"


def test_avatar_16px_circle_has_contrast():
    im = Image.open(RENDERER / "lead-avatar-16.png").convert("RGBA")
    dark = light = 0
    for y in range(16):
        for x in range(16):
            r, g, b, a = im.getpixel((x, y))
            if a < 200:
                continue
            if r < 80 and g < 80 and b < 80:
                dark += 1
            if r > 200 and g > 190 and b > 180:
                light += 1
    assert dark > 0 and light > 0


def test_avatar_32px_has_eyes():
    im = Image.open(RENDERER / "lead-avatar-32.png").convert("RGBA")
    dark = 0
    for y in range(8, 24):
        for x in range(8, 24):
            r, g, b, a = im.getpixel((x, y))
            if a > 200 and r < 80 and g < 80 and b < 80:
                dark += 1
    assert dark >= 2


def test_tray_sizes_and_monochrome():
    for base in (16, 20, 24, 32):
        for name, size in (
            (f"loreTemplate-{base}.png", base),
            (f"loreTemplate-{base}@2x.png", base * 2),
        ):
            im = Image.open(EXPORT / "tray" / name).convert("RGBA")
            assert im.size == (size, size)
            alpha = im.getchannel("A")
            colors = {
                im.getpixel((x, y))[:3]
                for y in range(im.height)
                for x in range(im.width)
                if alpha.getpixel((x, y)) > 0
            }
            assert colors
            assert len(colors) == 1, "tray template must be monochrome"


def test_favicon_png_and_ico():
    for size in (16, 32, 48):
        assert Image.open(EXPORT / "favicon" / f"favicon-{size}.png").size == (size, size)
    ico = Image.open(EXPORT / "favicon" / "favicon.ico")
    assert {(16, 16), (32, 32), (48, 48)} <= set(ico.info["sizes"])
