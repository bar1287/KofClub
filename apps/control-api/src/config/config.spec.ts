import { ConfigValidationError, loadConfig } from './config';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379/0',
  AUTH_JWT_PRIVATE_KEY_B64: 'x',
  AUTH_JWT_PUBLIC_KEY_B64: 'y',
  IP_HASH_SECRET: 'h'.repeat(32), // test fixture, not a secret
  MFA_ENCRYPTION_KEY_B64: Buffer.alloc(32).toString('base64'), // test fixture
  INTERNAL_SERVICE_TOKEN: 'x'.repeat(32),
};

describe('loadConfig', () => {
  it('applies defaults and parses lists', () => {
    const cfg = loadConfig({ ...base, CORS_ORIGINS: 'http://a.test, http://b.test' });
    expect(cfg.CONTROL_API_PORT).toBe(4000);
    expect(cfg.APP_ENV).toBe('local');
    expect(cfg.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('rejects weakened security settings in production', () => {
    expect(() => loadConfig({ ...base, APP_ENV: 'production', ARGON2_MEMORY_KIB: '4096' })).toThrow(
      /ARGON2_MEMORY_KIB/,
    );
    expect(() =>
      loadConfig({ ...base, APP_ENV: 'production', RATE_LIMIT_ENABLED: 'false' }),
    ).toThrow(/RATE_LIMIT_ENABLED/);
    expect(() =>
      loadConfig({ ...base, APP_ENV: 'production', ADMIN_MFA_REQUIRED: 'false' }),
    ).toThrow(/ADMIN_MFA_REQUIRED/);
    expect(() => loadConfig({ ...base, MFA_ENCRYPTION_KEY_B64: 'c2hvcnQ=' })).toThrow(
      /MFA_ENCRYPTION_KEY_B64/,
    );
  });

  it('parses which proxies may set X-Forwarded-For and refuses trusting all', () => {
    expect(loadConfig(base).TRUST_PROXY).toBe('loopback');
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8, loopback' }).TRUST_PROXY).toBe(
      '10.0.0.0/8, loopback',
    );
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
  });

  it('reports every invalid value at once', () => {
    try {
      loadConfig({ CONTROL_API_PORT: 'abc', APP_ENV: 'prod' });
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain('DATABASE_URL');
      expect(msg).toContain('REDIS_URL');
      expect(msg).toContain('CONTROL_API_PORT');
      expect(msg).toContain('APP_ENV');
    }
  });

  it('enables Telegram only with every required setting', () => {
    const tg = {
      TELEGRAM_BOT_TOKEN: '123456789:' + 'A'.repeat(35),
      TELEGRAM_BOT_USERNAME: 'kofclub_bot',
      TELEGRAM_WEBHOOK_SECRET: 's'.repeat(40),
      TELEGRAM_MINI_APP_URL: 'https://poker.example.test',
    };
    const off = loadConfig({ ...base, TELEGRAM_BOT_TOKEN: '', TELEGRAM_BOT_USERNAME: '' });
    expect(off.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(loadConfig({ ...base, ...tg }).TELEGRAM_BOT_USERNAME).toBe('kofclub_bot');
    expect(() => loadConfig({ ...base, ...tg, TELEGRAM_WEBHOOK_SECRET: '' })).toThrow(
      /TELEGRAM_WEBHOOK_SECRET/,
    );
    expect(() => loadConfig({ ...base, ...tg, TELEGRAM_BOT_TOKEN: 'nope' })).toThrow(
      /TELEGRAM_BOT_TOKEN/,
    );
    expect(() =>
      loadConfig({
        ...base,
        ...tg,
        APP_ENV: 'production',
        TELEGRAM_MINI_APP_URL: 'http://poker.example.test',
      }),
    ).toThrow(/TELEGRAM_MINI_APP_URL/);
  });

  it('enables the Stars store only with the bot and a support contact', () => {
    const tg = {
      TELEGRAM_BOT_TOKEN: '123456789:' + 'A'.repeat(35),
      TELEGRAM_BOT_USERNAME: 'kofclub_bot',
      TELEGRAM_WEBHOOK_SECRET: 's'.repeat(40),
      TELEGRAM_MINI_APP_URL: 'https://poker.example.test',
    };
    expect(loadConfig(base).TELEGRAM_STARS_ENABLED).toBe(false);
    expect(() => loadConfig({ ...base, TELEGRAM_STARS_ENABLED: 'true' })).toThrow(
      /TELEGRAM_BOT_TOKEN/,
    );
    expect(() => loadConfig({ ...base, ...tg, TELEGRAM_STARS_ENABLED: 'true' })).toThrow(
      /TELEGRAM_SUPPORT_CONTACT/,
    );
    const on = loadConfig({
      ...base,
      ...tg,
      TELEGRAM_STARS_ENABLED: 'true',
      TELEGRAM_SUPPORT_CONTACT: '@help',
    });
    expect(on).toMatchObject({ TELEGRAM_STARS_ENABLED: true, STARS_PRICE_CLUB_PRO: 250 });
    expect(() => loadConfig({ ...base, STARS_PRICE_CLUB_PRO: '20000' })).toThrow(
      /STARS_PRICE_CLUB_PRO/,
    );
    expect(() => loadConfig({ ...base, CLUB_PRO_MAX_MEMBERS: '10' })).toThrow(/Club Pro limits/);
  });

  it('enables operators only with a key, the webhook URL and the Mini App URL', () => {
    expect(loadConfig(base).OPERATORS_ENABLED).toBe(false);
    expect(() => loadConfig({ ...base, OPERATORS_ENABLED: 'true' })).toThrow(
      /OPERATOR_SECRET_KEY_B64[\s\S]*TELEGRAM_WEBHOOK_BASE_URL[\s\S]*TELEGRAM_MINI_APP_URL/,
    );
    const on = {
      ...base,
      OPERATORS_ENABLED: 'true',
      OPERATOR_SECRET_KEY_B64: Buffer.alloc(32, 7).toString('base64'), // test fixture
      TELEGRAM_WEBHOOK_BASE_URL: 'http://api.example.test',
      TELEGRAM_MINI_APP_URL: 'http://play.example.test',
    };
    expect(loadConfig(on).MAX_OPERATORS_PER_USER).toBe(3);
    expect(() => loadConfig({ ...on, OPERATOR_SECRET_KEY_B64: 'c2hvcnQ=' })).toThrow(/32 random/);
    expect(() => loadConfig({ ...on, APP_ENV: 'production' })).toThrow(/https in production/);
  });
});
