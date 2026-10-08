// Package protocol defines the client <-> gateway WebSocket frames. The
// canonical schemas live in packages/contracts/openapi/realtime.yaml; the
// gateway's contract tests validate these structs' JSON against it.
package protocol

import (
	"encoding/json"
	"time"
)

// Envelope is used to read the type discriminator of any frame.
type Envelope struct {
	Type string `json:"type"`
}

// Client -> server frames.

type Hello struct {
	Type          string `json:"type"`
	AccessToken   string `json:"accessToken"`
	ClientVersion string `json:"clientVersion"`
	DeviceID      string `json:"deviceId,omitempty"`
}

type Auth struct {
	Type        string `json:"type"`
	AccessToken string `json:"accessToken"`
}

type SubscribeTable struct {
	Type        string `json:"type"`
	RequestID   string `json:"requestId,omitempty"`
	TableID     string `json:"tableId"`
	LastSeenSeq *int64 `json:"lastSeenSeq,omitempty"`
}

type UnsubscribeTable struct {
	Type    string `json:"type"`
	TableID string `json:"tableId"`
}

type CommandPayload struct {
	Kind   string `json:"kind"`
	Amount int64  `json:"amount,omitempty"`
}

type Command struct {
	Type        string         `json:"type"`
	RequestID   string         `json:"requestId"`
	TableID     string         `json:"tableId"`
	ExpectedSeq *int64         `json:"expectedSeq,omitempty"`
	Command     CommandPayload `json:"command"`
}

// ChatSend is a chat message (Text) or an emoji reaction (Emoji).
type ChatSend struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	TableID   string `json:"tableId"`
	Text      string `json:"text,omitempty"`
	Emoji     string `json:"emoji,omitempty"`
}

type Ping struct {
	Type  string `json:"type"`
	Nonce string `json:"nonce,omitempty"`
}

// Server -> client frames.

type Welcome struct {
	Type                string    `json:"type"`
	ConnectionID        string    `json:"connectionId"`
	UserID              string    `json:"userId"`
	HeartbeatIntervalMs int64     `json:"heartbeatIntervalMs"`
	ServerTime          time.Time `json:"serverTime"`
	TokenExpiresAt      time.Time `json:"tokenExpiresAt"`
}

type Subscribed struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId,omitempty"`
	TableID   string `json:"tableId"`
	Seq       int64  `json:"seq"`
	Mode      string `json:"mode"` // SNAPSHOT | REPLAY
	Replayed  int    `json:"replayed"`
}

type TableSnapshot struct {
	Type     string          `json:"type"`
	TableID  string          `json:"tableId"`
	Seq      int64           `json:"seq"`
	Snapshot json.RawMessage `json:"snapshot"`
}

type TableEvent struct {
	Type       string          `json:"type"`
	TableID    string          `json:"tableId"`
	Seq        int64           `json:"seq"`
	HandID     string          `json:"handId,omitempty"`
	ServerTime time.Time       `json:"serverTime"`
	Event      json.RawMessage `json:"event"`
}

type CommandError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

type CommandResult struct {
	Type      string        `json:"type"`
	RequestID string        `json:"requestId"`
	TableID   string        `json:"tableId"`
	Accepted  bool          `json:"accepted"`
	Duplicate bool          `json:"duplicate"`
	Seq       int64         `json:"seq"`
	Error     *CommandError `json:"error,omitempty"`
}

type ResyncRequired struct {
	Type       string `json:"type"`
	TableID    string `json:"tableId"`
	Reason     string `json:"reason"` // EVENTS_NOT_RETAINED | SEQUENCE_GAP | FEED_RESET
	CurrentSeq int64  `json:"currentSeq"`
}

type Error struct {
	Type      string `json:"type"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId,omitempty"`
	TableID   string `json:"tableId,omitempty"`
}

type Pong struct {
	Type  string `json:"type"`
	Nonce string `json:"nonce,omitempty"`
}

// Frame type names.
const (
	TypeHello          = "HELLO"
	TypeAuth           = "AUTH"
	TypeSubscribe      = "SUBSCRIBE_TABLE"
	TypeUnsubscribe    = "UNSUBSCRIBE_TABLE"
	TypeCommand        = "COMMAND"
	TypeChatSend       = "CHAT_SEND"
	TypePing           = "PING"
	TypePong           = "PONG"
	TypeWelcome        = "WELCOME"
	TypeSubscribed     = "SUBSCRIBED"
	TypeTableSnapshot  = "TABLE_SNAPSHOT"
	TypeTableEvent     = "TABLE_EVENT"
	TypeCommandResult  = "COMMAND_RESULT"
	TypeResyncRequired = "RESYNC_REQUIRED"
	TypeError          = "ERROR"
	TypeChatMessage    = "CHAT_MESSAGE"
	TypeChatHidden     = "CHAT_HIDDEN"
)

// WebSocket close codes used by the gateway (documented in
// docs/realtime-protocol.md).
const (
	CloseAuthFailed   = 4401
	CloseHelloTimeout = 4408
	CloseRateLimited  = 4429
	CloseSlowConsumer = 4001
	CloseServerDrain  = 1012
	ClosePolicy       = 1008
)
