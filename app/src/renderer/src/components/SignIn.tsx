import { useState } from 'react';
import type { AppState } from '../../../common/ipc';
import { actions } from '../lib/store';

/** Code-only sign-in (personal code from your admin). */
export function SignIn({ st, theme }: { st: AppState; theme: 'dark' | 'light' }) {
  const [code, setCode] = useState('');
  const [url, setUrl] = useState(st.serverUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(st.lastError);
  const [adv, setAdv] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await Promise.race([actions.signIn(code.trim(), url.trim()),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`No answer from ${url} after 20 seconds. Check your connection or the server URL and try again.`)), 20_000))]);
    } catch (x) { setErr((x as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } finally { setBusy(false); }
  };
  const expired = /expired/i.test(st.lastError ?? '');
  const [pk, setPk] = useState(false);
  const passkey = async () => { setPk(true); setErr(null); try { await window.desklist.passkeySignIn(); } catch (x) { setErr((x as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } finally { setPk(false); } };
  const pkBtn = <button type="button" className={`btn ${expired ? 'pri' : 'sec'} passkey ${expired ? 'prominent' : ''}`} onClick={passkey} disabled={pk}>{pk ? 'Waiting for browser…' : '🔑 Sign in with passkey'}</button>;
  return (
    <form className={`signin ${theme}`} onSubmit={submit}>
      <div className="logo">✓</div>
      <h2>Sign in to Desklist</h2>
      {expired ? <><p>Your session expired. Sign in again with your passkey.</p>{pkBtn}<p className="small">or enter your personal code</p></> : <p>Enter the personal code your team admin gave you.</p>}
      <input className="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX" autoFocus
        aria-label="Personal code" spellCheck={false} />
      {adv && <input className="url" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Server URL" />}
      {err && <div className="err">{err}</div>}
      <button className="btn pri" disabled={busy || code.trim().length < 4}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {!expired && pkBtn}
      <button type="button" className="linkbtn" onClick={() => setAdv(!adv)}>{adv ? 'Hide server' : `Server: ${url}`}</button>
    </form>
  );
}

/** Shown while the first snapshot loads; offers Retry / Sign out so it can never get stuck. */
export function LoadingState({ st }: { st: AppState }) {
  return (
    <div className="w-empty loadingstate">
      <div>{st.connection === 'offline' ? 'Cannot reach the server.' : 'Loading…'}</div>
      {st.lastError && <div className="err">{st.lastError}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'center' }}>
        <button className="btn sec sm" onClick={() => actions.refresh()}>Retry</button>
        <button className="btn sec sm" onClick={() => actions.signOut()}>Sign out</button>
      </div>
    </div>
  );
}
