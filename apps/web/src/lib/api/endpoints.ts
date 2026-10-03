import type {
  AdminClub,
  AdminClubPage,
  AdminUser,
  AdminUserPage,
  PlatformOverview,
  RiskEvent,
  RiskEventPage,
  AuditPage,
  CloseTableResult,
  CreateInviteRequest,
  Invite,
  InviteCreated,
  LedgerSummary,
  LedgerTransactionPage,
  Member,
  MemberBalancePage,
  Club,
  HandDetail,
  HandSummaryPage,
  CreateTableRequest,
  LeaveResult,
  LedgerTransaction,
  MemberPage,
  SeatResult,
  Session,
  Table,
  TableDetail,
  Wallet,
  WalletEntryPage,
} from '../types';
import type { ApiClient } from './client';
import { newIdempotencyKey } from './client';

const enc = encodeURIComponent;
const cursorParam = (cursor?: string | null) => (cursor ? `&cursor=${enc(cursor)}` : '');

/** Typed wrappers for the control-API endpoints the web client uses. */
export function endpoints(api: ApiClient) {
  return {
    sessions: async (): Promise<Session[]> =>
      (await api.request<{ items: Session[] }>('GET', '/v1/me/sessions')).items,
    revokeSession: (id: string) => api.request<void>('DELETE', `/v1/me/sessions/${enc(id)}`),

    myClubs: async (): Promise<Club[]> =>
      (await api.request<{ items: Club[] }>('GET', '/v1/clubs')).items,
    club: (clubId: string) => api.request<Club>('GET', `/v1/clubs/${enc(clubId)}`),
    createClub: (body: { name: string; description?: string }, key = newIdempotencyKey()) =>
      api.request<Club>('POST', '/v1/clubs', { body, idempotencyKey: key }),
    joinClub: (code: string) => api.request<Club>('POST', '/v1/clubs/join', { body: { code } }),
    members: (clubId: string) =>
      api.request<MemberPage>('GET', `/v1/clubs/${enc(clubId)}/members?limit=100`),

    wallet: (clubId: string) => api.request<Wallet>('GET', `/v1/clubs/${enc(clubId)}/wallet`),
    walletEntries: (clubId: string) =>
      api.request<WalletEntryPage>('GET', `/v1/clubs/${enc(clubId)}/wallet/entries?limit=20`),
    grantChips: (
      clubId: string,
      body: { userId: string; amount: number; note?: string },
      key = newIdempotencyKey(),
    ) =>
      api.request<LedgerTransaction>('POST', `/v1/clubs/${enc(clubId)}/chips/grants`, {
        body,
        idempotencyKey: key,
      }),

    tables: async (clubId: string): Promise<Table[]> =>
      (await api.request<{ items: Table[] }>('GET', `/v1/clubs/${enc(clubId)}/tables`)).items,
    table: (tableId: string) => api.request<TableDetail>('GET', `/v1/tables/${enc(tableId)}`),
    createTable: (clubId: string, body: CreateTableRequest, key = newIdempotencyKey()) =>
      api.request<TableDetail>('POST', `/v1/clubs/${enc(clubId)}/tables`, {
        body,
        idempotencyKey: key,
      }),
    takeSeat: (
      tableId: string,
      body: { buyIn: number; seatNo?: number },
      key = newIdempotencyKey(),
    ) =>
      api.request<SeatResult>('POST', `/v1/tables/${enc(tableId)}/seat`, {
        body,
        idempotencyKey: key,
      }),
    closeTable: (tableId: string) =>
      api.request<CloseTableResult>('POST', `/v1/tables/${enc(tableId)}/close`),

    // --- club administration (the API enforces every permission) -------------
    updateClub: (clubId: string, body: { name?: string; description?: string | null }) =>
      api.request<Club>('PATCH', `/v1/clubs/${enc(clubId)}`, { body }),
    transferOwnership: (clubId: string, userId: string) =>
      api.request<Club>('POST', `/v1/clubs/${enc(clubId)}/transfer-ownership`, {
        body: { userId },
      }),
    rotateJoinCode: (clubId: string) =>
      api.request<Club>('POST', `/v1/clubs/${enc(clubId)}/join-code/rotate`),
    membersByStatus: (clubId: string, status: 'ACTIVE' | 'BANNED', cursor?: string | null) =>
      api.request<MemberPage>(
        'GET',
        `/v1/clubs/${enc(clubId)}/members?limit=100&status=${status}${cursorParam(cursor)}`,
      ),
    updateMember: (
      clubId: string,
      userId: string,
      body: { role?: 'ADMIN' | 'AGENT' | 'MEMBER'; status?: 'ACTIVE' | 'BANNED' },
    ) => api.request<Member>('PATCH', `/v1/clubs/${enc(clubId)}/members/${enc(userId)}`, { body }),
    invites: async (clubId: string): Promise<Invite[]> =>
      (await api.request<{ items: Invite[] }>('GET', `/v1/clubs/${enc(clubId)}/invites`)).items,
    createInvite: (clubId: string, body: CreateInviteRequest, key = newIdempotencyKey()) =>
      api.request<InviteCreated>('POST', `/v1/clubs/${enc(clubId)}/invites`, {
        body,
        idempotencyKey: key,
      }),
    revokeInvite: (clubId: string, inviteId: string) =>
      api.request<void>('DELETE', `/v1/clubs/${enc(clubId)}/invites/${enc(inviteId)}`),
    auditLog: (clubId: string, cursor?: string | null) =>
      api.request<AuditPage>(
        'GET',
        `/v1/clubs/${enc(clubId)}/audit-log?limit=50${cursorParam(cursor)}`,
      ),
    ledgerSummary: (clubId: string) =>
      api.request<LedgerSummary>('GET', `/v1/clubs/${enc(clubId)}/ledger/summary`),
    ledgerBalances: (clubId: string, cursor?: string | null) =>
      api.request<MemberBalancePage>(
        'GET',
        `/v1/clubs/${enc(clubId)}/ledger/balances?limit=100${cursorParam(cursor)}`,
      ),
    ledgerTransactions: (clubId: string, cursor?: string | null) =>
      api.request<LedgerTransactionPage>(
        'GET',
        `/v1/clubs/${enc(clubId)}/ledger/transactions?limit=25${cursorParam(cursor)}`,
      ),
    deductChips: (
      clubId: string,
      body: { userId: string; amount: number; note?: string },
      key = newIdempotencyKey(),
    ) =>
      api.request<LedgerTransaction>('POST', `/v1/clubs/${enc(clubId)}/chips/deductions`, {
        body,
        idempotencyKey: key,
      }),
    reverseTransaction: (clubId: string, txId: string, note: string, key = newIdempotencyKey()) =>
      api.request<LedgerTransaction>(
        'POST',
        `/v1/clubs/${enc(clubId)}/ledger/transactions/${enc(txId)}/reversal`,
        { body: { note }, idempotencyKey: key },
      ),

    // --- platform administration (PLATFORM_ADMIN; enforced server-side) -------
    adminOverview: () => api.request<PlatformOverview>('GET', '/v1/admin/overview'),
    adminUsers: (q: string, cursor?: string | null) =>
      api.request<AdminUserPage>(
        'GET',
        `/v1/admin/users?limit=50${q ? `&q=${enc(q)}` : ''}${cursorParam(cursor)}`,
      ),
    adminSetUserStatus: (userId: string, status: 'ACTIVE' | 'SUSPENDED', reason: string) =>
      api.request<AdminUser>('PATCH', `/v1/admin/users/${enc(userId)}`, {
        body: { status, reason },
      }),
    adminClubs: (q: string, cursor?: string | null) =>
      api.request<AdminClubPage>(
        'GET',
        `/v1/admin/clubs?limit=50${q ? `&q=${enc(q)}` : ''}${cursorParam(cursor)}`,
      ),
    adminSetClubStatus: (clubId: string, status: 'ACTIVE' | 'SUSPENDED', reason: string) =>
      api.request<AdminClub>('PATCH', `/v1/admin/clubs/${enc(clubId)}`, {
        body: { status, reason },
      }),
    adminAudit: (filter: { action?: string; clubId?: string }, cursor?: string | null) =>
      api.request<AuditPage>(
        'GET',
        `/v1/admin/audit-log?limit=50${filter.action ? `&action=${enc(filter.action)}` : ''}${
          filter.clubId ? `&clubId=${enc(filter.clubId)}` : ''
        }${cursorParam(cursor)}`,
      ),
    adminRisk: (status: 'OPEN' | 'REVIEWED', cursor?: string | null) =>
      api.request<RiskEventPage>(
        'GET',
        `/v1/admin/risk-events?limit=50&status=${status}${cursorParam(cursor)}`,
      ),
    adminReviewRisk: (
      id: string,
      disposition: 'DISMISSED' | 'CONFIRMED' | 'ESCALATED',
      note: string,
    ) =>
      api.request<RiskEvent>('PATCH', `/v1/admin/risk-events/${enc(id)}`, {
        body: { disposition, note },
      }),

    myHands: (cursor?: string | null) =>
      api.request<HandSummaryPage>('GET', `/v1/me/hands?limit=25${cursorParam(cursor)}`),
    hand: (handId: string) => api.request<HandDetail>('GET', `/v1/hands/${enc(handId)}`),
    clubHands: (clubId: string, opts: { tableId?: string; cursor?: string | null } = {}) =>
      api.request<HandSummaryPage>(
        'GET',
        `/v1/clubs/${enc(clubId)}/hands?limit=25${opts.tableId ? `&tableId=${enc(opts.tableId)}` : ''}${cursorParam(opts.cursor)}`,
      ),

    leaveTable: (tableId: string, key = newIdempotencyKey()) =>
      api.request<LeaveResult>('POST', `/v1/tables/${enc(tableId)}/leave`, {
        idempotencyKey: key,
      }),
  };
}

export type Endpoints = ReturnType<typeof endpoints>;
