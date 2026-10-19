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
    try { await actions.signIn(code, url); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className={`signin ${theme}`} onSubmit={submit}>
      <div className="logo">✓</div>
      <h2>Sign in to Desklist</h2>
      <p>Enter the personal code your team admin gave you.</p>
      <input className="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX" autoFocus
        aria-label="Personal code" spellCheck={false} />
      {adv && <input className="url" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Server URL" />}
      {err && <div className="err">{err}</div>}
      <button className="btn pri" disabled={busy || code.trim().length < 4}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <button type="button" className="linkbtn" onClick={() => setAdv(!adv)}>{adv ? 'Hide server' : `Server: ${url}`}</button>
    </form>
  );
}
