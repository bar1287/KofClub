import { MemoryRateLimiter } from './memory-limiter';

describe('MemoryRateLimiter', () => {
  it('counts a fixed window and resets it', () => {
    let now = 1_000_000;
    const limiter = new MemoryRateLimiter(100, () => now);
    const results = Array.from({ length: 4 }, () => limiter.hit('login:a', 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]).toMatchObject({ remaining: 0, retryAfterSec: 60 });
    now += 59_500;
    expect(limiter.hit('login:a', 3, 60)).toMatchObject({ allowed: false, retryAfterSec: 1 });
    now += 1_000;
    expect(limiter.hit('login:a', 3, 60)).toMatchObject({ allowed: true, remaining: 2 });
  });

  it('keeps keys independent', () => {
    const limiter = new MemoryRateLimiter();
    expect(limiter.hit('a', 1, 60).allowed).toBe(true);
    expect(limiter.hit('a', 1, 60).allowed).toBe(false);
    expect(limiter.hit('b', 1, 60).allowed).toBe(true);
  });

  it('stays bounded: sweeps expired windows, then drops the oldest', () => {
    let now = 0;
    const limiter = new MemoryRateLimiter(10, () => now);
    for (let i = 0; i < 10; i++) limiter.hit(`old${i}`, 5, 1);
    now = 2_000;
    limiter.hit('fresh', 5, 60);
    expect(limiter.size).toBe(1);
    for (let i = 0; i < 20; i++) limiter.hit(`k${i}`, 5, 60);
    expect(limiter.size).toBeLessThanOrEqual(10);
    // The newest keys keep their counts.
    expect(limiter.hit('k19', 5, 60).remaining).toBe(3);
  });
});
