import { createHmac } from 'node:crypto';
import { InitDataError, signInitData, validateInitData } from './init-data';

const TOKEN = '123456789:' + 'A'.repeat(35); // test fixture, not a real bot
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const authDate = String(NOW / 1000 - 30);
const user = JSON.stringify({
  id: 4242,
  first_name: 'Dana',
  username: 'dana_k',
  language_code: 'he',
});

function problem(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof InitDataError) return err.problem;
    throw err;
  }
  return undefined;
}

describe('validateInitData', () => {
  it('accepts init data signed with the bot token', () => {
    const raw = signInitData(
      { auth_date: authDate, user, query_id: 'AAH', start_param: 'c-AB12CD34' },
      TOKEN,
    );
    const data = validateInitData(raw, TOKEN, 3600, NOW);
    expect(data.user).toEqual({
      id: 4242,
      username: 'dana_k',
      firstName: 'Dana',
      languageCode: 'he',
    });
    expect(data.startParam).toBe('c-AB12CD34');
    expect(data.authDate.getTime()).toBe(NOW - 30_000);
  });

  it('matches the reference algorithm: secret = HMAC("WebAppData", token), sorted lines', () => {
    const lines = [`auth_date=${authDate}`, `user=${user}`].sort().join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    const hash = createHmac('sha256', secret).update(lines).digest('hex');
    const raw = new URLSearchParams({ user, auth_date: authDate, hash }).toString();
    expect(validateInitData(raw, TOKEN, 3600, NOW).user.id).toBe(4242);
  });

  it('rejects tampering, other bots, old data and odd input', () => {
    const raw = signInitData({ auth_date: authDate, user }, TOKEN);
    const forged = raw.replace('4242', '4243');
    expect(problem(() => validateInitData(forged, TOKEN, 3600, NOW))).toBe('signature');
    expect(problem(() => validateInitData(raw, '987654321:' + 'B'.repeat(35), 3600, NOW))).toBe(
      'signature',
    );
    expect(problem(() => validateInitData(raw, TOKEN, 10, NOW))).toBe('expired');
    const future = signInitData({ auth_date: String(NOW / 1000 + 600), user }, TOKEN);
    expect(problem(() => validateInitData(future, TOKEN, 3600, NOW))).toBe('malformed');
    expect(problem(() => validateInitData('', TOKEN, 3600, NOW))).toBe('malformed');
    expect(problem(() => validateInitData(`${raw}&user=x`, TOKEN, 3600, NOW))).toBe('malformed');
    const noUser = signInitData({ auth_date: authDate }, TOKEN);
    expect(problem(() => validateInitData(noUser, TOKEN, 3600, NOW))).toBe('no_user');
    const bot = signInitData(
      { auth_date: authDate, user: JSON.stringify({ id: 1, is_bot: true }) },
      TOKEN,
    );
    expect(problem(() => validateInitData(bot, TOKEN, 3600, NOW))).toBe('no_user');
  });

  it('drops a start parameter Telegram would not send', () => {
    const raw = signInitData({ auth_date: authDate, user, start_param: 'bad value!' }, TOKEN);
    expect(validateInitData(raw, TOKEN, 3600, NOW).startParam).toBeNull();
  });
});
