import { useMemo, useState } from 'react';
import { formatAmount, type Snapshot, type Template } from '@desklist/shared';
import { actions } from '../lib/store';
import { member, shortName } from '../lib/model';
import { Avatar } from '../components/Common';
import { Toggle, usdOf, rateNote } from '../components/Money';
import { Check, X } from '../components/Icons';

type Mode = 'existing' | 'own' | 'teammate';
const ICO: Record<string, string> = { globe: '🌐', phone: '📱', user: '👥', list: '☰' };

/** Opens right after "New project": use an existing template, create your own, or use a teammate's. */
export function TemplatePicker({ s, projectId, onClose }: { s: Snapshot; projectId: string; onClose: () => void }) {
  const p = s.projects.find((x) => x.id === projectId);
  const builtin = s.templates.filter((t) => !t.teamId);
  const mine = s.templates.filter((t) => t.teamId && t.ownerMemberId === s.me.id);
  const mates = s.templates.filter((t) => t.teamId && t.ownerMemberId !== s.me.id);
  const [mode, setMode] = useState<Mode>('existing');
  const [sel, setSel] = useState<string | null>(builtin[0]?.id ?? null);
  const [expenses, setExpenses] = useState(p?.hasExpenses ?? true);
  const [own, setOwn] = useState<{ name: string; tasks: string }>({ name: '', tasks: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const tpl = s.templates.find((t) => t.id === sel) ?? null;
  const ownTasks = useMemo(() => own.tasks.split('\n').map((x) => x.trim()).filter(Boolean), [own.tasks]);
  const otherProjects = s.projects.filter((x) => x.id !== projectId && s.tasks.some((t) => t.projectId === x.id));
  const [fromProject, setFromProject] = useState(otherProjects[0]?.id ?? '');

  const apply = async () => {
    setBusy(true); setErr('');
    try {
      let templateId = sel;
      if (mode === 'own') {
        if (!own.name.trim()) throw new Error('Give your template a name');
        const t = await actions.request<Template>('POST', '/api/templates', ownTasks.length || !fromProject
          ? { name: own.name, tasks: ownTasks.map((title) => ({ title })), shared: true }
          : { name: own.name, fromProjectId: fromProject, shared: true });
        templateId = t.id;
      }
      if (!templateId) throw new Error('Pick a template');
      await actions.request('POST', `/api/projects/${projectId}/apply-template`, { templateId });
      if (p && p.hasExpenses !== expenses) await actions.request('PATCH', `/api/projects/${projectId}`, { hasExpenses: expenses });
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const skip = async () => { if (p && p.hasExpenses !== expenses) await actions.request('PATCH', `/api/projects/${projectId}`, { hasExpenses: expenses }).catch(() => {}); onClose(); };

  const row = (t: Template) => {
    const owner = member(s, t.ownerMemberId);
    return (
      <button key={t.id} className={`tplrow ${sel === t.id ? 'on' : ''}`} onClick={() => setSel(t.id)}>
        {owner ? <Avatar initials={owner.initials} size="xs" /> : <span className="tico">{ICO[t.icon] ?? '☰'}</span>}
        <span className="tn">{t.name}</span>
        <span className="tc">{t.tasks.length} tasks{owner ? ` · shared by ${shortName(owner.name)}` : ''}</span>
        {sel === t.id && <Check size={11} />}
      </button>
    );
  };
  const preview = mode === 'own' ? { name: own.name || 'My template', tasks: ownTasks.map((title) => ({ title, expenseAmount: null, expenseCurrency: null })) } : tpl;
  const est = (preview?.tasks ?? []).filter((t) => t.expenseAmount);
  const estCur = est[0]?.expenseCurrency ?? s.currency;
  const estSum = est.reduce((a, t) => a + (t.expenseAmount ?? 0), 0);

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal tplmodal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Choose a template">
        <div className="mhd"><span className="mico"><Check size={14} /></span>
          <div><h2>{p?.name ?? 'Project'} created — choose a template</h2><div className="sub">Start with a ready checklist. Tasks, notes and expense estimates can be edited later.</div></div>
          <button className="iconbtn mx" onClick={skip} aria-label="Close"><X /></button></div>
        <div className="mbody">
          <div className="tplleft">
            <div className={`tplsec ${mode === 'existing' ? 'on' : ''}`} onClick={() => { setMode('existing'); if (!builtin.some((t) => t.id === sel)) setSel(builtin[0]?.id ?? null); }}>
              <div className="tsh"><i className="radio" />Use existing template<span>{builtin.length} templates</span></div>
              {mode === 'existing' && builtin.map(row)}
            </div>
            <div className={`tplsec ${mode === 'own' ? 'on' : ''}`} onClick={() => setMode('own')}>
              <div className="tsh"><i className="radio" />Create my own template<span>Your templates</span></div>
              {mode === 'own' && (
                <div className="ownform" onClick={(e) => e.stopPropagation()}>
                  <div className="inp"><input value={own.name} onChange={(e) => setOwn({ ...own, name: e.target.value })} placeholder="Template name" aria-label="Template name" /></div>
                  <textarea className="inp area" value={own.tasks} onChange={(e) => setOwn({ ...own, tasks: e.target.value })} placeholder={'One task per line — start blank…'} />
                  {otherProjects.length > 0 && !ownTasks.length && (
                    <label className="small muted">…or save an existing project as template:&nbsp;
                      <select value={fromProject} onChange={(e) => setFromProject(e.target.value)}>{otherProjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>)}
                  {mine.length > 0 && <div className="small muted">Your templates: {mine.map((t) => <button key={t.id} className="linkbtn" onClick={() => { setMode('teammate'); setSel(t.id); }}>{t.name}</button>)}</div>}
                </div>
              )}
            </div>
            <div className={`tplsec ${mode === 'teammate' ? 'on' : ''}`} onClick={() => { setMode('teammate'); if (!mates.concat(mine).some((t) => t.id === sel)) setSel(mates[0]?.id ?? null); }}>
              <div className="tsh"><i className="radio" />Use a teammate's template<span>Shared with you</span></div>
              {mode === 'teammate' && (mates.length ? mates.concat(mine).map(row) : <div className="small muted">No shared templates yet.</div>)}
            </div>
          </div>
          <div className="tplprev">
            <div className="tph"><b>Preview · {preview?.name ?? '—'}</b>{preview && <span className="selpill">Selected</span>}</div>
            <div className="small muted">{preview?.tasks.length ?? 0} tasks{est.length ? ` · ${est.length} with expenses` : ''}</div>
            <div className="tplist scroll">
              {(preview?.tasks ?? []).map((t, i) => (
                <div className="tpi" key={i}><span className="n">{i + 1}</span><i className="ring" /><span className="t">{t.title}</span>
                  {t.expenseAmount ? <span className="amt"><b>{formatAmount(t.expenseAmount, t.expenseCurrency ?? s.currency)}</b><em>{usdOf(s, t.expenseAmount, t.expenseCurrency ?? s.currency) ? ` ≈ ${usdOf(s, t.expenseAmount, t.expenseCurrency ?? s.currency)}` : ''}</em></span> : null}
                </div>))}
            </div>
            <div className="tpfoot"><span>Estimated expenses</span><b>{formatAmount(estSum, estCur)}</b>{usdOf(s, estSum, estCur) && <em>≈ {usdOf(s, estSum, estCur)}</em>}</div>
          </div>
        </div>
        <div className="mfoot">
          <div className="exptoggle"><Toggle on={expenses} onChange={setExpenses} label="Ada pengeluaran" />
            <span className="small muted">Track expenses &amp; reimbursements · default {s.currency} (per admin)</span></div>
          {err && <span className="errtxt">{err}</span>}
          <span className="small muted ml">{rateNote(s)}</span>
          <button className="btn sec" onClick={skip}>Skip</button>
          <button className="btn pri" disabled={busy || (mode !== 'own' && !sel)} onClick={apply}>{busy ? 'Applying…' : 'Apply template'}</button>
        </div>
      </div>
    </div>
  );
}
