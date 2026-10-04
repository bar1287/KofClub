import { expect, test } from '@playwright/test';
import {
  chipsOnTable,
  clubWithChips,
  myCards,
  playPassively,
  register,
  sitDown,
  snap,
  uniqueName,
  watchCsp,
  type Player,
} from './helpers';

/**
 * M9: a Pot-Limit Omaha table runs on the same table infrastructure. Each
 * player sees exactly their own four cards, sizing is capped at the pot,
 * and history keeps the four cards and the game.
 */
test('two players play a hand of Pot-Limit Omaha', async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice: Player = { page: await aliceCtx.newPage(), username: uniqueName('alice') };
  const bob: Player = { page: await bobCtx.newPage(), username: uniqueName('bob') };
  const cspViolations = [...watchCsp(alice.page), ...watchCsp(bob.page)];
  const BUY_IN = 1_000;

  await register(alice.page, alice.username);
  await register(bob.page, bob.username);
  await clubWithChips(alice, bob, 5_000);

  // --- a PLO table --------------------------------------------------------------
  await alice.page.getByLabel('Name', { exact: true }).fill('Omaha Night');
  await alice.page.getByLabel('Game').selectOption('PLO');
  await alice.page.getByLabel('Turn time (s)').fill('60');
  await alice.page.getByRole('button', { name: 'Create table' }).click();
  const row = alice.page.getByTestId('table-list').locator('tr', { hasText: 'Omaha Night' });
  await expect(row).toContainText('PL Omaha');
  await row.getByRole('link', { name: 'Open' }).click();
  await expect(alice.page.getByTestId('table-game')).toContainText('PL Omaha');
  const tableUrl = alice.page.url();

  await sitDown(alice.page, 1, BUY_IN);
  await bob.page.goto(tableUrl);
  await sitDown(bob.page, 2, BUY_IN);

  // --- four private cards each -------------------------------------------------------
  for (const p of [alice, bob]) {
    await expect(p.page.getByTestId('poker-table')).toHaveAttribute('data-hand-no', '1');
    await expect.poll(() => myCards(p.page)).toHaveLength(4);
  }
  const aliceCards = await myCards(alice.page);
  const bobCards = await myCards(bob.page);
  expect(aliceCards.filter((c) => bobCards.includes(c))).toEqual([]);
  await expect(alice.page.getByTestId('seat-2').getByTestId('card-back')).toHaveCount(4);
  await expect(bob.page.getByTestId('seat-1').getByTestId('card-back')).toHaveCount(4);
  await expect(alice.page.getByTestId('seat-2').locator('[data-card]')).toHaveCount(0);

  // --- pot-limit sizing: the small blind may raise to at most 30 ----------------
  const found: { opener?: Player } = {};
  await expect
    .poll(async () => {
      for (const p of [alice, bob]) {
        if (await p.page.getByTestId('aggressive-action').isVisible()) found.opener = p;
      }
      return found.opener !== undefined;
    })
    .toBe(true);
  const opener = found.opener!;
  const sizing = opener.page.locator('.sizing');
  await expect(sizing.getByRole('button', { name: 'Pot' })).toBeVisible();
  await expect(sizing.getByRole('button', { name: 'All-in' })).toHaveCount(0);
  await expect(opener.page.getByLabel('Bet amount')).toHaveAttribute('max', '30');
  await sizing.getByRole('button', { name: 'Pot' }).click();
  await expect(opener.page.getByTestId('aggressive-action')).toHaveText('Raise to 30');
  await snap(opener.page, '10-plo-pot-raise');
  await opener.page.getByTestId('aggressive-action').click();
  await expect(opener.page.getByTestId('action-log')).toContainText(/raises to 30/i);

  const handDone = async () => {
    for (const p of [alice, bob]) {
      const panel = p.page.getByTestId('last-hand');
      if (!(await panel.isVisible()) || !(await panel.textContent())?.includes('Hand #1')) {
        return false;
      }
    }
    return true;
  };
  await playPassively([alice, bob], handDone);
  await expect.poll(() => chipsOnTable(alice.page)).toBe(2 * BUY_IN);
  await expect.poll(() => chipsOnTable(bob.page)).toBe(2 * BUY_IN);

  // --- history: the game and all four of alice's cards ---------------------------
  const history = await aliceCtx.newPage();
  await history.goto('/hands');
  await expect(history.getByTestId('hand-list')).toContainText('PL Omaha');
  await history.getByTestId('hand-list').getByRole('link', { name: '#1', exact: true }).click();
  await expect(history.getByTestId('hand-title')).toHaveText('Hand #1');
  await expect(history.getByText(/PL Omaha/)).toBeVisible();
  await expect(history.getByTestId('my-hole-cards').locator('[data-card]')).toHaveCount(4);
  expect(
    await history
      .getByTestId('my-hole-cards')
      .locator('[data-card]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-card'))),
  ).toEqual(aliceCards);
  await snap(history, '11-plo-history');

  expect(cspViolations).toEqual([]);
  await aliceCtx.close();
  await bobCtx.close();
});
