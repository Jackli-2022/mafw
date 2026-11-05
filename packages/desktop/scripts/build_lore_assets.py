"""Copy Lore avatars from the generated pack and derive tray/favicon assets.

The avatar pack (15 sizes × circle/transparent) is user-generated; use exact
assets rather than upscaling. Tray and favicon are derived from the source
masters/platform exports.
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
AVATAR_PACK = LORE / "avatar"

PACK_SIZES = (16, 20, 24, 28, 32, 40, 48, 64, 80, 96, 128, 160, 256, 512, 1024)
UI_CIRCLE = ((20, "lead-avatar-20.png"),)
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
    out_circle = EXPORT / "avatar" / "circle"
    out_transparent = EXPORT / "avatar" / "transparent"
    out_circle.mkdir(parents=True, exist_ok=True)
    out_transparent.mkdir(parents=True, exist_ok=True)
    RENDERER.mkdir(parents=True, exist_ok=True)

    for size in PACK_SIZES:
        shutil.copyfile(
            AVATAR_PACK / "circle" / f"Lore_avatar_{size}.png",
            out_circle / f"Lore_avatar_{size}.png",
        )
        shutil.copyfile(
            AVATAR_PACK / "transparent" / f"Lore_avatar_transparent_{size}.png",
            out_transparent / f"Lore_avatar_transparent_{size}.png",
        )

    for size, name in UI_CIRCLE:
        shutil.copyfile(AVATAR_PACK / "circle" / f"Lore_avatar_{size}.png", RENDERER / name)
    print("avatars: pack 16..1024 (circle/transparent) + UI 20 circle")


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
