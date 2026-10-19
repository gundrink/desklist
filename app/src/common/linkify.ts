/** Split plain text into text + http(s)/www. link tokens. Trailing punctuation is not part of a link; only http/https are ever produced. */
export type LinkToken = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };
const RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAIL = /[.,;:!?)\]}'"»”’]+$/;
export function safeHref(raw: string): string | null {
  const href = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try { const u = new URL(href); return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null; } catch { return null; }
}
export function linkify(text: string): LinkToken[] {
  const out: LinkToken[] = []; let last = 0;
  for (const m of text.matchAll(RE)) {
    let url = m[0]; const start = m.index ?? 0;
    // keep balanced ")" (e.g. wiki links), strip other trailing punctuation
    while (TRAIL.test(url)) { const ch = url.slice(-1); if (ch === ')' && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break; url = url.slice(0, -1); }
    const href = safeHref(url); if (!href) continue;
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
    out.push({ kind: 'link', text: url, href }); last = start + url.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}
