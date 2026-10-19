"""0.6.10: legacy light-theme neutrals -> dark tokens (property aware). Light surfaces -> --surface*, dark text -> --text/--muted, light borders -> --border."""
import re, glob, os, colorsys
ROOT = os.path.join(os.path.dirname(__file__), '../src/renderer/src/styles')
COL = re.compile(r'#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)')
def rgb(m):
    if m.group(1):
        h = m.group(1); h = ''.join(c*2 for c in h) if len(h) == 3 else h
        return tuple(int(h[i:i+2], 16) for i in (0, 2, 4)), None
    return tuple(int(m.group(i)) for i in (2, 3, 4)), (float(m.group(5)) if m.group(5) else None)
def neutral(c): return (max(c) - min(c)) / 255 < 0.1
n = 0
for f in glob.glob(ROOT + '/*.css'):
    if f.endswith(('v68.css', 'v69.css')): continue
    src = open(f).read()
    def decl(m):
        global n
        prop, val = m.group(1), m.group(2)
        def rep(cm):
            global n
            c, a = rgb(cm)
            if not neutral(c): return cm.group(0)
            l = colorsys.rgb_to_hls(*(x/255 for x in c))[1]
            if a is not None and a < 0.5 and l < 0.2 and prop.startswith('background'): out = 'rgba(255,255,255,%g)' % min(0.06, a)   # dark veil -> light veil
            elif a is not None and a < 0.5 and prop.startswith('border') and l < 0.3: out = 'var(--border)'
            elif a is not None: return cm.group(0)
            elif prop in ('background', 'background-color'):
                out = 'var(--surface)' if l > 0.93 else 'var(--surface-2)' if l > 0.8 else cm.group(0)
            elif prop == 'color' or prop == 'fill' or prop == 'stroke':
                out = 'var(--text)' if l < 0.3 else 'var(--muted)' if l < 0.75 else cm.group(0)
            elif prop.startswith('border') or prop == 'outline' or prop == 'box-shadow':
                out = 'var(--border)' if l > 0.75 else 'var(--border-2)' if l < 0.3 and prop.startswith('border') else cm.group(0)
            else: return cm.group(0)
            if out != cm.group(0): n += 1
            return out
        return f'{prop}:{COL.sub(rep, val)}'
    out = re.sub(r'(?<![\w-])(background-color|background|color|fill|stroke|border(?:-top|-bottom|-left|-right)?(?:-color)?|outline|box-shadow)\s*:\s*([^;}]+)', decl, src)
    open(f, 'w').write(out)
print('rewrote', n, 'neutral colors')
