import { ConfigValidationError, loadConfig } from './config';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379/0',
  AUTH_JWT_PRIVATE_KEY_B64: 'x',
  AUTH_JWT_PUBLIC_KEY_B64: 'y',
  IP_HASH_SECRET: '0123456789abcdef0123456789abcdef',
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
});
