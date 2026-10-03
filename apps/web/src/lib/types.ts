import type { ControlApi, Realtime } from '@kofclub/contracts';

/** Control-plane (HTTP) types, generated from control-api.yaml. */
type Api = ControlApi.components['schemas'];
export type User = Api['User'];
export type AuthResult = Api['AuthResult'];
export type Session = Api['Session'];
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
export type ErrorBody = Api['ErrorBody'];

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

/** Every frame the gateway can send. */
export type ServerFrame =
  | Welcome
  | Subscribed
  | TableSnapshotMessage
  | TableEventMessage
  | CommandResult
  | ResyncRequired
  | ProtocolError
  | Rt['Ping']
  | Rt['Pong'];

/** Every frame the client can send. */
export type ClientFrame =
  | Rt['Hello']
  | Rt['Auth']
  | Rt['SubscribeTable']
  | Rt['UnsubscribeTable']
  | Rt['Command']
  | Rt['Ping']
  | Rt['Pong'];

/** Narrows a table event payload by kind. */
export type EventOf<K extends TableEventPayload['kind']> = Extract<TableEventPayload, { kind: K }>;
