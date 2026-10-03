import { expect, test, type Page } from '@playwright/test';
import {
  chipsOnTable,
  myCards,
  parseChips,
  playPassively,
  register,
  snap,
  uniqueName,
  type Player,
} from './helpers';

/**
 * The playable vertical slice (spec "FIRST TARGET"): two players in two
 * browsers register, join a club, receive chips, sit at a table, play a
 * complete hand with private hole cards, survive a reload mid-hand, and the
 * chips reconcile end to end (table and ledger).
 */
test('two players play a complete hand of Hold’em', async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice: Player = { page: await aliceCtx.newPage(), username: uniqueName('alice') };
  const bob: Player = { page: await bobCtx.newPage(), username: uniqueName('bob') };
  const GRANT = 5_000;
  const BUY_IN = 1_000;

  // --- accounts & club ----------------------------------------------------
  await register(alice.page, alice.username);
  await register(bob.page, bob.username);

  await alice.page.getByLabel('Club name').fill(`E2E Club ${alice.username}`);
  await alice.page.getByRole('button', { name: 'Create club' }).click();
  await expect(alice.page.getByTestId('club-name')).toContainText('E2E Club');
  const clubUrl = alice.page.url();
  const joinCode = (await alice.page.getByTestId('join-code').textContent())?.trim() ?? '';
  expect(joinCode).toMatch(/^[A-Z0-9]{8}$/);

  await bob.page.getByLabel('Join or invite code').fill(joinCode);
  await bob.page.getByRole('button', { name: 'Join' }).click();
  await expect(bob.page).toHaveURL(clubUrl);
  await expect(bob.page.getByTestId('wallet-balance')).toHaveText('0');

  // --- chips (owner grants from the club treasury) ---------------------------
  await alice.page.reload();
  for (const p of [alice, bob]) {
    const row = alice.page.locator(`tr[data-member="${p.username}"]`);
    await row.getByRole('textbox').fill(String(GRANT));
    await row.getByRole('button', { name: 'Grant' }).click();
    await expect(alice.page.getByText(`Granted 5,000 chips to ${p.username}.`)).toBeVisible();
  }
  await expect(alice.page.getByTestId('wallet-balance')).toHaveText('5,000');
  await snap(alice.page, '01-club-lobby');

  // --- table ------------------------------------------------------------------
  await alice.page.getByLabel('Name', { exact: true }).fill('Heads Up');
  await alice.page.getByLabel('Turn time (s)').fill('60');
  await alice.page.getByRole('button', { name: 'Create table' }).click();
  await alice.page.getByTestId('table-list').getByRole('link', { name: 'Open' }).first().click();
  await expect(alice.page.getByTestId('table-name')).toHaveText('Heads Up');
  const tableUrl = alice.page.url();

  await sitDown(alice.page, 1, BUY_IN);
  await bob.page.goto(tableUrl);
  await sitDown(bob.page, 2, BUY_IN);

  // --- hand 1 starts automatically --------------------------------------------
  for (const p of [alice, bob]) {
    await expect(p.page.getByTestId('poker-table')).toHaveAttribute('data-hand-no', '1');
    await expect.poll(() => myCards(p.page)).toHaveLength(2);
  }
  const aliceCards = await myCards(alice.page);
  const bobCards = await myCards(bob.page);
  expect(aliceCards.filter((c) => bobCards.includes(c))).toEqual([]);

  // Private cards: each browser sees only its own faces; the opponent is face down.
  await expect(alice.page.getByTestId('seat-2').locator('[data-card]')).toHaveCount(0);
  await expect(alice.page.getByTestId('seat-2').getByTestId('card-back')).toHaveCount(2);
  await expect(bob.page.getByTestId('seat-1').locator('[data-card]')).toHaveCount(0);
  expect(await alice.page.content()).not.toContain(`data-card="${bobCards[0]}"`);
  await snap(alice.page, '02-table-alice');
  await snap(bob.page, '03-table-bob');

  const handDone = (n: number) => async () => {
    for (const p of [alice, bob]) {
      const panel = p.page.getByTestId('last-hand');
      if (!(await panel.isVisible()) || !(await panel.textContent())?.includes(`Hand #${n}`)) {
        return false;
      }
    }
    return true;
  };

  const actions = await playPassively([alice, bob], handDone(1), async (_actor, count) => {
    if (count !== 1) return;
    // Reconnect mid-hand: a reload restores the same private state.
    await bob.page.reload();
    await expect(bob.page.getByTestId('connection-status')).toHaveAttribute('data-status', 'open');
    await expect.poll(() => myCards(bob.page)).toEqual(bobCards);
    await expect(bob.page.getByTestId('seat-2')).toHaveAttribute('data-username', bob.username);
  });
  expect(actions).toBeGreaterThanOrEqual(2);

  // Same final picture in both browsers, and no chip created or destroyed.
  await expect.poll(() => chipsOnTable(alice.page)).toBe(2 * BUY_IN);
  await expect.poll(() => chipsOnTable(bob.page)).toBe(2 * BUY_IN);
  await expect(alice.page.getByTestId('action-log')).toContainText('Hand #1 complete.');
  await snap(alice.page, '04-hand-complete');

  // --- leave and reconcile wallets via the ledger -----------------------------
  await leave(alice, [alice, bob]);
  await leave(bob, [bob]);
  let total = 0;
  for (const p of [alice, bob]) {
    await p.page.goto(clubUrl);
    total += parseChips(await p.page.getByTestId('wallet-balance').textContent());
  }
  expect(total).toBe(2 * GRANT);

  await aliceCtx.close();
  await bobCtx.close();
});

async function sitDown(page: Page, seat: number, buyIn: number): Promise<void> {
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'open');
  await page.getByTestId(`sit-${seat}`).click();
  const input = page.getByLabel('Buy-in amount');
  await expect(input).not.toHaveValue('');
  await input.fill(String(buyIn));
  await page.getByRole('button', { name: 'Buy in' }).click();
  await expect(page.getByTestId(`seat-${seat}`).getByTestId('seat-stack')).toHaveText(
    buyIn.toLocaleString('en-US'),
  );
}

/** Leaves the table, finishing any hand in progress first. */
async function leave(player: Player, atTable: Player[]): Promise<void> {
  const button = player.page.getByRole('button', { name: /^Leave table|^Leaving/ });
  await button.click();
  const gone = async () =>
    (await player.page.getByRole('button', { name: /^Leave table|^Leaving/ }).count()) === 0;
  await playPassively(atTable, gone);
  await expect(player.page.getByText(/You (left the table|will leave)/)).toBeVisible();
}
