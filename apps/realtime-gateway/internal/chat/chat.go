// Package chat carries table chat (roadmap W1.4). control-api owns chat:
// it decides who may talk, stores messages and publishes every chat frame
// on a Redis channel; each gateway forwards a player's CHAT_SEND to
// control-api and delivers published frames to its connections watching
// the table. The gateway never logs message text.
package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/bar1287/kofclub/go/observability"
)

// Channel is the Redis channel control-api publishes chat frames on.
const Channel = "table:chat"

// Frame types carried on the channel.
const (
	TypeMessage = "CHAT_MESSAGE"
	TypeHidden  = "CHAT_HIDDEN"
)

// SendRequest is a player's CHAT_SEND: exactly one of Text and Emoji.
type SendRequest struct {
	UserID    string `json:"userId"`
	SessionID string `json:"sessionId,omitempty"`
	RequestID string `json:"requestId"`
	Text      string `json:"text,omitempty"`
	Emoji     string `json:"emoji,omitempty"`
}

// SendResult is control-api's answer: the message as delivered, and
// whether it went out on the channel (false when Redis is down; the
// gateway then delivers it to its own connections).
type SendResult struct {
	Message   json.RawMessage `json:"message"`
	Published bool            `json:"published"`
}

// Sender hands a CHAT_SEND to control-api.
type Sender interface {
	Send(ctx context.Context, tableID string, req SendRequest) (SendResult, error)
}

// APIError is a rejection with a machine-readable code (CHAT_DISABLED,
// RATE_LIMITED, NOT_CLUB_MEMBER, ...).
type APIError struct {
	Status  int
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *APIError) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

// HTTPSender calls control-api's internal chat endpoint.
type HTTPSender struct {
	baseURL string
	token   string
	client  *http.Client
}

// NewHTTPSender creates a sender for control-api at baseURL.
func NewHTTPSender(baseURL, token string) *HTTPSender {
	return &HTTPSender{baseURL: baseURL, token: token, client: &http.Client{Timeout: 5 * time.Second}}
}

// Send forwards the message; rejections come back as *APIError.
func (s *HTTPSender) Send(ctx context.Context, tableID string, req SendRequest) (SendResult, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return SendResult{}, err
	}
	u := fmt.Sprintf("%s/internal/v1/tables/%s/chat", s.baseURL, url.PathEscape(tableID))
	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(body))
	if err != nil {
		return SendResult{}, err
	}
	hreq.Header.Set("Authorization", "Bearer "+s.token)
	hreq.Header.Set("Content-Type", "application/json")
	observability.InjectTrace(ctx, hreq.Header)
	res, err := s.client.Do(hreq)
	if err != nil {
		return SendResult{}, err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		var env struct {
			Error APIError `json:"error"`
		}
		if json.NewDecoder(res.Body).Decode(&env) != nil || env.Error.Code == "" {
			return SendResult{}, fmt.Errorf("chat: control-api returned %d", res.StatusCode)
		}
		env.Error.Status = res.StatusCode
		return SendResult{}, &env.Error
	}
	var out SendResult
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return SendResult{}, err
	}
	if len(out.Message) == 0 {
		return SendResult{}, errors.New("chat: control-api returned no message")
	}
	return out, nil
}

// MessageFrame builds the CHAT_MESSAGE frame for a message.
func MessageFrame(tableID string, message json.RawMessage) ([]byte, error) {
	return json.Marshal(struct {
		Type    string          `json:"type"`
		TableID string          `json:"tableId"`
		Message json.RawMessage `json:"message"`
	}{TypeMessage, tableID, message})
}

// Decode reads one channel payload: the table and the exact frame to send
// to its watchers. Only chat frame types are accepted.
func Decode(payload []byte) (tableID, frameType string, frame []byte, err error) {
	var p struct {
		TableID string          `json:"tableId"`
		Frame   json.RawMessage `json:"frame"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return "", "", nil, err
	}
	var head struct {
		Type    string `json:"type"`
		TableID string `json:"tableId"`
	}
	if err := json.Unmarshal(p.Frame, &head); err != nil {
		return "", "", nil, err
	}
	if head.Type != TypeMessage && head.Type != TypeHidden {
		return "", "", nil, fmt.Errorf("chat: unexpected frame type %q", head.Type)
	}
	if p.TableID == "" || head.TableID != p.TableID {
		return "", "", nil, errors.New("chat: frame for another table")
	}
	return p.TableID, head.Type, p.Frame, nil
}

// Watch delivers frames published on the channel until ctx ends. go-redis
// resubscribes after connection loss; frames published meanwhile are lost
// (chat is best-effort live; the history endpoint has stored messages).
func Watch(ctx context.Context, rdb *redis.Client, log *slog.Logger, deliver func(tableID, frameType string, frame []byte)) {
	sub := rdb.Subscribe(ctx, Channel)
	defer func() { _ = sub.Close() }()
	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case m, ok := <-ch:
			if !ok {
				return
			}
			tableID, frameType, frame, err := Decode([]byte(m.Payload))
			if err != nil {
				log.Warn("chat_frame_rejected", slog.String("error", err.Error()))
				continue
			}
			deliver(tableID, frameType, frame)
		}
	}
}
