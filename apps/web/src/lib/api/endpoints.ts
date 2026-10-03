import type {
  Club,
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
    leaveTable: (tableId: string, key = newIdempotencyKey()) =>
      api.request<LeaveResult>('POST', `/v1/tables/${enc(tableId)}/leave`, {
        idempotencyKey: key,
      }),
  };
}

export type Endpoints = ReturnType<typeof endpoints>;
