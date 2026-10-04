import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { register, uniqueName } from './helpers';

/** RFC 6238 code of a base32 secret at a time step (test-side authenticator). */
function totp(secretBase32: string, step: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secretBase32) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

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
