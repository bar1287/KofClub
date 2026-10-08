# Roadmap beyond M10: a world-class club poker platform

The spec §16 roadmap (M0–M10) is complete: Hold'em and Pot-Limit Omaha cash
tables and tournaments are playable end to end. This document plans the work
that separates a working platform from one thousands of players choose every
day. `PROJECT_STATUS.md` tracks which milestone is current.

The project's rules still apply to every milestone:

- Virtual chips only (ADR-006): no deposits, withdrawals, cash-out, crypto
  or rake as revenue.
- The server is authoritative.
- One milestone at a time.
- Every milestone ships with:
  - contracts first;
  - migrations with a working down;
  - tests at every level the change touches;
  - updated docs, CHANGELOG and PROJECT_STATUS.

Ordering principle: what a player feels in their first session comes first.
Next comes the depth that keeps clubs coming back, then the trust, safety and
scale work needed before thousands of players.

## W1: The table feels complete

These are the first-session essentials every serious poker client has.

| ID   | Milestone             | Scope                                                                                                                                                                                                                                                |
| ---- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1.1 | Pre-actions           | Check/Fold, Check, Call (exact amount), Call any and Fold, queued before your turn. A queued action is cleared when the bet it was made against changes. It is sent as a normal command when the turn arrives, and the server validates it as usual. |
| W1.2 | Time bank             | Each seated player has a bank of extra seconds that starts when the turn timer runs out. It refills a little every N hands, up to a cap, and the table settings control all three. Clients show the bank and a distinct countdown.                   |
| W1.3 | Re-buy and top-up     | Add chips between hands, up to the table maximum, through a ledger posting. A busted player keeps the seat for a grace period to re-buy. Players can sit out next hand, wait for the big blind, and use auto-rebuy.                                  |
| W1.4 | Table chat, reactions | Messages and emoji reactions over the realtime connection, with recent history for late joiners. Moderation: rate limits, mute a player (per viewer), club setting to turn chat off, report a message to club staff.                                 |
| W1.5 | Showdown choices      | Show or muck when the rules allow it. Show cards after winning uncontested, including just one card.                                                                                                                                                 |
| W1.6 | Feel                  | Sounds (your turn, chips, deal, win) and dealing and chip animations, respecting reduced motion. Four-color deck, felt and card-back themes, and generated avatars. A settings panel stores these preferences.                                       |

## W2: Game variety

| ID   | Milestone              | Scope                                                                                                                                                    |
| ---- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W2.1 | Antes                  | Classic antes and big-blind ante, for cash tables and tournaments.                                                                                       |
| W2.2 | Straddle and bomb pots | Optional UTG straddle. Bomb pots as a club table setting: every N hands, everyone antes and play starts on the flop.                                     |
| W2.3 | Run it twice           | Offered when all-in players all agree, with the second board drawn from the same committed deck. Rabbit hunt shows the unused board as information only. |
| W2.4 | Short Deck (6+)        | A 36-card deck with Short Deck hand rankings: a flush beats a full house, and A-6-7-8-9 is a straight.                                                   |
| W2.5 | PLO-5 and PLO-6        | Five- and six-card Pot-Limit Omaha through the existing Omaha rule module.                                                                               |
| W2.6 | Omaha Hi-Lo            | 8-or-better split pots with odd-chip rules.                                                                                                              |
| W2.7 | Stud games             | Seven-Card Stud and Razz, fixed-limit betting with bring-in.                                                                                             |

## W3: Tournament depth

| ID   | Milestone                   | Scope                                                                                                                             |
| ---- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| W3.1 | Structures                  | Blind structure templates (turbo, regular, deep) and custom levels with antes. Breaks. Payout templates by field size, or custom. |
| W3.2 | Late reg, re-entry, rebuys  | A late registration window, re-entry limits, and rebuy and add-on periods.                                                        |
| W3.3 | Bounties                    | Progressive knockout bounties.                                                                                                    |
| W3.4 | Realtime tournament channel | Lobby, standings and level changes pushed over the realtime connection, replacing polling.                                        |
| W3.5 | Satellites and series       | Ticket prizes and recurring scheduled series.                                                                                     |
| W3.6 | Bubble and final table      | Hand-for-hand play on the bubble and a final table presentation.                                                                  |

## W4: Clubs, social and retention

| ID   | Milestone                  | Scope                                                                                                                    |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| W4.1 | Profiles                   | Avatar upload (re-encoded server-side), bio, country, and a stats summary.                                               |
| W4.2 | Friends and invitations    | Friend requests, invite links to a club or table, and which friends are online and where they play.                      |
| W4.3 | Club home                  | Announcements, club chat, a member directory and an activity feed.                                                       |
| W4.4 | Chip requests              | Members request chips and staff approve or deny them (a ledger posting), with per-period limits.                         |
| W4.5 | Leaderboards and leagues   | Club leaderboards by period and game, and league points for tournament series.                                           |
| W4.6 | Achievements               | Badges for milestones such as a first tournament win or a royal flush.                                                   |
| W4.7 | Notifications              | An in-app inbox, web push and opt-in email for events such as a tournament starting, a friend request or a chip request. |
| W4.8 | Private and scheduled play | Invite-only tables and scheduled table openings.                                                                         |

## W5: Trust, safety and accounts

| ID   | Milestone        | Scope                                                                                                                                                             |
| ---- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W5.1 | Email            | Verification, password reset and email change, behind a provider abstraction (SMTP; Mailpit for local development).                                               |
| W5.2 | Sign-in options  | Google and Apple (OIDC), and passkeys (WebAuthn) for login and as a second factor.                                                                                |
| W5.3 | Integrity        | Club rules for players from the same IP address or device. Collusion indicators (chip dumping, soft play) and bot-timing heuristics feed the existing risk queue. |
| W5.4 | Moderation       | A queue for reported messages, mutes and bans with durations, all audited.                                                                                        |
| W5.5 | Responsible play | Session reminders, daily play-time limits and self-exclusion.                                                                                                     |
| W5.6 | Privacy          | Account data export and deletion, and retention policies.                                                                                                         |

## W6: Experience everywhere

| ID   | Milestone       | Scope                                                                                                      |
| ---- | --------------- | ---------------------------------------------------------------------------------------------------------- |
| W6.1 | Languages       | English and Hebrew (right to left), locale-aware numbers and dates, and a translation workflow.            |
| W6.2 | Accessibility   | Keyboard play with shortcuts, screen-reader announcements for turns and actions, and contrast checks.      |
| W6.3 | Installable app | A PWA with icon, splash screen, offline shell and push notifications.                                      |
| W6.4 | Hand replayer   | A step-by-step visual replay and shareable links that show only cards that were revealed.                  |
| W6.5 | Stats           | Your own VPIP, PFR, 3-bet and went-to-showdown, session graphs, and an opponent HUD if the club allows it. |
| W6.6 | Multi-tabling   | Several tables in one window, switching focus to whichever table has your turn.                            |
| W6.7 | Lobby           | Filters by game, stakes and seats, quick seat, and table previews.                                         |

## W7: Production and scale

These are needed before thousands of players.

| ID   | Milestone        | Scope                                                                                                                                                          |
| ---- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W7.1 | Single origin    | One domain for web, API and WebSocket behind a reverse proxy with TLS. This also makes cloud IDEs (Codespaces) and remote hosts work.                          |
| W7.2 | Deployment kit   | CI-built images in a registry, a production compose file and Helm chart, and staging and production workflows. It needs the owner's cloud account and secrets. |
| W7.3 | Horizontal scale | Several gateways and game nodes behind a load balancer (table leases already exist), with autoscaling signals.                                                 |
| W7.4 | Data at scale    | Hand history partitioned by month, archival to object storage, and a read replica for history.                                                                 |
| W7.5 | Load proof       | A load test of 10,000 concurrent players on 1,500 tables against service-level objectives (p99 command round trip under 150 ms), plus a soak test.             |
| W7.6 | Operations       | Dashboards for the service-level objectives, a status page, point-in-time recovery and a disaster-recovery drill.                                              |

## Order of work

W1 in order comes first. Then W2.1–W2.3 and W7.1. W4.4 and W4.7, the club
loop, follow, then W3, W5, W6 and the rest. Each milestone that changes a
contract or a core rule records its decision in an ADR.
