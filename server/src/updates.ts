/** 0.6.14 update feed proxy: serves electron-updater files from the newest GitHub release (prereleases included)
 *  of the private repo using the server's own GH_TOKEN. The desktop app never holds a GitHub token. */
import type { Express, Request, Response } from 'express';
import { Readable } from 'node:stream';

type Rel = { tag_name: string; draft: boolean; prerelease: boolean; published_at: string | null; assets: { id: number; name: string; size: number }[] };
export function registerUpdates(app: Express, opts: { token?: string; repo?: string; fetchImpl?: typeof fetch; log?: (m: string) => void } = {}) {
  const token = opts.token ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN; const repo = opts.repo ?? process.env.UPDATES_REPO ?? 'ponkssol/desklist';
  const f = opts.fetchImpl ?? fetch; let cache: { at: number; rel: Rel | null } | null = null;
  const gh = (url: string, accept = 'application/vnd.github+json', extra: Record<string, string> = {}) =>
    f(url, { headers: { accept, 'user-agent': 'desklist-update-proxy', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, redirect: 'follow' });
  async function latest(): Promise<Rel | null> {
    if (cache && Date.now() - cache.at < 5 * 60_000) return cache.rel;
    const r = await gh(`https://api.github.com/repos/${repo}/releases?per_page=20`);
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const list = (await r.json()) as Rel[];
    // newest published non-draft release that carries an update manifest
    const rel = list.filter((x) => !x.draft && x.assets.some((a) => /^latest(-mac|-linux)?\.yml$/.test(a.name)))
      .sort((a, b) => Date.parse(b.published_at ?? '0') - Date.parse(a.published_at ?? '0'))[0] ?? null;
    cache = { at: Date.now(), rel }; return rel;
  }
  const serve = async (req: Request, res: Response) => {
    try {
      const name = String(req.params.file ?? '');
      if (!/^[\w.\- ]{1,200}$/.test(name)) return res.status(400).json({ error: 'Bad file name' });
      if (!token) return res.status(503).json({ error: 'Updates are not configured' });
      const rel = await latest(); const asset = rel?.assets.find((a) => a.name === name);
      if (!asset) return res.status(404).json({ error: 'Not found' });
      const range: Record<string, string> = req.headers.range ? { range: String(req.headers.range) } : {};
      const up = await gh(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`, 'application/octet-stream', range);
      if (!up.ok && up.status !== 206) return res.status(502).json({ error: `Upstream ${up.status}` });
      res.status(up.status);
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) { const v = up.headers.get(h); if (v) res.setHeader(h, v); }
      if (/\.yml$/.test(name)) res.setHeader('cache-control', 'no-cache');
      if (req.method === 'HEAD' || !up.body) return res.end();
      Readable.fromWeb(up.body as any).pipe(res);
    } catch (e) { opts.log?.(`[updates] ${(e as Error).message}`); if (!res.headersSent) res.status(502).json({ error: 'Update feed unavailable' }); }
  };
  app.get('/updates/:file', serve); app.get('/updates/:plat/:file', serve);
}
