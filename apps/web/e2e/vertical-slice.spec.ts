import { expect, test } from '@playwright/test';
import {
  chipsOnTable,
  myCards,
  parseChips,
  playPassively,
  register,
  sitDown,
  snap,
  uniqueName,
  watchCsp,
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
  const cspViolations = [...watchCsp(alice.page), ...watchCsp(bob.page)];
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

  // --- pre-actions: the big blind queues "Check" while the button acts ------
  // Heads-up, the button (small blind) acts first preflop.
  const callButton = (p: Player) => p.page.getByRole('button', { name: /^Call \d/ });
  await expect
    .poll(async () => (await callButton(alice).isVisible()) || (await callButton(bob).isVisible()))
    .toBe(true);
  const [first, waiting] = (await callButton(alice).isVisible()) ? [alice, bob] : [bob, alice];
  await expect(waiting.page.getByTestId('pre-action-CALL_ANY')).toBeVisible();
  await waiting.page.getByTestId('pre-action-CHECK').check();
  await expect(waiting.page.getByTestId('pre-action-CHECK')).toBeChecked();
  await callButton(first).click();
  // The queued check is played without a click: the flop comes.
  for (const p of [alice, bob]) {
    await expect(p.page.getByTestId('action-log')).toContainText(`${waiting.username} checks`);
    await expect(p.page.getByTestId('board').locator('[data-card]')).toHaveCount(3);
  }

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

  // --- table chat: a message, a reaction, a report the owner acts on ----------
  await alice.page.getByLabel('Chat message').fill('good luck');
  await alice.page.getByRole('button', { name: 'Send', exact: true }).click();
  for (const p of [alice, bob]) {
    await expect(p.page.getByTestId('chat-log')).toContainText(`${alice.username} good luck`);
  }
  await expect(alice.page.getByLabel('Chat message')).toHaveValue('');
  await bob.page.getByTestId('react-🔥').click();
  await expect(alice.page.getByTestId('seat-2').getByTestId('seat-reaction')).toHaveText('🔥');

  const line = bob.page.getByTestId('chat-message').filter({ hasText: 'good luck' });
  await line.hover();
  await line.getByRole('button', { name: `Report message from ${alice.username}` }).click();
  await bob.page.getByLabel('Reason (optional)').fill('e2e report');
  await bob.page.getByRole('button', { name: 'Report', exact: true }).click();
  await expect(bob.page.getByText('Club staff will review it.')).toBeVisible();
  await bob.page.getByRole('button', { name: 'Close', exact: true }).click();

  const admin = await aliceCtx.newPage();
  await admin.goto(`${clubUrl}/admin`);
  await admin.getByRole('tab', { name: 'Chat reports' }).click();
  await expect(admin.getByTestId('chat-reports')).toContainText('e2e report');
  await admin.getByRole('button', { name: 'Hide message' }).click();
  await expect(admin.getByText(`The message from ${alice.username} was hidden.`)).toBeVisible();
  await admin.close();
  // Hidden for everyone, live.
  for (const p of [alice, bob]) {
    await expect(p.page.getByTestId('chat-log')).not.toContainText('good luck');
  }

  // --- hand history: own cards, public record ---------------------------------
  const history = await aliceCtx.newPage();
  await history.goto('/hands');
  await history.getByTestId('hand-list').getByRole('link', { name: '#1', exact: true }).click();
  await expect(history.getByTestId('hand-title')).toHaveText('Hand #1');
  await expect(history.getByTestId('my-hole-cards').locator('[data-card]')).toHaveCount(2);
  expect(
    await history
      .getByTestId('my-hole-cards')
      .locator('[data-card]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-card'))),
  ).toEqual(aliceCards);
  await expect(history.getByTestId('hand-actions')).toContainText('Hand #1 complete.');
  await snap(history, '05-hand-history');
  await history.close();

  // --- leave and reconcile wallets via the ledger -----------------------------
  await leave(alice, [alice, bob]);
  await leave(bob, [bob]);
  let total = 0;
  for (const p of [alice, bob]) {
    await p.page.goto(clubUrl);
    total += parseChips(await p.page.getByTestId('wallet-balance').textContent());
  }
  expect(total).toBe(2 * GRANT);

  // The strict nonce CSP never got in the way of the app.
  expect(cspViolations).toEqual([]);

  await aliceCtx.close();
  await bobCtx.close();
});

/** Leaves the table, finishing any hand in progress first. */
async function leave(player: Player, atTable: Player[]): Promise<void> {
  const button = player.page.getByRole('button', { name: /^Leave table|^Leaving/ });
  await button.click();
  const gone = async () =>
    (await player.page.getByRole('button', { name: /^Leave table|^Leaving/ }).count()) === 0;
  await playPassively(atTable, gone);
  await expect(player.page.getByText(/You (left the table|will leave)/)).toBeVisible();
}
