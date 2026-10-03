# Web client (`apps/web`)

Next.js 16 (App Router) + React 19. The client is a _view_: every game and
economy decision is made by the servers. Decisions: ADR-010 (web first),
ADR-012 (session handling, realtime client, state model).

## Pages

| Route                       | Purpose                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                         | Landing                                                                                                                                                  |
| `/register`, `/login`       | Account creation / sign-in (`?next=` only follows same-origin paths)                                                                                     |
| `/clubs`                    | My clubs, create a club, join with a join/invite code                                                                                                    |
| `/clubs/[clubId]`           | Lobby: wallet, tables, members; staff (ADMIN+) create tables and grant chips                                                                             |
| `/tables/[tableId]`         | Poker table                                                                                                                                              |
| `/profile`                  | Signed-in devices (sessions) with remote sign-out                                                                                                        |
| `/hands`, `/hands/[handId]` | Hand history: results, board, own cards, shown cards, public action log (ADR-008)                                                                        |
| `/clubs/[clubId]/admin`     | Club console (AGENT+): members/roles/bans/ownership, invites, chips & ledger (grants, deductions, reversals), tables (close), hands, audit log, settings |
| `/admin`                    | Platform console (PLATFORM_ADMIN): overview, accounts, clubs, risk cases, audit log                                                                      |

Protected pages render through `RequireAuth`, which redirects anonymous
visitors to `/login?next=…`. Role checks in the UI only hide controls; the
control API enforces every permission.

## Layers

| Module                       | Responsibility                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/lib/api/client.ts`      | HTTP client: in-memory access token, cookie refresh, single-flight + Web Locks, error envelope → `ApiError` |
| `src/lib/api/endpoints.ts`   | Typed endpoint wrappers (types generated from `control-api.yaml`); idempotency keys per user intent         |
| `src/lib/realtime/client.ts` | Gateway protocol client (HELLO/AUTH, backoff, resume, command re-send, heartbeats)                          |
| `src/lib/table/state.ts`     | Pure table reducer (snapshot replace, strict seq order, gap → stale)                                        |
| `src/lib/table/actions.ts`   | Legal-action presentation: call amounts, bet presets (min, ½ pot, pot, all-in), command building            |
| `src/lib/table/useTable.ts`  | React hook: subscription lifecycle, resync policy, command sending with `expectedSeq`                       |
| `src/lib/session.tsx`        | Session provider; one API + realtime client per tab                                                         |
| `src/components/table/*`     | Felt, seats, cards, timer, action bar, buy-in dialog, log                                                   |

## Table behaviour

- Actions are enabled only while the socket is `open`, the state is not
  stale, and the server's `legalActions` say it is the viewer's turn. Every
  command carries `expectedSeq` (the last applied seq); a
  `STALE_GAME_STATE`/`NOT_YOUR_TURN` rejection triggers a resync.
- Bet/raise amounts are "to" amounts. Choosing the maximum sends `ALL_IN`.
- Opponents' cards are drawn face down until the server reveals them at
  showdown; the client never receives them earlier (ADR-008).
- The turn timer uses `deadline - serverTime` relative to the receipt time,
  immune to client clock skew. The server enforces the timeout.
- Leaving mid-hand returns `LEAVING_AFTER_HAND`; the stack is cashed out to
  the club wallet when the hand ends.
- The hand's deck commitment (SHA-256) is shown for audit.

## Testing

- Unit (Jest, `pnpm --filter @kofclub/web test`): reducer (complete hand with
  chip conservation at every step, gaps, duplicates, voids, resume), action
  helpers, realtime client against a fake socket (HELLO, resume, command
  re-send, timeouts, 4401 handling, AUTH refresh, heartbeats), API client
  (single-flight refresh, retry after expiry, error envelope).
- End-to-end (`make e2e` → `scripts/e2e.sh`): recreates the `kofclub_e2e`
  database, builds and starts every service natively on ports 3100/4400/4500/4600,
  then Playwright drives two browsers: register, create/join a club, grant
  chips, create a table, sit, play a full hand (private cards checked in the
  DOM), reload mid-hand (state and hole cards restored), leave, and verify
  that table stacks and club wallets reconcile. A second spec covers the
  login redirect flow and asserts the refresh cookie is HttpOnly/Strict and
  invisible to `document.cookie`.
  Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use a pre-installed Chromium and
  `E2E_SCREENSHOT_DIR` to capture screenshots.
