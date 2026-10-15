import { createHmac, randomInt } from 'node:crypto';
import type { Page } from '@playwright/test';
import { uniqueName } from './helpers';

// scripts/e2e.sh runs the stack with a made-up bot whose token signs the
// launch data below, exactly as Telegram does (ADR-018).
export const botToken = process.env.E2E_TELEGRAM_BOT_TOKEN ?? '';

export interface TelegramUser {
  id: number;
  first_name: string;
  username: string;
}

export function telegramUser(firstName: string): TelegramUser {
  return {
    id: randomInt(1_000_000, 2 ** 40),
    first_name: firstName,
    username: uniqueName('tg').replace(/[^A-Za-z0-9_]/g, ''),
  };
}

/** Mini App launch data signed with the bot token (Telegram's algorithm). */
export function signInitData(user: TelegramUser, startParam?: string): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `AAE${randomInt(1_000_000_000)}`,
    user: JSON.stringify(user),
    ...(startParam ? { start_param: startParam } : {}),
  };
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

/**
 * Opens the app the way Telegram does, with a stand-in for Telegram's
 * script. An opened invoice waits in `window.__invoice` until the test
 * settles it (see `settleInvoice`).
 */
export async function openMiniApp(page: Page, initData: string, path = '/'): Promise<void> {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.Telegram = { WebApp: {
        initData: '', ready() { window.__tgReady = true; }, expand() {},
        openTelegramLink(url) { (window.__tgLinks ||= []).push(url); },
        openInvoice(url, cb) { window.__invoice = { url, cb }; },
      } };`,
    }),
  );
  const hash = new URLSearchParams({
    tgWebAppData: initData,
    tgWebAppVersion: '8.0',
    tgWebAppPlatform: 'tdesktop',
  });
  await page.goto(`${path}#${hash.toString()}`);
}

/** Closes the open invoice the way Telegram reports it to the app. */
export async function settleInvoice(page: Page, status: 'paid' | 'cancelled'): Promise<void> {
  await page.evaluate((s) => {
    const w = window as unknown as { __invoice?: { cb(status: string): void } };
    w.__invoice?.cb(s);
    delete w.__invoice;
  }, status);
}
