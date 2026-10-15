/**
 * Telegram Mini App bridge (ADR-018).
 *
 * Telegram opens the app with signed launch data in the URL fragment
 * (`#tgWebAppData=...`). It is kept in sessionStorage for this tab so that
 * reloads inside Telegram still have it; the server checks its signature on
 * every sign-in, so nothing here is trusted. Outside Telegram there is no
 * launch data and none of this runs.
 */

import { ApiError } from './api/client';

export const TELEGRAM_SCRIPT_URL = 'https://telegram.org/js/telegram-web-app.js';

const INIT_DATA_KEY = 'kofclub.tgInitData';
const START_HANDLED_KEY = 'kofclub.tgStartHandled';
/** The server rejects longer launch data. */
const MAX_INIT_DATA = 4096;

export type InvoiceStatus = 'paid' | 'cancelled' | 'failed' | 'pending';

/** The parts of window.Telegram.WebApp this app uses. */
export interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  openTelegramLink(url: string): void;
  openInvoice(url: string, callback?: (status: InvoiceStatus) => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** The launch data in a Mini App URL fragment, or null. */
export function initDataFromHash(hash: string): string | null {
  const data = new URLSearchParams(hash.replace(/^#/, '')).get('tgWebAppData');
  return data && data.length <= MAX_INIT_DATA ? data : null;
}

/** The `startapp` parameter of a t.me link that opened the app, or null. */
export function startParamOf(initData: string): string | null {
  return new URLSearchParams(initData).get('start_param');
}

/** `c-<CODE>` start parameters open a club's join page (see the bot). */
export function joinCodeFromStartParam(param: string | null): string | null {
  const m = param ? /^c-([A-Za-z0-9]{6,16})$/.exec(param) : null;
  return m?.[1]?.toUpperCase() ?? null;
}

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

let cached: string | null | undefined;

/** The launch data when the app runs inside Telegram, else null. */
export function telegramInitData(): string | null {
  if (cached !== undefined) return cached;
  if (typeof window === 'undefined') return null;
  const storage = session();
  let data = initDataFromHash(window.location.hash);
  try {
    if (data) storage?.setItem(INIT_DATA_KEY, data);
    else data = storage?.getItem(INIT_DATA_KEY) ?? null;
  } catch {
    /* storage blocked: the launch data lasts for this page */
  }
  cached = data;
  return data;
}

/**
 * Where a start parameter leads: `c-<CODE>` to a club's join page,
 * `store` to the store. Null for anything else.
 */
export function routeForStartParam(param: string | null): string | null {
  if (param === 'store') return '/store';
  const code = joinCodeFromStartParam(param);
  return code ? `/join?code=${encodeURIComponent(code)}` : null;
}

/**
 * The page the link that opened the app points to, once per tab: later
 * visits to the home page are not redirected again.
 */
export function takeStartRoute(): string | null {
  const data = telegramInitData();
  const route = data ? routeForStartParam(startParamOf(data)) : null;
  if (!route) return null;
  const storage = session();
  try {
    if (storage?.getItem(START_HANDLED_KEY)) return null;
    storage?.setItem(START_HANDLED_KEY, '1');
  } catch {
    /* without storage the redirect may repeat on reload; harmless */
  }
  return route;
}

let loading: Promise<TelegramWebApp | null> | null = null;

/**
 * Loads Telegram's Mini App script (only inside Telegram). It must run
 * while the launch fragment is still in the URL, so the bridge loads it on
 * the first render. Resolves null when it cannot be loaded.
 */
export function loadTelegramWebApp(): Promise<TelegramWebApp | null> {
  if (typeof window === 'undefined' || !telegramInitData()) return Promise.resolve(null);
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp);
  loading ??= new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = TELEGRAM_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(window.Telegram?.WebApp ?? null);
    script.onerror = () => {
      loading = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Opens a Stars invoice inside Telegram and resolves with how it ended.
 * Outside Telegram (or on a client too old for payments) it rejects.
 */
export async function openInvoice(url: string): Promise<InvoiceStatus> {
  const webApp = await loadTelegramWebApp();
  if (!webApp) throw new Error('Purchases are made in the Telegram app.');
  return new Promise((resolve, reject) => {
    try {
      webApp.openInvoice(url, (status) => resolve(status));
    } catch {
      reject(new Error('Update Telegram to pay with Stars.'));
    }
  });
}

/** A t.me link that opens the Mini App on the store page. */
export function storeStartLink(botUsername: string): string {
  return `https://t.me/${encodeURIComponent(botUsername)}?startapp=store`;
}

/** A t.me link that opens the Mini App on a club's join page. */
export function clubStartLink(botUsername: string, joinCode: string): string {
  return `https://t.me/${encodeURIComponent(botUsername)}?startapp=c-${encodeURIComponent(joinCode)}`;
}

/** Telegram's "share to a chat" link for a club invitation. */
export function shareClubLink(botUsername: string, joinCode: string, clubName: string): string {
  const url = clubStartLink(botUsername, joinCode);
  const text = `Join my poker club "${clubName}" on KofClub (free play, virtual chips).`;
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

/** Opens a t.me link: inside Telegram without leaving the app. */
export async function openTelegramLink(url: string): Promise<void> {
  const webApp = await loadTelegramWebApp();
  if (webApp) webApp.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Inside the Telegram Mini App (ADR-018): how the automatic sign-in with
 * Telegram's launch data went.
 */
export interface TelegramSession {
  initData: string;
  /**
   * signed-in: the Telegram account's KofClub account is open;
   * not-linked: no KofClub account yet (create one or link by logging in);
   * mfa-required: the account needs its authentication code;
   * failed: Telegram sign-in is unavailable (see `message`).
   */
  state: 'signed-in' | 'not-linked' | 'mfa-required' | 'failed';
  firstName: string | null;
  message: string | null;
}

/** What a Telegram sign-in attempt means for the login page. */
export function telegramOutcome(initData: string, err: unknown): TelegramSession {
  const base = { initData, firstName: null, message: null };
  if (err === null) return { ...base, state: 'signed-in' };
  if (err instanceof ApiError && err.code === 'TELEGRAM_NOT_LINKED') {
    const firstName = err.details?.firstName;
    return {
      ...base,
      state: 'not-linked',
      firstName: typeof firstName === 'string' ? firstName : null,
    };
  }
  if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
    return { ...base, state: 'mfa-required' };
  }
  return {
    ...base,
    state: 'failed',
    message:
      err instanceof ApiError && err.code !== 'INTERNAL'
        ? err.message
        : 'Telegram sign-in is not available right now.',
  };
}

/** For tests: forget the cached launch data. */
export function resetTelegramForTests(): void {
  cached = undefined;
  loading = null;
}
