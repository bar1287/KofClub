import { expect, test } from '@playwright/test';
import { register, uniqueName } from './helpers';
import { botToken, openMiniApp, signInitData, telegramUser } from './telegram-helpers';

test.skip(!botToken, 'needs the E2E Telegram bot of scripts/e2e.sh');

test('a Telegram player starts without a password and joins a club from a link', async ({
  page,
  browser,
}) => {
  const owner = uniqueName('tgowner');
  await register(page, owner);
  await page.getByLabel('Club name').fill(`Telegram ${owner}`);
  await page.getByRole('button', { name: 'Create club' }).click();
  const code = (await page.getByTestId('join-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z0-9]{6,16}$/);
  // The deployment has a bot, so the club can be shared to Telegram.
  await expect(page.getByTestId('share-telegram')).toBeVisible();

  const context = await browser.newContext();
  const tg = await context.newPage();
  const user = telegramUser('Tess');
  await openMiniApp(tg, signInitData(user, `c-${code.toLowerCase()}`));

  // The club link leads to the join page, which needs an account first.
  await expect(tg).toHaveURL(/\/login\?next=%2Fjoin%3Fcode%3D/);
  await expect(tg.getByText('Hi Tess!')).toBeVisible();
  await tg.getByRole('button', { name: 'Continue with Telegram' }).click();
  await expect(tg).toHaveURL(new RegExp(`/join\\?code=${code}$`));
  await expect(tg.getByTestId('current-user')).toHaveText(user.username);
  await tg.getByRole('button', { name: 'Join club' }).click();
  await expect(tg.getByTestId('club-name')).toHaveText(`Telegram ${owner}`);
  await expect
    .poll(() => tg.evaluate(() => (window as { __tgReady?: boolean }).__tgReady))
    .toBe(true);

  // No refresh cookie inside Telegram; a reload signs in with Telegram again.
  expect((await context.cookies()).filter((c) => c.httpOnly)).toEqual([]);
  await tg.reload();
  await expect(tg.getByTestId('current-user')).toHaveText(user.username);
  await tg.goto('/profile');
  await expect(tg.getByTestId('telegram-panel')).toContainText(`@${user.username}`);
  await expect(tg.getByTestId('telegram-panel')).toContainText('signs in with Telegram only');
  await context.close();
});

test('an existing account links Telegram by logging in inside the app', async ({
  page,
  browser,
}) => {
  const name = uniqueName('tglink');
  await register(page, name);

  const context = await browser.newContext();
  const tg = await context.newPage();
  const user = telegramUser('Lior');
  const initData = signInitData(user);
  await openMiniApp(tg, initData);
  await tg.getByRole('link', { name: 'Start playing' }).click();
  await expect(tg.getByTestId('telegram-sign-in')).toBeVisible();
  await tg.getByLabel('Email or username').fill(name);
  await tg.getByLabel('Password').fill(`${name}-password-1`);
  await expect(tg.getByLabel('Sign in with this Telegram account from now on')).toBeChecked();
  await tg.getByRole('button', { name: 'Log in' }).click();
  await expect(tg).toHaveURL(/\/clubs$/);
  await context.close();

  // Next time Telegram signs the player straight in.
  const again = await browser.newContext();
  const tg2 = await again.newPage();
  await openMiniApp(tg2, signInitData(user));
  await expect(tg2.getByTestId('current-user')).toHaveText(name);
  await tg2.goto('/profile');
  const panel = tg2.getByTestId('telegram-panel');
  await expect(panel).toContainText(`@${user.username}`);
  await panel.getByRole('button', { name: 'Unlink Telegram' }).click();
  await expect(panel.getByRole('button', { name: 'Link Telegram' })).toBeVisible();
  await again.close();
});
