import { useState } from 'react';
import type { Project, Snapshot } from '@desklist/shared';
import { picOf, statusOf, statusStyle, tasksOf } from '../lib/model';

/** ~13px circular pie: done/total. */
export function Pie({ done, total, size = 13 }: { done: number; total: number; size?: number }) {
  const f = total ? done / total : 0; const r = size / 2; const c = 2 * Math.PI * (r / 2);
  return (
    <svg className="pie" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${done} of ${total}`}>
      <circle cx={r} cy={r} r={r - 0.75} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <circle className="pie-fill" cx={r} cy={r} r={r / 2} fill="none" stroke="currentColor" strokeWidth={r} strokeDasharray={`${f * c} ${c}`} transform={`rotate(-90 ${r} ${r})`} />
    </svg>
  );
}
export const isDoneProject = (s: Snapshot, p: Project) => { const t = tasksOf(s, p.id); return statusOf(s, p) === 'Done' || (t.all.length > 0 && t.open.length === 0); };

export function useProjectTabs(s: Snapshot) {
  const [tab, setTab] = useState<'progress' | 'done'>('progress');
  const done = s.projects.filter((p) => isDoneProject(s, p)); const prog = s.projects.filter((p) => !isDoneProject(s, p));
  return { tab, setTab, list: tab === 'done' ? done : prog, prog, done };
}
export function ProjTabs({ t, theme }: { t: ReturnType<typeof useProjectTabs>; theme: 'dark' | 'light' }) {
  return (
    <div className={`ptabs ${theme} idx-${t.tab === 'done' ? 1 : 0}`} role="tablist">
      <button role="tab" className={t.tab === 'progress' ? 'on' : ''} onClick={() => t.setTab('progress')}>In progress <em>{t.prog.length}</em></button>
      <button role="tab" className={t.tab === 'done' ? 'on' : ''} onClick={() => t.setTab('done')}>Done <em>{t.done.length}</em></button>
    </div>
  );
}
/** Compact rail item (widget): status mark, name, pie, 7/12. */
export function RailItem({ s, p, selected, onClick }: { s: Snapshot; p: Project; selected: boolean; onClick: () => void }) {
  const t = tasksOf(s, p.id); const st = statusStyle(statusOf(s, p));
  return (
    <button className={`ri v6 ${selected ? 'sel' : ''}`} onClick={onClick} data-project={p.name} title={p.name}>
      <span className={`smark ${st.cls}`} /><span className="rn">{p.name}</span><Pie done={t.done.length} total={t.all.length} /><span className="rc">{t.done.length}/{t.all.length}</span>
    </button>
  );
}
export { picOf };
