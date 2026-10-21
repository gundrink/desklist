import { useRef, useState } from 'react';
import type { Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { Avatar, avatarOf } from './Common';

const MAX_IN = 8 * 1024 * 1024;
/** Center-crop to a square and resize to 256px (WebP, JPEG fallback). */
export async function squareAvatar(file: Blob, px = 256): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPG or WebP image');
  if (file.size > MAX_IN) throw new Error('Image too large (max 8 MB)');
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height); const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d')!; g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, px, px);
  let url = c.toDataURL('image/webp', 0.85); if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', 0.85);
  return url;
}

export function ProfileCard({ s }: { s: Snapshot }) {
  const meM = s.members.find((m) => m.id === s.me.id);
  const [name, setName] = useState(meM?.name ?? s.me.name); const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null); const url = avatarOf(s, s.me.id);
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); setErr(''); setOk('');
    try { await fn(); await actions.refresh(); setOk(msg); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="card setcard profcard" data-card="profile">
      <div className="fhead"><h3>Profile</h3></div>
      <div className="profrow">
        <Avatar initials={meM?.initials ?? s.me.initials} url={url} size="lg" />
        <div className="profbtns">
          <button className="btn sec sm" disabled={busy} onClick={() => file.current?.click()}>{url ? 'Change photo' : 'Upload photo'}</button>
          {url && <button className="btn sec sm" disabled={busy} data-removephoto onClick={() => run(() => actions.request('DELETE', '/api/me/avatar'), 'Photo removed')}>Remove photo</button>}
          <span className="muted small">PNG, JPG or WebP. Cropped to a square.</span>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden-file" aria-label="Profile photo" data-avatarinput
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(async () => actions.request('PUT', '/api/me/avatar', { dataUrl: await squareAvatar(f) }), 'Photo updated'); }} />
        </div>
      </div>
      <form className="profname" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(() => actions.request('PATCH', '/api/me', { name: name.trim() }), 'Name saved'); }}>
        <label><span>Display name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Display name" /></label>
        <button className="btn pri sm" disabled={busy || !name.trim() || name.trim() === meM?.name}>Save</button>
      </form>
      {err && <div className="tferr" role="alert">{err}</div>}{ok && <div className="small okmsg">{ok}</div>}
    </div>
  );
}
