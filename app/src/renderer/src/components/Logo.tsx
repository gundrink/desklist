/** Desklist mark: rounded square, indigo→violet gradient, checkmark + stacked list lines. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs><linearGradient id="dlg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6366f1" /><stop offset="1" stopColor="#8b5cf6" /></linearGradient></defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#dlg)" />
      <path d="M14 23l5 5 9-10" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="33" y="19" width="18" height="5" rx="2.5" fill="#fff" opacity=".95" />
      <rect x="14" y="34" width="37" height="5" rx="2.5" fill="#fff" opacity=".75" />
      <rect x="14" y="44" width="28" height="5" rx="2.5" fill="#fff" opacity=".55" />
    </svg>);
}
export function Logo({ size = 28 }: { size?: number }) {
  return <span className="dl-brand"><LogoMark size={size} /><span className="dl-word" style={{ fontSize: size * 0.64 }}>Desklist</span></span>;
}
