import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { uuidv7 } from '../../common/ids';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import type { AuthContext, RequestContext } from '../../common/request-context';
import { decodeCursor, encodeCursor, Page } from '../../common/validation/schemas';
import { Database } from '../../infra/database/database';
import { MetricsService } from '../../metrics/metrics.service';
import { AuditService } from '../audit/audit.service';
import { ClubAccessService } from '../clubs/club-access.service';
import { roleHasPermission } from '../clubs/club-permissions';
import { UsersRepository } from '../identity/users.repository';
import { TablesRepository, type TableRow } from '../tables/tables.repository';
import { ChatPublisher } from './chat.publisher';
import { ChatMessageRow, ChatReportRow, ChatRepository } from './chat.repository';
import {
  cleanChatText,
  type ChatEmoji,
  type InternalChatInput,
  type ListChatReportsQuery,
  type ReportChatInput,
  type ResolveChatReportInput,
} from './chat.schemas';

export interface ChatMessageDto {
  id: string;
  tableId: string;
  kind: 'MESSAGE' | 'REACTION';
  userId: string;
  username: string;
  text?: string;
  emoji?: ChatEmoji;
  sentAt: string;
}

export interface ChatHistoryDto {
  tableId: string;
  enabled: boolean;
  canSend: boolean;
  items: ChatMessageDto[];
}

export interface ChatReportDto {
  id: string;
  clubId: string;
  tableId: string;
  messageId: string;
  reportedUserId: string;
  reportedUsername: string;
  reporterUserId: string;
  reporterUsername: string;
  text: string;
  reason: string | null;
  status: ChatReportRow['status'];
  resolvedAt: string | null;
  createdAt: string;
}

export interface ChatSendResult {
  message: ChatMessageDto;
  /** False when the chat bus is down: the gateway then delivers it locally. */
  published: boolean;
}

/** Messages a player sees when opening a table. */
const HISTORY_LIMIT = 50;
/** Per-user send limits (in addition to the gateway's per-connection limit). */
const MESSAGE_LIMIT = { limit: 5, windowSec: 10 };
const REACTION_LIMIT = { limit: 10, windowSec: 10 };

function toMessageDto(m: ChatMessageRow): ChatMessageDto {
  return {
    id: m.id,
    tableId: m.tableId,
    kind: 'MESSAGE',
    userId: m.userId,
    username: m.username,
    text: m.body,
    sentAt: m.createdAt.toISOString(),
  };
}

function toReportDto(r: ChatReportRow): ChatReportDto {
  return {
    id: r.id,
    clubId: r.clubId,
    tableId: r.tableId,
    messageId: r.messageId,
    reportedUserId: r.reportedUserId,
    reportedUsername: r.reportedUsername,
    reporterUserId: r.reporterUserId,
    reporterUsername: r.reporterUsername,
    text: r.body,
    reason: r.reason,
    status: r.status,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Table chat (roadmap W1.4). control-api decides who may talk, stores
 * messages and handles reports; the realtime gateway only carries frames.
 * Message text is user content: it is never logged.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly db: Database,
    private readonly repo: ChatRepository,
    private readonly tables: TablesRepository,
    private readonly users: UsersRepository,
    private readonly access: ClubAccessService,
    private readonly rateLimit: RateLimitService,
    private readonly publisher: ChatPublisher,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
  ) {}

  /** A CHAT_SEND from the realtime gateway (the user is authenticated there). */
  async send(tableId: string, input: InternalChatInput): Promise<ChatSendResult> {
    const table = await this.findTable(tableId);
    if (table.status !== 'OPEN') throw new AppError('TABLE_CLOSED', 'The table is closed');
    const user = await this.users.findById(input.userId);
    if (!user) throw new AppError('AUTH_REQUIRED', 'Unknown user');
    if (user.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED', 'Account suspended');
    const { club } = await this.access.require(
      table.clubId,
      {
        userId: user.id,
        sessionId: input.sessionId ?? 'internal',
        platformRole: user.platformRole,
        mfa: false,
      },
      'CHAT_SEND',
    );
    if (!club.tableChat) throw new AppError('CHAT_DISABLED', 'Chat is turned off in this club');

    const kind = input.emoji !== undefined ? 'REACTION' : 'MESSAGE';
    const body = input.emoji !== undefined ? null : cleanChatText(input.text ?? '');
    if (kind === 'MESSAGE' && body === null) {
      throw new AppError('VALIDATION_FAILED', 'A message has 1 to 200 characters');
    }
    const limits = kind === 'REACTION' ? REACTION_LIMIT : MESSAGE_LIMIT;
    const rl = await this.rateLimit.hit(
      `chat:${kind.toLowerCase()}`,
      user.id,
      limits.limit,
      limits.windowSec,
    );
    if (!rl.allowed) {
      throw new AppError('RATE_LIMITED', 'You are sending messages too quickly', {
        retryAfterSec: rl.retryAfterSec,
      });
    }

    let message: ChatMessageDto;
    if (body === null) {
      // Reactions are momentary: delivered, never stored.
      message = {
        id: uuidv7(),
        tableId,
        kind: 'REACTION',
        userId: user.id,
        username: user.username,
        emoji: input.emoji,
        sentAt: new Date().toISOString(),
      };
    } else {
      const stored = await this.repo.insertMessage({
        id: uuidv7(),
        clubId: table.clubId,
        tableId,
        userId: user.id,
        requestId: input.requestId,
        body,
      });
      message = toMessageDto(stored.message);
      // A retried send was already delivered the first time.
      if (!stored.created) return { message, published: true };
    }
    this.metrics.chatMessages.inc({ kind });
    const published = await this.publisher.publish(tableId, {
      type: 'CHAT_MESSAGE',
      tableId,
      message,
    });
    return { message, published };
  }

  /** Recent messages for a player opening the table. */
  async history(auth: AuthContext, tableId: string): Promise<ChatHistoryDto> {
    const table = await this.findTable(tableId);
    const { club, membership } = await this.access.require(table.clubId, auth, 'CLUB_VIEW');
    const enabled = club.tableChat;
    const canSend =
      enabled &&
      table.status === 'OPEN' &&
      club.status === 'ACTIVE' &&
      membership !== null &&
      roleHasPermission(membership.role, 'CHAT_SEND');
    const items = enabled ? (await this.repo.recent(tableId, HISTORY_LIMIT)).map(toMessageDto) : [];
    return { tableId, enabled, canSend, items };
  }

  /** Reports a message to the club's staff (once per message and reporter). */
  async report(auth: AuthContext, tableId: string, input: ReportChatInput): Promise<ChatReportDto> {
    const table = await this.findTable(tableId);
    await this.access.require(table.clubId, auth, 'CHAT_SEND');
    const message = await this.repo.findMessage(input.messageId);
    if (!message || message.tableId !== tableId) {
      throw new AppError('NOT_FOUND', 'Message not found');
    }
    if (message.userId === auth.userId) {
      throw new AppError('VALIDATION_FAILED', 'You cannot report your own message');
    }
    const { report, created } = await this.repo.insertReport({
      id: uuidv7(),
      message,
      reporterUserId: auth.userId,
      reason: input.reason ? input.reason : null,
    });
    if (created) this.metrics.chatReports.inc();
    return toReportDto(report);
  }

  async listReports(
    auth: AuthContext,
    clubId: string,
    query: ListChatReportsQuery,
  ): Promise<Page<ChatReportDto>> {
    await this.access.require(clubId, auth, 'CHAT_MODERATE');
    const after = decodeCursor(query.cursor, ['id'] as const);
    const rows = await this.repo.listReports(clubId, query.status, query.limit, after?.id);
    const last = rows[rows.length - 1];
    return {
      items: rows.map(toReportDto),
      nextCursor: rows.length === query.limit && last ? encodeCursor({ id: last.id }) : null,
    };
  }

  /**
   * DISMISS closes one report; HIDE removes the message from the table's
   * chat for everyone and closes every open report of it. Both are audited.
   */
  async resolveReport(
    auth: AuthContext,
    clubId: string,
    reportId: string,
    input: ResolveChatReportInput,
    ctx: RequestContext,
  ): Promise<ChatReportDto> {
    const resolved = await this.db.tx(async (q) => {
      await this.access.require(clubId, auth, 'CHAT_MODERATE', q);
      const report = await this.repo.findReport(q, clubId, reportId, true);
      if (!report) throw new AppError('NOT_FOUND', 'Report not found');
      if (report.status !== 'OPEN') {
        throw new AppError('CONFLICT', 'The report was already resolved', {
          status: report.status,
        });
      }
      if (input.action === 'HIDE') {
        await this.repo.hideMessage(q, report.messageId, auth.userId);
      } else {
        await this.repo.dismissReport(q, report.id, auth.userId);
      }
      await this.audit.record(q, ctx, {
        action: input.action === 'HIDE' ? 'CHAT_MESSAGE_HIDDEN' : 'CHAT_REPORT_DISMISSED',
        objectType: 'chat_report',
        objectId: report.id,
        clubId,
        after: {
          messageId: report.messageId,
          tableId: report.tableId,
          reportedUserId: report.reportedUserId,
        },
      });
      return (await this.repo.findReport(q, clubId, reportId))!;
    });
    if (input.action === 'HIDE') {
      await this.publisher.publish(resolved.tableId, {
        type: 'CHAT_HIDDEN',
        tableId: resolved.tableId,
        messageId: resolved.messageId,
      });
    }
    return toReportDto(resolved);
  }

  private async findTable(tableId: string): Promise<TableRow> {
    const table = await this.tables.find(tableId);
    if (!table) throw new AppError('TABLE_NOT_FOUND', 'Table not found');
    return table;
  }
}
