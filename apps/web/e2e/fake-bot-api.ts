import { createServer, type Server } from 'node:http';

export interface BotCall {
  token: string;
  method: string;
  body: Record<string, unknown>;
}

export interface FakeBotApi {
  calls: BotCall[];
  /** Calls of one method, optionally by one bot, oldest first. */
  of(method: string, token?: string): Record<string, unknown>[];
  close(): Promise<void>;
}

/**
 * A stand-in for the Bot API on the port scripts/e2e.sh points the API at.
 * Every token is a bot: getMe answers id <number before ":"> and username
 * op_<id>_bot; invoices get fake links; everything else succeeds.
 */
export async function startFakeBotApi(port: number): Promise<FakeBotApi> {
  const calls: BotCall[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');
      const token = m?.[1] ?? '';
      const method = m?.[2] ?? '';
      calls.push({ token, method, body: JSON.parse(raw || '{}') as Record<string, unknown> });
      const id = Number(token.split(':')[0]);
      const result =
        method === 'getMe'
          ? { id, is_bot: true, username: `op_${id}_bot` }
          : method === 'createInvoiceLink'
            ? `https://t.me/$e2e-invoice-${calls.length}`
            : method === 'sendMessage'
              ? { message_id: calls.length }
              : true;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    calls,
    of: (method, token) =>
      calls
        .filter((c) => c.method === method && (token === undefined || c.token === token))
        .map((c) => c.body),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
