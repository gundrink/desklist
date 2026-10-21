import { useState } from 'react';
import type { Member, Project, Snapshot } from '@desklist/shared';
import { initialsOf, shortDate, shortName, statusOf, statusStyle, member } from '../lib/model';
import { Check } from './Icons';

// Standard Reserve muted tiles (dark initials via CSS)
const AV: Record<string, string> = { AD: 'linear-gradient(135deg,#e1d5c0,#ccbca3)' };
const PALETTE = ['linear-gradient(135deg,#e1d5c0,#ccbca3)', 'linear-gradient(135deg,#aac1b3,#96ae9f)', 'linear-gradient(135deg,#c9d4b8,#b0c49a)',
  'linear-gradient(135deg,#ead7a0,#e0c478)', 'linear-gradient(135deg,#d8d2c6,#bdb6a8)', 'linear-gradient(135deg,#b9c3cf,#95a9c4)'];
export function avatarBg(initials: string) {
  if (AV[initials]) return AV[initials];
  let h = 0; for (const c of initials) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** 0.6.14: shows the member's profile photo when set, initials otherwise (and if the image fails). */
export function Avatar({ initials, size = 'sm', title, url }: { initials: string; size?: 'xs' | 'sm' | 'md' | 'lg'; title?: string; url?: string | null }) {
  const [bad, setBad] = useState(false);
  if (url && !bad) return <span className={`av ${size} photo`} title={title} data-avatar="photo"><img src={url} alt="" draggable={false} onError={() => setBad(true)} /></span>;
  return <span className={`av ${size}`} style={{ background: avatarBg(initials) }} title={title}>{initials}</span>;
}
export const avatarOf = (s: Snapshot, id: string | null | undefined) => (id ? s.members.find((m) => m.id === id)?.avatarUrl ?? null : null);
export const avatarByName = (s: Snapshot, name: string | null | undefined) => { const n = (name ?? '').trim().toLowerCase(); return n ? s.members.find((m) => m.name.trim().toLowerCase() === n)?.avatarUrl ?? null : null; };

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
export function checkedBy(s: Snapshot, approvedBy: string | null, approvedAt: string | null, formerName?: string | null): { m?: Member; text: string } {
  const m = member(s, approvedBy);
  return { m, text: m ? `${shortName(m.name)} · ${shortDate(approvedAt)}` : formerName ? `${shortName(formerName)} (removed) · ${shortDate(approvedAt)}` : approvedAt ? shortDate(approvedAt) : '' };
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
