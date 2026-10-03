import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function newRequestId(): string {
  return `req_${randomBytes(12).toString('hex')}`;
}

/**
 * Accepts a well-formed client-supplied request id (for end-to-end
 * correlation) or generates one; always echoes it in the response.
 */
const RESOLVED = Symbol('kofclub.requestId');

export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const cached = (req as IncomingMessage & { [RESOLVED]?: string })[RESOLVED];
  if (cached) return cached;
  const header = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(header) ? header[0] : header;
  const id = candidate && VALID_REQUEST_ID.test(candidate) ? candidate : newRequestId();
  (req as IncomingMessage & { [RESOLVED]?: string })[RESOLVED] = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
