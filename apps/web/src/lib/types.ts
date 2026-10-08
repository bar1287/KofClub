import type { ControlApi, Realtime } from '@kofclub/contracts';

/** Control-plane (HTTP) types, generated from control-api.yaml. */
type Api = ControlApi.components['schemas'];
export type User = Api['User'];
export type AuthResult = Api['AuthResult'];
export type Session = Api['Session'];
export type MfaStatus = Api['MfaStatus'];
export type TotpEnrollment = Api['TotpEnrollment'];
export type Club = Api['Club'];
export type ClubRole = Api['ClubRole'];
export type Member = Api['Member'];
export type MemberPage = Api['MemberPage'];
export type Wallet = Api['Wallet'];
export type WalletEntryPage = Api['WalletEntryPage'];
export type LedgerTransaction = Api['LedgerTransaction'];
export type Table = Api['Table'];
export type TableDetail = Api['TableDetail'];
export type CreateTableRequest = Api['CreateTableRequest'];
export type SeatResult = Api['SeatResult'];
export type LeaveResult = Api['LeaveResult'];
export type TopUpResult = Api['TopUpResult'];
export type AutoTopUpResult = Api['AutoTopUpResult'];
export type MuckPreferenceResult = Api['MuckPreferenceResult'];
export type ErrorBody = Api['ErrorBody'];
export type Invite = Api['Invite'];
export type InviteCreated = Api['InviteCreated'];
export type CreateInviteRequest = Api['CreateInviteRequest'];
export type AuditPage = Api['AuditPage'];
export type AuditRecord = Api['AuditRecord'];
export type LedgerSummary = Api['LedgerSummary'];
export type MemberBalancePage = Api['MemberBalancePage'];
export type LedgerTransactionPage = Api['LedgerTransactionPage'];
export type CloseTableResult = Api['CloseTableResult'];
export type PlatformOverview = Api['PlatformOverview'];
export type AdminUser = Api['AdminUser'];
export type AdminUserPage = Api['AdminUserPage'];
export type AdminClub = Api['AdminClub'];
export type AdminClubPage = Api['AdminClubPage'];
export type RiskEvent = Api['RiskEvent'];
export type RiskEventPage = Api['RiskEventPage'];
export type HandSummaryRecord = Api['HandSummary'];
export type HandSummaryPage = Api['HandSummaryPage'];
export type HandDetail = Api['HandDetail'];
export type HandParticipant = Api['HandParticipant'];
export type Tournament = Api['Tournament'];
export type TournamentDetail = Api['TournamentDetail'];
export type TournamentStatus = Api['TournamentStatus'];
export type CreateTournamentRequest = Api['CreateTournamentRequest'];
export type ChatHistory = Api['ChatHistory'];
export type ChatReport = Api['ChatReport'];
export type ChatReportPage = Api['ChatReportPage'];
export type ChatReportStatus = Api['ChatReportStatus'];

/** Realtime (WebSocket) types, generated from realtime.yaml. */
type Rt = Realtime.components['schemas'];
export type Card = Rt['Card'];
export type LegalAction = Rt['LegalAction'];
export type CommandPayload = Rt['CommandPayload'];
export type CommandKind = CommandPayload['kind'];
export type CommandResult = Rt['CommandResult'];
export type TableSnapshot = Rt['TableSnapshot'];
export type TableSnapshotMessage = Rt['TableSnapshotMessage'];
export type TableEventMessage = Rt['TableEventMessage'];
export type TableEventPayload = Rt['TableEventPayload'];
export type TableInfo = Rt['TableInfo'];
export type TournamentTableInfo = Rt['TournamentTableInfo'];
export type SeatView = Rt['SeatView'];
export type HandView = Rt['HandView'];
export type HandResult = Rt['HandResult'];
export type WinnerShare = Rt['WinnerShare'];
export type Street = HandView['street'];
export type TablePhase = TableSnapshot['phase'];
export type Welcome = Rt['Welcome'];
export type Subscribed = Rt['Subscribed'];
export type ResyncRequired = Rt['ResyncRequired'];
export type ProtocolError = Rt['ProtocolError'];
export type ChatMessage = Rt['ChatMessage'];
export type ChatEmoji = Rt['ChatEmoji'];
export type ChatMessageFrame = Rt['ChatMessageFrame'];
export type ChatHiddenFrame = Rt['ChatHiddenFrame'];
export type ChatFrame = ChatMessageFrame | ChatHiddenFrame;

/** Every frame the gateway can send. */
export type ServerFrame =
  | Welcome
  | Subscribed
  | TableSnapshotMessage
  | TableEventMessage
  | CommandResult
  | ResyncRequired
  | ProtocolError
  | ChatMessageFrame
  | ChatHiddenFrame
  | Rt['Ping']
  | Rt['Pong'];

/** Every frame the client can send. */
export type ClientFrame =
  | Rt['Hello']
  | Rt['Auth']
  | Rt['SubscribeTable']
  | Rt['UnsubscribeTable']
  | Rt['Command']
  | Rt['ChatSend']
  | Rt['Ping']
  | Rt['Pong'];

/** Narrows a table event payload by kind. */
export type EventOf<K extends TableEventPayload['kind']> = Extract<TableEventPayload, { kind: K }>;
