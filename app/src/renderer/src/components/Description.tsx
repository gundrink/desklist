import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Project, Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { CopyBtn } from './Copy';
import { Linkify } from './Linkify';

/** Project description: read-only formatted text (clamped, Show more); admins switch to an auto-growing editor. */
export function ProjectDescription({ s, p, editable, compact }: { s: Snapshot; p: Project; editable: boolean; compact?: boolean }) {
  const canEdit = editable && s.me.role === 'admin';
  const [v, setV] = useState(p.notes ?? ''); const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false); const [long, setLong] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null); const tx = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!editing) setV(p.notes ?? ''); }, [p.notes, editing]);
  useLayoutEffect(() => { const el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; } }, [v, editing]);
  useLayoutEffect(() => { const el = tx.current; if (el && !open) setLong(el.scrollHeight > el.clientHeight + 2); }, [p.notes, open]);
  if (compact) {
    if (!p.notes) return null;
    return <div className={`wdesc nodrag ${open ? 'open' : ''}`} data-desc onClick={() => setOpen(!open)} title={open ? 'Collapse' : 'Show full description'}>
      <span className="wdesc-t"><Linkify text={p.notes} /></span><span className="wdesc-x">{open ? '▴' : '▾'}</span></div>;
  }
  if (!p.notes && !canEdit) return null;
  const save = () => { if (v !== (p.notes ?? '')) void actions.setProjectNotes(p.id, v); setEditing(false); };
  const cancel = () => { setV(p.notes ?? ''); setEditing(false); };
  return (
    <div className={`pdesc ${editing ? 'editing' : ''}`} data-desc>
      <div className="pdesc-h">Project description<span className="ml" />{p.notes && <CopyBtn text={p.notes} label="description" />}
        {canEdit && !editing && <button className="iconbtn" aria-label="Edit description" title="Edit description" onClick={() => setEditing(true)}>✎</button>}</div>
      {editing ? <>
        <textarea ref={ta} autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="What is this project about? Goal, scope, links…" aria-label="Edit project description"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } if (e.key === 'Escape') { e.preventDefault(); cancel(); } }} />
        <div className="pdbtns"><span className="muted small">Ctrl+Enter to save · Esc to cancel</span><span className="ml" />
          <button className="btn sec sm" onClick={cancel}>Cancel</button><button className="btn pri sm" onClick={save}>Save</button></div>
      </> : p.notes ? <>
        <div ref={tx} className={`pdesc-t ${open ? '' : 'clamp'}`}><Linkify text={p.notes} /></div>
        {(long || open) && <button className="linkbtn more" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show more'}</button>}
      </> : <div className="pdesc-empty">No description yet. Use ✎ to add one.</div>}
    </div>
  );
}
