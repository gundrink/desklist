# Desklist environment variables

Never commit real values. `server/.env` is git-ignored; `server/.env.example` has placeholders.

## Sync server (`server/`, Railway service `server` in project `desklist`)

| Variable | Required | Secret | Description |
|---|---|---|---|
| `NEON_DATABASE_URL` | **yes** | **yes** | Neon Postgres connection string. All tables live in schema `desklist`. Neon hosts use `@neondatabase/serverless` over port 443 (5432 may be blocked). `DATABASE_URL` is accepted as a fallback name. |
| `APP_ENCRYPTION_KEY` | **yes** | **yes** | 16+ (ideally 32+) chars. AES-256-GCM key material for secret master fields (project passwords). Must stay identical forever, or stored secrets can't be decrypted. |
| `PORT` | no | no | HTTP/WebSocket port. Railway injects it (service uses 8080); local default 8787. |
| `PUBLIC_SERVER_URL` | no | no | Public base URL of this server (e.g. the Railway URL). Informational / for tooling; the app's default comes from `DESKLIST_SERVER_URL` at build time. |
| `SIGNIN_RATE_LIMIT` | no | no | Max failed sign-ins per IP per 15 min (default 10). |
| `NODE_ENV` | no | no | `production` on Railway. |
| `COINGECKO_API_KEY` | no | yes | Optional CoinGecko key for `simple/price`. Without it the public API is used. |
| `COINGECKO_API_PLAN` | no | no | `demo` (default; `x-cg-demo-api-key` on api.coingecko.com) or `pro` (pro-api.coingecko.com). |
| `PRICE_CACHE_SECONDS` | no | no | Price cache TTL, default 300 (≈5 min). On fetch failure the last cached rate is served (marked `stale`). |
| `SOLANA_RPC_URL` | no | maybe | **Reserved, unused in v5.** For future on-chain payout verification. |
| `DESKLIST_DB_DRIVER` | no | no | Set `http` to use the Neon HTTP driver (`sql.query`) instead of the WebSocket pool. |

## Desktop app (`app/`)

| Variable | When | Required | Secret | Description |
|---|---|---|---|---|
| `DESKLIST_SERVER_URL` | runtime | no | no | Overrides the server URL (also overrides the saved setting). |
| `DESKLIST_DEFAULT_SERVER_URL` | build | no | no | Default server URL baked into the build (set to the Railway URL for release builds). Default: the Railway URL; dev runs use `http://localhost:8787`. |
| `DESKLIST_DISABLE_UPDATES` | runtime | no | no | `1` disables electron-updater checks. |
| `DESKLIST_USER_DATA` | runtime | no | no | Alternate userData dir (tests / multiple profiles). |
| `DESKLIST_WIN_ATTACH` | runtime | no | no | Windows desktop-layer mode override (see `app/src/main/desktop-layer/windows.ts`). |
| `DESKLIST_SMOKE` | runtime | no | no | Smoke-test/screenshot mode (dev only). |

## Release / update feed

| Variable | Required | Secret | Description |
|---|---|---|---|
| `GH_TOKEN` | to publish | **yes** | GitHub token (repo scope) for `electron-builder --publish` / uploading release assets to `ponkssol/desklist`. Because the repo is private, auto-update clients would also need a token — publish releases to a public repo (or a generic HTTPS feed) for end-user auto-update. |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | to sign | yes | Code-signing certificate (Windows / macOS). Builds are currently unsigned. |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | to notarize | yes | macOS notarization (placeholder; not configured). |
