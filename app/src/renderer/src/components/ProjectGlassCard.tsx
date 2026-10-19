import { Popover } from './Popover';
import { useState, useRef } from 'react';
import type { Project, Snapshot } from '@desklist/shared';
import { formatAmount, convert } from '@desklist/shared';
import { picOf, statusOf, tasksOf, shortDate } from '../lib/model';
import { actions } from '../lib/store';
import { StatusPill, CheckBox } from './Common';
import { Pie } from './ProjectList';

/** Compact project card (Manage project column): name, pie + 7/12, status, PIC; the selected card previews open tasks. */
export function ProjectGlassCard({ s, p, selected, expanded, onSelect, onMenu, menuItems }: {
  s: Snapshot; p: Project; selected?: boolean; expanded?: boolean; onSelect: () => void; onMenu?: (e: React.MouseEvent) => void;
  menuItems?: { label: string; danger?: boolean; onClick: () => void }[];
}) {
  const [mopen, setMopen] = useState(false); const mbtn = useRef<HTMLButtonElement>(null);
  const { all, open, done } = tasksOf(s, p.id);
  const status = statusOf(s, p);
  const pic = picOf(s, p);
  const preview = open.slice(0, 2);
  const pend = s.reimbursements.filter((r) => r.projectId === p.id && !r.reimbursed);
  const sum = pend.reduce((a, r) => a + (convert(r.amount, r.currency, s.currency, s.prices) ?? 0), 0);
  return (
    <div className={`gcard v6 ${selected ? 'sel' : ''}`} onClick={onSelect} role="button" tabIndex={0} data-project={p.name}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}>
      <div className="g1">
        <span className="gsq" />
        <span className="gname">{p.name}</span>
        <Pie done={done.length} total={all.length} /><span className="gcount">{done.length}/{all.length}</span>
        {(onMenu || menuItems) && <button ref={mbtn} className="gmenu" title="Project menu" aria-label={`Project menu ${p.name}`} onClick={(e) => { e.stopPropagation(); if (menuItems) setMopen(!mopen); else onMenu?.(e); }}>⋯</button>}
        {mopen && menuItems && <Popover anchor={mbtn} className="pmenu-pop gpop" onClose={() => setMopen(false)}>
          {menuItems.map((m) => <button key={m.label} role="menuitem" className={`pi ${m.danger ? 'danger-item' : ''}`} onClick={() => { setMopen(false); m.onClick(); }}>{m.label}</button>)}</Popover>}
      </div>
      <div className="g3">
        <StatusPill status={status} theme="dark" />
        {pic && <span className="ell">PIC: <b>{pic}</b></span>}
        {p.deadline && <span className="gdl">Due {shortDate(p.deadline)}</span>}
      </div>
      {expanded && open.length > 0 && (
        <>
          <div className="gsec">Open · {open.length}</div>
          {preview.map((t) => (
            <div className="mt" key={t.id}>
              <CheckBox theme="dark" done={false} label={t.title} onClick={() => actions.toggleTask(t)} />
              <span className="t">{t.title}</span>
            </div>
          ))}
          {open.length > preview.length && <div className="mmore">+{open.length - preview.length} more</div>}
        </>
      )}
      {expanded && <div className="g4">{p.hasExpenses ? `Has expenses${pend.length ? ` · ${formatAmount(sum, s.currency)} pending` : ''}` : 'No expenses'}</div>}
    </div>
  );
}
