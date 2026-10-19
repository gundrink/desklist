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
      <div className="fhead"><h3>Your passkeys</h3><button className="btn pri sm" onClick={add} disabled={busy}>{busy ? 'Waiting…' : '+ Add passkey'}</button></div>
      <div className="muted small">Sessions last 5 days. With a passkey you sign in again with one tap (opens your browser).</div>
      {list.map((p) => <div className="pkrow" key={p.id} data-passkey={p.label}><b>🔑 {p.label}</b><span className="muted small">added {shortDate(p.createdAt)}{p.lastUsedAt ? ` · last used ${shortDate(p.lastUsedAt)}` : ''}</span>
        <span className="ml" /><button className="btn sec sm" onClick={async () => { await actions.request('DELETE', `/api/passkeys/${p.id}`); await load(); }}>Remove</button></div>)}
      {!list.length && <div className="muted small">No passkeys yet.</div>}
      {msg && <div className="callout">{msg}</div>}
    </div>
  );
}
