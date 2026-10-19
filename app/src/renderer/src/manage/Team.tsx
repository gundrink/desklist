import { PasskeysCard } from '../components/Passkeys';
import { useState as useStateG } from 'react';
import { actions as act } from '../lib/store';

/** Admin: Google account allowed to sign in as this member (edit / clear). */
function GoogleEmail({ id, value, name }: { id: string; value: string | null; name: string }) {
  const [edit, setEdit] = useStateG(false); const [v, setV] = useStateG(value ?? ''); const [err, setErr] = useStateG('');
  const save = async (val: string | null) => {
    try { await act.request('PATCH', `/api/members/${id}`, { googleEmail: val }); setEdit(false); setErr(''); } catch (e) { setErr((e as Error).message); }
  };
  if (!edit) return <span className="gmail" data-gmail={name}>
    {value ? <><span className="gtag">G</span><span className="small">{value}</span></> : <span className="small muted">No Google email</span>}
    <button className="btn sec xs" onClick={() => { setV(value ?? ''); setEdit(true); }}>{value ? 'Edit' : 'Add Google email'}</button>
    {value && <button className="btn sec xs" onClick={() => save(null)}>Clear</button>}</span>;
  return <form className="gmail editing" onSubmit={(e) => { e.preventDefault(); void save(v.trim() || null); }}>
    <input autoFocus type="email" value={v} onChange={(e) => setV(e.target.value)} placeholder="name@gmail.com" aria-label={`Google email for ${name}`} />
    <button className="btn pri xs">Save</button><button type="button" className="btn sec xs" onClick={() => setEdit(false)}>Cancel</button>
    {err && <span className="tferr">{err}</span>}</form>;
}
import { useState } from 'react';
import type { Member, Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { Avatar } from '../components/Common';
import { Plus } from '../components/Icons';

/** Admin: generate / reset / revoke personal sign-in codes. Codes are shown once; only bcrypt hashes are stored. */
export function Team({ s, isAdmin }: { s: Snapshot; isAdmin: boolean }) {
  const [shown, setShown] = useState<{ name: string; code: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(''); const [role, setRole] = useState<'member' | 'admin'>('member');
  const run = async (fn: () => Promise<{ member: Member; code: string } | unknown>) => {
    setErr(null);
    try { const r: any = await fn(); if (r?.code) setShown({ name: r.member.name, code: r.code }); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <>
      <div className="rhead"><div className="row"><h1>Team &amp; codes</h1><span className="lpill ns">{s.team.name}</span></div>
        <div className="sub">Everyone signs in with a personal code. Generate, reset or revoke codes here.</div></div>
      <div className="rbody scroll">
        <div className="details" style={{ paddingBottom: 0 }}><PasskeysCard /></div>
        {!isAdmin && <div className="callout">Only admins can manage codes.</div>}
        {err && <div className="callout err">{err}</div>}
        {shown && <div className="callout code-callout">New code for <b>{shown.name}</b>: <span className="mono big">{shown.code}</span>
          <button className="btn sec sm" onClick={() => navigator.clipboard.writeText(shown.code)}>Copy</button>
          <span className="muted small">Shown once — share it privately.</span></div>}
        <div className="card">
          {s.members.map((m) => (
            <div className={`mem-row ${m.revoked ? 'revoked' : ''}`} key={m.id}>
              <Avatar initials={m.initials} size="md" />
              <span className="mname">{m.name}{m.id === s.me.id && <em> (you)</em>}{m.isDemo && <span className="demo-tag light">demo</span>}</span>
              <span className={`badge ${m.role === 'admin' ? 'admin' : ''}`}>{m.role}</span>
              <span className="muted small">{m.revoked ? 'Revoked' : 'Active'}</span>
              {isAdmin ? <GoogleEmail id={m.id} value={m.googleEmail ?? null} name={m.name} /> : m.googleEmail ? <span className="small muted">G · {m.googleEmail}</span> : null}
              {isAdmin && <span className="mem-actions">
                <button className="btn sec sm" onClick={() => run(() => actions.request('POST', `/api/members/${m.id}/code`))}>{m.revoked ? 'Restore + new code' : 'Reset code'}</button>
                {!m.revoked && m.id !== s.me.id && <button className="btn danger sm" onClick={() => run(() => actions.request('POST', `/api/members/${m.id}/revoke`))}>Revoke</button>}
              </span>}
            </div>
          ))}
        </div>
        {isAdmin && (
          <form className="card newmember" onSubmit={(e) => { e.preventDefault(); void run(() => actions.request('POST', '/api/members', { name, role })).then(() => setName('')); }}>
            <div className="inp"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" aria-label="Member name" /></div>
            <div className="inp sel narrow"><select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}><option value="member">Member</option><option value="admin">Admin</option></select></div>
            <button className="btn pri" disabled={!name.trim()}><Plus size={12} /> Add member &amp; generate code</button>
          </form>
        )}
      </div>
    </>
  );
}
