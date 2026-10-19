# Desklist

Desktop-level team project checklists for **macOS + Windows**.

- **Widget** — a frameless dark-glass panel pinned at wallpaper level (above the wallpaper, below normal windows, never always-on-top). Project rail (A, B, C, D, F, G…) + detail: progress, status, PIC, Pending tasks, Done tasks with the checker's initials, inline add-task row, **Notes** menu (Input notes / column / field / data). Daily updates never need the main window.
- **Manage window** — dark project-card column on the left, project detail on the right: *Checklist* (Done on top, Pending below, Due / Checked by / Notes columns, inline note editor, add-task title + date) and *Details & fields* (master fields + free-form project columns, promote a column to a master field). Plus **New project**, **Master fields** (add / edit / reorder / archive at runtime) and **Team & codes** (generate / reset / revoke sign-in codes).
- **Ticking a task auto-approves it** — the server records the signed-in member (from the session token, never from the request body) as `approved_by_member_id` / `approved_at` (and BIC). Unticking clears it. Tasks have no required BIC.
- Both windows share one data layer (main-process `SyncEngine`) and update live; other machines update via the server's WebSocket broadcast.

```
desklist/
├─ shared/   @desklist/shared – TypeScript types shared by app + server
├─ server/   Node + TypeScript sync server (Express REST + ws WebSocket). The ONLY thing that touches PostgreSQL.
│   ├─ migrations/*.sql   idempotent schema (everything in schema `desklist`)
│   ├─ src/migrate.ts, src/seed.ts (DEMO data), src/app.ts (API), test/api.test.ts
│   └─ Dockerfile, railway.json (Railway-ready: PORT env, start script)
├─ app/      Electron + React + TypeScript (electron-vite)
│   ├─ src/main/            windows, tray, single-instance, settings, sync engine, updater
│   │   └─ desktop-layer/   macos.ts (type 'desktop'), windows.ts (koffi + user32 attach)
│   ├─ src/preload/         contextBridge API
│   ├─ src/renderer/        React UI (widget + manage share components/hooks)
│   ├─ scripts/smoke.mjs    Playwright-driven smoke run + screenshots
│   └─ electron-builder.yml dmg (mac) / nsis (win), GitHub publish placeholders
└─ screenshots/             real captures from the smoke run
```

## Demo data (clearly marked)

`npm run db:seed` creates **Demo Team** (`is_demo = true`, shown with *DEMO* badges in the UI):

| Member | Initials | Role | Sign-in code |
|---|---|---|---|
| Alex Morgan | AM | admin | `DEMO-ADMIN` |
| Sam Carter | SC | member | `DEMO-0001` |
| Jordan Lee | JL | member | `DEMO-0002` |

Projects **A** (12 tasks, 7 done), **B** (9/3), **C** (5/0), **D** (4/2), **F** (4/4), **G** (6/2) — no E — with sample master values (PIC, emails, domain, encrypted password, status) and custom columns (Source, Repo link, Deadline, Budget). Re-running the seed is safe: it keeps your edits and only resets the demo codes. **Change or revoke the demo codes before real use.**

## Local setup (macOS and Windows)

Requirements: **Node.js 20+** (includes npm), Git. On Windows use PowerShell; on macOS, Terminal.

```bash
git clone <your repo> desklist   # or unzip desklist.zip
cd desklist
npm install
```

> npm 11 gates install scripts; the root `package.json` already allow-lists the ones we need (`electron`, `esbuild`, `koffi`, `electron-winstaller`). If npm still reports skipped scripts, run `npm install-scripts approve electron esbuild koffi` and `npm install` again.

### 1. Environment variables (server)

Create `server/.env` (git-ignored — never commit it) from `server/.env.example`:

```
NEON_DATABASE_URL=postgresql://USER:PASSWORD@YOUR-ENDPOINT.neon.tech/neondb?sslmode=require
APP_ENCRYPTION_KEY=<32+ random characters — keep it stable, it decrypts stored secrets>
PORT=8787
```

Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
You can instead set them as real environment variables (macOS: `export NEON_DATABASE_URL=...`; Windows PowerShell: `$env:NEON_DATABASE_URL="..."`). Real env vars win over `server/.env`.

- Hosts ending in `neon.tech` use `@neondatabase/serverless` over port 443 (WebSocket pool with transactions; set `DESKLIST_DB_DRIVER=http` to force the HTTP driver). Any other host uses plain `pg`.
- Secret master fields (e.g. *Password*) are AES-256-GCM encrypted with `APP_ENCRYPTION_KEY`. **The secrets seeded on the shared Neon DB were encrypted with the key generated on the build box**; with a different key they show as stored but cannot be revealed — just re-enter them.

### 2. Migrate + seed

```bash
npm run db:migrate     # creates schema `desklist` + tables (idempotent)
npm run db:seed        # DEMO team, members, projects (idempotent)
```

### 3. Start the sync server

```bash
npm run server:dev     # tsx watch, http://localhost:8787   (health: /health)
# or production style:
npm run build -w server && npm run server:start
```

### 4. Start the app

```bash
npm run app:dev        # electron-vite dev (hot reload), points at http://localhost:8787
# or the built app:
npm run build -w app && npm run app:start
```

Sign in with `DEMO-ADMIN`. The widget appears at the right of your primary screen; the Manage window opens from the widget's ⋯ menu (or the tray / menu-bar icon). Use a different server with `DESKLIST_SERVER_URL=https://… npm run app:dev` or the *Server:* link on the sign-in screen.

### 5. Tests

```bash
npm test               # vitest against the real DB in NEON_DATABASE_URL (creates and deletes a TEST team)
npm run typecheck
# Electron smoke + screenshots (Linux CI with Xvfb; server must be running):
xvfb-run -a -s "-screen 0 1920x1080x24" npm run smoke -w app
```

### 6. Build installers

Build on the target OS:

```bash
npm run dist:mac       # on a Mac  → app/release/Desklist-<v>.dmg (+ .zip for auto-update)
npm run dist:win       # on Windows → app/release/Desklist Setup <v>.exe (NSIS)
```

**Auto-update:** `electron-updater` checks GitHub Releases in packaged builds. Edit `app/electron-builder.yml` → `publish.owner` / `publish.repo` (currently `YOUR_GITHUB_OWNER` / `YOUR_GITHUB_REPO` placeholders) and publish with `GH_TOKEN=… npx electron-builder --publish always` from `app/`. Also change `appId` (`app.desklist.desktop` placeholder).

**macOS signing/notarization** needs an Apple Developer account: set `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` and switch `mac.notarize` to `true`. Unsigned builds run after right-click → Open. Windows builds are unsigned unless you provide a code-signing certificate (`CSC_LINK` / `WIN_CSC_LINK`).

## How it works

- **Sync:** REST for reads/mutations, WebSocket `/ws?token=…` for change notifications. The server broadcasts `{type:'changed'}` to the team after every mutation; clients re-fetch `/api/snapshot`.
- **Offline:** the app keeps `cache.json` (last snapshot) and `outbox.json` (queued mutations) in the user-data folder. Mutations apply optimistically, flush in order, and replay on reconnect (client-generated UUIDs make creates idempotent). **Last-write-wins** on `updated_at`: each op carries the local edit time; the server ignores a write older than what it has.
- **Auth:** code-only sign-in. Codes are bcrypt-hashed (plus a 2-hex-char sha256 bucket to avoid comparing every hash), failed attempts are rate-limited per IP (`SIGNIN_RATE_LIMIT`, default 10 / 15 min). Admins generate/reset/revoke codes in *Team & codes* (reset/revoke kills existing sessions). The session token is stored with Electron `safeStorage` (Keychain / DPAPI).
- **Widget window:** single-instance lock (relaunch re-shows it), remembers position/size, optional *Lock position* and *Launch at login* (⋯ menu or tray). Closing hides it; *Quit Desklist* in the tray/menu-bar quits.
  - macOS: `type: 'desktop'`, transparent, `setVisibleOnAllWorkspaces`, Dock icon hidden (`LSUIElement`).
  - Windows: `app/src/main/desktop-layer/windows.ts` — koffi + user32: sends Progman `0x052C`, finds the window hosting `SHELLDLL_DefView` (Progman on Win11 24H2+, a WorkerW on Win10), `SetParent`s the widget into it and orders it with `SetWindowPos` so it survives Win+D. `DESKLIST_WIN_ATTACH=owner` uses an owner relationship instead; `=bottom` (and automatic fallback) keeps it at `HWND_BOTTOM`.

## Known limitations

- **Not verifiable on the Linux build box:** the Windows desktop-layer attach (needs testing on real Win10 and Win11 machines, incl. multi-monitor / DPI scaling and Explorer restarts) and the macOS desktop-level behaviour (Spaces, Mission Control, keyboard focus in a desktop-level window). On Linux the widget is a normal frameless window.
- macOS signing/notarization requires an Apple Developer account; Windows code signing requires a certificate.
- The server must run locally (or somewhere you host it) until it is deployed to Railway (`server/Dockerfile` + `railway.json` are ready; set `NEON_DATABASE_URL`, `APP_ENCRYPTION_KEY` there).
- Backdrop blur of the real desktop isn't available to Electron windows; the widget uses a semi-opaque dark glass gradient instead.
- Project create, master-field admin, member codes and secret reveal need a live connection (they are not queued offline); task / notes / value / column edits work offline.
- Master field definitions are global (shared by all teams on one server).
- The `00-desktop-composite.png` screenshot is a composite of real window captures on a generated wallpaper (Xvfb has no desktop); all other screenshots are direct captures.
