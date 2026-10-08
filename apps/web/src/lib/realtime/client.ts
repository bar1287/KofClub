import type {
  ChatEmoji,
  ChatFrame,
  ClientFrame,
  CommandPayload,
  CommandResult,
  ProtocolError,
  ResyncRequired,
  ServerFrame,
  Subscribed,
  TableEventMessage,
  TableSnapshotMessage,
} from '../types';
import { backoffDelay } from './backoff';

/** Connection state shown to the player (actions are disabled unless `open`). */
export type ConnectionStatus =
  'idle' | 'connecting' | 'open' | 'reconnecting' | 'unauthorized' | 'closed';

/** Receives one table's frames, in order. */
export interface TableListener {
  onSnapshot(msg: TableSnapshotMessage, receivedAt: number): void;
  onEvent(msg: TableEventMessage, receivedAt: number): void;
  onSubscribed?(msg: Subscribed): void;
  onResync?(msg: ResyncRequired): void;
  onError?(err: ProtocolError): void;
  /** Last seq applied locally (-1 = none); resumes after reconnects. */
  lastSeq(): number;
}

/** Minimal WebSocket surface (lets tests inject a fake). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

/** Receives a table's chat frames (CHAT_MESSAGE, CHAT_HIDDEN). */
export type ChatListener = (frame: ChatFrame) => void;

export class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface RealtimeOptions {
  url: string;
  clientVersion: string;
  /** A currently valid access token. */
  getAccessToken: () => Promise<string>;
  /** Forces a token refresh (rejects when the session is gone). */
  refreshAccessToken: () => Promise<string>;
  socketFactory?: SocketFactory;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  commandTimeoutMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  random?: () => number;
}

interface PendingCommand {
  frame: Extract<ClientFrame, { type: 'COMMAND' }>;
  resolve: (r: CommandResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingChat {
  tableId: string;
  resolve: () => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const OPEN = 1;
const CLOSE_AUTH = 4401;
/** Consecutive auth failures tolerated (each after a token refresh). */
const MAX_AUTH_RETRIES = 2;

/**
 * Client for the realtime gateway (docs/realtime-protocol.md).
 *
 * - HELLO with the access token on every connection; AUTH with a fresh
 *   token before it expires.
 * - Reconnects with exponential backoff + jitter and resumes every table
 *   with SUBSCRIBE_TABLE{lastSeenSeq} (replay or snapshot).
 * - Commands carry a requestId (idempotency key). Unanswered commands are
 *   re-sent with the same requestId after a reconnect: the server applies
 *   each requestId at most once.
 * - Application-level PING detects half-open connections.
 */
export class RealtimeClient {
  private readonly opts: Required<
    Omit<RealtimeOptions, 'socketFactory' | 'getAccessToken' | 'refreshAccessToken'>
  >;
  private readonly socketFactory: SocketFactory;
  private socket: SocketLike | null = null;
  private welcomed = false;
  private stopped = true;
  private opening = false;
  private attempt = 0;
  private authFailures = 0;
  private statusValue: ConnectionStatus = 'idle';
  private readonly statusListeners = new Set<(s: ConnectionStatus) => void>();
  private readonly tables = new Map<string, TableListener>();
  private readonly pending = new Map<string, PendingCommand>();
  private readonly chatListeners = new Map<string, Set<ChatListener>>();
  private readonly pendingChat = new Map<string, PendingChat>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private pingSentAt = 0;
  private nonce = 0;
  /** Round-trip time of the last PING (ms). */
  latencyMs: number | null = null;
  userId: string | null = null;

  constructor(private readonly base: RealtimeOptions) {
    this.opts = {
      url: base.url,
      clientVersion: base.clientVersion,
      pingIntervalMs: base.pingIntervalMs ?? 15_000,
      pongTimeoutMs: base.pongTimeoutMs ?? 10_000,
      commandTimeoutMs: base.commandTimeoutMs ?? 10_000,
      backoffBaseMs: base.backoffBaseMs ?? 500,
      backoffMaxMs: base.backoffMaxMs ?? 10_000,
      random: base.random ?? Math.random,
    };
    this.socketFactory =
      base.socketFactory ?? ((url) => new WebSocket(url) as unknown as SocketLike);
  }

  get status(): ConnectionStatus {
    return this.statusValue;
  }

  onStatus(listener: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Starts (or resumes) connecting. Idempotent. */
  connect(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    void this.open();
  }

  /** Closes permanently and fails pending commands. */
  close(): void {
    this.stopped = true;
    this.clearTimers();
    const s = this.socket;
    this.detach();
    s?.close(1000, 'client closing');
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new CommandError('CONNECTION_CLOSED', 'Connection closed.'));
      this.pending.delete(id);
    }
    this.failPendingChat();
    this.setStatus('closed');
  }

  /** Reconnects immediately (e.g. the browser came back online). */
  reconnectNow(): void {
    if (this.stopped || this.statusValue === 'open' || this.statusValue === 'connecting') return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    void this.open();
  }

  /** Subscribes to a table; returns an unsubscribe function. */
  subscribe(tableId: string, listener: TableListener): () => void {
    this.tables.set(tableId, listener);
    if (this.isLive()) this.sendSubscribe(tableId, listener);
    return () => {
      if (this.tables.get(tableId) !== listener) return;
      this.tables.delete(tableId);
      if (this.isLive()) this.send({ type: 'UNSUBSCRIBE_TABLE', tableId });
    };
  }

  /**
   * Re-subscribes from the listener's last seq (after a local gap), or
   * from a fresh snapshot when `fromSnapshot` is set.
   */
  resubscribe(tableId: string, fromSnapshot = false): void {
    const listener = this.tables.get(tableId);
    if (listener && this.isLive()) this.sendSubscribe(tableId, listener, fromSnapshot);
  }

  /**
   * Sends a table command. Resolves with the COMMAND_RESULT (check
   * `accepted`); rejects on timeout or permanent close.
   */
  sendCommand(
    tableId: string,
    command: CommandPayload,
    expectedSeq?: number,
  ): Promise<CommandResult> {
    const requestId = crypto.randomUUID();
    const frame: PendingCommand['frame'] = { type: 'COMMAND', requestId, tableId, command };
    if (expectedSeq !== undefined && expectedSeq >= 0) frame.expectedSeq = expectedSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new CommandError('COMMAND_TIMEOUT', 'The server did not answer in time.'));
      }, this.opts.commandTimeoutMs);
      this.pending.set(requestId, { frame, resolve, reject, timer });
      if (this.isLive()) this.send(frame);
    });
  }

  /**
   * Listens to a table's chat. Frames only arrive while the table is
   * subscribed (subscribe()); returns a function that stops listening.
   */
  onChat(tableId: string, listener: ChatListener): () => void {
    let set = this.chatListeners.get(tableId);
    if (!set) {
      set = new Set();
      this.chatListeners.set(tableId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.chatListeners.get(tableId) === set) {
        this.chatListeners.delete(tableId);
      }
    };
  }

  /**
   * Sends a chat message or reaction at a subscribed table. Resolves when
   * the server echoes it (or after the command timeout); rejects with the
   * server's ERROR code (CHAT_DISABLED, RATE_LIMITED, ...) or when the
   * connection is not open. Chat is not queued across reconnects.
   */
  sendChat(tableId: string, body: { text: string } | { emoji: ChatEmoji }): Promise<void> {
    if (!this.isLive()) {
      return Promise.reject(new CommandError('CONNECTION_CLOSED', 'Not connected.'));
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingChat.delete(requestId);
        resolve();
      }, this.opts.commandTimeoutMs);
      this.pendingChat.set(requestId, { tableId, resolve, reject, timer });
      this.send({ type: 'CHAT_SEND', requestId, tableId, ...body });
    });
  }

  private failPendingChat(): void {
    for (const [id, p] of this.pendingChat) {
      clearTimeout(p.timer);
      p.reject(
        new CommandError(
          'CONNECTION_CLOSED',
          'Connection lost; the message may not have been sent.',
        ),
      );
      this.pendingChat.delete(id);
    }
  }

  private isLive(): boolean {
    return this.welcomed && this.socket?.readyState === OPEN;
  }

  private async open(): Promise<void> {
    if (this.opening || this.socket) return;
    this.opening = true;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let token: string;
    try {
      token = await this.base.getAccessToken();
    } catch {
      if (!this.stopped) this.setStatus('unauthorized');
      return;
    } finally {
      this.opening = false;
    }
    if (this.stopped || this.socket) return;
    let socket: SocketLike;
    try {
      socket = this.socketFactory(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.welcomed = false;
    socket.onopen = () => {
      this.send({ type: 'HELLO', accessToken: token, clientVersion: this.opts.clientVersion });
    };
    socket.onmessage = (ev) => this.onMessage(ev.data);
    socket.onclose = (ev) => this.onClose(socket, ev.code);
    socket.onerror = () => {
      /* onclose follows */
    };
  }

  private onMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let frame: ServerFrame;
    try {
      frame = JSON.parse(data) as ServerFrame;
    } catch {
      return;
    }
    const receivedAt = Date.now();
    switch (frame.type) {
      case 'WELCOME': {
        const first = !this.welcomed;
        this.welcomed = true;
        this.userId = frame.userId;
        this.authFailures = 0;
        this.scheduleAuthRefresh(Date.parse(frame.tokenExpiresAt) - Date.parse(frame.serverTime));
        if (first) {
          this.attempt = 0;
          this.setStatus('open');
          this.startPing();
          for (const [tableId, listener] of this.tables) this.sendSubscribe(tableId, listener);
          for (const p of this.pending.values()) this.send(p.frame);
        }
        break;
      }
      case 'TABLE_SNAPSHOT':
        this.tables.get(frame.tableId)?.onSnapshot(frame, receivedAt);
        break;
      case 'TABLE_EVENT':
        this.tables.get(frame.tableId)?.onEvent(frame, receivedAt);
        break;
      case 'SUBSCRIBED':
        this.tables.get(frame.tableId)?.onSubscribed?.(frame);
        break;
      case 'RESYNC_REQUIRED':
        this.tables.get(frame.tableId)?.onResync?.(frame);
        break;
      case 'COMMAND_RESULT': {
        const p = this.pending.get(frame.requestId);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(frame.requestId);
          p.resolve(frame);
        }
        break;
      }
      case 'CHAT_MESSAGE':
      case 'CHAT_HIDDEN': {
        if (frame.type === 'CHAT_MESSAGE' && frame.message.userId === this.userId) {
          // The echo of our own send: settle the oldest pending one there.
          for (const [id, p] of this.pendingChat) {
            if (p.tableId !== frame.tableId) continue;
            clearTimeout(p.timer);
            this.pendingChat.delete(id);
            p.resolve();
            break;
          }
        }
        for (const l of this.chatListeners.get(frame.tableId) ?? []) l(frame);
        break;
      }
      case 'ERROR': {
        const chat = frame.requestId ? this.pendingChat.get(frame.requestId) : undefined;
        if (chat && frame.requestId) {
          clearTimeout(chat.timer);
          this.pendingChat.delete(frame.requestId);
          chat.reject(new CommandError(frame.code, frame.message));
          break;
        }
        if (frame.tableId) this.tables.get(frame.tableId)?.onError?.(frame);
        break;
      }
      case 'PING':
        this.send({ type: 'PONG', nonce: frame.nonce });
        break;
      case 'PONG':
        if (this.pongTimer) clearTimeout(this.pongTimer);
        this.pongTimer = null;
        this.latencyMs = Date.now() - this.pingSentAt;
        break;
    }
  }

  private onClose(socket: SocketLike, code: number): void {
    if (socket !== this.socket) return; // superseded
    this.detach();
    this.clearTimers();
    this.failPendingChat();
    if (this.stopped) return;
    if (code === CLOSE_AUTH) {
      void this.recoverAuth();
      return;
    }
    this.scheduleReconnect();
  }

  /** 4401: refresh the access token once, then reconnect. */
  private async recoverAuth(): Promise<void> {
    this.authFailures++;
    if (this.authFailures > MAX_AUTH_RETRIES) {
      this.setStatus('unauthorized');
      return;
    }
    this.setStatus('reconnecting');
    try {
      await this.base.refreshAccessToken();
    } catch {
      if (!this.stopped) this.setStatus('unauthorized');
      return;
    }
    if (!this.stopped) void this.open();
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting');
    const delay = backoffDelay(
      this.attempt++,
      this.opts.backoffBaseMs,
      this.opts.backoffMaxMs,
      this.opts.random,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) void this.open();
    }, delay);
  }

  private scheduleAuthRefresh(validForMs: number): void {
    if (this.authTimer) clearTimeout(this.authTimer);
    // Refresh a minute early (at least 5 s from now, at most at 80% of the lifetime).
    const delay = Math.max(5_000, Math.min(validForMs - 60_000, validForMs * 0.8));
    this.authTimer = setTimeout(() => {
      this.authTimer = null;
      this.base
        .refreshAccessToken()
        .then((accessToken) => {
          if (this.isLive()) this.send({ type: 'AUTH', accessToken });
        })
        .catch(() => {
          /* the gateway closes with 4401 at expiry; recoverAuth handles it */
        });
    }, delay);
  }

  private startPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (!this.isLive() || this.pongTimer) return;
      this.pingSentAt = Date.now();
      this.send({ type: 'PING', nonce: String(++this.nonce) });
      this.pongTimer = setTimeout(() => {
        // Half-open connection: drop it and reconnect.
        this.pongTimer = null;
        const s = this.socket;
        if (s) {
          this.onClose(s, 4000);
          s.close(4000, 'heartbeat timeout');
        }
      }, this.opts.pongTimeoutMs);
    }, this.opts.pingIntervalMs);
  }

  private sendSubscribe(tableId: string, listener: TableListener, fromSnapshot = false): void {
    const last = fromSnapshot ? -1 : listener.lastSeq();
    this.send({
      type: 'SUBSCRIBE_TABLE',
      tableId,
      ...(last >= 0 ? { lastSeenSeq: last } : {}),
    });
  }

  private send(frame: ClientFrame): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(frame));
  }

  private detach(): void {
    const s = this.socket;
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null;
    }
    this.socket = null;
    this.welcomed = false;
  }

  private clearTimers(): void {
    for (const t of [this.reconnectTimer, this.authTimer, this.pongTimer]) if (t) clearTimeout(t);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.reconnectTimer = this.authTimer = this.pongTimer = this.pingTimer = null;
  }

  private setStatus(s: ConnectionStatus): void {
    if (s === this.statusValue) return;
    this.statusValue = s;
    for (const l of this.statusListeners) l(s);
  }
}
