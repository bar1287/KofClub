# ADR-008: Card privacy, logging and hand-history visibility

Status: Accepted
Date: 2026-10-03

## Decision

- The deck exists only inside the owning game node. The full deck is never
  sent to any client or the gateway.
- Hole cards are delivered only in the private payload addressed to their
  owner. Public events never contain unrevealed cards.
- Persisted decks/hole cards are encrypted at rest (AES-256-GCM,
  `DECK_ENCRYPTION_KEY_B64`); `hands.deck_commitment` stores a SHA-256
  commitment (deck order + server salt) for audit.
- Logging ban: hole cards before hand completion, deck order, passwords,
  refresh tokens, full Authorization headers and private user data are never
  logged, traced or included in errors.
- Hand-history visibility:
  - A participant sees the public action log, the board, cards shown at
    showdown, and their own hole cards.
  - Mucked/folded cards of other players are never visible to players.
  - Club owners/admins see the same as a participant (no hole-card
    "god view") in the MVP. A future audited review tool for platform
    admins may decrypt cards for fraud investigation; that requires an ADR.

## Consequences

Investigations rely on public action logs and risk telemetry until an
audited decryption tool exists.
