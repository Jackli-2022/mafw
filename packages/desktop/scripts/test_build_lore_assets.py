from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
EXPORT = ROOT / "assets" / "brand" / "lore" / "export"
RENDERER = ROOT / "packages" / "desktop" / "src" / "renderer" / "mafw" / "assets" / "lore"
AVATARS = (64, 96, 128, 256, 512)


def test_avatar_sizes_mode_and_safe_margin():
    for size in AVATARS:
        im = Image.open(EXPORT / "avatar" / f"lore-avatar-{size}.png")
        assert im.size == (size, size)
        assert im.mode == "RGBA"
        bbox = im.getchannel("A").getbbox()
        assert bbox is not None
        left, top, right, bottom = bbox
        margin = max(2, round(size * 0.03))
        assert left >= margin and top >= margin
        assert right <= size - margin and bottom <= size - margin
        # no tag/thread: the alpha bbox stays near-square
        assert abs((right - left) - (bottom - top)) <= size * 0.12


def test_avatar_has_eyes_and_outline():
    im = Image.open(EXPORT / "avatar" / "lore-avatar-64.png").convert("RGBA")
    w, h = im.size
    dark = 0
    for y in range(h // 4, h * 3 // 4):
        for x in range(w // 4, w * 3 // 4):
            r, g, b, a = im.getpixel((x, y))
            if a > 200 and r < 80 and g < 80 and b < 80:
                dark += 1
    assert dark >= 4, "64px avatar lost its eyes"


def test_avatar_16px_legibility():
    im = Image.open(EXPORT / "avatar" / "lore-avatar-64.png").convert("RGBA").resize((16, 16), Image.LANCZOS)
    dark = 0
    for y in range(4, 12):
        for x in range(4, 12):
            r, g, b, a = im.getpixel((x, y))
            if a > 160 and r < 160 and g < 160 and b < 160:
                dark += 1
    assert dark >= 2, "16px avatar lost its eyes"


def test_avatar_has_ink_outline():
    im = Image.open(EXPORT / "avatar" / "lore-avatar-64.png").convert("RGBA")
    alpha = im.getchannel("A")
    w, h = im.size
    dark = 0
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if alpha.getpixel((x, y)) < 200:
                continue
            edge = any(alpha.getpixel((x + dx, y + dy)) < 32 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if not edge:
                continue
            r, g, b, a = im.getpixel((x, y))
            if r < 150 and g < 150 and b < 150:
                dark += 1
    assert dark > 0, "avatar lost its ink outline"


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


def test_renderer_avatar_copies_exist():
    for size in AVATARS:
        assert (RENDERER / f"lead-avatar-{size}.png").exists()
