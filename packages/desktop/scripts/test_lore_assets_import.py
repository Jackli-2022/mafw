from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
LORE = ROOT / "assets" / "brand" / "lore"


def test_source_masters_exist():
    for name in ("lore-pearl-1024.png", "lore-pearl-simplified-1024.png", "lore-monochrome-1024.png"):
        im = Image.open(LORE / "source" / name)
        assert im.size == (1024, 1024)
        assert im.mode == "RGBA"


def test_platform_exports_exist():
    ico = Image.open(LORE / "platform" / "windows" / "icon.ico")
    assert {(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)} <= set(ico.info["sizes"])
    assert (LORE / "platform" / "macos" / "icon.icns").read_bytes()[:4] == b"icns"
    assert (LORE / "platform" / "android" / "mipmap-anydpi-v26" / "ic_launcher.xml").exists()
    assert (LORE / "platform" / "android" / "values" / "colors.xml").read_text(encoding="utf-8").find("#1D1F25") >= 0
    assert (LORE / "platform" / "previews" / "four-platform.png").exists()
    assert (LORE / "platform" / "previews" / "android-adaptive.png").exists()
