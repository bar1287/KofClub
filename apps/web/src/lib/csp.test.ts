import { buildCsp, newNonce } from './csp';

describe('buildCsp', () => {
  const policy = (dev: boolean) =>
    buildCsp({
      nonce: 'abc123',
      apiUrl: 'https://api.example.test/',
      realtimeUrl: 'wss://rt.example.test/ws',
      dev,
    });

  it('allows scripts only with the nonce and network only to known origins', () => {
    const csp = policy(false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("connect-src 'self' https://api.example.test wss://rt.example.test");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('lets only Telegram Web frame the app when the Mini App is on', () => {
    const csp = buildCsp({
      nonce: 'n',
      apiUrl: 'https://api.example.test',
      realtimeUrl: 'wss://rt.example.test/ws',
      dev: false,
      telegramFraming: true,
    });
    expect(csp).toContain("frame-ancestors 'self' https://web.telegram.org;");
    expect(csp).toContain("script-src 'self' 'nonce-n' 'strict-dynamic'");
  });

  it('relaxes only what next dev needs', () => {
    const csp = policy(true);
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toMatch(/connect-src [^;]* ws:/);
  });

  it('creates unpredictable nonces', () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });
});
