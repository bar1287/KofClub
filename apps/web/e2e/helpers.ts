import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

export interface Player {
  page: Page;
  username: string;
}

export function uniqueName(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function register(page: Page, username: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Email').fill(`${username}@example.test`);
  await page.getByLabel(/^Username/).fill(username);
  await page.getByLabel(/^Password/).fill(`${username}-password-1`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/clubs$/);
  await expect(page.getByTestId('current-user')).toHaveText(username);
}

/** Integer value of a "12,345"-formatted chip amount. */
export function parseChips(text: string | null): number {
  return Number((text ?? '').replace(/[^0-9-]/g, ''));
}

/** Hole cards shown in the viewer's own seat ([] when none). */
export async function myCards(page: Page): Promise<string[]> {
  return page
    .getByTestId('my-cards')
    .locator('[data-card]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-card') ?? ''));
}

export async function tableSeq(page: Page): Promise<number> {
  return Number(await page.getByTestId('poker-table').getAttribute('data-seq'));
}

/** Sum of every seat stack plus the pot, as displayed. */
export async function chipsOnTable(page: Page): Promise<number> {
  const stacks = await page
    .getByTestId('seat-stack')
    .evaluateAll((els) => els.map((e) => e.textContent ?? ''));
  const pot = await page.getByTestId('pot').textContent();
  return stacks.reduce((sum, s) => sum + parseChips(s), 0) + parseChips(pot);
}

/**
 * Plays passively (check, otherwise call) for whichever player is to act
 * until `done()` holds. `onAction` runs after each action.
 */
export async function playPassively(
  players: Player[],
  done: () => Promise<boolean>,
  onAction?: (actor: Player, actions: number) => Promise<void>,
): Promise<number> {
  let actions = 0;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (await done()) return actions;
    let acted = false;
    for (const p of players) {
      const check = p.page.getByRole('button', { name: 'Check', exact: true });
      const call = p.page.getByRole('button', { name: /^Call \d/ });
      const button = (await check.isVisible()) ? check : (await call.isVisible()) ? call : null;
      if (!button || !(await button.isEnabled())) continue;
      const seq = await tableSeq(p.page);
      await button.click();
      // Applied once the table has moved past the seq we acted on.
      await expect.poll(() => tableSeq(p.page)).toBeGreaterThan(seq);
      actions++;
      acted = true;
      if (onAction) await onAction(p, actions);
      break;
    }
    if (!acted) await players[0]!.page.waitForTimeout(150);
  }
  throw new Error('hand did not finish in time');
}

/** Saves a screenshot when E2E_SCREENSHOT_DIR is set (docs / debugging). */
export async function snap(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/** Collects Content-Security-Policy violations reported by the browser. */
export function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content.Security.Policy/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}

/** Takes a seat with the given buy-in through the buy-in dialog. */
export async function sitDown(page: Page, seat: number, buyIn: number): Promise<void> {
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

/**
 * The owner creates a club, the other player joins with the join code and
 * the owner grants both of them chips. Returns the club URL.
 */
export async function clubWithChips(owner: Player, member: Player, grant: number): Promise<string> {
  await owner.page.getByLabel('Club name').fill(`E2E Club ${owner.username}`);
  await owner.page.getByRole('button', { name: 'Create club' }).click();
  await expect(owner.page.getByTestId('club-name')).toContainText('E2E Club');
  const clubUrl = owner.page.url();
  const joinCode = (await owner.page.getByTestId('join-code').textContent())?.trim() ?? '';
  await member.page.getByLabel('Join or invite code').fill(joinCode);
  await member.page.getByRole('button', { name: 'Join' }).click();
  await expect(member.page).toHaveURL(clubUrl);
  await owner.page.reload();
  for (const p of [owner, member]) {
    const row = owner.page.locator(`tr[data-member="${p.username}"]`);
    await row.getByRole('textbox').fill(String(grant));
    await row.getByRole('button', { name: 'Grant' }).click();
    await expect(
      owner.page.getByText(`Granted ${grant.toLocaleString('en-US')} chips to ${p.username}.`),
    ).toBeVisible();
  }
  return clubUrl;
}

/**
 * Plays aggressively (all-in whenever possible, otherwise call/check) for
 * whoever is to act until `done()` holds; tournaments end quickly this way.
 */
export async function playAllIn(players: Player[], done: () => Promise<boolean>): Promise<number> {
  let actions = 0;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (await done()) return actions;
    let acted = false;
    for (const p of players) {
      const page = p.page;
      const preset = page.locator('.sizing').getByRole('button', { name: 'All-in', exact: true });
      const aggressive = page.getByTestId('aggressive-action');
      const allIn = page.getByRole('button', { name: /^All-in/ });
      const call = page.getByRole('button', { name: /^Call \d/ });
      const check = page.getByRole('button', { name: 'Check', exact: true });
      const seq = await tableSeq(page);
      if (await preset.isVisible()) {
        await preset.click();
        if (!(await aggressive.isEnabled())) continue;
        await aggressive.click();
      } else if ((await allIn.isVisible()) && (await allIn.isEnabled())) {
        await allIn.first().click();
      } else if ((await call.isVisible()) && (await call.isEnabled())) {
        await call.click();
      } else if ((await check.isVisible()) && (await check.isEnabled())) {
        await check.click();
      } else {
        continue;
      }
      await expect.poll(() => tableSeq(page)).toBeGreaterThan(seq);
      actions++;
      acted = true;
      break;
    }
    if (!acted) await players[0]!.page.waitForTimeout(150);
  }
  throw new Error('play did not finish in time');
}

/** RFC 6238 code of a base32 secret at a time step (test-side authenticator). */
export function totp(secretBase32: string, step = Math.floor(Date.now() / 30_000)): string {
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
