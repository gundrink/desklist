import { Select } from '../components/Select';
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
  const [temp, setTemp] = useState<{ name: string; pw: string } | null>(null);
  const [del, setDel] = useState<Member | null>(null);
  const [name, setName] = useState(''); const [role, setRole] = useState<'member' | 'admin'>('member');
  const run = async (fn: () => Promise<{ member: Member; code: string } | unknown>) => {
    setErr(null);
    try { const r: any = await fn(); if (r?.code) setShown({ name: r.member.name, code: r.code }); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <>
      <div className="rhead"><div className="row"><h1>Team &amp; codes</h1><span className="lpill ns">{s.team.name}</span></div>
        <div className="sub">Members create an account (username + password), then enter their code once to join. Manage codes and accounts here. Your own password is in Settings.</div></div>
      <div className="rbody scroll">
        {!isAdmin && <div className="callout">Only admins can manage codes.</div>}
        {err && <div className="callout err">{err}</div>}
        {del && <div className="modal-back" onClick={() => setDel(null)}><div className="modal delmodal" role="dialog" aria-label="Delete member" onClick={(e) => e.stopPropagation()}>
          <h3>Delete {del.name}?</h3>
          <p className="small">This permanently removes the member and their sign-in. Tasks they own are unassigned; tasks they approved keep their name in history.</p>
          <div className="mbtns"><span className="ml" /><button className="btn sec sm" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger sm" data-confirmdelmember onClick={() => { const m = del; setDel(null); void run(() => actions.request('DELETE', `/api/members/${m.id}`).then(() => actions.refresh())); }}>Delete member</button></div>
        </div></div>}
        {temp && <div className="callout code-callout" data-temp>Temporary password for <b>{temp.name}</b>: <span className="mono big">{temp.pw}</span>
          <button className="btn sec sm" onClick={() => navigator.clipboard.writeText(temp.pw)}>Copy</button>
          <span className="muted small">Shown once. They should change it in Settings.</span></div>}
        {shown && <div className="callout code-callout">New code for <b>{shown.name}</b>: <span className="mono big">{shown.code}</span>
          <button className="btn sec sm" onClick={() => navigator.clipboard.writeText(shown.code)}>Copy</button>
          <span className="muted small">Shown once — share it privately.</span></div>}
        <div className="card">
          {s.members.map((m) => (
            <div className={`mem-row ${m.revoked ? 'revoked' : ''}`} key={m.id}>
              <Avatar initials={m.initials} url={m.avatarUrl} size="md" />
              <span className="mname">{m.name}{m.id === s.me.id && <em> (you)</em>}{m.isDemo && <span className="demo-tag light">demo</span>}</span>
              {isAdmin && m.id !== s.me.id
                ? <span className="rolesel" data-role={m.name}><Select value={m.role} aria-label={`Role for ${m.name}`} onChange={(e) => { const r = e.target.value; if (r !== m.role) void run(() => actions.request('PATCH', `/api/members/${m.id}`, { role: r }).then(() => actions.refresh())); }}>
                  <option value="member">Member</option><option value="admin">Admin</option></Select></span>
                : <span className={`badge ${m.role === 'admin' ? 'admin' : ''}`} title={m.id === s.me.id ? 'You cannot change your own role' : undefined}>{m.role}</span>}
              <span className="muted small">{m.revoked ? 'Revoked' : 'Active'}</span>
              <span className="accname small" data-account={m.name}>{m.username ? <>@{m.username}</> : <span className="muted">Not joined yet{isAdmin ? ' · share their code (Reset code shows a new one)' : ''}</span>}</span>
              {isAdmin && <span className="mem-actions">
                <button className="btn sec sm" onClick={() => run(() => actions.request('POST', `/api/members/${m.id}/code`))}>{m.revoked ? 'Restore + new code' : 'Reset code'}</button>
                {m.username && <button className="btn sec sm" onClick={() => run(async () => { const r = await actions.request<{ tempPassword: string }>('POST', `/api/members/${m.id}/reset-password`); setTemp({ name: m.name, pw: r.tempPassword }); })}>Reset password</button>}
                {m.username && m.id !== s.me.id && <button className="btn sec sm" onClick={() => { if (confirm(`Unlink @${m.username} from ${m.name}? Their code can then be used again.`)) void run(() => actions.request('POST', `/api/members/${m.id}/unlink`)); }}>Unlink</button>}
                {!m.revoked && m.id !== s.me.id && <button className="btn danger sm" onClick={() => run(() => actions.request('POST', `/api/members/${m.id}/revoke`))}>Revoke</button>}
                {m.id !== s.me.id && <button className="btn danger sm" data-delmember={m.name} onClick={() => setDel(m)}>Delete</button>}
              </span>}
            </div>
          ))}
        </div>
        {isAdmin && (
          <form className="card newmember" onSubmit={(e) => { e.preventDefault(); void run(() => actions.request('POST', '/api/members', { name, role })).then(() => setName('')); }}>
            <div className="inp"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" aria-label="Member name" /></div>
            <div className="inp sel narrow"><Select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}><option value="member">Member</option><option value="admin">Admin</option></Select></div>
            <button className="btn pri" disabled={!name.trim()}><Plus size={12} /> Add member &amp; generate code</button>
          </form>
        )}
      </div>
    </>
  );
}
