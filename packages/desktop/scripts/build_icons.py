"""MAFW desktop icon build pipeline.

Generates prod/dev/beta channel icons from the selected AI-generated concept:
watermark removal, channel variants, full PNG size matrix, .ico and .icns.

Usage: python build_icons.py
Requires: Pillow (pip install Pillow)
Spec: docs/superpowers/specs/2026-09-10-desktop-icon-design.md
"""
from pathlib import Path
import io
import struct

from PIL import Image, ImageDraw, ImageFilter, ImageFont, PngImagePlugin

AI_META = PngImagePlugin.PngInfo()
AI_META.add_text("AI-Generated", "true (CogView-4 base, post-processed; see icons/README.md)")
AI_META.add_text("Software", "MAFW desktop icon build pipeline")

ICONS = Path(__file__).resolve().parent.parent / "icons"
SOURCE = ICONS / "concepts" / "icon-concept-zhipu-2.png"
MASTER_OUT = ICONS / "master" / "app-icon-1024.png"
CHANNELS = ("prod", "dev", "beta")
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
PNG_TARGETS = {
    "icon.png": 512,
    "dock.png": 256,
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
}
ICNS_TYPES = (("icp4", 16), ("icp5", 32), ("ic07", 128), ("ic08", 256), ("ic09", 512), ("ic10", 1024))
# "AI生成" watermark rect on the source image (located via ASCII luminance map;
# covers text AND the dark badge plate behind it)
WM_BOX = (884, 934, 1018, 1018)
WM_BRIGHT = 170


def _has_bright(im: Image.Image) -> bool:
    rgb = im.convert("RGB")
    return any(
        all(c > WM_BRIGHT for c in px)
        for px in rgb.getdata()
    )


def remove_watermark(im: Image.Image) -> Image.Image:
    """Cover WM_BOX with a mirrored patch from the first clean neighbor region."""
    im = im.convert("RGBA")
    x0, y0, x1, y1 = WM_BOX
    bw, bh = x1 - x0, y1 - y0
    candidates = (
        ((x0, y0 - bh, x1, y0), Image.FLIP_TOP_BOTTOM),       # directly above
        ((1024 - bw, y0 - 2 * bh, 1024, y0 - bh), Image.FLIP_TOP_BOTTOM),  # higher strip
        ((1024 - bw, y0, 1024, y1), None),                    # right strip stretch
    )
    patch = None
    for box, flip in candidates:
        cand = im.crop(box)
        if _has_bright(cand):
            continue
        patch = cand.transpose(flip) if flip else cand.resize((bw, bh))
        break
    if patch is None:
        # fallback: synthesized horizontal gradient sampled at the row scale
        base = im.crop((x0, y0 - bh, x1, y0)).filter(ImageFilter.GaussianBlur(24))
        patch = base
    mask = Image.new("L", (bw, bh), 0)
    draw = ImageDraw.Draw(mask)
    inset = 4
    draw.rectangle((inset, inset, bw - inset, bh - inset), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(10))
    im.paste(patch, (x0, y0), mask)
    # soften the whole patched area slightly so the seam disappears
    region = im.crop((x0 - 6, y0 - 6, x1 + 6, y1 + 6))
    region = region.filter(ImageFilter.GaussianBlur(1.2))
    im.paste(region, (x0 - 6, y0 - 6))
    return im


def border_background(im: Image.Image) -> tuple[int, int, int]:
    """Median-ish dark background color sampled from the image border."""
    px = im.convert("RGB").load()
    w, h = im.size
    samples = []
    for i in range(0, w, 32):
        samples.append(px[i, 0])
        samples.append(px[i, h - 1])
    for j in range(0, h, 32):
        samples.append(px[0, j])
        samples.append(px[w - 1, j])
    rs = sorted(s[0] for s in samples)
    gs = sorted(s[1] for s in samples)
    bs = sorted(s[2] for s in samples)
    mid = len(samples) // 2
    return (rs[mid], gs[mid], bs[mid])


def make_icns_canvas(im: Image.Image) -> Image.Image:
    """Scale master to 88% and center on background-extended 1024 canvas."""
    bg = border_background(im)
    canvas = Image.new("RGBA", (1024, 1024), bg + (255,))
    scaled = im.resize((901, 901), Image.LANCZOS)
    canvas.paste(scaled, ((1024 - 901) // 2, (1024 - 901) // 2))
    return canvas


def write_icns(canvas: Image.Image, path: Path) -> None:
    entries = b""
    for code, size in ICNS_TYPES:
        sized = canvas if size == 1024 else canvas.resize((size, size), Image.LANCZOS)
        buf = io.BytesIO()
        sized.save(buf, format="PNG")
        data = buf.getvalue()
        entries += code.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    total = 8 + len(entries)
    path.write_bytes(b"icns" + struct.pack(">I", total) + entries)


def load_badge_font(size: int):
    for name in ("arialbd.ttf", "arial.ttf", "seguisb.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def apply_dev_blueprint(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    tint = Image.new("RGBA", im.size, (40, 70, 160, 26))
    im = Image.alpha_composite(im, tint)
    grid = Image.new("RGBA", im.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(grid)
    for pos in range(0, 1025, 64):
        draw.line((pos, 0, pos, 1024), fill=(140, 190, 255, 34), width=2)
        draw.line((0, pos, 1024, pos), fill=(140, 190, 255, 34), width=2)
    return Image.alpha_composite(im, grid)


def apply_beta_badge(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    ribbon = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    draw = ImageDraw.Draw(ribbon)
    draw.polygon([(1024 - 380, 0), (1024, 0), (1024, 380)], fill=(255, 140, 60, 235))
    label = Image.new("RGBA", (520, 520), (0, 0, 0, 0))
    ldraw = ImageDraw.Draw(label)
    font = load_badge_font(130)
    ldraw.text((260, 260), "BETA", font=font, fill=(255, 255, 255, 255), anchor="mm")
    label = label.rotate(-45, resample=Image.BICUBIC)
    im = Image.alpha_composite(im, ribbon)
    # ribbon diagonal midpoint (834, 190) gets the centered BETA label
    im.paste(label, (834 - 260, 190 - 260), label)
    return im


def channel_master(processed: Image.Image, channel: str) -> Image.Image:
    if channel == "dev":
        return apply_dev_blueprint(processed)
    if channel == "beta":
        return apply_beta_badge(processed)
    return processed.copy()


def emit_channel(master: Image.Image, channel: str) -> None:
    out = ICONS / channel
    out.mkdir(parents=True, exist_ok=True)
    for name, size in PNG_TARGETS.items():
        master.resize((size, size), Image.LANCZOS).save(out / name, pnginfo=AI_META)
    ico_base = master.resize((256, 256), Image.LANCZOS)
    ico_base.save(
        out / "icon.ico",
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
    )
    write_icns(make_icns_canvas(master), out / "icon.icns")


def main() -> None:
    source = Image.open(SOURCE)
    processed = remove_watermark(source)
    MASTER_OUT.parent.mkdir(parents=True, exist_ok=True)
    processed.save(MASTER_OUT, pnginfo=AI_META)
    for channel in CHANNELS:
        emit_channel(channel_master(processed, channel), channel)
        print(f"channel '{channel}' emitted")


if __name__ == "__main__":
    main()
