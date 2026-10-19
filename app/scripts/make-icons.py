"""Generates app + tray icons (teal rounded square with a check mark). Run: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw
def icon(size, bg=True, color=(255,255,255,255)):
    s = size * 4
    im = Image.new('RGBA', (s, s), (0,0,0,0)); d = ImageDraw.Draw(im)
    if bg:
        r = int(s*0.22)
        for y in range(s):  # vertical teal gradient
            t = y / s; c = (int(45+(15-45)*t), int(212+(118-212)*t), int(191+(110-191)*t), 255)
            d.line([(0,y),(s,y)], fill=c)
        mask = Image.new('L', (s, s), 0); ImageDraw.Draw(mask).rounded_rectangle([0,0,s-1,s-1], r, fill=255)
        im.putalpha(mask)
    w = max(2, int(s*0.11))
    d.line([(s*0.28,s*0.52),(s*0.44,s*0.68),(s*0.74,s*0.34)], fill=color, width=w, joint='curve')
    return im.resize((size,size), Image.LANCZOS)
icon(1024).save('build/icon.png'); icon(512).save('resources/icon.png')
icon(32).save('resources/tray.png')
# macOS template image: black glyph + alpha, no background
icon(22, bg=False, color=(0,0,0,255)).save('resources/trayTemplate.png'); icon(44, bg=False, color=(0,0,0,255)).save('resources/trayTemplate@2x.png')
