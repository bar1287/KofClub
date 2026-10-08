import { purgeChatMessages, purgeIdempotencyKeys } from './purge-jobs';

function fakePool(rowCount: number) {
  return { query: jest.fn(async () => ({ rowCount })) };
}

describe('purge jobs', () => {
  it('purges chat messages older than the retention period', async () => {
    const pool = fakePool(3);
    await expect(purgeChatMessages(pool as never).run()).resolves.toEqual({ affected: 3 });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM chat_messages WHERE created_at <'),
      [7],
    );
  });

  it('purges old idempotency keys', async () => {
    const pool = fakePool(0);
    await expect(purgeIdempotencyKeys(pool as never, 12).run()).resolves.toEqual({ affected: 0 });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('idempotency_keys'), [12]);
  });
});
