import type { Project, Snapshot } from '@desklist/shared';
import { picOf, statusOf, statusStyle, tasksOf } from '../lib/model';
import { actions } from '../lib/store';
import { StatusPill, CheckBox } from './Common';

/** Mini version of the glass widget — used in the Manage project list AND the widget's "All projects" view. */
export function ProjectGlassCard({ s, p, selected, expanded, onSelect, onMenu }: {
  s: Snapshot; p: Project; selected?: boolean; expanded?: boolean; onSelect: () => void; onMenu?: (e: React.MouseEvent) => void;
}) {
  const { all, open, done, pct } = tasksOf(s, p.id);
  const status = statusOf(s, p);
  const color = statusStyle(status).color;
  const pic = picOf(s, p);
  const preview = open.slice(0, 2);
  return (
    <div className={`gcard ${selected ? 'sel' : ''}`} onClick={onSelect} role="button" tabIndex={0} data-project={p.name}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}>
      <div className="g1">
        <span className="gdot" style={{ background: color }} />
        <span className="gname">{p.name}</span>
        {p.isDemo && <span className="demo-tag" title="Seeded demo data">demo</span>}
        {onMenu && <button className="gmenu" title="Project menu" onClick={(e) => { e.stopPropagation(); onMenu(e); }}>⋯</button>}
      </div>
      <div className="g2"><span><b>{done.length} of {all.length}</b> done</span><span>{pct}%</span></div>
      <div className="gbar"><i style={{ width: `${pct}%`, background: color }} /></div>
      <div className="g3">
        <StatusPill status={status} theme="dark" />
        {pic && <><span className="gsep" /><span className="ell">PIC: <b>{pic}</b></span></>}
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
    </div>
  );
}
