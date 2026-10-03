# ADR-012: Browser session handling and the reference realtime client

Status: Accepted
Date: 2026-10-03

## Context

The web client (M6) must keep a player signed in across reloads, keep a
live WebSocket authenticated, and mirror table state without ever becoming
a source of truth. Constraints from earlier decisions:

- Refresh tokens rotate on every use and a reused token revokes the whole
  session (M1). Two concurrent refreshes with the same token — two tabs, or
  React StrictMode running effects twice — would log the user out.
- The gateway authenticates with the access token in the first frame only
  and closes with `4401` when it expires (ADR-004, docs/realtime-protocol.md).
- Clients must apply events strictly in `seq` order, replace state on a
  snapshot and resubscribe with `lastSeenSeq` after a gap (ADR-004).

## Decision

1. **Tokens.** The access token lives only in memory. The refresh token is
   delivered as the HttpOnly, SameSite=Strict `kof_rt` cookie scoped to
   `/v1/auth` (`X-Auth-Transport: cookie`), so scripts cannot read it. A page
   load restores the session with one `POST /v1/auth/refresh`.
2. **Single refresh at a time.** Refreshes are single-flight within a tab
   (shared promise) and serialized across tabs with the Web Locks API
   (`navigator.locks`, lock `kofclub-auth-refresh`); a second tab waiting on
   the lock then rotates the already-updated cookie.
3. **Realtime client** (`apps/web/src/lib/realtime/client.ts`): HELLO on every
   connection, AUTH with a freshly refreshed token a minute before expiry,
   token refresh + reconnect on `4401` (bounded retries), exponential backoff
   with equal jitter for every other close, application-level PING to detect
   half-open sockets, and automatic resubscription with `lastSeenSeq`.
   Commands are kept until their `COMMAND_RESULT` and re-sent with the **same
   requestId** after a reconnect; server-side idempotency makes that safe.
4. **Table state** is a pure reducer (`apps/web/src/lib/table/state.ts`):
   snapshots replace state, events apply only when `seq == lastSeq + 1`,
   a gap marks the state stale (actions disabled) and triggers a replay
   resubscribe, falling back to a snapshot if continuity is still not
   restored. Turn deadlines are converted to the local clock from each
   frame's `serverTime`, so client clock skew does not distort timers.

## Consequences

- XSS cannot exfiltrate the refresh token, but a script running in the page
  could still act as the user while the page is open (inherent to any
  browser session); CSP hardening is tracked for M8.
- A reload that aborts an in-flight refresh after the server rotated the
  token loses the new cookie; the next refresh is treated as reuse and the
  user must log in again. The window is one request long; a server-side grace
  period would weaken reuse detection, so it is deliberately not added.
- The reducer duplicates a small amount of server state logic (stack and pot
  bookkeeping between turns). Every `TURN_STARTED`, `HAND_COMPLETED` and
  snapshot carries authoritative values that overwrite it, and unit tests
  assert chip conservation over complete hands.
- Native/Unity clients (ADR-010) follow the same rules; the TypeScript
  client is the reference implementation of the protocol's client side.
