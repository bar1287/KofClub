import { telegramUsernameCandidates } from '../identity/auth.service';
import { joinCodeFromStartParam, parseCommand } from './telegram-bot.service';

describe('telegram bot helpers', () => {
  it('parses commands, ignoring other bots', () => {
    expect(parseCommand('/start c-AB12CD34', 'kofclub_bot')).toEqual({
      command: 'start',
      arg: 'c-AB12CD34',
    });
    expect(parseCommand('/help@KofClub_Bot', 'kofclub_bot')).toEqual({ command: 'help', arg: '' });
    expect(parseCommand('/help@other_bot', 'kofclub_bot')).toBeNull();
    expect(parseCommand('hello', 'kofclub_bot')).toBeNull();
  });

  it('reads club join codes from start parameters', () => {
    expect(joinCodeFromStartParam('c-ab12cd34')).toBe('AB12CD34');
    expect(joinCodeFromStartParam('c-x')).toBeNull();
    expect(joinCodeFromStartParam('promo')).toBeNull();
    expect(joinCodeFromStartParam(undefined)).toBeNull();
  });

  it('suggests valid usernames for new Telegram accounts', () => {
    const valid = /^[A-Za-z0-9_]{3,24}$/;
    const all = [
      telegramUsernameCandidates({
        id: 123456789,
        username: 'dana_k',
        firstName: 'Dana',
        languageCode: null,
      }),
      telegramUsernameCandidates({ id: 42, username: null, firstName: 'דנה', languageCode: 'he' }),
      telegramUsernameCandidates({
        id: 7,
        username: 'a_very_long_telegram_username_x',
        firstName: null,
        languageCode: null,
      }),
    ];
    expect(all[0]).toEqual(['dana_k', 'Dana_6789', 'tg_123456789']);
    expect(all[1]).toEqual(['tg_42']);
    for (const list of all) for (const name of list) expect(name).toMatch(valid);
  });
});
