import { linkify } from '../../../common/linkify';

/** Display-only auto-linking: http(s)/www. URLs become links that open in the system browser (never navigate the window). */
export function Linkify({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return <>{linkify(text).map((t, i) => t.kind === 'text' ? <span key={i}>{t.text}</span>
    : <a key={i} className="alink" href={t.href} title={t.href} data-href={t.href}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void window.desklist.openExternal(t.href); }}>{t.text}</a>)}</>;
}
