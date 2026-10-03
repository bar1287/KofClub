import pino from 'pino';
import { runJobs } from './jobs';

describe('runJobs', () => {
  it('runs every job even when one fails', async () => {
    const ran: string[] = [];
    const logger = pino({ level: 'silent' });
    const result = await runJobs(
      [
        { name: 'a', run: async () => (ran.push('a'), { affected: 1 }) },
        {
          name: 'b',
          run: async () => {
            ran.push('b');
            throw new Error('boom');
          },
        },
        { name: 'c', run: async () => (ran.push('c'), { affected: 0 }) },
      ],
      logger,
    );
    expect(ran).toEqual(['a', 'b', 'c']);
    expect(result.failed).toBe(1);
  });
});
