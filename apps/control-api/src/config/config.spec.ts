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
});
