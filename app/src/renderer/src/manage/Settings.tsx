import { useState } from 'react';
import type { AppState } from '../../../common/ipc';
import type { Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { PasskeysCard } from '../components/Passkeys';
import { OpacityControl } from '../components/WidgetLook';
import { Toggle } from '../components/Money';
import { TzSelect, useClockMode } from '../components/Overview';
function ClockStyle() { const [m, setM] = useClockMode(); return <div className="seg clockseg" role="group" aria-label="Clock style">{(['digital', 'analog'] as const).map((x) => <button key={x} className={m === x ? 'on' : ''} aria-pressed={m === x} onClick={() => setM(x)}>{x === 'digital' ? 'Digital' : 'Analog'}</button>)}</div>; }

const clean = (x: unknown) => (x as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Settings (every member): Account, Sign-in methods / Passkeys, Session. */
export function Settings({ s, st }: { s: Snapshot; st: AppState }) {
  const me = s.members.find((m) => m.id === s.me.id);
  const [uname, setUname] = useState(me?.username ?? ''); const [umsg, setUmsg] = useState('');
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [nw2, setNw2] = useState(''); const [pmsg, setPmsg] = useState('');
  const exp = st.settings.sessionExpiresAt;
  return (
    <>
      <div className="rhead"><h1>Settings</h1><div className="sub">Your account, sign-in methods and session.</div></div>
      <div className="rbody scroll settings mswap">
        <div className="card setcard" data-card="startup">
          <div className="fhead"><h3>Startup</h3></div>
          <p className="muted small">What happens when this computer starts. Saved on this device only.</p>
          {([['launchAtLogin', 'Open Desklist at startup', 'Starts Desklist when you sign in to Windows or macOS.', st.settings.launchAtLogin],
            ['autoShowWidget', 'Show widget automatically at startup', 'The widget appears pinned to the desktop at its saved position.', st.settings.autoShowWidget ?? true],
            ['openManageAtStartup', 'Open Manage window at startup', 'Also opens this window when Desklist starts.', st.settings.openManageAtStartup ?? false],
            ['startMinimized', 'Start minimized to tray', 'Starts quietly in the system tray; open the widget from the tray icon.', st.settings.startMinimized ?? false]] as const).map(([k, label, hint, on]) =>
            <div className="strow" key={k} data-startup={k}><div><b>{label}</b><span>{hint}</span></div>
              <Toggle on={!!on} theme="dark" label="" onChange={(v) => void actions.setSetting({ [k]: v })} aria={label} /></div>)}
        </div>
        <div className="card setcard" data-card="clock">
          <div className="fhead"><h3>Clock</h3></div>
          <p className="muted small">Only changes the clock inside Desklist. Your computer's clock and timezone are never touched.</p>
          <div className="strow"><div><b>Clock style</b><span>Digital or analog on the Overview and widget.</span></div><ClockStyle /></div>
          <div className="strow"><div><b>Clock timezone</b><span>Time, date, greeting and "today" follow this zone.</span></div><div className="tzset"><TzSelect /></div></div>
        </div>
        <div className="card setcard" data-card="widget">
          <div className="fhead"><h3>Widget</h3></div>
          <p className="muted small">How the desktop widget looks on this device. Only the panel background fades; text stays readable.</p>
          <OpacityControl st={st} />
        </div>
        <div className="card setcard" data-card="account">
          <div className="fhead"><h3>Account</h3></div>
          {me?.username == null && <div className="muted small">This member slot has no username account yet.</div>}
          <form className="setrow" onSubmit={async (e) => { e.preventDefault(); try { await actions.request('PATCH', '/api/account', { username: uname.trim() }); setUmsg('Username saved'); } catch (x) { setUmsg(clean(x)); } }}>
            <label>Username</label><input value={uname} onChange={(e) => setUname(e.target.value)} aria-label="Your username" spellCheck={false} />
            <button className="btn sec sm" disabled={!uname.trim() || uname.trim() === me?.username}>Save</button>{umsg && <span className="small muted">{umsg}</span>}
          </form>
          <form className="setrow pw" onSubmit={async (e) => {
            e.preventDefault(); if (nw.length < 8) return setPmsg('New password must be at least 8 characters'); if (nw !== nw2) return setPmsg("New passwords don't match");
            try { await actions.request('POST', '/api/account/password', { current: cur, next: nw }); setPmsg('Password changed'); setCur(''); setNw(''); setNw2(''); } catch (x) { setPmsg(clean(x)); } }}>
            <label>Change password</label>
            <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current password" aria-label="Current password" />
            <input type="password" value={nw} onChange={(e) => setNw(e.target.value)} placeholder="New password (8+)" aria-label="New password" />
            <input type="password" value={nw2} onChange={(e) => setNw2(e.target.value)} placeholder="Confirm new password" aria-label="Confirm new password" />
            <button className="btn pri sm" disabled={!cur || !nw}>Change password</button>{pmsg && <span className="small muted" data-msg="pw">{pmsg}</span>}
          </form>
        </div>
        <PasskeysCard />
        <div className="card setcard" data-card="session">
          <div className="fhead"><h3>Session</h3><button className="btn sec sm" onClick={() => actions.signOut()}>Sign out</button></div>
          <div className="small">Signed in as <b>{me?.username ?? s.me.name}</b> · {s.me.role} · {s.team.name}</div>
          <div className="small muted">{exp ? `This session expires ${new Date(exp).toLocaleString()} (sessions last 5 days).` : 'Sessions last 5 days from sign-in.'}</div>
        </div>
      </div>
    </>
  );
}
