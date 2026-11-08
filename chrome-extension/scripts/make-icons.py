"""Generates the robot icons (PNG) of the extension. Run: python scripts/make-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'assets' / 'icons'
GREEN, WHITE = (15, 111, 94, 255), (255, 255, 255, 255)

def icon(size):
    s = 512
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=112, fill=GREEN)
    d.rounded_rectangle((104, 176, 408, 400), radius=56, outline=WHITE, width=34)   # head
    d.line((256, 96, 256, 176), fill=WHITE, width=34)                                # antenna
    d.ellipse((228, 68, 284, 124), fill=WHITE)
    d.ellipse((168, 250, 222, 304), fill=WHITE)                                      # eyes
    d.ellipse((290, 250, 344, 304), fill=WHITE)
    d.rounded_rectangle((196, 334, 316, 360), radius=13, fill=WHITE)                 # mouth
    d.rounded_rectangle((52, 250, 86, 330), radius=17, fill=WHITE)                   # ears
    d.rounded_rectangle((426, 250, 460, 330), radius=17, fill=WHITE)
    return im.resize((size, size), Image.LANCZOS)

OUT.mkdir(parents=True, exist_ok=True)
for n in (16, 32, 48, 128):
    icon(n).save(OUT / f'icon{n}.png')
print('ok')
