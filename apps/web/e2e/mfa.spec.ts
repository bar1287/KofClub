import { expect, test } from '@playwright/test';
import { register, totp, uniqueName } from './helpers';

const stepNow = () => Math.floor(Date.now() / 30_000);

test('a player turns on two-factor authentication and signs in with a code', async ({ page }) => {
  const username = uniqueName('tfa');
  await register(page, username);
  await page.goto('/profile');
  const panel = page.getByTestId('two-factor');
  await panel.getByRole('button', { name: 'Set up two-factor authentication' }).click();
  const secret = (await panel.getByTestId('totp-secret').getAttribute('data-secret')) ?? '';
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  const enrolledAt = stepNow();
  await panel.getByTestId('totp-code').fill(totp(secret, enrolledAt));
  await panel.getByRole('button', { name: 'Turn on' }).click();
  await expect(panel.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
  const recovery = await panel.getByTestId('recovery-codes').locator('li').first().innerText();
  await panel.getByRole('button', { name: 'I saved them' }).click();
  await expect(panel.getByText('10 recovery codes left')).toBeVisible();

  // Sign in again: the password alone is not enough.
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email or username').fill(username);
  await page.getByLabel('Password').fill(`${username}-password-1`);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByTestId('mfa-code')).toBeVisible();
  await page.getByTestId('mfa-code').fill('000000');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('Invalid authentication code')).toBeVisible();
  // The code used for enrollment cannot be replayed; the next one works.
  await page.getByTestId('mfa-code').fill(totp(secret, Math.max(stepNow(), enrolledAt + 1)));
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByTestId('current-user')).toHaveText(username);

  // A recovery code works once.
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.getByLabel('Email or username').fill(username);
  await page.getByLabel('Password').fill(`${username}-password-1`);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByTestId('mfa-code').fill(recovery);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByTestId('current-user')).toHaveText(username);
  await page.goto('/profile');
  await expect(page.getByTestId('two-factor').getByText('9 recovery codes left')).toBeVisible();
});
