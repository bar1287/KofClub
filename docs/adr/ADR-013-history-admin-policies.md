# ADR-013: Hand history, table closure and administrative enforcement

Status: Accepted
Date: 2026-10-03

## Context

M7 adds hand history, club administration and platform administration.
Each touches an existing invariant: card privacy (ADR-008), chip
conservation (ADR-003), table ownership (ADR-002) and the rule that
enforcement must be explainable and reviewed (spec §11).

## Decisions

1. **History read model.** The control-api History module reads hands,
   participants and the persisted _public_ event log directly (the game
   service owns those rows; history is read-only). Finished hands only
   (`COMPLETED`/`VOIDED`); keyset pagination on time-ordered UUIDv7 hand ids.
2. **Own hole cards come from the game plane.** Hole cards stay encrypted
   with a key held only by game nodes. control-api asks
   `GET /internal/v1/hands/{id}/hole-cards?userId=<requester>`; the row is
   selected by (hand, user), so other players' cards are unreachable. If the
   game plane is down the public record is still served (`myHoleCards: null`).
3. **Visibility.** Participants: public record + own cards. Club ADMIN+ and
   platform admins: public record only (no "god view", ADR-008). Everyone
   else: `HAND_NOT_FOUND` (existence is not revealed).
4. **Closing a table** is terminal. The directory row flips to `CLOSED`
   first (so no path can seat anyone), then the owning actor stops dealing
   and cashes all seats out in one atomic commit once no hand is running.
   The actor re-checks the directory before each hand and on start, so the
   closure converges even if the notification is lost or the node crashes.
5. **Suspensions.** A suspended _account_ loses every session immediately
   (HTTP checks PostgreSQL per request; live sockets are closed via the
   revocation channel). A suspended _club_ is view-only: no seats, tables,
   chip movements or membership changes; hands in progress finish and
   players can always leave, so chips never get stuck.
6. **Platform admins** are created only by an operator CLI with database
   access (`make platform-admin`), never over HTTP, and cannot be suspended
   through the API. Roles are read from PostgreSQL on every request.
7. **Risk review** records a disposition and a note; evidence columns stay
   immutable (trigger). A disposition never enforces anything by itself;
   suspension is a separate, audited action.

## Consequences

- History queries hit the primary database; at scale they move to a read
  replica or a history projection (spec §18), without API changes.
- Players cannot verify the deck commitment themselves: revealing the deck
  would expose folded cards. The commitment supports internal audits.
- A crashed game plane hides own hole cards in history until it recovers.
