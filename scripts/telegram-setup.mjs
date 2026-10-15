#!/usr/bin/env node
// Configures the Telegram bot for KofClub (docs/telegram.md): the webhook
// (with its secret), the command list and the menu button that opens the
// Mini App. Reads TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
// TELEGRAM_MINI_APP_URL and the public API URL (TELEGRAM_WEBHOOK_URL, or
// NEXT_PUBLIC_API_URL + /v1/telegram/webhook) from the environment.
// The token is never printed.
const env = process.env;
const token = env.TELEGRAM_BOT_TOKEN;
const secret = env.TELEGRAM_WEBHOOK_SECRET;
const appUrl = env.TELEGRAM_MINI_APP_URL;
const webhookUrl =
  env.TELEGRAM_WEBHOOK_URL ||
  (env.NEXT_PUBLIC_API_URL
    ? `${env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '')}/v1/telegram/webhook`
    : '');
const apiBase = (env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/+$/, '');

const missing = Object.entries({
  TELEGRAM_BOT_TOKEN: token,
  TELEGRAM_WEBHOOK_SECRET: secret,
  TELEGRAM_MINI_APP_URL: appUrl,
  'TELEGRAM_WEBHOOK_URL or NEXT_PUBLIC_API_URL': webhookUrl,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`Missing: ${missing.join(', ')} (see docs/telegram.md)`);
  process.exit(1);
}
for (const [name, url] of [
  ['TELEGRAM_MINI_APP_URL', appUrl],
  ['webhook URL', webhookUrl],
]) {
  if (!url.startsWith('https://')) {
    console.error(`${name} must be a public https URL (Telegram rejects anything else): ${url}`);
    process.exit(1);
  }
}

async function call(method, params) {
  let res;
  try {
    res = await fetch(`${apiBase}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error(`${method}: could not reach Telegram`);
  }
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(`${method}: ${body.description ?? res.status}`);
  return body.result;
}

try {
  const me = await call('getMe', {});
  console.log(`Bot: @${me.username}`);
  if (env.TELEGRAM_BOT_USERNAME && env.TELEGRAM_BOT_USERNAME !== me.username) {
    console.warn(
      `Note: TELEGRAM_BOT_USERNAME is ${env.TELEGRAM_BOT_USERNAME}; Telegram says ${me.username}.`,
    );
  }
  await call('setWebhook', {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ['message', 'pre_checkout_query'],
  });
  console.log(`Webhook: ${webhookUrl}`);
  await call('setMyCommands', {
    commands: [
      { command: 'start', description: 'Open KofClub' },
      { command: 'help', description: 'What the bot can do' },
      { command: 'terms', description: 'Terms of use' },
      { command: 'paysupport', description: 'Help with a Telegram Stars purchase' },
    ],
  });
  await call('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Play', web_app: { url: appUrl } },
  });
  console.log(`Menu button opens: ${appUrl}`);
  console.log('Done. In @BotFather, also set the Main Mini App URL (see docs/telegram.md).');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
