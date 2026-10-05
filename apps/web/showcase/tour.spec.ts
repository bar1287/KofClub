import { expect, test, type Browser, type Page } from '@playwright/test';
import { myCards, playAllIn, playPassively, sitDown, totp, type Player } from '../e2e/helpers';

/**
 * A guided tour of the product on the demo data (db/seeds/demo.json): the
 * club owner alice, bob and carol (carol is made a platform administrator by
 * scripts/screenshots.sh). Each step saves a screenshot to SHOWCASE_DIR.
 */
const dir = process.env.SHOWCASE_DIR ?? 'showcase-output';
const PASSWORD = (u: string) => `${u}-demo-password`;

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.waitForTimeout(400); // let transitions settle
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage });
}

async function signIn(page: Page, username: string, code?: () => string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD(username));
  await page.getByRole('button', { name: 'Log in' }).click();
  if (code) {
    await page.getByTestId('mfa-code').fill(code());
    await page.getByRole('button', { name: 'Log in' }).click();
  }
  await expect(page.getByTestId('current-user')).toHaveText(username);
}

async function player(browser: Browser, username: string): Promise<Player> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, username);
  return { page, username };
}

test('product tour', async ({ browser }) => {
  // --- sign-in and the club lobby ----------------------------------------------
  const loginCtx = await browser.newContext();
  const loginPage = await loginCtx.newPage();
  await loginPage.goto('/login');
  await loginPage.getByLabel('Email or username').fill('alice');
  await loginPage.getByLabel('Password').fill('••••••••••••');
  await shot(loginPage, '01-login');
  await loginCtx.close();

  const alice = await player(browser, 'alice');
  const bob = await player(browser, 'bob');
  const carol = await player(browser, 'carol');
  await alice.page.goto('/clubs');
  await expect(alice.page.getByRole('link', { name: /Demo Club/ })).toBeVisible();
  await shot(alice.page, '02-my-clubs');
  await alice.page
    .getByRole('link', { name: /Demo Club/ })
    .first()
    .click();
  await expect(alice.page.getByTestId('club-name')).toContainText('Demo Club');
  const clubUrl = alice.page.url();

  // Staff open two tables: No-Limit Hold'em and Pot-Limit Omaha.
  for (const [name, game, sb, bb] of [
    ['Main Street', 'NLHE', '5', '10'],
    ['Omaha Corner', 'PLO', '10', '20'],
  ] as const) {
    await alice.page.getByLabel('Name', { exact: true }).fill(name);
    await alice.page.locator('select[name="gameType"]').selectOption(game);
    await alice.page.getByLabel('Small blind').fill(sb);
    await alice.page.getByLabel('Big blind').fill(bb);
    await alice.page.getByLabel('Min buy-in').fill(String(Number(bb) * 20));
    await alice.page.getByLabel('Max buy-in').fill(String(Number(bb) * 200));
    await alice.page.getByLabel('Turn time (s)').fill('30');
    await alice.page.getByRole('button', { name: 'Create table' }).click();
    await expect(alice.page.getByTestId('table-list')).toContainText(name);
  }
  await shot(alice.page, '03-club-lobby', true);

  // --- a cash game: three players, private hole cards -------------------------------
  await alice.page
    .getByTestId('table-list')
    .locator('tr', { hasText: 'Main Street' })
    .getByRole('link', { name: 'Open' })
    .click();
  await expect(alice.page.getByTestId('table-name')).toHaveText('Main Street');
  const tableUrl = alice.page.url();
  await sitDown(alice.page, 1, 1000);
  await bob.page.goto(tableUrl);
  await sitDown(bob.page, 3, 1500);
  await carol.page.goto(tableUrl);
  await sitDown(carol.page, 5, 2000);
  const players = [alice, bob, carol];
  for (const p of players) await expect.poll(() => myCards(p.page)).toHaveLength(2);

  // The player to act sees the action bar with legal actions and sizing.
  const toAct = async () => {
    for (const p of players) {
      if (
        await p.page
          .getByRole('button', { name: 'Fold', exact: true })
          .isEnabled()
          .catch(() => false)
      )
        return p;
    }
    return null;
  };
  await expect.poll(async () => (await toAct()) !== null).toBe(true);
  await shot((await toAct())!.page, '04-table-your-turn');

  const handOne = async () => {
    for (const p of players) {
      const panel = p.page.getByTestId('last-hand');
      if (!(await panel.isVisible()) || !(await panel.textContent())?.includes('Hand #1'))
        return false;
    }
    return true;
  };
  await playPassively(players, handOne);
  await shot(alice.page, '05-table-after-hand');

  // Mobile layout of the same table (bob on a phone).
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const bobPhone = await phone.newPage();
  await signIn(bobPhone, 'bob');
  await bobPhone.goto(tableUrl);
  await expect(bobPhone.getByTestId('poker-table')).toBeVisible();
  await expect.poll(() => myCards(bobPhone)).toHaveLength(2);
  await shot(bobPhone, '06-table-mobile');
  await phone.close();

  // Hand history with the public record and the viewer's own cards.
  await alice.page.getByTestId('last-hand').getByRole('link').first().click();
  await expect(alice.page.getByTestId('hand-title')).toBeVisible();
  await shot(alice.page, '07-hand-history', true);

  // Everyone leaves the cash table (chips return to the club wallet).
  for (const p of players) {
    await p.page.goto(tableUrl);
    await p.page.getByRole('button', { name: 'Leave table' }).click();
  }

  // --- a three-player sit-and-go ---------------------------------------------------
  await alice.page.goto(clubUrl);
  const panel = alice.page.getByTestId('tournaments-panel');
  await panel.getByRole('button', { name: 'New tournament' }).click();
  const form = alice.page.getByTestId('create-tournament');
  await form.getByLabel('Tournament name').fill('Sunday Turbo');
  for (const [label, value] of [
    ['Buy-in (club chips)', '500'],
    ['Starting stack', '1500'],
    ['Level 1 small blind', '10'],
    ['Level 1 big blind', '20'],
    ['Level length (s)', '120'],
    ['Seats per table', '3'],
    ['Min players', '3'],
    ['Max players', '3'],
    ['Turn time (s)', '30'],
  ] as const) {
    await form.getByLabel(label, { exact: true }).fill(value);
  }
  await form.getByRole('button', { name: 'Create tournament' }).click();
  const row = (p: Page) =>
    p.getByTestId('tournament-list').locator('tr', { hasText: 'Sunday Turbo' });
  await expect(row(alice.page)).toContainText('Registering');
  await row(alice.page).getByRole('button', { name: 'Register' }).click();
  await bob.page.goto(clubUrl);
  await row(bob.page).getByRole('button', { name: 'Register' }).click();
  await expect(bob.page.getByTestId('wallet-balance')).toBeVisible();
  await alice.page.reload();
  await alice.page.getByTestId('tournaments-panel').scrollIntoViewIfNeeded();
  await shot(alice.page, '08-tournaments-in-lobby', true);
  await row(alice.page).getByRole('link', { name: 'Sunday Turbo' }).click();
  await expect(alice.page.getByTestId('tournament-status')).toHaveText('Registering');
  await shot(alice.page, '09-tournament-registering', true);

  // The last registration fills it; everyone follows their table.
  await carol.page.goto(clubUrl);
  await row(carol.page).getByRole('button', { name: 'Register' }).click();
  for (const p of players) {
    await p.page.goto(clubUrl);
    await row(p.page).getByRole('link', { name: 'Sunday Turbo' }).click();
    await expect(p.page.getByTestId('tournament-status')).toHaveText('Running');
    await p.page.getByTestId('my-table').click();
    await expect(p.page.getByTestId('table-game')).toContainText('Level 1');
    await expect.poll(() => myCards(p.page)).toHaveLength(2);
  }
  await shot(alice.page, '10-tournament-table');

  const finished = async () => {
    for (const p of players) {
      if (!(await p.page.getByTestId('tournament-result').isVisible())) return false;
    }
    return true;
  };
  await playAllIn(players, finished);
  const winner = (
    await Promise.all(
      players.map(async (p) =>
        (await p.page.getByTestId('tournament-result').textContent())?.includes('You won')
          ? p
          : null,
      ),
    )
  ).find(Boolean)!;
  await shot(winner.page, '11-tournament-won');
  await winner.page.getByRole('link', { name: 'See the results' }).click();
  await expect(winner.page.getByTestId('tournament-status')).toHaveText('Finished');
  await shot(winner.page, '12-tournament-results', true);

  // --- club administration ---------------------------------------------------------
  await alice.page.goto(`${clubUrl}/admin`);
  await expect(alice.page.getByTestId('admin-members')).toBeVisible();
  await shot(alice.page, '13-club-admin', true);

  // --- platform administration needs two-factor authentication --------------------
  await carol.page.goto('/admin');
  await expect(carol.page.getByTestId('admin-mfa-required')).toBeVisible();
  await shot(carol.page, '14-admin-needs-2fa');
  await carol.page.goto('/profile');
  const tfa = carol.page.getByTestId('two-factor');
  await tfa.getByRole('button', { name: 'Set up two-factor authentication' }).click();
  const secret = (await tfa.getByTestId('totp-secret').getAttribute('data-secret')) ?? '';
  const enrolledStep = Math.floor(Date.now() / 30_000);
  await tfa.getByTestId('totp-code').fill(totp(secret, enrolledStep));
  await shot(carol.page, '15-profile-2fa-setup', true);
  await tfa.getByRole('button', { name: 'Turn on' }).click();
  await expect(tfa.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
  await shot(carol.page, '16-profile-recovery-codes', true);
  await tfa.getByRole('button', { name: 'I saved them' }).click();
  await carol.page.goto('/admin');
  await expect(carol.page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(carol.page.getByTestId('admin-mfa-required')).toHaveCount(0);
  await shot(carol.page, '17-platform-admin', true);

  // Signing in again asks for the authenticator code after the password.
  await carol.page.getByRole('button', { name: 'Log out' }).click();
  await carol.page.getByLabel('Email or username').fill('carol');
  await carol.page.getByLabel('Password').fill(PASSWORD('carol'));
  await carol.page.getByRole('button', { name: 'Log in' }).click();
  await expect(carol.page.getByTestId('mfa-code')).toBeVisible();
  await carol.page
    .getByTestId('mfa-code')
    .fill(totp(secret, Math.max(Math.floor(Date.now() / 30_000), enrolledStep + 1)));
  await shot(carol.page, '18-login-with-code');
});
