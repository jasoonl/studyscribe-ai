"""Builds desktop/build/icon.png (1024x1024), from which electron-builder makes
the macOS .icns, the Windows .ico and the Linux icons.

The source is the large logo in scripts/demo-video/v2/assets/logo.webp (white
background). It is placed on a rounded square inside Apple's icon grid: an
824px tile with 100px of transparent margin, so the Dock shows it at the same
size as other apps.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

here = Path(__file__).resolve().parent
repo = here.parent.parent
source = Image.open(repo / "scripts" / "demo-video" / "v2" / "assets" / "logo.webp").convert("RGBA")

size, tile, radius = 1024, 824, 186
margin = (size - tile) // 2

logo = source.resize((tile, tile), Image.LANCZOS)
background = Image.new("RGBA", (tile, tile), (255, 255, 255, 255))
background.alpha_composite(logo)

mask = Image.new("L", (tile * 4, tile * 4), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, tile * 4 - 1, tile * 4 - 1), radius=radius * 4, fill=255)
mask = mask.resize((tile, tile), Image.LANCZOS)

icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
# A soft shadow under the tile, as macOS icons have.
shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
shadow_mask = Image.new("L", (size, size), 0)
shadow_mask.paste(mask, (margin, margin + 12))
shadow.putalpha(shadow_mask.point(lambda a: int(a * 0.22)))
icon.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
tile_image = Image.new("RGBA", (tile, tile), (0, 0, 0, 0))
tile_image.paste(background, (0, 0), mask)
icon.alpha_composite(tile_image, (margin, margin))

out = here.parent / "build"
out.mkdir(exist_ok=True)
icon.save(out / "icon.png", optimize=True)
print("Wrote build/icon.png")
