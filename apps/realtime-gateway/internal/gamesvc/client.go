// Package gamesvc is the gateway's client for the game service's internal
// API (docs/protocols/internal-game-api.md), including table routing to the
// owning node and the per-table event stream.
package gamesvc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/bar1287/kofclub/go/observability"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// APIError is an error envelope returned by the game service.
type APIError struct {
	Status  int
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details"`
}

func (e *APIError) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

// ErrResync means requested events are no longer retained.
var ErrResync = errors.New("gamesvc: resync required")

// Client talks to game-service nodes.
type Client struct {
	defaultURL string
	token      string
	http       *http.Client

	mu     sync.Mutex
	routes map[string]string // tableID -> owner URL
}

// New creates a client. defaultURL is any game-service node (or a load balancer).
func New(defaultURL, token string) *Client {
	return &Client{defaultURL: strings.TrimRight(defaultURL, "/"), token: token, http: &http.Client{Timeout: 10 * time.Second}, routes: map[string]string{}}
}

func (c *Client) base(tableID string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if u, ok := c.routes[tableID]; ok {
		return u
	}
	return c.defaultURL
}

func (c *Client) setRoute(tableID, url string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if url == "" {
		delete(c.routes, tableID)
	} else {
		c.routes[tableID] = strings.TrimRight(url, "/")
	}
}

// do performs a request, following one owner redirect.
func (c *Client) do(ctx context.Context, method, tableID, path string, body any, out any) error {
	for attempt := 0; attempt < 2; attempt++ {
		var reader *bytes.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			reader = bytes.NewReader(b)
		} else {
			reader = bytes.NewReader(nil)
		}
		req, err := http.NewRequestWithContext(ctx, method, c.base(tableID)+path, reader)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+c.token)
		req.Header.Set("Content-Type", "application/json")
		observability.InjectTrace(ctx, req.Header)
		res, err := c.http.Do(req)
		if err != nil {
			c.setRoute(tableID, "") // node may be gone: fall back to default routing
			return &APIError{Status: 503, Code: "TABLE_UNAVAILABLE", Message: "game service unreachable"}
		}
		raw := new(bytes.Buffer)
		_, _ = raw.ReadFrom(res.Body)
		_ = res.Body.Close()
		if res.StatusCode < 300 {
			if out != nil {
				return json.Unmarshal(raw.Bytes(), out)
			}
			return nil
		}
		var env struct {
			Error APIError `json:"error"`
		}
		_ = json.Unmarshal(raw.Bytes(), &env)
		apiErr := env.Error
		apiErr.Status = res.StatusCode
		if apiErr.Code == "TABLE_UNAVAILABLE" {
			if owner, _ := apiErr.Details["ownerUrl"].(string); owner != "" && attempt == 0 {
				c.setRoute(tableID, owner)
				continue
			}
		}
		if apiErr.Code == "STALE_GAME_STATE" && res.StatusCode == http.StatusConflict && strings.Contains(path, "/events") {
			return ErrResync
		}
		if apiErr.Code == "" {
			apiErr.Code, apiErr.Message = "TABLE_UNAVAILABLE", "game service error"
		}
		return &apiErr
	}
	return &APIError{Status: 503, Code: "TABLE_UNAVAILABLE", Message: "table ownership is moving"}
}

// Snapshot fetches a viewer-sanitized snapshot.
func (c *Client) Snapshot(ctx context.Context, tableID, viewer string) (json.RawMessage, int64, error) {
	var raw json.RawMessage
	if err := c.do(ctx, http.MethodGet, tableID, fmt.Sprintf("/internal/v1/tables/%s/snapshot?viewer=%s", tableID, viewer), nil, &raw); err != nil {
		return nil, 0, err
	}
	var head struct {
		Seq int64 `json:"seq"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return nil, 0, err
	}
	return raw, head.Seq, nil
}

// CommandRequest is forwarded to the table actor.
type CommandRequest struct {
	UserID      string   `json:"userId"`
	CommandID   string   `json:"commandId"`
	ExpectedSeq *int64   `json:"expectedSeq,omitempty"`
	Kind        string   `json:"kind"`
	Amount      int64    `json:"amount"`
	Cards       []string `json:"cards,omitempty"`
}

// CommandResult is the actor's answer.
type CommandResult struct {
	CommandID string `json:"commandId"`
	Accepted  bool   `json:"accepted"`
	Duplicate bool   `json:"duplicate"`
	Seq       int64  `json:"seq"`
}

// Command forwards a player command.
func (c *Client) Command(ctx context.Context, tableID string, req CommandRequest) (CommandResult, error) {
	var res CommandResult
	err := c.do(ctx, http.MethodPost, tableID, fmt.Sprintf("/internal/v1/tables/%s/commands", tableID), req, &res)
	return res, err
}

// StreamFrame mirrors game-service api.StreamFrame.
type StreamFrame struct {
	Type       string                     `json:"type"`
	Seq        int64                      `json:"seq"`
	HandID     string                     `json:"handId,omitempty"`
	Kind       string                     `json:"kind,omitempty"`
	ServerTime time.Time                  `json:"serverTime"`
	Public     json.RawMessage            `json:"public,omitempty"`
	Private    map[string]json.RawMessage `json:"private,omitempty"`
}

// Stream is an open internal event stream.
type Stream struct {
	conn *websocket.Conn
}

// Next reads the next frame.
func (s *Stream) Next(ctx context.Context) (StreamFrame, error) {
	var f StreamFrame
	_, b, err := s.conn.Read(ctx)
	if err != nil {
		if websocket.CloseStatus(err) == 4409 {
			return f, ErrResync
		}
		return f, err
	}
	return f, json.Unmarshal(b, &f)
}

// Close closes the stream.
func (s *Stream) Close() { _ = s.conn.CloseNow() }

// OpenStream connects to the owning node's event stream after seq `after`
// (-1 = live only), following routing hints.
func (c *Client) OpenStream(ctx context.Context, tableID string, after int64) (*Stream, error) {
	// Resolve the owner first (activates the table if nobody owns it).
	var route struct {
		OwnerURL string `json:"ownerUrl"`
	}
	if err := c.do(ctx, http.MethodGet, tableID, fmt.Sprintf("/internal/v1/tables/%s/route", tableID), nil, &route); err != nil {
		return nil, err
	}
	if route.OwnerURL != "" {
		c.setRoute(tableID, route.OwnerURL)
	}
	u := strings.Replace(c.base(tableID), "http", "ws", 1) + fmt.Sprintf("/internal/v1/tables/%s/stream?after=%d", tableID, after)
	conn, res, err := websocket.Dial(ctx, u, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + c.token}},
	})
	if err != nil {
		if res != nil && res.StatusCode == http.StatusConflict {
			return nil, ErrResync
		}
		c.setRoute(tableID, "")
		return nil, err
	}
	conn.SetReadLimit(1 << 20)
	return &Stream{conn: conn}, nil
}
