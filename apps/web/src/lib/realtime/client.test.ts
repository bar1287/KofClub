import type { ClientFrame, ServerFrame } from '../types';
import { backoffDelay } from './backoff';
import { RealtimeClient, type SocketLike, type TableListener } from './client';

const TABLE = '0191a000-0000-7000-8000-000000000001';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: ClientFrame[] = [];
  closedWith: number | null = null;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;

  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientFrame);
  }
  close(code = 1000) {
    this.closedWith = code;
    this.readyState = 3;
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(frame: ServerFrame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
  types() {
    return this.sent.map((f) => f.type);
  }
}

function nth(sockets: FakeSocket[], i: number): FakeSocket {
  const s = sockets[i];
  if (!s) throw new Error(`socket ${i} was not created`);
  return s;
}

function welcome(expiresInMs = 15 * 60_000): ServerFrame {
  const now = Date.now();
  return {
    type: 'WELCOME',
    connectionId: 'c1',
    userId: 'u1',
    heartbeatIntervalMs: 15000,
    serverTime: new Date(now).toISOString(),
    tokenExpiresAt: new Date(now + expiresInMs).toISOString(),
  };
}

function setup(overrides: { refresh?: () => Promise<string>; pingIntervalMs?: number } = {}) {
  const sockets: FakeSocket[] = [];
  let tokenNo = 0;
  const refresh = jest.fn(overrides.refresh ?? (async () => `token-${++tokenNo}`));
  const client = new RealtimeClient({
    url: 'ws://test/ws',
    clientVersion: 'test',
    getAccessToken: async () => 'token-0',
    refreshAccessToken: refresh,
    socketFactory: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    random: () => 0,
    pingIntervalMs: overrides.pingIntervalMs ?? 1_000,
    pongTimeoutMs: 500,
    commandTimeoutMs: 5_000,
  });
  return { client, sockets, refresh };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function listener(lastSeq: () => number): TableListener & { events: number[] } {
  const events: number[] = [];
  return {
    events,
    lastSeq,
    onSnapshot: (m) => events.push(m.seq),
    onEvent: (m) => events.push(m.seq),
  };
}

describe('RealtimeClient', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('authenticates with HELLO, subscribes and routes table frames', async () => {
    const { client, sockets } = setup();
    const statuses: string[] = [];
    client.onStatus((s) => statuses.push(s));
    const l = listener(() => -1);
    client.subscribe(TABLE, l);
    client.connect();
    await flush();
    const s = nth(sockets, 0);
    s.open();
    expect(s.sent[0]).toEqual({ type: 'HELLO', accessToken: 'token-0', clientVersion: 'test' });
    s.receive(welcome());
    expect(client.status).toBe('open');
    expect(s.sent[1]).toEqual({ type: 'SUBSCRIBE_TABLE', tableId: TABLE });
    s.receive({
      type: 'TABLE_EVENT',
      tableId: TABLE,
      seq: 7,
      serverTime: new Date().toISOString(),
      event: { kind: 'HOLE_CARDS_DEALT', seats: [1, 2] },
    });
    expect(l.events).toEqual([7]);
    expect(statuses).toEqual(['connecting', 'open']);
    client.close();
    expect(client.status).toBe('closed');
  });

  it('reconnects with backoff and resumes from the last seq', async () => {
    const { client, sockets } = setup();
    let last = 41;
    client.subscribe(
      TABLE,
      listener(() => last),
    );
    client.connect();
    await flush();
    nth(sockets, 0).open();
    nth(sockets, 0).receive(welcome());
    expect(nth(sockets, 0).sent[1]).toEqual({
      type: 'SUBSCRIBE_TABLE',
      tableId: TABLE,
      lastSeenSeq: 41,
    });

    last = 50;
    nth(sockets, 0).drop(1006);
    expect(client.status).toBe('reconnecting');
    expect(sockets).toHaveLength(1);
    jest.advanceTimersByTime(backoffDelay(0, 500, 10_000, () => 0));
    await flush();
    expect(sockets).toHaveLength(2);
    nth(sockets, 1).open();
    nth(sockets, 1).receive(welcome());
    expect(nth(sockets, 1).sent[1]).toEqual({
      type: 'SUBSCRIBE_TABLE',
      tableId: TABLE,
      lastSeenSeq: 50,
    });
    client.close();
  });

  it('re-sends unanswered commands with the same requestId after a reconnect', async () => {
    const { client, sockets } = setup();
    client.connect();
    await flush();
    nth(sockets, 0).open();
    nth(sockets, 0).receive(welcome());
    const result = client.sendCommand(TABLE, { kind: 'CALL' }, 12);
    const first = nth(sockets, 0).sent.find((f) => f.type === 'COMMAND');
    expect(first).toMatchObject({
      type: 'COMMAND',
      tableId: TABLE,
      expectedSeq: 12,
      command: { kind: 'CALL' },
    });

    nth(sockets, 0).drop(1012);
    jest.advanceTimersByTime(1_000);
    await flush();
    nth(sockets, 1).open();
    nth(sockets, 1).receive(welcome());
    const resent = nth(sockets, 1).sent.find((f) => f.type === 'COMMAND');
    expect(resent).toEqual(first);

    const requestId = (first as { requestId: string }).requestId;
    nth(sockets, 1).receive({
      type: 'COMMAND_RESULT',
      requestId,
      tableId: TABLE,
      accepted: true,
      duplicate: true,
      seq: 13,
    });
    await expect(result).resolves.toMatchObject({ accepted: true, duplicate: true });
    client.close();
  });

  it('times out unanswered commands', async () => {
    const { client, sockets } = setup();
    client.connect();
    await flush();
    nth(sockets, 0).open();
    nth(sockets, 0).receive(welcome());
    const result = client.sendCommand(TABLE, { kind: 'FOLD' });
    jest.advanceTimersByTime(5_001);
    await expect(result).rejects.toMatchObject({ code: 'COMMAND_TIMEOUT' });
    client.close();
  });

  it('refreshes the token on 4401 and gives up after repeated auth failures', async () => {
    const { client, sockets, refresh } = setup();
    client.connect();
    await flush();
    nth(sockets, 0).open();
    nth(sockets, 0).drop(4401);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(2);
    nth(sockets, 1).open();
    nth(sockets, 1).drop(4401);
    await flush();
    nth(sockets, 2).open();
    nth(sockets, 2).drop(4401);
    await flush();
    expect(client.status).toBe('unauthorized');
    expect(sockets).toHaveLength(3);
  });

  it('becomes unauthorized when the session cannot be refreshed', async () => {
    const { client, sockets } = setup({
      refresh: async () => {
        throw new Error('revoked');
      },
    });
    client.connect();
    await flush();
    nth(sockets, 0).open();
    nth(sockets, 0).drop(4401);
    await flush();
    expect(client.status).toBe('unauthorized');
  });

  it('sends AUTH with a fresh token before expiry', async () => {
    const { client, sockets, refresh } = setup({ pingIntervalMs: 3_600_000 });
    client.connect();
    await flush();
    nth(sockets, 0).open();
    nth(sockets, 0).receive(welcome(120_000));
    jest.advanceTimersByTime(60_000);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(nth(sockets, 0).sent.at(-1)).toEqual({ type: 'AUTH', accessToken: 'token-1' });
    client.close();
  });

  it('answers server PINGs and drops a connection whose PONG never arrives', async () => {
    const { client, sockets } = setup();
    client.connect();
    await flush();
    nth(sockets, 0).open();
    nth(sockets, 0).receive(welcome());
    nth(sockets, 0).receive({ type: 'PING', nonce: 'n1' });
    expect(nth(sockets, 0).sent.at(-1)).toEqual({ type: 'PONG', nonce: 'n1' });

    jest.advanceTimersByTime(1_000); // client PING
    expect(nth(sockets, 0).sent.at(-1)).toMatchObject({ type: 'PING' });
    jest.advanceTimersByTime(500); // no PONG
    expect(nth(sockets, 0).closedWith).toBe(4000);
    expect(client.status).toBe('reconnecting');
    client.close();
  });
});

describe('backoffDelay', () => {
  it('grows exponentially, caps and jitters', () => {
    expect(backoffDelay(0, 500, 10_000, () => 0)).toBe(250);
    expect(backoffDelay(0, 500, 10_000, () => 1)).toBe(500);
    expect(backoffDelay(3, 500, 10_000, () => 1)).toBe(4_000);
    expect(backoffDelay(30, 500, 10_000, () => 1)).toBe(10_000);
  });
});
