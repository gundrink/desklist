/** WCAG contrast audit run inside a page: every visible text node + svg icon vs. its effective (composited) background. */
export const CONTRAST_AUDIT = (base = [13, 14, 14]) => {
  const parse = (s) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s || ''); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
  const gradColor = (img) => { if (!img || img === 'none') return null; const m = /rgba?\([^)]*\)/.exec(img); return m ? parse(m[0]) : null; };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => { const layers = []; let opac = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); opac *= +cs.opacity;
      const g = gradColor(cs.backgroundImage); if (g && g[3] > 0) layers.push(g); const c = parse(cs.backgroundColor); if (c && c[3] > 0) layers.push(c);
      if (c && c[3] >= 1) break; }
    let col = [...base, 1]; for (let i = layers.length - 1; i >= 0; i--) col = over(layers[i], col); return { col, opac }; };
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const disabled = (el) => !!el.closest(':disabled,[aria-disabled="true"],.disabled');
  const fails = []; let n = 0;
  const test = (el, colorStr, kind) => {
    if (el.matches?.('input[type=checkbox],input[type=radio],input[type=range]')) return; /* no text: indicator drawn by ::after / thumb */
    const fg = parse(colorStr); if (!fg) return; const { col, opac } = bgOf(el); if (opac < 0.1) return; /* hidden until hover */ const f = over([fg[0], fg[1], fg[2], fg[3] * opac], col);
    const cs = getComputedStyle(el); const size = parseFloat(cs.fontSize); const large = size >= 18 || (size >= 14 && +cs.fontWeight >= 700);
    const need = kind === 'icon' || large || disabled(el) ? 3 : 4.5; const r = ratio(f, col); n++;
    const dim = r >= need ? "" : (() => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) if (+getComputedStyle(e).opacity < 1) return ` [opacity ${getComputedStyle(e).opacity} on .${String(e.className?.baseVal ?? e.className).split(' ')[0]}]`; return ''; })();
    if (r < need) fails.push(dim + `${kind} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" .${String(el.className?.baseVal ?? el.className).split(' ')[0]} ${r.toFixed(2)}<${need} fg ${f.slice(0, 3).map(Math.round)} bg ${col.slice(0, 3).map(Math.round)}`);
  };
  for (const el of document.querySelectorAll('body *')) {
    if (['SCRIPT', 'STYLE'].includes(el.tagName) || !vis(el)) continue;
    if (el.tagName === 'svg') { if (!el.closest('button,a,[role=button],.tfic')) continue; const cs = getComputedStyle(el); test(el, cs.stroke !== 'none' && parse(cs.stroke) ? cs.stroke : cs.color, 'icon'); continue; }
    if ([...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) test(el, getComputedStyle(el).color, 'text');
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.value) test(el, getComputedStyle(el).color, 'text');
  }
  return { n, fails };
};

/** Composited background + text contrast of one element (for hover checks). */
export const LOOK = (el, base = [13, 14, 14]) => {
  const parse = (s) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s || ''); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
  const over = (t, b) => [t[0] * t[3] + b[0] * (1 - t[3]), t[1] * t[3] + b[1] * (1 - t[3]), t[2] * t[3] + b[2] * (1 - t[3]), 1];
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const layers = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
  let col = [...base, 1]; for (let i = layers.length - 1; i >= 0; i--) col = over(layers[i], col);
  const tEl = [el, ...el.querySelectorAll('*')].find((x) => [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) || el;
  const fg = over(parse(getComputedStyle(tEl).color), col); const a = lum(fg), b = lum(col);
  return { bg: col.slice(0, 3).map(Math.round), lum: b, contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
};
