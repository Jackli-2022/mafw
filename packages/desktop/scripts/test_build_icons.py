"""Verification tests for the MAFW desktop icon build pipeline.

Run: python -m pytest test_build_icons.py -v
Requires the build to have been executed first: python build_icons.py
"""
from pathlib import Path

import pytest
from PIL import Image

ICONS = Path(__file__).resolve().parent.parent / "icons"
MASTER = ICONS / "master" / "app-icon-1024.png"
SOURCE = ICONS / "concepts" / "icon-concept-zhipu-2.png"
CHANNELS = ("prod", "dev", "beta")
CHANNEL_FILES = (
    "icon.png",
    "dock.png",
    "32x32.png",
    "64x64.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.ico",
    "icon.icns",
)
PNG_SIZES = {
    "icon.png": 512,
    "dock.png": 256,
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
}
ICO_SIZES = {(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)}
# "AI生成" watermark rect on the source image (located via ASCII luminance map;
# covers text AND the dark badge plate behind it; must match WM_BOX in
# build_icons.py)
WM_BOX = (884, 934, 1018, 1018)


def _bright_count(im: Image.Image) -> int:
    region = im.convert("RGB").crop(WM_BOX)
    return sum(
        1
        for r, g, b in region.getdata()
        if r > 170 and g > 170 and b > 170
    )


def test_master_processed_exists():
    assert MASTER.exists(), "run build_icons.py first"
    im = Image.open(MASTER)
    assert im.size == (1024, 1024)


def test_watermark_removed():
    assert _bright_count(Image.open(SOURCE)) > 0, "no watermark pixels in source"
    assert _bright_count(Image.open(MASTER)) == 0, "watermark still visible"


def test_all_channel_files_exist():
    for ch in CHANNELS:
        for f in CHANNEL_FILES:
            assert (ICONS / ch / f).exists(), f"{ch}/{f} missing"


@pytest.mark.parametrize("ch", CHANNELS)
@pytest.mark.parametrize("f,size", sorted(PNG_SIZES.items()))
def test_png_sizes(ch, f, size):
    im = Image.open(ICONS / ch / f)
    assert im.size == (size, size)
    assert im.mode == "RGBA"


@pytest.mark.parametrize("ch", CHANNELS)
def test_ico_frames(ch):
    ico = Image.open(ICONS / ch / "icon.ico")
    assert ICO_SIZES <= set(ico.info.get("sizes", set()))


def test_icns_valid():
    data = (ICONS / "prod" / "icon.icns").read_bytes()
    assert data[:4] == b"icns"
    total = int.from_bytes(data[4:8], "big")
    assert total == len(data)
    # walk entries: expect at least ic07(128) ic08(256) ic09(512) ic10(1024)
    types = set()
    off = 8
    while off + 8 <= len(data):
        etype = data[off:off + 4].decode("ascii", "replace")
        elen = int.from_bytes(data[off + 4:off + 8], "big")
        assert elen >= 8
        types.add(etype)
        off += elen
    assert {"ic07", "ic08", "ic09", "ic10"} <= types


def test_channels_visually_distinct():
    prod = (ICONS / "prod" / "icon.png").read_bytes()
    dev = (ICONS / "dev" / "icon.png").read_bytes()
    beta = (ICONS / "beta" / "icon.png").read_bytes()
    assert prod != dev
    assert prod != beta
    # beta: orange badge pixels in top-right corner
    beta_im = Image.open(ICONS / "beta" / "icon.png").convert("RGB")
    corner = beta_im.crop((beta_im.width - 200, 0, beta_im.width, 200))
    has_orange = any(
        r > 180 and 90 <= g <= 190 and b < 110
        for r, g, b in corner.getdata()
    )
    assert has_orange, "beta icon lacks orange badge in top-right"
    # dev: blueprint grid -> cyan-ish bright thin lines; compare channel-mean
    def mean_rgb(im):
        px = list(im.convert("RGB").getdata())
        n = len(px)
        return tuple(sum(c[i] for c in px) / n for i in range(3))

    dev_m, prod_m = mean_rgb(Image.open(ICONS / "dev" / "icon.png")), mean_rgb(
        Image.open(ICONS / "prod" / "icon.png")
    )
    assert dev_m[2] > prod_m[2], "dev icon should be blue-shifted vs prod"


@pytest.mark.parametrize("ch", CHANNELS)
def test_small_size_legible(ch):
    """32x32 face region must retain contrast (not washed out)."""
    im = Image.open(ICONS / ch / "32x32.png").convert("RGB")
    px = list(im.getdata())
    lums = [0.299 * r + 0.587 * g + 0.114 * b for r, g, b in px]
    assert max(lums) - min(lums) > 60, f"{ch} 32x32 too flat"
