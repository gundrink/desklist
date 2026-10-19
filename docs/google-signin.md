# Design note: Google sign-in (not implemented)

Status: proposal only. Nothing below is built yet.

## Flow
1. The app (Electron) never shows Google's page in an embedded webview. It opens the **system browser**.
2. The app starts a one-shot **loopback** listener on `http://127.0.0.1:<random port>/oauth` and creates a **PKCE**
   pair (`code_verifier`, `code_challenge = BASE64URL(SHA256(verifier))`) plus a random `state`.
3. It opens `https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=http://127.0.0.1:<port>/oauth&response_type=code&scope=openid%20email%20profile&code_challenge=…&code_challenge_method=S256&state=…`.
4. Google redirects to the loopback with `code` + `state`. The app checks `state` and sends `{ code, code_verifier, redirect_uri }` to the Desklist server.
5. The **server** exchanges the code at `https://oauth2.googleapis.com/token` (with the client secret), then
   **verifies the ID token**: signature against Google's JWKS, `aud == GOOGLE_CLIENT_ID`, `iss` is `accounts.google.com`, `exp`, `email_verified == true`.
   Use `google-auth-library` (`OAuth2Client.verifyIdToken`).
6. **Member matching**: the server looks up a member whose `google_email` (lower-case) equals the token's email.
   Admins add or change that email in *Team & codes*. No match means 403 "Ask your admin to add this Google account".
   Google sign-in never creates members or teams by itself.
7. On a match, the server issues a normal Desklist session (same `SESSION_TTL_DAYS`, default 5 days, fixed).

## Google Cloud setup
- Create an OAuth client of type **"Desktop app"**. Google allows any `127.0.0.1` loopback port for this type.
- Scopes: `openid email profile`.

## Server env vars
| Var | Secret | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | no | Desktop-app OAuth client id; also the expected `aud` of ID tokens |
| `GOOGLE_CLIENT_SECRET` | yes* | Used in the server-side code exchange. *Google treats desktop secrets as not truly confidential; PKCE is the real protection, but keep it on the server anyway. |

## Schema change
- `members.google_email text UNIQUE NULL`. It is set by an admin only.

## Relation to passkeys (built in 0.6.1)
Passkeys use the same pattern: system browser, a 127.0.0.1 loopback redirect and a PKCE-style verifier.
The difference is that the WebAuthn ceremony runs on the Desklist server's own https origin (`/passkey/login`). The server
issues a one-time code, and the app exchanges it with its verifier at `/api/auth/passkey/exchange`. Google sign-in can reuse
the loopback helper (`app/src/main/passkey.ts`) and the session issuing (`issueSession`) unchanged.
