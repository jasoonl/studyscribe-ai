"""Regenerates the extension icons from the site's logo (client/public).

16 and 32 come from the favicon, which is drawn for small sizes; 48 and 128
are resized from logo.webp. Run with `npm run icons` after the logo changes.
"""
from pathlib import Path

from PIL import Image

here = Path(__file__).resolve().parent
public = here.parent.parent / "client" / "public"
out = here.parent / "static" / "icons"
out.mkdir(parents=True, exist_ok=True)

favicon = Image.open(public / "favicon.ico")
for size in (16, 32):
    favicon.size = (size, size)
    favicon.load()
    favicon.convert("RGBA").resize((size, size), Image.LANCZOS).save(out / f"icon-{size}.png")

logo = Image.open(public / "logo.webp").convert("RGBA")
for size in (48, 128):
    logo.resize((size, size), Image.LANCZOS).save(out / f"icon-{size}.png", optimize=True)

print("Wrote", ", ".join(sorted(p.name for p in out.glob("icon-*.png"))))
