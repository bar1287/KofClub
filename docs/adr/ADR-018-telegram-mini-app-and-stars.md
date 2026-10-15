# ADR-018: Telegram Mini App, Telegram sign-in and Stars for non-game digital goods

Status: Accepted
Date: 2026-10-15
Amends: ADR-006 (adds a narrow carve-out for Telegram Stars), ADR-012 (refresh
token transport inside Telegram)

## Context

Most of our players already organise their home games in Telegram groups.
Telegram can open a web app inside the chat ("Mini App") and hands it signed
launch data that identifies the Telegram user, so the existing Next.js client
can run there without a separate native app. The product owner also wants to
fund the service. Inside Telegram, digital goods and services must be sold
for Telegram Stars (XTR), Telegram's in-app currency.

ADR-006 forbids anything that turns chips into money, or money into chips.
That rule stays. This ADR decides how Telegram fits around it.

## Decision

### Mini App and sign-in (roadmap T1)

- **One web app.** The Mini App is the same web client served from a public
  https URL (`TELEGRAM_MINI_APP_URL`). The bot's menu button and its
  `/start` reply open it. No second client and no Telegram-only game logic.
- **Launch data is the only Telegram credential.** The client sends the raw
  `initData` string to `POST /v1/auth/telegram`. The API checks its
  HMAC-SHA256 signature (secret = HMAC-SHA256("WebAppData", bot token)) with a
  constant-time comparison. It also checks `auth_date` against
  `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` (default one hour, 60 seconds of clock
  skew allowed) and rejects duplicate keys and oversized data. Nothing the
  client says about the Telegram user is trusted beyond that signature.
- **Accounts.** `telegram_accounts` links at most one Telegram user to one
  KofClub user, and the reverse. An unknown Telegram user gets
  `TELEGRAM_NOT_LINKED`; the client then offers either:
  - _Continue with Telegram_ (`create: true`), which makes a Telegram-only
    account with no email and no password;
  - logging in with a password and linking (`POST /v1/me/telegram`).
    Making both choices explicit means a password login inside someone else's
    Telegram never silently links accounts. A deferred constraint trigger
    guarantees every user can sign in (a password or a Telegram link).
    Unlinking is refused for Telegram-only accounts. Two-factor
    authentication still applies to Telegram sign-in (ADR-017).
- **Refresh token inside Telegram.** Telegram Web shows the Mini App in a
  frame from `web.telegram.org`, where our `SameSite=Strict` refresh cookie
  is not sent. Inside Telegram (and only there) the client keeps the
  rotating refresh token in memory instead (body transport, never written
  to storage). A reload signs in again with the launch data, which is kept
  in `sessionStorage` for the tab as Telegram's own script does. Trade-off:
  an injected script in that tab could read the in-memory token. The CSP
  (nonces, `strict-dynamic`, no inline scripts) is the mitigation. Outside
  Telegram nothing changes.
- **Framing.** When the deployment names a bot (`TELEGRAM_BOT_USERNAME` set
  for the web server), CSP `frame-ancestors` allows `'self'` and
  `https://web.telegram.org`, and `X-Frame-Options` is omitted, since it
  cannot express an allow-list. Otherwise `frame-ancestors 'none'` and
  `X-Frame-Options: DENY` stay.
- **Telegram's script** (`telegram.org/js/telegram-web-app.js`) is loaded
  only inside Telegram, by our own nonce-trusted code (`strict-dynamic`).
- **Bot webhook.** `POST /v1/telegram/webhook` must carry the configured
  secret in `X-Telegram-Bot-Api-Secret-Token`. A wrong secret gets 401, and
  404 is returned when Telegram is off. The bot answers `/start` (with an
  optional club code), `/help`, `/terms` and `/paysupport`. The bot token
  appears only in configuration. It is never logged, and the API client
  never logs request URLs, which contain it.
- **Club links.** `t.me/<bot>?startapp=c-<CODE>` opens the Mini App on
  `/join?code=CODE`. Joining still needs an explicit tap.

### Telegram Stars (roadmap T2): what may be sold

Stars may buy **only digital goods that do not touch gameplay or chips**:

1. **Club Pro**, a 30-day Stars subscription for a club's owner, covering
   club management extras and limits.
2. **Cosmetics**: premium table felts and card backs, bought once.
3. **Tips** to the developers.

Stars must **never** buy or be exchanged for:

- chips;
- seats, buy-ins, re-buys or top-ups;
- tournament entries;
- prizes;
- odds, information or any in-game advantage.

No game result, chip balance or ledger entry can be turned into Stars, and
chips never leave the ledger for anything Stars-related. No player-to-player
Stars transfers, no Stars-funded prize pools, and no "entry fee" collected
for club owners. Payments are recorded in their own tables, separate from
the chip ledger. They are idempotent by Telegram's charge id. Refunds are
handled by platform admins, with MFA and an audit record.

The terms page (`/terms`) and the bot's `/terms` state that playing for
money in any form, including settling up outside the app, is forbidden.

## Consequences

- AGENTS.md rule 11 gains the carve-out above. Anything beyond it (selling
  chips for Stars, Stars prizes, cash-outs) remains forbidden by ADR-006 and
  needs a superseding ADR plus legal review.
- Telegram is optional. With no `TELEGRAM_*` configuration the platform runs
  exactly as before: the endpoints answer `TELEGRAM_NOT_CONFIGURED` (or 404
  for the webhook) and the client shows nothing Telegram-specific.
- `users.email` and `users.password_hash` became nullable (migration 000017).
  Code that reads them must handle null, and the down migration refuses to
  run while Telegram-only users exist.
- The Mini App needs a public https deployment. Local development can use a
  tunnel (see docs/telegram.md).
