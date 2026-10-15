# Telegram Mini App and bot

KofClub can run inside Telegram as a Mini App. It is the same web client,
opened from a bot. Players sign in with their Telegram account and share club
links into their groups. Design and rules: [ADR-018](adr/ADR-018-telegram-mini-app-and-stars.md).
Telegram is optional: with the `TELEGRAM_*` settings empty, nothing changes.

> Chips stay virtual everywhere. Telegram Stars (roadmap T2) may only buy
> digital extras such as Club Pro, themes or a tip. They never buy chips,
> seats, entries or prizes, and playing for money is against the terms
> (`/terms`).

## What you need

- A deployment reachable over **public https**. Telegram only opens https
  Mini Apps and only delivers webhooks to https. You need:
  - the web app (for example `https://play.example.com`);
  - the control API (for example `https://api.example.com`);
  - the realtime gateway (`wss://...`).
- A Telegram account to create the bot with.

## 1. Create the bot (BotFather)

1. In Telegram, open **@BotFather** and send `/newbot`.
2. Choose a display name (e.g. `KofClub Poker`) and a username ending in
   `bot` (e.g. `MyKofClubBot`).
3. BotFather replies with the **bot token** (`123456789:AA...`). Treat it like
   a password: never commit it, never paste it in chats or tickets. If it
   leaks, send `/revoke` to BotFather and update your configuration.
4. Optional but recommended, in BotFather → your bot:
   - `/setdescription` and `/setabouttext`: say that the app is free social
     poker with virtual chips.
   - `/setuserpic`: upload a picture for the bot.
   - **Bot Settings → Configure Mini App → Enable Mini App**: set the
     Mini App URL to your web app URL. This makes it the bot's _Main Mini
     App_, so `t.me/<bot>?startapp=...` links open it directly. Club
     share links need this.

## 2. Configure the deployment

Set these in your secret store (production) or `.env` (your own machine).
They are read by the control API; the web server only needs
`TELEGRAM_BOT_USERNAME`.

| Variable                             | Value                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`                 | The token from BotFather. Secret.                                                                                                           |
| `TELEGRAM_BOT_USERNAME`              | The bot's username without `@`, e.g. `MyKofClubBot`. Also give it to the **web** server: it allows Telegram Web to show the app in a frame. |
| `TELEGRAM_WEBHOOK_SECRET`            | 32–256 random characters `[A-Za-z0-9_-]`. Generate one with `openssl rand -hex 32`. Secret.                                                 |
| `TELEGRAM_MINI_APP_URL`              | The public https URL of the web app, e.g. `https://play.example.com`.                                                                       |
| `TELEGRAM_SUPPORT_CONTACT`           | Who players contact about purchases (shown by `/paysupport`), e.g. `@your_support`.                                                         |
| `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` | Optional. How old Telegram's launch data may be (default 3600).                                                                             |

Restart the control API and the web server after changing them. Check that it
worked:

```bash
curl https://api.example.com/v1/telegram/config
# {"enabled":true,"botUsername":"MyKofClubBot"}
```

## 3. Connect the bot to the deployment

From a checkout with the same values in `.env` (or exported in the shell),
plus the public API URL in `NEXT_PUBLIC_API_URL` (or the full webhook URL in
`TELEGRAM_WEBHOOK_URL`):

```bash
make telegram-setup
```

It checks the token (`getMe`) and registers the webhook
`https://api.example.com/v1/telegram/webhook` together with the secret. It
also sets the bot's command list (`/start`, `/help`, `/terms`, `/paysupport`)
and the chat **menu button** that opens the Mini App. It never prints the
token. Run it again whenever a URL or the secret changes.

## 4. Try it

1. Open your bot in Telegram and press **Start** (or the **Play** menu button).
2. Tap **Continue with Telegram**. That creates an account with no email or
   password. To link an existing account instead, log in with its password
   inside the app.
3. Create a club. On the club page, **Share in Telegram** posts a link that
   opens the app on that club's join page.

In a group, `/start` replies with a link button (Telegram allows Mini App
buttons only in private chats).

## How it works

- Telegram opens the app with signed launch data (`#tgWebAppData=...`). The
  client sends it to `POST /v1/auth/telegram`. The API checks its signature
  with the bot token and its age, then signs the player in (ADR-018).
- Inside Telegram the refresh token is kept in memory rather than in a
  cookie, because Telegram Web frames the app and cookies are not sent there.
  Reopening the app signs in again with fresh launch data.
- `t.me/<bot>?startapp=c-<CODE>` opens the join page for club code `CODE`.
  Joining still takes a tap. `t.me/<bot>?startapp=store` opens the store.
- Accounts: profile → **Telegram** shows the link. Accounts with a password
  can unlink. Telegram-only accounts cannot (they would lose access).

## 5. Telegram Stars store (optional)

The store sells three kinds of digital extras for Telegram Stars (ADR-018):

- **Club Pro**: a 30-day subscription that a club's owner buys for the club.
  Telegram renews it monthly until it is canceled. It raises the club's
  limits on open tables and members.
- **Premium themes**: extra felts and card backs, bought once. They change
  looks only.
- **Tips** to the people who run the service.

Stars never buy chips, seats, buy-ins, tournament entries or prizes. Chips
never turn into Stars, and the store never touches the chip ledger.

To turn it on, set these for the control API and restart it:

| Variable                                             | Value                                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_STARS_ENABLED`                             | `true`. Needs the bot settings above and `TELEGRAM_SUPPORT_CONTACT`, because Telegram requires payment support. |
| `STARS_PRICE_CLUB_PRO`, `STARS_PRICE_PREMIUM_THEMES` | Prices in Stars (defaults 250 and 150; 1–10000). Tips are 50, 250 and 1000.                                     |
| `CLUB_FREE_MAX_OPEN_TABLES`, `CLUB_FREE_MAX_MEMBERS` | Limits for clubs without Club Pro (defaults 3 and 50).                                                          |
| `CLUB_PRO_MAX_OPEN_TABLES`, `CLUB_PRO_MAX_MEMBERS`   | Limits with Club Pro (defaults 30 and 1000).                                                                    |

Plan limits apply only while the store is on. Existing members and tables
are never removed: a full club just cannot add more. With the store off,
clubs have no limits and premium themes are free for everyone.

Run `make telegram-setup` again after enabling the store, so the webhook
also receives `pre_checkout_query` updates. Stars need no payment provider
in BotFather.

How a purchase works:

1. In the Mini App, the player opens **Store** and taps a product. The API
   creates an order and a Stars invoice (`createInvoiceLink`, currency
   `XTR`), and the app opens it with `Telegram.WebApp.openInvoice`.
2. Before charging, Telegram sends `pre_checkout_query`. The API accepts it
   only for the order's own payer, at the order's price, while the order is
   unpaid (and, for Club Pro, while the payer still owns the club).
3. Telegram sends `successful_payment`. The API records the charge once (by
   Telegram's charge id) and delivers the item in the same transaction. The
   bot then thanks the player. Club Pro renewals arrive the same way, as new
   charges.
4. Club owners cancel or resume the renewal on the club page.
5. Platform administrators see every payment in **Admin → Stars payments**.
   They can refund one there (`refundStarPayment`), which takes back what it
   bought and is recorded in the audit log. Refunds that Telegram reports
   are applied too.

Players get help with `/paysupport` (it names `TELEGRAM_SUPPORT_CONTACT`).

## Troubleshooting

| Symptom                                        | Cause and fix                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `make telegram-setup` says a URL must be https | Telegram refuses http URLs. Deploy behind https.                                                                                             |
| "The Telegram sign-in expired"                 | The launch data is older than `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS`. Close and reopen the app from the bot.                                   |
| "could not be verified"                        | The token in the API config is not this bot's token, or the app was opened from another bot.                                                 |
| The app is blank in Telegram Web only          | The web server does not have `TELEGRAM_BOT_USERNAME`, so framing is refused. Set it and restart the web server.                              |
| The bot does not answer commands               | Run `make telegram-setup` again. `getWebhookInfo` in the Bot API shows delivery errors; a 401 there means `TELEGRAM_WEBHOOK_SECRET` differs. |
| Share links open the bot chat, not the app     | Set the Main Mini App in BotFather (step 1.4).                                                                                               |
| A payment stays "pending" / nothing unlocks    | The webhook must receive `pre_checkout_query` and payments: run `make telegram-setup` again. Check `stars_store_events_total` in metrics.    |
| "Free clubs can have up to …"                  | The store is on and the club reached its free limits. The owner can buy Club Pro, or you can raise `CLUB_FREE_*`.                            |

Local testing needs public https URLs for the web app, the API and the
realtime gateway, for example from a tunnelling service. The web app must
also be rebuilt with those URLs in `NEXT_PUBLIC_API_URL` and
`NEXT_PUBLIC_REALTIME_URL`, and the web origin added to `CORS_ORIGINS`.
The automated tests use a made-up bot and a stand-in for the Bot API
instead (`scripts/e2e.sh`, `e2e/store.spec.ts`, and the `telegram` and
`store` integration suites of the control API).
