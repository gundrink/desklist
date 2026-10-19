"""0.6.9 color audit: rewrites chromatic hard-coded colors in renderer CSS to Standard Reserve tokens.
--report: list remaining saturated blue/teal/cyan/indigo/violet colors (exit 1 if any)."""
import re, sys, colorsys, glob, os
ROOT = os.path.join(os.path.dirname(__file__), '../src/renderer/src')
ALLOWED = {'95a9c4', '2c343e', '16202e'}  # soft blue (semantic info/selected) from the palette
TOK = {'bronze': ((204,188,163), 'var(--bronze)'), 'sage': ((150,174,159), 'var(--sage)'), 'yellow': ((224,196,120), 'var(--yellow)'), 'danger': ((190,18,60), 'var(--danger)')}
COL = re.compile(r'#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+%?)\s*)?\)')
def parse(m):
    if m.group(1):
        h = m.group(1)
        if len(h) in (3, 4): h = ''.join(c*2 for c in h)
        r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4)); a = int(h[6:8], 16)/255 if len(h) == 8 else None
        return (r, g, b), a, h[:6].lower()
    a = m.group(5); a = (float(a[:-1])/100 if a and a.endswith('%') else float(a)) if a else None
    rgb = tuple(int(m.group(i)) for i in (2, 3, 4)); return rgb, a, '%02x%02x%02x' % rgb
def classify(rgb):
    h, l, s = colorsys.rgb_to_hls(*(c/255 for c in rgb)); return h*360, l, s
def bluish(rgb, hexs):
    if hexs in ALLOWED: return False
    h, l, s = classify(rgb); return 160 <= h <= 300 and s >= 0.25 and (max(rgb) - min(rgb)) / 255 >= 0.12 and 0.08 < l < 0.97
def mapc(rgb, a, hexs):
    h, l, s = classify(rgb); chroma = (max(rgb) - min(rgb)) / 255
    if hexs in ALLOWED or hexs in ('f8f7f4', 'ccbca3', 'e1d5c0', '30302e', '96ae9f', 'aac1b3', '16221b', 'b0c49a', '242e1e', 'e0c478', '332a1a', 'be123c', '9f1239', 'fb7185', '0d0e0e', '151616', '1c1d1c', '22221f'): return None
    if s >= 0.25 and chroma >= 0.12 and 0.08 < l < 0.97:
        k = 'sage' if 75 <= h < 160 else 'yellow' if 20 <= h < 75 else 'danger' if (h >= 330 or h < 20) else 'bronze'
    elif 180 <= h <= 270 and chroma > 0.015:  # cold slate greys -> warm neutral, same lightness
        r, g, b = (round(c*255) for c in colorsys.hls_to_rgb(40/360, l, 0.05))
        return f'rgba({r},{g},{b},{a:g})' if a is not None else '#%02x%02x%02x' % (r, g, b)
    else: return None
    (r, g, b), var = TOK[k]
    if l > 0.82: return f'rgba({r},{g},{b},{0.14 if a is None else round(a*0.14, 3):g})'  # pastel tint -> faint token tint
    if l < 0.22: return f'rgba({r},{g},{b},{0.18 if a is None else round(a*0.18, 3):g})'  # deep shade -> faint token tint
    return f'rgba({r},{g},{b},{a:g})' if a is not None else var
files = [f for f in glob.glob(ROOT + '/styles/*.css')]
if '--report' in sys.argv:
    bad = []
    for f in files + glob.glob(ROOT + '/**/*.tsx', recursive=True) + glob.glob(ROOT + '/**/*.ts', recursive=True):
        for n, line in enumerate(open(f), 1):
            for m in COL.finditer(line):
                rgb, a, hx = parse(m)
                if bluish(rgb, hx): bad.append(f'{os.path.relpath(f, ROOT)}:{n}: {m.group(0)}')
            for m in re.finditer(r'\b(teal|blue|sky|cyan|indigo|violet)-\d{2,3}\b', line): bad.append(f'{os.path.relpath(f, ROOT)}:{n}: {m.group(0)}')
    print('\n'.join(bad) or 'no saturated blue/teal/cyan/indigo/violet colors remain'); sys.exit(1 if bad else 0)
n = 0
for f in files:
    src = open(f).read()
    def rep(m):
        global n
        rgb, a, hx = parse(m); out = mapc(rgb, a, hx)
        if out is None: return m.group(0)
        n += 1; return out
    # don't touch token definitions in v68/v69
    out = COL.sub(rep, src) if not f.endswith(('v68.css', 'v69.css')) else src
    open(f, 'w').write(out)
print('rewrote', n, 'colors')
