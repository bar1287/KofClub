import { expect, test } from '@playwright/test';
import {
  clubWithChips,
  myCards,
  parseChips,
  playAllIn,
  register,
  snap,
  uniqueName,
  watchCsp,
  type Player,
} from './helpers';

/**
 * M10: a two-player sit-and-go. Staff creates it in the lobby, both players
 * register (the buy-ins form the prize pool), it starts when full, the
 * players follow their table from the tournament page, play until one has
 * every chip, and the prize is paid to the winner's club wallet.
 */
test('two players play a sit-and-go to the end', async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice: Player = { page: await aliceCtx.newPage(), username: uniqueName('alice') };
  const bob: Player = { page: await bobCtx.newPage(), username: uniqueName('bob') };
  const cspViolations = [...watchCsp(alice.page), ...watchCsp(bob.page)];

  await register(alice.page, alice.username);
  await register(bob.page, bob.username);
  const clubUrl = await clubWithChips(alice, bob, 5_000);

  // --- staff creates a heads-up sit-and-go ------------------------------------
  const panel = alice.page.getByTestId('tournaments-panel');
  await panel.getByRole('button', { name: 'New tournament' }).click();
  const form = alice.page.getByTestId('create-tournament');
  await form.getByLabel('Tournament name').fill('E2E Turbo');
  for (const [label, value] of [
    ['Buy-in (club chips)', '100'],
    ['Starting stack', '1000'],
    ['Seats per table', '2'],
    ['Min players', '2'],
    ['Max players', '2'],
    ['Turn time (s)', '60'],
  ] as const) {
    await form.getByLabel(label, { exact: true }).fill(value);
  }
  await form.getByRole('button', { name: 'Create tournament' }).click();
  const row = alice.page.getByTestId('tournament-list').locator('tr', { hasText: 'E2E Turbo' });
  await expect(row).toContainText('Registering');

  // --- registration: buy-ins move into the prize pool ---------------------------
  await row.getByRole('button', { name: 'Register' }).click();
  await expect(alice.page.getByText('Registered for E2E Turbo.')).toBeVisible();
  await expect(alice.page.getByTestId('wallet-balance')).toHaveText('4,900');
  await bob.page.goto(clubUrl);
  const bobRow = bob.page.getByTestId('tournament-list').locator('tr', { hasText: 'E2E Turbo' });
  await bobRow.getByRole('button', { name: 'Register' }).click();
  await expect(bob.page.getByTestId('wallet-balance')).toHaveText('4,900');

  // --- the full sit-and-go starts; both follow their table ----------------------
  for (const p of [alice, bob]) {
    await p.page.getByTestId('tournament-list').getByRole('link', { name: 'E2E Turbo' }).click();
    await expect(p.page.getByTestId('tournament-status')).toHaveText('Running');
    await expect(p.page.getByTestId('prize-pool')).toHaveText('200');
    await p.page.getByTestId('my-table').click();
    await expect(p.page.getByTestId('table-game')).toContainText('Level 1');
    await expect.poll(() => myCards(p.page)).toHaveLength(2);
  }
  await expect(alice.page.getByRole('button', { name: 'Leave table' })).toHaveCount(0);

  // --- look and feel (W1.6): settings stay in this browser ------------------------
  await expect(alice.page.getByTestId('seat-1').getByTestId('avatar')).toBeVisible();
  await alice.page.getByTestId('table-settings').click();
  const settings = alice.page.getByTestId('preferences');
  await settings.getByLabel('Four-color deck').check();
  await settings.locator('select[name="felt"]').selectOption('blue');
  await settings.locator('select[name="cardBack"]').selectOption('red');
  await alice.page.getByRole('button', { name: 'Close', exact: true }).click();
  const html = alice.page.locator('html');
  await expect(html).toHaveAttribute('data-felt', 'blue');
  await expect(html).toHaveAttribute('data-four-color', 'true');
  await expect(html).toHaveAttribute('data-card-back', 'red');
  await alice.page.reload();
  await expect(html).toHaveAttribute('data-felt', 'blue');
  await expect(alice.page.getByTestId('table-game')).toContainText('Level 1');
  await expect(bob.page.locator('html')).toHaveAttribute('data-felt', 'green'); // per browser
  await snap(alice.page, '20-tournament-table');

  // --- play until one player has every chip ---------------------------------------
  const finished = async () => {
    for (const p of [alice, bob]) {
      if (!(await p.page.getByTestId('tournament-result').isVisible())) return false;
    }
    return true;
  };
  await playAllIn([alice, bob], finished);
  const results = await Promise.all(
    [alice, bob].map((p) => p.page.getByTestId('tournament-result').textContent()),
  );
  const winnerIdx = results.findIndex((r) => r?.includes('You won the tournament!'));
  expect(winnerIdx).toBeGreaterThanOrEqual(0);
  expect(results[1 - winnerIdx]).toContain('You finished in 2nd place.');
  const winner = [alice, bob][winnerIdx]!;
  const loser = [alice, bob][1 - winnerIdx]!;

  // --- results and prize ----------------------------------------------------------------
  await winner.page.getByRole('link', { name: 'See the results' }).click();
  await expect(winner.page.getByTestId('tournament-status')).toHaveText('Finished');
  await expect(winner.page.getByTestId('my-result')).toContainText('Prize: 200 chips');
  await expect(
    winner.page.getByTestId('entrants').locator('tr', { hasText: loser.username }),
  ).toContainText('2nd');
  await snap(winner.page, '21-tournament-results');
  await winner.page.goto(clubUrl);
  await expect(winner.page.getByTestId('wallet-balance')).toHaveText('5,100');
  await loser.page.goto(clubUrl);
  expect(parseChips(await loser.page.getByTestId('wallet-balance').textContent())).toBe(4_900);

  expect(cspViolations).toEqual([]);
  await aliceCtx.close();
  await bobCtx.close();
});
