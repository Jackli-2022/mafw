"""Derive Lore avatar, tray, and favicon assets.

Source masters live in assets/brand/lore/source/; the platform pack is read-only.
Avatars always use the simplified base (no thread/tag) so a circular crop is safe.
"""

from pathlib import Path
import shutil

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
LORE = ROOT / "assets" / "brand" / "lore"
SOURCE = LORE / "source"
EXPORT = LORE / "export"
RENDERER = ROOT / "packages" / "desktop" / "src" / "renderer" / "mafw" / "assets" / "lore"
PLATFORM_WINDOWS = LORE / "platform" / "windows"

AVATAR_SIZES = (512, 256, 128, 96, 64)
TRAY_BASES = (16, 20, 24, 32)


def square_crop(im: Image.Image, pad_ratio: float) -> Image.Image:
    """Crop a square around the alpha bbox, with padding, clamped to the image."""
    bbox = im.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("source image has no opaque pixels")
    left, top, right, bottom = bbox
    width, height = right - left, bottom - top
    side = round(max(width, height) * (1 + 2 * pad_ratio))
    cx = (left + right) // 2
    cy = (top + bottom) // 2
    x0 = cx - side // 2
    y0 = cy - side // 2
    x1 = x0 + side
    y1 = y0 + side

    # Clamp while keeping the square size; shift the window back inside the image.
    if x0 < 0:
        x1 -= x0
        x0 = 0
    if y0 < 0:
        y1 -= y0
        y0 = 0
    if x1 > im.width:
        x0 -= x1 - im.width
        x1 = im.width
    if y1 > im.height:
        y0 -= y1 - im.height
        y1 = im.height

    return im.crop((x0, y0, x1, y1))


def monochrome_silhouette(im: Image.Image) -> Image.Image:
    """White silhouette with transparent eye holes, derived from the pearl alpha."""
    cropped = square_crop(im.convert("RGBA"), 0.04)
    alpha = cropped.getchannel("A").copy()
    width, height = cropped.size
    x_min, x_max = int(width * 0.18), int(width * 0.82)
    y_min, y_max = int(height * 0.18), int(height * 0.82)
    for y in range(y_min, y_max):
        for x in range(x_min, x_max):
            r, g, b, a = cropped.getpixel((x, y))
            if a > 200 and r < 80 and g < 80 and b < 80:
                alpha.putpixel((x, y), 0)
    out = Image.new("RGBA", cropped.size, (255, 255, 255, 0))
    out.putalpha(alpha)
    return out


def emit_avatars() -> None:
    source = Image.open(SOURCE / "lore-pearl-simplified-1024.png").convert("RGBA")
    cropped = square_crop(source, 0.08)
    avatar_dir = EXPORT / "avatar"
    avatar_dir.mkdir(parents=True, exist_ok=True)
    RENDERER.mkdir(parents=True, exist_ok=True)
    for size in AVATAR_SIZES:
        avatar = cropped.resize((size, size), Image.LANCZOS)
        out = avatar_dir / f"lore-avatar-{size}.png"
        avatar.save(out, format="PNG")
        shutil.copyfile(out, RENDERER / f"lead-avatar-{size}.png")
    print(f"avatars: {', '.join(str(s) for s in AVATAR_SIZES)}")


def emit_tray() -> None:
    source = Image.open(SOURCE / "lore-pearl-simplified-1024.png")
    mono = monochrome_silhouette(source)
    tray_dir = EXPORT / "tray"
    tray_dir.mkdir(parents=True, exist_ok=True)
    for base in TRAY_BASES:
        for suffix, size in ((".png", base), ("@2x.png", base * 2)):
            mono.resize((size, size), Image.LANCZOS).save(tray_dir / f"loreTemplate-{base}{suffix}", format="PNG")
    print("tray: 16/20/24/32 + @2x")


def emit_favicon() -> None:
    favicon_dir = EXPORT / "favicon"
    favicon_dir.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48):
        shutil.copyfile(PLATFORM_WINDOWS / f"Lore_{size}.png", favicon_dir / f"favicon-{size}.png")
    base = Image.open(PLATFORM_WINDOWS / "Lore_48.png").convert("RGBA")
    base.save(favicon_dir / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print("favicon: 16/32/48 + ico")


def main() -> None:
    emit_avatars()
    emit_tray()
    emit_favicon()


if __name__ == "__main__":
    main()
