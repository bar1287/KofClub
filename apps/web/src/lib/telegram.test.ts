import { ApiError } from './api/client';
import {
  clubStartLink,
  initDataFromHash,
  joinCodeFromStartParam,
  shareClubLink,
  startParamOf,
  telegramOutcome,
} from './telegram';

describe('Telegram launch data', () => {
  const initData =
    'query_id=AA1&user=%7B%22id%22%3A42%7D&auth_date=1700000000&start_param=c-abc123&hash=ff';

  it('reads the signed launch data from the URL fragment', () => {
    const hash = `#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=8.0&tgWebAppPlatform=ios`;
    expect(initDataFromHash(hash)).toBe(initData);
    expect(initDataFromHash('#section')).toBeNull();
    expect(initDataFromHash('')).toBeNull();
    expect(initDataFromHash(`#tgWebAppData=${'a'.repeat(5000)}`)).toBeNull();
  });

  it('routes c-<CODE> start parameters to a club join code', () => {
    expect(startParamOf(initData)).toBe('c-abc123');
    expect(joinCodeFromStartParam('c-abc123')).toBe('ABC123');
    for (const bad of [
      null,
      '',
      'c-',
      'c-abc',
      'x-ABC123',
      'c-ABC123/../x',
      `c-${'A'.repeat(17)}`,
    ]) {
      expect(joinCodeFromStartParam(bad)).toBeNull();
    }
  });

  it('builds share links that open the Mini App on the join page', () => {
    expect(clubStartLink('KofClubBot', 'ABC123')).toBe('https://t.me/KofClubBot?startapp=c-ABC123');
    const share = new URL(shareClubLink('KofClubBot', 'ABC123', 'Friday Game'));
    expect(share.origin + share.pathname).toBe('https://t.me/share/url');
    expect(share.searchParams.get('url')).toBe('https://t.me/KofClubBot?startapp=c-ABC123');
    expect(share.searchParams.get('text')).toContain('Friday Game');
    expect(share.searchParams.get('text')).toContain('virtual chips');
  });
});

describe('telegramOutcome', () => {
  it('maps sign-in results to what the login page offers', () => {
    expect(telegramOutcome('d', null).state).toBe('signed-in');
    const notLinked = telegramOutcome(
      'd',
      new ApiError(404, 'TELEGRAM_NOT_LINKED', 'no account', { firstName: 'Dana' }),
    );
    expect(notLinked).toEqual({
      initData: 'd',
      state: 'not-linked',
      firstName: 'Dana',
      message: null,
    });
    expect(telegramOutcome('d', new ApiError(401, 'MFA_REQUIRED', 'code')).state).toBe(
      'mfa-required',
    );
    const expired = telegramOutcome('d', new ApiError(401, 'TELEGRAM_AUTH_INVALID', 'reopen'));
    expect(expired).toMatchObject({ state: 'failed', message: 'reopen' });
    expect(telegramOutcome('d', new Error('boom')).message).toMatch(/not available/);
  });
});
