import { useEffect, useState } from 'react';
import type { Project, Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { CopyBtn } from './Copy';

/** Project description: visible to all; admins edit in Edit mode. */
export function ProjectDescription({ s, p, editable, compact }: { s: Snapshot; p: Project; editable: boolean; compact?: boolean }) {
  const canEdit = editable && s.me.role === 'admin';
  const [v, setV] = useState(p.notes ?? ''); const [open, setOpen] = useState(false);
  useEffect(() => { setV(p.notes ?? ''); }, [p.notes]);
  if (compact) {
    if (!p.notes) return null;
    return <div className={`wdesc nodrag ${open ? 'open' : ''}`} data-desc onClick={() => setOpen(!open)} title={open ? 'Collapse' : 'Show full description'}>
      <span className="wdesc-t">{p.notes}</span><span className="wdesc-x">{open ? '▴' : '▾'}</span></div>;
  }
  if (canEdit) return <div className="pdesc editing" data-desc>
    <div className="pdesc-h">Project description<CopyBtn text={p.notes} label="description" /></div>
    <textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== (p.notes ?? '')) void actions.setProjectNotes(p.id, v); }}
      placeholder="What is this project about? Goal, scope, links…" aria-label="Edit project description" rows={2} /></div>;
  if (!p.notes) return null;
  return <div className="pdesc" data-desc><div className="pdesc-h">Project description<CopyBtn text={p.notes} label="description" /></div><div className="pdesc-t">{p.notes}</div></div>;
}
