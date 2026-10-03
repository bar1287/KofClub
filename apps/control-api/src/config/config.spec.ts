import { ConfigValidationError, loadConfig } from './config';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379/0',
};

describe('loadConfig', () => {
  it('applies defaults and parses lists', () => {
    const cfg = loadConfig({ ...base, CORS_ORIGINS: 'http://a.test, http://b.test' });
    expect(cfg.CONTROL_API_PORT).toBe(4000);
    expect(cfg.APP_ENV).toBe('local');
    expect(cfg.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
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
