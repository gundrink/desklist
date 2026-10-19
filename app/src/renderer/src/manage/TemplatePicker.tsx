import { useEffect, useState } from 'react';
import type { Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { Check, X } from '../components/Icons';

type Setup = { id: string; title: string; fields: { label: string; reimbursement?: boolean }[]; updatedAt: string };

/** 0.6.5: right after "New project" — pick configured tasks from Admin › Task setup (or start blank). */
export function TemplatePicker({ s, projectId, onClose }: { s: Snapshot; projectId: string; onClose: () => void }) {
  const p = s.projects.find((x) => x.id === projectId);
  const [setups, setSetups] = useState<Setup[] | null>(null);
  const [order, setOrder] = useState<string[]>([]); // selected ids, in creation order
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  // refetch whenever the snapshot changes, so setups edited elsewhere show up live
  useEffect(() => { void actions.request<Setup[]>('GET', '/api/task-setups').then(setSetups).catch((e) => setErr((e as Error).message)); }, [s]);
  const toggle = (id: string) => setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const move = (id: string, d: -1 | 1) => setOrder((o) => { const i = o.indexOf(id), j = i + d; if (j < 0 || j >= o.length) return o; const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const byId = new Map((setups ?? []).map((x) => [x.id, x]));
  const counts = (x: Setup) => { const r = x.fields.filter((f) => f.reimbursement).length; return `${x.fields.length - r} fields · ${r} reimbursement`; };
  const create = async () => {
    setBusy(true); setErr('');
    try { await actions.request('POST', `/api/projects/${projectId}/tasks-from-setups`, { setupIds: order }); onClose(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal tplmodal setupmodal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Choose tasks">
        <div className="mhd"><span className="mico"><Check size={14} /></span>
          <div><h2>{p?.name ?? 'Project'} created — add tasks</h2><div className="sub">Pick configured tasks from Admin › Task setup. Their fields and reimbursement come pre-configured.</div></div>
          <button className="iconbtn mx" onClick={onClose} aria-label="Close"><X /></button></div>
        <div className="mbody setupbody">
          <div className="tplleft">
            <div className="tsh2"><b>Configured tasks</b><span className="muted small">{setups?.length ?? 0}</span><span className="ml" />
              <button className="btn sec xs" onClick={() => setOrder((setups ?? []).map((x) => x.id))} disabled={!setups?.length}>Select all</button>
              <button className="btn sec xs" onClick={() => setOrder([])} disabled={!order.length}>Clear</button></div>
            {setups === null && <div className="muted small">Loading…</div>}
            {setups?.length === 0 && <div className="muted small">No configured tasks yet. {s.me.role === 'admin' ? 'Add them in Admin › Task setup.' : 'Ask your admin to add them in Task setup.'}</div>}
            {(setups ?? []).map((x) => (
              <label key={x.id} className={`setuprow ${order.includes(x.id) ? 'on' : ''}`} data-setup={x.title}>
                <input type="checkbox" checked={order.includes(x.id)} onChange={() => toggle(x.id)} aria-label={`Select ${x.title}`} />
                <span className="tn">{x.title}</span><span className="tc">{counts(x)}</span>
              </label>))}
          </div>
          <div className="tplright">
            <div className="tsh2"><b>Will be created</b><span className="muted small">{order.length} tasks</span></div>
            {order.map((id, i) => byId.get(id) && (
              <div key={id} className="selrow" data-sel={byId.get(id)!.title}><span className="num">{i + 1}</span><span className="tn">{byId.get(id)!.title}</span><span className="ml" />
                <button className="iconbtn" aria-label="Move up" disabled={i === 0} onClick={() => move(id, -1)}>↑</button>
                <button className="iconbtn" aria-label="Move down" disabled={i === order.length - 1} onClick={() => move(id, 1)}>↓</button></div>))}
            {!order.length && <div className="muted small">Nothing selected — you can also start with a blank project.</div>}
          </div>
        </div>
        {err && <div className="callout err">{err}</div>}
        <div className="mft"><button className="btn sec" onClick={onClose}>Blank project</button><span className="ml" />
          <button className="btn pri" disabled={!order.length || busy} onClick={create}>{busy ? 'Creating…' : `Create ${order.length || ''} task${order.length === 1 ? '' : 's'}`}</button></div>
      </div>
    </div>
  );
}
