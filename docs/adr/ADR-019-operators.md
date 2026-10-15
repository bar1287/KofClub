# ADR-019: Operators — other people's Telegram bots, each a separate world

Status: Accepted
Date: 2026-10-15
Builds on: ADR-018 (Telegram Mini App). Keeps: ADR-006 (virtual chips only).

## Context

The owner wants KofClub to be a poker game provider. Anyone can create a
Telegram bot, plug it into KofClub and run their own poker service, with
their own name and players. KofClub runs the games. Telegram pays Stars to
the bot that sells, so KofClub cannot take a cut of an operator's in-bot
sales. KofClub instead charges operators directly through its own bot
(roadmap T5).

## Decision

**Worlds.** An operator is a row in `operators`. Users and clubs carry an
`operator_id`; NULL means KofClub's own world, so existing data does not
move. Worlds never mix:

- A club is created in its creator's world.
- Join and invite codes of another world look invalid.
- `ClubAccessService` hides other worlds' clubs. Platform administrators,
  who are in KofClub's world, still oversee every world.
- A database trigger refuses a club owner or member from another world.
- A Telegram user has one account per world:
  `UNIQUE NULLS NOT DISTINCT (operator_id, telegram_user_id)`. A composite
  foreign key ties each link to its user's world.

Usernames stay unique across all worlds, which keeps login, the CLI and
admin search simple. Telegram sign-up picks a free name, as before.

**Sign-in.** An operator's world is Telegram-only: a CHECK constraint keeps
email and password NULL there. The operator's Mini App URL is
`TELEGRAM_MINI_APP_URL/?op=<slug>`. The web client keeps the slug for the
tab and sends `operator` with `POST /v1/auth/telegram`. The API checks the
launch data with that operator's bot token, so data signed by another bot is
rejected. Everything else in the web client works the same: refresh token in
memory, start parameters, sharing through the operator's bot. KofClub's
store and Telegram account linking are not available in operator worlds.

**Bot tokens.** Tokens are checked with `getMe` at registration and when
replaced. At rest they are sealed with AES-256-GCM
(`OPERATOR_SECRET_KEY_B64`), bound to the operator id. They are unsealed
only to call the Bot API or to check launch data, and are never returned or
logged. A replacement token must belong to the same bot (same bot id).

**Lifecycle.** Registration is self-serve: name, slug, token and terms
acceptance (virtual chips only, no play for money). The operator starts
PENDING. A platform administrator (MFA, audited) moves it to:

- **ACTIVE:** connects the bot. That means `setWebhook` to
  `/v1/telegram/operators/{id}/webhook` with a fresh secret (only its
  SHA-256 is stored), the bot's commands, and a "Play" menu button that
  opens the operator's Mini App.
- **SUSPENDED:** `deleteWebhook`, every session in that world is revoked,
  and the auth guard refuses users of a closed world.
- **REJECTED.**

Transitions are fixed: PENDING to ACTIVE or REJECTED; ACTIVE to SUSPENDED;
SUSPENDED to ACTIVE or REJECTED; REJECTED to ACTIVE. Each user may register
`MAX_OPERATORS_PER_USER` bots, counting rejected ones out.

**Webhooks.** Each operator bot has its own route and secret, compared as
hashes in constant time. An unknown, inactive or disconnected operator
answers 404. Operator bots answer `/start` (with club links into their world),
`/help`, `/terms` and `/paysupport`, which says the bot sells nothing. They
decline every pre-checkout query.

## Consequences

- Operators get a separate service each, with the same rules and the same
  engine. Abuse such as play for money is handled by suspension, which
  takes effect immediately.
- The platform takes no share of operators' Stars. Revenue is a separate
  operator subscription bought through KofClub's own bot (T5).
- New columns are nullable, so KofClub's own world is unchanged. The down
  migration refuses to run while operators exist.
- Operator worlds have no email or password accounts, so their players
  cannot sign in on the plain website, only through the operator's bot.
