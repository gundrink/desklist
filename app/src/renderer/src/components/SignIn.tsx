import { useEffect, useState } from 'react';
import type { AppState } from '../../../common/ipc';
import { actions } from '../lib/store';

const clean = (x: unknown) => (x as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const withTimeout = <T,>(p: Promise<T>, url: string) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`No answer from ${url} after 20 seconds. Check your connection or the server URL and try again.`)), 20_000))]);

/** Monochrome face / fingerprint glyph for the passkey option. */
export const FaceIdIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 16c1.5 1.2 3.5 1.2 5 0" />
  </svg>);

/** 0.6.4: Sign in (username + password) or Create account -> Enter the code from your admin. */
export function SignIn({ st, theme }: { st: AppState; theme: 'dark' | 'light' }) {
  const [tab, setTab] = useState<'signin' | 'create'>('signin');
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState<{ token: string; username: string } | null>(null);
  const [code, setCode] = useState('');
  const [url, setUrl] = useState(st.serverUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(st.lastError);
  const [adv, setAdv] = useState(false);
  const [pk, setPk] = useState(false);
  const expired = /expired/i.test(st.lastError ?? '');
  // flag set before the call: the widget switches to the signed-in view as soon as the session lands
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); localStorage.setItem('dl-pk-nudge', '1'); try { await withTimeout(fn(), url); } catch (x) { localStorage.removeItem('dl-pk-nudge'); setErr(clean(x)); } finally { setBusy(false); } };
  const after = (r: { pending: boolean; accountToken?: string; username?: string }, viaPassword: boolean) => {
    void viaPassword; if (r.pending) { setPending({ token: r.accountToken!, username: r.username! }); setCode(''); }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return void run(async () => { after(await actions.account('redeem', { accountToken: pending.token, code: code.trim() }), true); });
    if (tab === 'create') {
      if (password.length < 8) return setErr('Password must be at least 8 characters');
      if (password !== confirm) return setErr("Passwords don't match");
      return void run(async () => { after(await actions.account('signup', { username: username.trim(), password }, url.trim()), true); });
    }
    return void run(async () => { after(await actions.account('login', { username: username.trim(), password }, url.trim()), true); });
  };
  const passkey = async () => { setPk(true); setErr(null); try { await window.desklist.passkeySignIn(); } catch (x) { setErr(clean(x)); } finally { setPk(false); } };
  const pkBtn = <button type="button" className={`btn sec passkey ${expired ? 'prominent' : ''}`} onClick={passkey} disabled={pk}><FaceIdIcon /> {pk ? 'Waiting for browser…' : 'Sign in with passkey'}</button>;

  if (pending) return (
    <form className={`signin ${theme} mswap`} onSubmit={submit}>
      <div className="logo">✓</div>
      <h2>Enter the code from your admin</h2>
      <p>Account <b>{pending.username}</b> is created. Enter the code your admin gave you to join your team.</p>
      <input className="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autoFocus aria-label="Admin code" spellCheck={false} />
      {err && <div className="err">{err}</div>}
      <button className="btn pri" disabled={busy || code.trim().length < 4}>{busy ? 'Joining…' : 'Join'}</button>
      <button type="button" className="linkbtn" onClick={() => { setPending(null); setErr(null); }}>Back to sign in</button>
    </form>);

  return (
    <form className={`signin ${theme}`} onSubmit={submit}>
      <div className="logo">✓</div>
      <div className={`ptabs authtabs ${theme} idx-${tab === 'create' ? 1 : 0}`} role="tablist">
        <button type="button" role="tab" className={tab === 'signin' ? 'on' : ''} onClick={() => { setTab('signin'); setErr(null); }}>Sign in</button>
        <button type="button" role="tab" className={tab === 'create' ? 'on' : ''} onClick={() => { setTab('create'); setErr(null); }}>Create account</button>
      </div>
      {expired && <p>Your session expired. Sign in again.</p>}
      <div className="mswap" key={tab}>
        <input className="acc" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" aria-label="Username" autoFocus autoComplete="username" spellCheck={false} />
        <input className="acc" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Password" autoComplete={tab === 'create' ? 'new-password' : 'current-password'} />
        {tab === 'create' && <input className="acc" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password" aria-label="Confirm password" autoComplete="new-password" />}
      </div>
      {adv && <input className="url" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Server URL" />}
      {err && <div className="err">{err}</div>}
      <button className="btn pri" disabled={busy || !username.trim() || !password}>{busy ? (tab === 'create' ? 'Creating…' : 'Signing in…') : tab === 'create' ? 'Create account' : 'Sign in'}</button>
      {tab === 'signin' && <div className="altsign"><span className="or">or</span>{pkBtn}</div>}
      {tab === 'create' && <p className="small muted">Next you'll enter the code from your admin.</p>}
      <button type="button" className="linkbtn" onClick={() => setAdv(!adv)}>{adv ? 'Hide server' : `Server: ${url}`}</button>
    </form>
  );
}

/** One-time, skippable nudge after a password sign-in when the member has no passkey yet. */
export function PasskeyNudge() {
  const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  useEffect(() => {
    if (localStorage.getItem('dl-pk-nudge') !== '1' || localStorage.getItem('dl-pk-nudge-done')) return;
    void actions.request<unknown[]>('GET', '/api/passkeys').then((l) => { if (l.length) localStorage.removeItem('dl-pk-nudge'); else setShow(true); }).catch(() => {});
  }, []);
  if (!show) return null;
  const done = () => { localStorage.removeItem('dl-pk-nudge'); localStorage.setItem('dl-pk-nudge-done', '1'); setShow(false); };
  return (
    <div className="pknudge nodrag" role="dialog" aria-label="Set up passkey">
      <FaceIdIcon size={18} /><span>{msg || 'Set up Face ID / Windows Hello for faster sign-in?'}</span>
      <button className="btn pri xs" disabled={busy} onClick={async () => { setBusy(true); setMsg('Finish in your browser…'); try { await window.desklist.passkeyRegister(); done(); } catch (x) { setMsg(clean(x)); } finally { setBusy(false); } }}>Set up</button>
      <button className="btn sec xs" onClick={done}>Not now</button>
    </div>);
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
