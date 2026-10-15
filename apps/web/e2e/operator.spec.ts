import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { startFakeBotApi, type FakeBotApi } from './fake-bot-api';
import { register, totp, uniqueName } from './helpers';
import { botToken, openMiniApp, signInitData, telegramUser } from './telegram-helpers';

// Operators (ADR-019): someone registers their own bot, an administrator
// approves it, and its players get a world of their own. scripts/e2e.sh
// enables operators and gives the spec the database URL (to grant the admin
// role with the operator CLI) and the API URL (to deliver bot updates).
const apiUrl = process.env.E2E_API_URL ?? '';
const fakePort = Number(process.env.E2E_TELEGRAM_API_PORT ?? 0);
const databaseUrl = process.env.DATABASE_URL ?? '';
test.skip(
  !botToken || !apiUrl || !fakePort || !databaseUrl,
  'needs the E2E stack of scripts/e2e.sh',
);

let bot: FakeBotApi;
test.beforeAll(async () => {
  bot = await startFakeBotApi(fakePort);
});
test.afterAll(async () => {
  await bot.close();
});

function grantPlatformAdmin(username: string) {
  execFileSync(
    process.execPath,
    ['-r', '@swc-node/register', 'src/cli/platform-admin.ts', 'grant', username],
    {
      cwd: path.resolve(__dirname, '../../control-api'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    },
  );
}

/** Turns on TOTP from the profile; the session becomes verified. */
async function enrollMfa(page: Page) {
  await page.goto('/profile');
  const panel = page.getByTestId('two-factor');
  await panel.getByRole('button', { name: 'Set up two-factor authentication' }).click();
  const secret = (await panel.getByTestId('totp-secret').getAttribute('data-secret')) ?? '';
  await panel.getByTestId('totp-code').fill(totp(secret, Math.floor(Date.now() / 30_000)));
  await panel.getByRole('button', { name: 'Turn on' }).click();
  await panel.getByRole('button', { name: 'I saved them' }).click();
}

async function adminSetStatus(page: Page, operatorName: string, button: string, reason: string) {
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Operators' }).click();
  await page.getByLabel('Operator status').selectOption('');
  const row = page
    .getByTestId('admin-operators')
    .getByRole('row', { name: new RegExp(operatorName) });
  page.once('dialog', (d) => void d.accept(reason));
  await row.getByRole('button', { name: button }).click();
  await expect(page.getByText(/^.+: (active|suspended)\.$/)).toBeVisible();
}

test('anyone runs their own poker bot in a world of its own', async ({
  page,
  browser,
  request,
}) => {
  // The operator registers their bot.
  const owner = uniqueName('opowner');
  await register(page, owner);
  await page.getByRole('link', { name: 'Your bot' }).click();
  const serviceName = `Alpha ${owner}`;
  const token = `${randomInt(10_000_000, 99_999_999)}:${'A'.repeat(35)}`;
  const form = page.getByTestId('register-operator');
  await form.getByLabel('Service name').fill(serviceName);
  const slug = await form.getByLabel(/^Address/).inputValue();
  expect(slug).toMatch(/^alpha-opowner/);
  await form.getByLabel('Bot token').fill(token);
  await form.getByLabel(/I accept the terms/).check();
  await form.getByRole('button', { name: 'Register bot' }).click();
  const card = page.getByTestId('operator-card');
  await expect(card).toContainText('Waiting for approval');
  await expect(card.getByTestId('operator-mini-app-url')).toContainText(`?op=${slug}`);

  // A platform administrator approves it: the bot gets connected.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const admin = uniqueName('opadmin');
  await register(adminPage, admin);
  grantPlatformAdmin(admin);
  await enrollMfa(adminPage);
  await adminSetStatus(adminPage, serviceName, 'Approve', 'Looks good');
  const hook = bot.of('setWebhook', token).at(-1)!;
  expect(String(hook.url)).toMatch(/\/v1\/telegram\/operators\/[0-9a-f-]+\/webhook$/);
  await page.reload();
  await expect(card).toContainText('Live');

  // A player opens the operator's bot: its name, Telegram sign-in only.
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  const tess = telegramUser('Tess');
  await openMiniApp(player, signInitData(tess, undefined, token), `/?op=${slug}`);
  await expect(player.getByTestId('brand')).toContainText(serviceName);
  await player.getByRole('link', { name: 'Log in' }).click();
  await expect(player.getByLabel('Password')).toHaveCount(0);
  await player.getByRole('button', { name: 'Continue with Telegram' }).click();
  await expect(player.getByTestId('current-user')).toHaveText(tess.username);
  await expect(player.getByRole('link', { name: 'Store' })).toHaveCount(0);

  // Clubs in this world are shared through the operator's bot.
  await player.getByRole('link', { name: 'Clubs' }).click();
  await player.getByLabel('Club name').fill(uniqueName('Alpha Club'));
  await player.getByRole('button', { name: 'Create club' }).click();
  const code = (await player.getByTestId('join-code').textContent())?.trim() ?? '';
  await player.getByTestId('share-telegram').click();
  await expect
    .poll(() => player.evaluate(() => (window as { __tgLinks?: string[] }).__tgLinks?.[0] ?? ''))
    .toContain(encodeURIComponent(`op_${token.split(':')[0]}_bot?startapp=c-${code}`));

  // KofClub's own players cannot join it.
  await page.goto('/clubs');
  await page.getByLabel('Join or invite code').fill(code);
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByText('Invalid, expired or used-up code')).toBeVisible();

  // The operator's bot answers with links into the operator's world.
  const res = await request.post(
    `${apiUrl}/v1/telegram/operators/${String(hook.url).split('/').at(-2)}/webhook`,
    {
      headers: { 'X-Telegram-Bot-Api-Secret-Token': String(hook.secret_token) },
      data: {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: tess.id, type: 'private' },
          from: { id: tess.id, is_bot: false, first_name: 'Tess' },
          text: '/start',
        },
      },
    },
  );
  expect(res.status()).toBe(200);
  expect(bot.of('sendMessage', token).at(-1)).toMatchObject({
    text: expect.stringContaining(serviceName),
  });

  // Suspended: the world closes for its players.
  await adminSetStatus(adminPage, serviceName, 'Suspend', 'Testing a suspension');
  await player.reload();
  await expect(player.getByText('This service is not available right now')).toBeVisible();
  await adminContext.close();
  await playerContext.close();
});
