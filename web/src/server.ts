/** Same hosted server as the packaged desktop app (app/electron.vite.config.ts). */
export const DEFAULT_SERVER = 'https://server-production-46b2.up.railway.app';

export function normalizeServer(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_SERVER;
  if (!/^https?:\/\//i.test(trimmed)) throw new Error('Server URL must start with http:// or https://');
  return trimmed;
}
