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
