import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../../common/ipc';

export function useUpdate(): UpdateStatus | null {
  const [u, setU] = useState<UpdateStatus | null>(null);
  useEffect(() => { void window.desklist.updateStatus().then(setU).catch(() => {}); return window.desklist.onUpdate(setU); }, []);
  return u;
}
/** Sidebar footer chip (same row as "+ New"): version when current; "Update now" → progress → "Restart". */
export function UpdateChip() {
  const u = useUpdate(); if (!u) return null;
  if (u.state === 'available') return <button className="updchip accent nodrag" data-update="available" title={`Version ${u.version} is available`} onClick={() => void window.desklist.downloadUpdate()}>Update now</button>;
  if (u.state === 'downloading') return <span className="updchip prog nodrag" data-update="downloading" title={`Downloading ${u.version ?? ''}`}><i><b style={{ width: `${u.percent ?? 0}%` }} /></i><em className="mono">{u.percent ?? 0}%</em></span>;
  if (u.state === 'downloaded') return <button className="updchip accent nodrag" data-update="downloaded" title={`Restart to install ${u.version}`} onClick={() => void window.desklist.installUpdate()}>Restart</button>;
  return <span className="updchip ver mono" data-update="current" title={u.state === 'error' ? `Update check failed: ${u.error}` : 'Desklist is up to date'}>v{u.current}</span>;
}
export function UpdatesCard() {
  const u = useUpdate(); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <div className="card setcard" data-card="updates">
      <div className="fhead"><h3>Updates</h3></div>
      <div className="updrow"><span>Current version <b className="mono">v{u?.current ?? '…'}</b></span><span className="ml" />
        {u?.state === 'available' ? <button className="btn pri sm" onClick={() => void window.desklist.downloadUpdate()}>Download &amp; install v{u.version}</button>
          : u?.state === 'downloading' ? <span className="updchip prog"><i><b style={{ width: `${u.percent ?? 0}%` }} /></i><em className="mono">{u.percent ?? 0}%</em></span>
          : u?.state === 'downloaded' ? <button className="btn pri sm" onClick={() => void window.desklist.installUpdate()}>Restart to update</button>
          : <button className="btn sec sm" disabled={busy || u?.state === 'checking'} data-checkupdates onClick={async () => { setBusy(true); setMsg(await window.desklist.checkForUpdates()); setBusy(false); }}>{busy || u?.state === 'checking' ? 'Checking…' : 'Check for updates'}</button>}</div>
      {(msg || u?.error) && <div className="small muted" data-updmsg>{u?.state === 'error' ? `Update check failed: ${u.error}` : msg}</div>}
    </div>
  );
}
