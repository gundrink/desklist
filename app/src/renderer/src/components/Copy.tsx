import { useState } from 'react';
/** Copy-to-clipboard button (Electron clipboard via IPC). `get` lets passwords copy the decrypted value without showing it. */
export function CopyBtn({ text, get, label = 'value' }: { text?: string | null; get?: () => Promise<string | null>; label?: string }) {
  const [st, setSt] = useState<'' | 'ok' | 'err'>('');
  if (!get && !text) return null;
  const go = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try { const v = get ? await get() : text; if (v == null) throw new Error('empty'); await window.desklist.copyText(v); setSt('ok'); }
    catch { setSt('err'); }
    setTimeout(() => setSt(''), 1300);
  };
  return <button type="button" className={`copybtn ${st}`} title={`Copy ${label}`} aria-label={`Copy ${label}`} onClick={go}>
    {st === 'ok' ? 'Copied' : st === 'err' ? 'Failed' : '⧉'}</button>;
}
export const revealTaskField = (id: string) => async () =>
  (await window.desklist.request<{ value: string | null }>('GET', `/api/task-fields/${id}/reveal`)).value;
export const revealProjectSecret = (pid: string, fid: string) => async () =>
  (await window.desklist.request<{ value: string | null }>('GET', `/api/projects/${pid}/secret/${fid}`)).value;
