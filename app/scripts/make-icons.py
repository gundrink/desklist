"""0.6.8 icons: dark tile with a bronze/sand check + list mark. Run: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw
def grad(s, a=(0xe1,0xd5,0xc0), b=(0xcc,0xbc,0xa3)):
    g = Image.new('RGBA', (s, s)); d = ImageDraw.Draw(g)
    for y in range(s):
        t = y/s; d.line([(0,y),(s,y)], fill=tuple(int(a[i]+(b[i]-a[i])*t) for i in range(3))+(255,))
    return g
def icon(size, bg=True, color=None):
    s = size*4; im = Image.new('RGBA', (s, s), (0,0,0,0))
    if bg:
        tile = Image.new('RGBA', (s, s), (0,0,0,0)); ImageDraw.Draw(tile).rounded_rectangle([0,0,s-1,s-1], int(s*0.23), fill=(0x1c,0x1d,0x1c,255), outline=(0x30,0x30,0x2e,255), width=max(1,s//64))
        im = tile
    m = Image.new('L', (s, s), 0); d = ImageDraw.Draw(m); w = max(2, int(s*0.075)); r = w//2
    d.line([(s*.22,s*.36),(s*.30,s*.44),(s*.44,s*.28)], fill=255, width=w, joint='curve')
    for (x1,y,op) in ((.52,.33,255),(.22,.55,200),(.22,.72,150)):
        x2 = .78 if y < .7 else .64
        d.rounded_rectangle([s*x1, s*y-r, s*x2, s*y+r], r, fill=op)
    fill = grad(s) if color is None else Image.new('RGBA', (s, s), color)
    im.paste(fill, (0,0), m)
    return im.resize((size,size), Image.LANCZOS)
icon(1024).save('build/icon.png'); icon(512).save('resources/icon.png')
icon(256).save('build/icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
icon(32).save('resources/tray.png')
icon(22, bg=False, color=(0,0,0,255)).save('resources/trayTemplate.png'); icon(44, bg=False, color=(0,0,0,255)).save('resources/trayTemplate@2x.png')
