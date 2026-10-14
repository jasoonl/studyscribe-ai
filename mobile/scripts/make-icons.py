"""Builds the app's icons and splash image from the web's logo assets.

    python3 mobile/scripts/make-icons.py   (from the repo root; needs Pillow)

- assets/images/icon.png             1024x1024 opaque (iOS rejects transparency): the mark on white,
                                     cut from desktop/build/icon.png, which has it at full resolution.
- assets/images/adaptive-icon.png    Android adaptive foreground: the mark inside the 66% safe zone, transparent.
- assets/images/adaptive-mono.png    Android 13 themed (monochrome) icon.
- assets/images/splash-icon.png      the mark on transparent, shown centred on the splash background.
- assets/images/logo.png             the mark for in-app use (auth screens).
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "mobile" / "assets" / "images"
OUT.mkdir(parents=True, exist_ok=True)

desktop = Image.open(ROOT / "desktop" / "build" / "icon.png").convert("RGBA")
mark_small = Image.open(ROOT / "client" / "public" / "logo.webp").convert("RGBA")

# The mark inside the desktop icon's white plate: everything clearly not white.
plate = desktop.crop((150, 150, 874, 874))
pixels = plate.load()
xs, ys = [], []
for y in range(plate.height):
    for x in range(plate.width):
        r, g, b, a = pixels[x, y]
        if a > 200 and min(r, g, b) < 225:
            xs.append(x)
            ys.append(y)
box = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
mark = plate.crop(box)

# iOS / store icon: opaque white square, mark about 64% of the width.
icon = Image.new("RGBA", (1024, 1024), (255, 255, 255, 255))
scale = 0.64 * 1024 / max(mark.size)
resized = mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.LANCZOS)
icon.alpha_composite(resized, ((1024 - resized.width) // 2, (1024 - resized.height) // 2))
icon.convert("RGB").save(OUT / "icon.png")

def centred(source: Image.Image, canvas: int, fraction: float) -> Image.Image:
    bbox = source.getbbox()
    cropped = source.crop(bbox)
    factor = fraction * canvas / max(cropped.size)
    scaled = cropped.resize((round(cropped.width * factor), round(cropped.height * factor)), Image.LANCZOS)
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.alpha_composite(scaled, ((canvas - scaled.width) // 2, (canvas - scaled.height) // 2))
    return out

centred(mark_small, 1024, 0.56).save(OUT / "adaptive-icon.png")
mono = centred(mark_small, 1024, 0.56)
alpha = mono.getchannel("A")
Image.merge("RGBA", (alpha.point(lambda _: 255), alpha.point(lambda _: 255), alpha.point(lambda _: 255), alpha)).save(OUT / "adaptive-mono.png")
centred(mark_small, 512, 0.9).save(OUT / "splash-icon.png")
centred(mark_small, 256, 1.0).save(OUT / "logo.png")
Image.new("RGB", (48, 48), (255, 255, 255)).save(OUT / "favicon.png") if not (OUT / "favicon.png").exists() else None
mark_small.resize((48, 48), Image.LANCZOS).save(OUT / "favicon.png")
print("wrote", sorted(p.name for p in OUT.iterdir()))
