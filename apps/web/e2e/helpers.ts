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
