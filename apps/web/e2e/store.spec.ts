import { createServer, type Server } from 'node:http';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { uniqueName } from './helpers';
import {
  botToken,
  openMiniApp,
  settleInvoice,
  signInitData,
  telegramUser,
  type TelegramUser,
} from './telegram-helpers';

// scripts/e2e.sh points the API at a stand-in for the Bot API that this spec
// runs, and gives the spec the webhook secret, so the test can play
// Telegram's part of a Stars purchase (T2, ADR-018).
const apiUrl = process.env.E2E_API_URL ?? '';
const webhookSecret = process.env.E2E_TELEGRAM_WEBHOOK_SECRET ?? '';
const fakePort = Number(process.env.E2E_TELEGRAM_API_PORT ?? 0);
test.skip(!botToken || !apiUrl || !fakePort, 'needs the E2E Telegram bot of scripts/e2e.sh');

interface BotCall {
  method: string;
  body: Record<string, unknown>;
}

const calls: BotCall[] = [];
let server: Server;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const method = (req.url ?? '').split('/').pop() ?? '';
      calls.push({ method, body: JSON.parse(raw || '{}') as Record<string, unknown> });
      const result =
        method === 'createInvoiceLink'
          ? `https://t.me/$e2e-invoice-${calls.length}`
          : method === 'sendMessage'
            ? { message_id: calls.length }
            : true;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(fakePort, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let updateId = 1;

async function webhook(request: APIRequestContext, update: Record<string, unknown>) {
  const res = await request.post(`${apiUrl}/v1/telegram/webhook`, {
    headers: { 'X-Telegram-Bot-Api-Secret-Token': webhookSecret },
    data: { update_id: updateId++, ...update },
  });
  expect(res.status()).toBe(200);
}

/** Waits for the app to open an invoice, then plays Telegram: checkout and payment. */
async function payInvoice(
  page: Page,
  request: APIRequestContext,
  user: TelegramUser,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  await expect
    .poll(() => page.evaluate(() => Boolean((window as { __invoice?: unknown }).__invoice)))
    .toBe(true);
  const invoice = [...calls].reverse().find((c) => c.method === 'createInvoiceLink')!.body;
  const amount = (invoice.prices as { amount: number }[])[0]!.amount;
  const from = { id: user.id, is_bot: false, first_name: user.first_name };
  await webhook(request, {
    pre_checkout_query: {
      id: `q-${updateId}`,
      from,
      currency: 'XTR',
      total_amount: amount,
      invoice_payload: invoice.payload,
    },
  });
  expect(calls.at(-1)).toMatchObject({ method: 'answerPreCheckoutQuery', body: { ok: true } });
  await webhook(request, {
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: user.id, type: 'private' },
      from,
      successful_payment: {
        currency: 'XTR',
        total_amount: amount,
        invoice_payload: invoice.payload,
        telegram_payment_charge_id: `e2e-${String(invoice.payload)}`,
        ...extra,
      },
    },
  });
  await settleInvoice(page, 'paid');
  return invoice;
}

test('a Telegram player buys premium themes and Club Pro with Stars', async ({ page, request }) => {
  const user = telegramUser('Stella');
  // A t.me/<bot>?startapp=store link opens the store.
  await openMiniApp(page, signInitData(user, 'store'));
  await expect(page).toHaveURL(/\/login\?next=%2Fstore/);
  await page.getByRole('button', { name: 'Continue with Telegram' }).click();
  await expect(page.getByTestId('store')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Store' })).toBeVisible();

  // Premium themes: looks only, unlocked once paid.
  await page.getByTestId('buy-PREMIUM_THEMES').click();
  await payInvoice(page, request, user);
  await expect(page.getByText('Payment received')).toBeVisible();
  await expect(page.getByTestId('product-PREMIUM_THEMES')).toContainText('Owned');
  await expect(page.getByTestId('my-purchases')).toContainText('Premium themes');
  await page.getByRole('link', { name: 'Profile' }).click();
  await page.locator('select[name="felt"]').selectOption('midnight');
  await expect(page.locator('html')).toHaveAttribute('data-felt', 'midnight');

  // Club Pro for a club the player owns.
  await page.getByRole('link', { name: 'Clubs' }).click();
  await page.getByLabel('Club name').fill(uniqueName('Stars Club'));
  await page.getByRole('button', { name: 'Create club' }).click();
  await expect(page.getByTestId('club-plan')).toContainText('Free');
  const clubUrl = page.url();
  await page.getByRole('link', { name: 'Upgrade to Club Pro' }).click();
  await expect(page).toHaveURL(/\/store\?club=/);
  await page.getByTestId('buy-CLUB_PRO').click();
  const invoice = await payInvoice(page, request, user, {
    is_recurring: true,
    is_first_recurring: true,
    subscription_expiration_date: Math.floor(Date.now() / 1000) + 30 * 86400,
  });
  expect(invoice).toMatchObject({ currency: 'XTR', subscription_period: 2592000 });
  await expect(page.getByTestId('my-purchases')).toContainText('Club Pro');

  await page.goto(clubUrl);
  const plan = page.getByTestId('club-plan');
  await expect(plan).toContainText('Club Pro');
  await expect(plan).toContainText('Renews on');
  await plan.getByRole('button', { name: 'Cancel renewal' }).click();
  await expect(plan).toContainText('renewal canceled');
  expect(calls.find((c) => c.method === 'editUserStarSubscription')?.body).toMatchObject({
    user_id: user.id,
    is_canceled: true,
  });
});
