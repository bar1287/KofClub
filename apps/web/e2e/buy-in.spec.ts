import { expect, test } from '@playwright/test';
import { clubWithChips, register, uniqueName, type Player } from './helpers';

/**
 * The buy-in dialog loads the wallet in the background; an amount the
 * player typed before it arrived must be the one bought in (the default
 * used to replace it).
 */
test('a typed buy-in survives a slow wallet response', async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice: Player = { page: await aliceCtx.newPage(), username: uniqueName('alice') };
  const bob: Player = { page: await bobCtx.newPage(), username: uniqueName('bob') };
  await register(alice.page, alice.username);
  await register(bob.page, bob.username);
  await clubWithChips(alice, bob, 5_000);

  await alice.page.getByLabel('Name', { exact: true }).fill('Slow Wallet');
  await alice.page.getByRole('button', { name: 'Create table' }).click();
  const row = alice.page.getByTestId('table-list').locator('tr', { hasText: 'Slow Wallet' });
  await row.getByRole('link', { name: 'Open' }).click();
  await expect(alice.page.getByTestId('connection-status')).toHaveAttribute('data-status', 'open');

  // Hold the wallet response until the amount has been typed.
  let releaseWallet = () => {};
  const walletHeld = new Promise<void>((resolve) => (releaseWallet = resolve));
  await alice.page.route('**/v1/clubs/*/wallet', async (route) => {
    await walletHeld;
    await route.continue();
  });

  await alice.page.getByTestId('sit-1').click();
  const input = alice.page.getByLabel('Buy-in amount');
  await input.fill('1000');
  releaseWallet();
  await expect(alice.page.getByRole('dialog')).toContainText('Wallet: 5,000');
  await expect(input).toHaveValue('1000');
  await alice.page.getByRole('button', { name: 'Buy in' }).click();
  await expect(alice.page.getByTestId('seat-1').getByTestId('seat-stack')).toHaveText('1,000');

  await aliceCtx.close();
  await bobCtx.close();
});
