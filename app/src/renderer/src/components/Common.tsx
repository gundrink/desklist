import type { Member, Project, Snapshot } from '@desklist/shared';
import { initialsOf, shortDate, shortName, statusOf, statusStyle, member } from '../lib/model';
import { Check } from './Icons';

const AV: Record<string, string> = {
  AD: 'linear-gradient(135deg,#e1d5c0,#ccbca3)', BS: 'linear-gradient(135deg,#f59e0b,#f97316)',
  CK: 'linear-gradient(135deg,#ec4899,#f43f5e)', RH: 'linear-gradient(135deg,#14b8a6,#0ea5e9)',
};
const PALETTE = ['linear-gradient(135deg,#14b8a6,#0ea5e9)', 'linear-gradient(135deg,#22c55e,#16a34a)', 'linear-gradient(135deg,#0ea5e9,#6366f1)',
  'linear-gradient(135deg,#a855f7,#ec4899)', 'linear-gradient(135deg,#f97316,#ef4444)', 'linear-gradient(135deg,#64748b,#334155)'];
export function avatarBg(initials: string) {
  if (AV[initials]) return AV[initials];
  let h = 0; for (const c of initials) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function Avatar({ initials, size = 'sm', title }: { initials: string; size?: 'xs' | 'sm' | 'md'; title?: string }) {
  return <span className={`av ${size}`} style={{ background: avatarBg(initials) }} title={title}>{initials}</span>;
}

export function StatusPill({ status, theme }: { status: string; theme: 'dark' | 'light' }) {
  const st = statusStyle(status);
  return <span className={theme === 'dark' ? `gp ${st.cls}` : `lpill ${st.cls}`}>{status}</span>;
}

export function CheckBox({ done, onClick, theme, label }: { done: boolean; onClick: () => void; theme: 'dark' | 'light'; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={done} aria-label={label} className={`cbx ${theme} ${done ? 'd' : ''}`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {done && <Check size={10} />}
    </button>
  );
}

/** "Checked by Andi D. · 9 Oct" — the checker is the approver (recorded server-side from the token). */
export function checkedBy(s: Snapshot, approvedBy: string | null, approvedAt: string | null): { m?: Member; text: string } {
  const m = member(s, approvedBy);
  return { m, text: m ? `${shortName(m.name)} · ${shortDate(approvedAt)}` : approvedAt ? shortDate(approvedAt) : '' };
}

export function SyncDot({ connection }: { connection: string }) {
  return <i className={`syncdot ${connection}`} />;
}
export function syncLabel(connection: string, pending: number, ago: string) {
  if (connection === 'offline') return pending ? `Offline · ${pending} change${pending > 1 ? 's' : ''} queued` : 'Offline · cached';
  if (connection === 'connecting') return 'Connecting…';
  return pending ? `Syncing ${pending}…` : `Synced · ${ago}`;
}

export function projectColor(s: Snapshot, p: Project) { return statusStyle(statusOf(s, p)).color; }
export { initialsOf };
