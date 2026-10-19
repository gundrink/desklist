/** Desklist mark: rounded square, bronze/sand mark on a dark tile, checkmark + stacked list lines. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs><linearGradient id="dlg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e1d5c0" /><stop offset="1" stopColor="#ccbca3" /></linearGradient></defs>
      <rect x="2.5" y="2.5" width="59" height="59" rx="15" fill="#1c1d1c" stroke="#30302e" />
      <path d="M14 23l5 5 9-10" fill="none" stroke="url(#dlg)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="33" y="19" width="18" height="5" rx="2.5" fill="url(#dlg)" opacity=".95" />
      <rect x="14" y="34" width="37" height="5" rx="2.5" fill="url(#dlg)" opacity=".75" />
      <rect x="14" y="44" width="28" height="5" rx="2.5" fill="url(#dlg)" opacity=".55" />
    </svg>);
}
export function Logo({ size = 28 }: { size?: number }) {
  return <span className="dl-brand"><LogoMark size={size} /><span className="dl-word" style={{ fontSize: size * 0.64 }}>Desklist</span></span>;
}
