/**
 * Live USD prices from CoinGecko's public simple/price API, cached ~5 minutes.
 * On failure the last cached table is returned (marked stale). Optional COINGECKO_API_KEY.
 */
import { CURRENCIES, type CurrencyCode, type PriceTable } from '@desklist/shared';

const TTL = Number(process.env.PRICE_CACHE_SECONDS ?? 300) * 1000;
export type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export class PriceService {
  private table: PriceTable | null = null;
  private at = 0;
  private inflight: Promise<PriceTable> | null = null;
  constructor(private fetcher: Fetcher = (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(8000) }) as any, private ttl = TTL) {}

  url() {
    const key = process.env.COINGECKO_API_KEY;
    const ids = CURRENCIES.map((c) => c.geckoId).filter(Boolean).join(',');
    // Pro keys use pro-api; demo keys use the public host with x-cg-demo-api-key.
    const pro = key && process.env.COINGECKO_API_PLAN === 'pro';
    return `https://${pro ? 'pro-api' : 'api'}.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,idr`;
  }

  async get(): Promise<PriceTable> {
    if (this.table && Date.now() - this.at < this.ttl) return this.table;
    this.inflight ??= this.refresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async refresh(): Promise<PriceTable> {
    try {
      const key = process.env.COINGECKO_API_KEY;
      const headers: Record<string, string> = { accept: 'application/json' };
      if (key) headers[process.env.COINGECKO_API_PLAN === 'pro' ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'] = key;
      const r = await this.fetcher(this.url(), { headers });
      if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`);
      const j = await r.json();
      const usd: Partial<Record<CurrencyCode, number>> = { USD: 1 };
      for (const c of CURRENCIES) if (c.geckoId && j[c.geckoId]?.usd) usd[c.code] = Number(j[c.geckoId].usd);
      const btc = j.bitcoin;
      if (btc?.usd && btc?.idr) usd.IDR = btc.usd / btc.idr; // USD per 1 IDR
      if (!usd.SOL) throw new Error('CoinGecko response missing SOL');
      this.table = { usd, fetchedAt: new Date().toISOString(), stale: false, source: 'coingecko' };
      this.at = Date.now();
      return this.table;
    } catch (e) {
      if (this.table) { this.at = Date.now() - this.ttl + 60_000; return { ...this.table, stale: true }; } // retry in 1 min
      return { usd: { USD: 1 }, fetchedAt: null, stale: true, source: `unavailable: ${(e as Error).message}` };
    }
  }
}
