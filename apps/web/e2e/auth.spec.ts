import { expect, test } from '@playwright/test';
import { register, uniqueName } from './helpers';

test('protected pages redirect to login and return afterwards', async ({ page }) => {
  const username = uniqueName('carol');
  await register(page, username);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  const login = await page.goto('/login');
  const csp = login?.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(login?.headers()['x-frame-options']).toBe('DENY');

  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login\?next=%2Fprofile$/);

  await page.getByLabel('Email or username').fill(username);
  await page.getByLabel('Password').fill('wrong-password-123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  await page.getByLabel('Password').fill(`${username}-password-1`);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText('this device')).toBeVisible();

  // The session survives a reload via the HttpOnly refresh cookie only.
  await page.reload();
  await expect(page.getByTestId('current-user')).toHaveText(username);
  const cookies = await page.context().cookies();
  const refresh = cookies.find((c) => c.name === 'kof_rt');
  expect(refresh?.httpOnly).toBe(true);
  expect(refresh?.sameSite).toBe('Strict');
  expect(await page.evaluate(() => document.cookie)).not.toContain('kof_rt');
});
