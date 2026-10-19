import { useEffect, useState } from 'react';
import { actions } from '../lib/store';
import { shortDate } from '../lib/model';

type PK = { id: string; label: string; createdAt: string; lastUsedAt: string | null };
/** Account: add / list / remove your passkeys (quick re-login when the 5-day session ends). */
export function PasskeysCard() {
  const [list, setList] = useState<PK[]>([]); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const load = async () => { try { setList(await actions.request<PK[]>('GET', '/api/passkeys')); } catch (e) { setMsg((e as Error).message); } };
  useEffect(() => { void load(); }, []);
  const add = async () => {
    setBusy(true); setMsg('Finish in your browser…');
    try { await window.desklist.passkeyRegister(); setMsg('Passkey added'); await load(); }
    catch (e) { setMsg((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } finally { setBusy(false); }
  };
  return (
    <div className="card pkcard">
      <div className="fhead"><h3>Sign-in methods · Passkeys</h3><button className="btn pri sm" onClick={add} disabled={busy}>{busy ? 'Waiting…' : '+ Add passkey'}</button></div>
      <div className="muted small">Use Face ID, Touch ID, Windows Hello or a security key to sign in without your password.</div>
      <div className="small pkstatus">{list.length ? `${list.length} passkey${list.length > 1 ? 's' : ''} set up — you can sign in with one tap.` : 'No passkeys yet — you sign in with your password.'}</div>
      {list.map((p) => <PkRow key={p.id} p={p} reload={load} />)}
      {msg && <div className="callout">{msg}</div>}
    </div>
  );
}

function PkRow({ p, reload }: { p: PK; reload: () => Promise<void> }) {
  const [edit, setEdit] = useState(false); const [v, setV] = useState(p.label);
  return <div className="pkrow" data-passkey={p.label}>
    {edit ? <form className="pkedit" onSubmit={async (e) => { e.preventDefault(); await actions.request('PATCH', `/api/passkeys/${p.id}`, { label: v }); setEdit(false); await reload(); }}>
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} aria-label="Passkey name" /><button className="btn pri xs">Save</button><button type="button" className="btn sec xs" onClick={() => setEdit(false)}>Cancel</button></form>
      : <b>{p.label}</b>}
    <span className="muted small">added {shortDate(p.createdAt)}{p.lastUsedAt ? ` · last used ${shortDate(p.lastUsedAt)}` : ''}</span>
    <span className="ml" />{!edit && <button className="btn sec sm" onClick={() => setEdit(true)}>Rename</button>}
    <button className="btn sec sm" onClick={async () => { await actions.request('DELETE', `/api/passkeys/${p.id}`); await reload(); }}>Remove</button></div>;
}
