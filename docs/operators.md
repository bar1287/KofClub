# Operators: your own poker bot on KofClub

Anyone can run a poker service on Telegram under their own bot, with their
own name, players and clubs. KofClub runs the games. Each operator is a
separate world: players and clubs of one operator never meet another's.
Design: [ADR-019](adr/ADR-019-operators.md).

> Chips are virtual everywhere. Operators may not charge players money, run
> cash games, collect fees or settle results in any form, inside or outside
> the app. KofClub suspends operators that do (`/terms`).

## For operators

1. In Telegram, open **@BotFather** and send `/newbot`. Choose a name and a
   username ending in `bot`. Keep the token it gives you secret.
2. Sign in to KofClub and open **Your bot**. Enter:
   - a service name, which players see;
   - an address (`alpha-poker`);
   - the bot token.

   Accept the terms and press **Register bot**. KofClub checks the token
   with Telegram and stores it encrypted.

3. Wait for approval. The page shows "Waiting for approval", then "Live".
4. In **@BotFather**, open Bot Settings, then Configure Mini App, then
   Enable Mini App, and set the address shown on the page. It looks like
   `https://play.example.com/?op=alpha-poker`.
5. Share `https://t.me/<your bot>` with your players. They press
   **Play**, then **Continue with Telegram**, and they're in. Clubs are
   created and joined inside your bot, and club links shared from there open
   your bot.

If your token leaks, send `/revoke` to BotFather and paste the new token
under **Replace token**. It must be for the same bot.

## For the platform owner

Turn operators on for the control API:

| Variable                    | Value                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `OPERATORS_ENABLED`         | `true`                                                                                     |
| `OPERATOR_SECRET_KEY_B64`   | 32 random bytes, base64 (`scripts/init-env.sh` generates it). Keep it in the secret store. |
| `TELEGRAM_WEBHOOK_BASE_URL` | The public https URL of the control API (e.g. `https://api.example.com`).                  |
| `TELEGRAM_MINI_APP_URL`     | The public https URL of the web app (operators' Mini Apps live under it, `?op=<slug>`).    |
| `MAX_OPERATORS_PER_USER`    | Optional, default 3.                                                                       |

Your own bot (docs/telegram.md) is not required for operators. It is needed
for Stars, and the operator subscription (roadmap T5) is sold through it.

Review operators in **Admin, then Operators** (platform administrators,
MFA):

- **Approve** connects the bot: its webhook, commands and the Play button.
  If Telegram refuses, nothing changes and the error says which call failed.
- **Suspend** disconnects the bot and signs everyone in that world out at
  once. Use it for reports of play for money.
- **Reject** or **Reinstate**. Every change needs a reason and is recorded in
  the audit log.

Losing `OPERATOR_SECRET_KEY_B64` makes stored tokens unreadable. Operators
then have to replace their tokens.
