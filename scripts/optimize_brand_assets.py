from pathlib import Path

from PIL import Image


ASSET_DIR = Path(__file__).resolve().parents[1] / "assets" / "images"
FILES = [
    "icon.png",
    "splash-icon.png",
    "favicon.png",
    "android-icon-foreground.png",
]


def optimize_png(path: Path) -> None:
    with Image.open(path) as source:
        image = source.convert("RGBA")
        image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        temporary_path = path.with_suffix(".optimized.png")
        image.save(temporary_path, format="PNG", optimize=True, compress_level=9)
    temporary_path.replace(path)


for filename in FILES:
    optimize_png(ASSET_DIR / filename)
