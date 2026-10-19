"""Places the REAL widget + Manage captures from the smoke run on a generated wallpaper, to show the
intended desktop arrangement (Xvfb has no wallpaper/compositor, so this is a composite, not an OS capture)."""
import sys, os
from PIL import Image, ImageDraw, ImageFilter
d = sys.argv[1]
W, H = 1920, 1080
bg = Image.new('RGB', (W, H)); px = ImageDraw.Draw(bg)
stops = [(0, (27, 42, 74)), (.30, (59, 79, 122)), (.55, (201, 139, 122)), (.62, (231, 169, 127)), (.63, (42, 59, 90)), (1, (22, 34, 58))]
for y in range(H):
    t = y / H
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if a <= t <= b:
            k = (t - a) / max(b - a, 1e-6); c = tuple(int(ca[i] + (cb[i] - ca[i]) * k) for i in range(3)); break
    px.line([(0, y), (W, y)], fill=c)
mtn = Image.new('RGBA', (W, H), (0, 0, 0, 0)); m = ImageDraw.Draw(mtn)
m.polygon([(0, 790), (200, 720), (380, 780), (560, 700), (760, 790), (940, 730), (1120, 800), (1320, 720), (1520, 780), (1720, 710), (1920, 770), (1920, 1080), (0, 1080)], fill=(42, 49, 86, 255))
m.polygon([(0, 900), (400, 860), (800, 890), (1300, 850), (1920, 880), (1920, 1080), (0, 1080)], fill=(20, 26, 48, 255))
bg = Image.alpha_composite(bg.convert('RGBA'), mtn)
def shadow(img, r=28, a=110):
    s = Image.new('RGBA', (img.width + r * 4, img.height + r * 4), (0, 0, 0, 0))
    ImageDraw.Draw(s).rounded_rectangle([r * 2, r * 2 + 12, r * 2 + img.width, r * 2 + img.height + 12], 18, fill=(0, 0, 0, a))
    return s.filter(ImageFilter.GaussianBlur(r))
man = Image.open(os.path.join(d, '02-manage-project-detail.png')).convert('RGBA')
wid = Image.open(os.path.join(d, '01-widget.png')).convert('RGBA')
mask = Image.new('L', man.size, 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, man.width - 1, man.height - 1], 12, fill=255)
man.putalpha(mask)
mx, my = 90, 70; wx, wy = W - wid.width - 60, 120
for img, x, y in ((wid, wx, wy), (man, mx, my)):
    sh = shadow(img); bg.alpha_composite(sh, (x - 56, y - 56)); bg.alpha_composite(img, (x, y))
bg.convert('RGB').save(os.path.join(d, '00-desktop-composite.png'))
