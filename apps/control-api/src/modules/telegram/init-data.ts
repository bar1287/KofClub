import { createHmac, timingSafeEqual } from 'node:crypto';

/** The Telegram user in Mini App init data (fields the platform uses). */
export interface TelegramUser {
  id: number;
  username: string | null;
  firstName: string | null;
  languageCode: string | null;
}

export interface InitData {
  user: TelegramUser;
  authDate: Date;
  /** The Mini App start parameter (t.me/<bot>?startapp=…), if any. */
  startParam: string | null;
}

export type InitDataProblem = 'malformed' | 'signature' | 'expired' | 'no_user';

export class InitDataError extends Error {
  constructor(readonly problem: InitDataProblem) {
    super(`telegram init data rejected: ${problem}`);
    this.name = 'InitDataError';
  }
}

/** HMAC-SHA256 key derived from the bot token ("WebAppData" scheme). */
export function initDataSecret(botToken: string): Buffer {
  return createHmac('sha256', 'WebAppData').update(botToken).digest();
}

/** Every field except `hash`, as key=value lines in key order. */
function dataCheckString(params: URLSearchParams): string {
  const pairs: string[] = [];
  for (const [key, value] of params) if (key !== 'hash') pairs.push(`${key}=${value}`);
  return pairs.sort().join('\n');
}

/** Signs init data the way Telegram does (tests and local tooling). */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const hash = createHmac('sha256', initDataSecret(botToken))
    .update(dataCheckString(params))
    .digest('hex');
  params.set('hash', hash);
  return params.toString();
}

const START_PARAM = /^[A-Za-z0-9_-]{1,512}$/;
/** Clock skew tolerated for auth_date in the future. */
const FUTURE_SKEW_SECONDS = 60;

/**
 * Validates `Telegram.WebApp.initData` (ADR-018): the hash must be the
 * HMAC of the data-check string under the bot-token-derived key, and the
 * data must be younger than maxAgeSec. Returns the Telegram user; never
 * trust anything from init data that this function did not check.
 */
export function validateInitData(
  raw: string,
  botToken: string,
  maxAgeSec: number,
  nowMs: number = Date.now(),
): InitData {
  if (raw.length === 0 || raw.length > 4096) throw new InitDataError('malformed');
  const params = new URLSearchParams(raw);
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) throw new InitDataError('malformed');
    seen.add(key);
  }
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw new InitDataError('malformed');
  const expected = createHmac('sha256', initDataSecret(botToken))
    .update(dataCheckString(params))
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw new InitDataError('signature');

  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate <= 0) throw new InitDataError('malformed');
  const ageSec = nowMs / 1000 - authDate;
  if (ageSec > maxAgeSec) throw new InitDataError('expired');
  if (ageSec < -FUTURE_SKEW_SECONDS) throw new InitDataError('malformed');

  const rawUser = params.get('user');
  if (!rawUser) throw new InitDataError('no_user');
  let u: Record<string, unknown>;
  try {
    u = JSON.parse(rawUser) as Record<string, unknown>;
  } catch {
    throw new InitDataError('malformed');
  }
  if (typeof u !== 'object' || u === null) throw new InitDataError('malformed');
  if (typeof u.id !== 'number' || !Number.isSafeInteger(u.id) || u.id <= 0 || u.is_bot === true) {
    throw new InitDataError('no_user');
  }
  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
  const startParam = params.get('start_param');
  return {
    user: {
      id: u.id,
      username: text(u.username, 64),
      firstName: text(u.first_name, 128),
      languageCode: text(u.language_code, 16),
    },
    authDate: new Date(authDate * 1000),
    startParam: startParam && START_PARAM.test(startParam) ? startParam : null,
  };
}
