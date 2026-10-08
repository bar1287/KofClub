package ws

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/bar1287/kofclub/go/observability"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"log/slog"
	"regexp"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/auth"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/chat"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/gamesvc"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/protocol"
)

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

var commandKinds = map[string]bool{
	"FOLD": true, "CHECK": true, "CALL": true, "BET": true, "RAISE": true, "ALL_IN": true, "SIT_OUT": true, "SIT_IN": true,
}

// Conn is one client connection. The read loop handles frames serially;
// a writer goroutine drains the bounded send queue.
type Conn struct {
	hub  *Hub
	ws   *websocket.Conn
	id   string
	log  *slog.Logger
	send chan []byte

	closeOnce sync.Once
	closed    chan struct{}
	failing   chan struct{} // set when fail() scheduled a close with a specific code

	mu          sync.Mutex
	claims      auth.Claims
	authed      bool
	subs        map[string]*subscription
	expiryTimer *time.Timer

	tokens     float64
	lastRefill time.Time
}

func newConn(h *Hub, wsConn *websocket.Conn, id string) *Conn {
	return &Conn{
		hub: h, ws: wsConn, id: id, log: h.log.With(slog.String("connection_id", id)),
		send: make(chan []byte, h.cfg.SendQueue), closed: make(chan struct{}),
		subs: map[string]*subscription{}, tokens: float64(h.cfg.CommandBurst), lastRefill: time.Now(),
	}
}

func (c *Conn) userID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.claims.UserID
}

func (c *Conn) sessionID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.claims.SessionID
}

func (c *Conn) subscribedTo(tableID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, ok := c.subs[tableID]
	return ok
}

// enqueue queues a frame without blocking; a full queue means the client
// cannot keep up, so it is disconnected and must resume/resync later.
func (c *Conn) enqueue(frameType string, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		c.log.Error("frame_marshal_failed", slog.String("error", err.Error()))
		return
	}
	c.enqueueRaw(frameType, b)
}

// enqueueRaw queues an already encoded frame (see enqueue).
func (c *Conn) enqueueRaw(frameType string, b []byte) {
	select {
	case <-c.closed:
		return
	default:
	}
	select {
	case c.send <- b:
		c.hub.metrics.FramesOut.WithLabelValues(frameType).Inc()
	default:
		c.hub.metrics.SlowConsumers.Inc()
		go c.closeWith(protocol.CloseSlowConsumer, "client too slow; reconnect and resume")
	}
}

func (c *Conn) sendError(code, msg, requestID, tableID string) {
	c.enqueue(protocol.TypeError, protocol.Error{Type: protocol.TypeError, Code: code, Message: msg, RequestID: requestID, TableID: tableID})
}

// fail sends an error frame and closes the connection with closeCode
// shortly after (so the error frame can be flushed first).
func (c *Conn) fail(closeCode websocket.StatusCode, code, msg string) {
	c.sendError(code, msg, "", "")
	done := make(chan struct{})
	c.mu.Lock()
	if c.failing != nil {
		c.mu.Unlock()
		return
	}
	c.failing = done
	c.mu.Unlock()
	go func() {
		defer close(done)
		time.Sleep(50 * time.Millisecond)
		c.closeWith(closeCode, msg)
	}()
}

func (c *Conn) closeWith(code websocket.StatusCode, reason string) {
	c.closeOnce.Do(func() {
		close(c.closed)
		_ = c.ws.Close(code, reason)
	})
}

func (c *Conn) run(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go c.writeLoop(ctx)
	c.readLoop(ctx)
	c.mu.Lock()
	failing := c.failing
	c.mu.Unlock()
	if failing != nil {
		<-failing // keep the specific close code chosen by fail()
	}
	c.closeWith(websocket.StatusNormalClosure, "")
	c.mu.Lock()
	subs := c.subs
	c.subs = map[string]*subscription{}
	if c.expiryTimer != nil {
		c.expiryTimer.Stop()
	}
	c.mu.Unlock()
	for _, s := range subs {
		s.stop()
	}
}

func (c *Conn) writeLoop(ctx context.Context) {
	ping := time.NewTicker(c.hub.cfg.HeartbeatInterval)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.closed:
			return
		case b := <-c.send:
			wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := c.ws.Write(wctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				c.closeWith(websocket.StatusGoingAway, "write failed")
				return
			}
		case <-ping.C:
			// Transport-level ping detects dead peers; clients may also send PING frames.
			pctx, cancel := context.WithTimeout(ctx, c.hub.cfg.HeartbeatInterval)
			err := c.ws.Ping(pctx)
			cancel()
			if err != nil {
				c.closeWith(websocket.StatusGoingAway, "heartbeat timeout")
				return
			}
		}
	}
}

func (c *Conn) readLoop(ctx context.Context) {
	// A read-context deadline would tear the socket down without a close
	// code, so the HELLO timeout closes explicitly with 4408 instead.
	helloTimer := time.AfterFunc(c.hub.cfg.HelloTimeout, func() {
		c.mu.Lock()
		authed := c.authed
		c.mu.Unlock()
		if !authed {
			c.hub.metrics.AuthFailures.WithLabelValues("hello_timeout").Inc()
			c.closeWith(protocol.CloseHelloTimeout, "HELLO not received")
		}
	})
	defer helloTimer.Stop()
	for {
		_, data, err := c.ws.Read(ctx)
		if err != nil {
			return
		}
		c.mu.Lock()
		authed := c.authed
		c.mu.Unlock()
		var env protocol.Envelope
		if json.Unmarshal(data, &env) != nil {
			c.sendError("VALIDATION_FAILED", "frame must be a JSON object with a type", "", "")
			continue
		}
		c.hub.metrics.FramesIn.WithLabelValues(frameLabel(env.Type)).Inc()
		if !authed && env.Type != protocol.TypeHello {
			c.hub.metrics.AuthFailures.WithLabelValues("no_hello").Inc()
			c.fail(protocol.CloseAuthFailed, "AUTH_REQUIRED", "first frame must be HELLO")
			return
		}
		switch env.Type {
		case protocol.TypeHello:
			c.handleHello(ctx, data)
		case protocol.TypeAuth:
			c.handleAuth(ctx, data)
		case protocol.TypeSubscribe:
			c.handleSubscribe(ctx, data)
		case protocol.TypeUnsubscribe:
			c.handleUnsubscribe(data)
		case protocol.TypeCommand:
			c.handleCommand(ctx, data)
		case protocol.TypeChatSend:
			c.handleChat(ctx, data)
		case protocol.TypePing:
			var p protocol.Ping
			_ = json.Unmarshal(data, &p)
			c.enqueue(protocol.TypePong, protocol.Pong{Type: protocol.TypePong, Nonce: p.Nonce})
		case protocol.TypePong:
		default:
			c.sendError("VALIDATION_FAILED", "unknown frame type", "", "")
		}
	}
}

func frameLabel(t string) string {
	switch t {
	case protocol.TypeHello, protocol.TypeAuth, protocol.TypeSubscribe, protocol.TypeUnsubscribe, protocol.TypeCommand, protocol.TypeChatSend, protocol.TypePing, protocol.TypePong:
		return t
	}
	return "UNKNOWN"
}

// authenticate verifies a token and installs it on the connection.
func (c *Conn) authenticate(ctx context.Context, token string) bool {
	claims, err := c.hub.verifier.Verify(token)
	if err != nil {
		code, reason := "AUTH_TOKEN_INVALID", "invalid"
		if errors.Is(err, auth.ErrTokenExpired) {
			code, reason = "AUTH_TOKEN_EXPIRED", "expired"
		}
		c.hub.metrics.AuthFailures.WithLabelValues(reason).Inc()
		c.fail(protocol.CloseAuthFailed, code, "access token rejected")
		return false
	}
	if c.hub.revoker != nil && c.hub.revoker.IsRevoked(ctx, claims.SessionID) {
		c.hub.metrics.AuthFailures.WithLabelValues("revoked").Inc()
		c.fail(protocol.CloseAuthFailed, "AUTH_SESSION_REVOKED", "session revoked")
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.authed && claims.UserID != c.claims.UserID {
		c.hub.metrics.AuthFailures.WithLabelValues("user_switch").Inc()
		go c.fail(protocol.CloseAuthFailed, "FORBIDDEN", "re-authentication must keep the same user")
		return false
	}
	c.claims, c.authed = claims, true
	if c.expiryTimer != nil {
		c.expiryTimer.Stop()
	}
	// Without a fresh AUTH before expiry the connection is closed.
	c.expiryTimer = time.AfterFunc(time.Until(claims.ExpiresAt), func() {
		c.fail(protocol.CloseAuthFailed, "AUTH_TOKEN_EXPIRED", "access token expired; reconnect with a fresh token")
	})
	c.log = c.hub.log.With(slog.String("connection_id", c.id), slog.String("user_id", claims.UserID))
	return true
}

func (c *Conn) handleHello(ctx context.Context, data []byte) {
	var m protocol.Hello
	if json.Unmarshal(data, &m) != nil || m.AccessToken == "" {
		c.fail(protocol.CloseAuthFailed, "AUTH_REQUIRED", "HELLO requires accessToken")
		return
	}
	c.mu.Lock()
	already := c.authed
	c.mu.Unlock()
	if already {
		c.sendError("VALIDATION_FAILED", "already authenticated; use AUTH to refresh", "", "")
		return
	}
	if !c.authenticate(ctx, m.AccessToken) {
		return
	}
	c.mu.Lock()
	claims := c.claims
	c.mu.Unlock()
	c.log.Info("ws_connected", slog.String("client_version", m.ClientVersion))
	c.enqueue(protocol.TypeWelcome, protocol.Welcome{
		Type: protocol.TypeWelcome, ConnectionID: c.id, UserID: claims.UserID,
		HeartbeatIntervalMs: c.hub.cfg.HeartbeatInterval.Milliseconds(), ServerTime: time.Now().UTC(), TokenExpiresAt: claims.ExpiresAt.UTC(),
	})
}

func (c *Conn) handleAuth(ctx context.Context, data []byte) {
	var m protocol.Auth
	if json.Unmarshal(data, &m) != nil || m.AccessToken == "" {
		c.sendError("VALIDATION_FAILED", "AUTH requires accessToken", "", "")
		return
	}
	if c.authenticate(ctx, m.AccessToken) {
		c.mu.Lock()
		claims := c.claims
		c.mu.Unlock()
		c.enqueue(protocol.TypeWelcome, protocol.Welcome{
			Type: protocol.TypeWelcome, ConnectionID: c.id, UserID: claims.UserID,
			HeartbeatIntervalMs: c.hub.cfg.HeartbeatInterval.Milliseconds(), ServerTime: time.Now().UTC(), TokenExpiresAt: claims.ExpiresAt.UTC(),
		})
	}
}

// authorize checks table access through control-api (cached).
func (c *Conn) authorize(ctx context.Context, tableID string) (string, bool) {
	actx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	d, err := c.hub.access.CheckTable(actx, c.userID(), c.sessionID(), tableID)
	if err != nil {
		c.log.Warn("access_check_failed", slog.String("error", err.Error()))
		return "SERVICE_UNAVAILABLE", false
	}
	if !d.Allowed {
		if d.Code == "" {
			d.Code = "FORBIDDEN"
		}
		return d.Code, false
	}
	return "", true
}

func (c *Conn) handleSubscribe(ctx context.Context, data []byte) {
	var m protocol.SubscribeTable
	if json.Unmarshal(data, &m) != nil || !uuidRe.MatchString(m.TableID) || (m.LastSeenSeq != nil && *m.LastSeenSeq < 0) {
		c.sendError("VALIDATION_FAILED", "SUBSCRIBE_TABLE requires a tableId UUID and optional non-negative lastSeenSeq", m.RequestID, m.TableID)
		return
	}
	if code, ok := c.authorize(ctx, m.TableID); !ok {
		c.sendError(code, "not allowed to subscribe to this table", m.RequestID, m.TableID)
		return
	}
	c.mu.Lock()
	if old, ok := c.subs[m.TableID]; ok {
		delete(c.subs, m.TableID)
		c.mu.Unlock()
		old.stop()
		c.mu.Lock()
	}
	sub := newSubscription(c, m.TableID, c.hub.feedFor(m.TableID))
	c.subs[m.TableID] = sub
	c.mu.Unlock()
	c.hub.metrics.Subscriptions.Inc()
	sub.begin(m.LastSeenSeq, m.RequestID)
}

func (c *Conn) handleUnsubscribe(data []byte) {
	var m protocol.UnsubscribeTable
	if json.Unmarshal(data, &m) != nil {
		return
	}
	c.mu.Lock()
	sub, ok := c.subs[m.TableID]
	delete(c.subs, m.TableID)
	c.mu.Unlock()
	if ok {
		sub.stop()
	}
}

func (c *Conn) allowCommand() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	c.tokens = min(float64(c.hub.cfg.CommandBurst), c.tokens+now.Sub(c.lastRefill).Seconds()*c.hub.cfg.CommandsPerSecond)
	c.lastRefill = now
	if c.tokens < 1 {
		return false
	}
	c.tokens--
	return true
}

func (c *Conn) handleCommand(ctx context.Context, data []byte) {
	start := time.Now()
	var m protocol.Command
	if json.Unmarshal(data, &m) != nil || !uuidRe.MatchString(m.RequestID) || !uuidRe.MatchString(m.TableID) || !commandKinds[m.Command.Kind] {
		c.enqueue(protocol.TypeCommandResult, protocol.CommandResult{Type: protocol.TypeCommandResult, RequestID: m.RequestID, TableID: m.TableID,
			Error: &protocol.CommandError{Code: "VALIDATION_FAILED", Message: "COMMAND requires requestId/tableId UUIDs and a valid command.kind"}})
		return
	}
	// One trace per player action: WebSocket ingress -> game command ->
	// persistence -> broadcast (the game service continues it).
	ctx, span := observability.Tracer().Start(ctx, "ws.command", trace.WithSpanKind(trace.SpanKindServer),
		trace.WithAttributes(attribute.String("table.id", m.TableID), attribute.String("command.kind", m.Command.Kind),
			attribute.String("command.request_id", m.RequestID), attribute.String("ws.connection_id", c.id)))
	defer span.End()
	result := func(res protocol.CommandResult) {
		res.Type, res.RequestID, res.TableID = protocol.TypeCommandResult, m.RequestID, m.TableID
		c.enqueue(protocol.TypeCommandResult, res)
		c.hub.metrics.CommandRTT.Observe(time.Since(start).Seconds())
		span.SetAttributes(attribute.Bool("command.accepted", res.Accepted), attribute.Bool("command.duplicate", res.Duplicate))
		if res.Error != nil {
			span.SetAttributes(attribute.String("error.code", res.Error.Code))
		}
	}
	if !c.allowCommand() {
		result(protocol.CommandResult{Error: &protocol.CommandError{Code: "RATE_LIMITED", Message: "too many commands"}})
		return
	}
	if code, ok := c.authorize(ctx, m.TableID); !ok {
		result(protocol.CommandResult{Error: &protocol.CommandError{Code: code, Message: "not allowed to act at this table"}})
		return
	}
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	res, err := c.hub.game.Command(cctx, m.TableID, gamesvc.CommandRequest{
		UserID: c.userID(), CommandID: m.RequestID, ExpectedSeq: m.ExpectedSeq, Kind: m.Command.Kind, Amount: m.Command.Amount,
	})
	if err != nil {
		var apiErr *gamesvc.APIError
		if errors.As(err, &apiErr) {
			seq, _ := apiErr.Details["seq"].(float64)
			dup, _ := apiErr.Details["duplicate"].(bool)
			details := map[string]any{}
			for k, v := range apiErr.Details {
				if k != "seq" && k != "duplicate" && k != "commandId" {
					details[k] = v
				}
			}
			if len(details) == 0 {
				details = nil
			}
			result(protocol.CommandResult{Seq: int64(seq), Duplicate: dup, Error: &protocol.CommandError{Code: apiErr.Code, Message: apiErr.Message, Details: details}})
			return
		}
		result(protocol.CommandResult{Error: &protocol.CommandError{Code: "TABLE_UNAVAILABLE", Message: "table unavailable; retry"}})
		return
	}
	result(protocol.CommandResult{Accepted: res.Accepted, Duplicate: res.Duplicate, Seq: res.Seq})
}

// maxChatTextBytes bounds what is forwarded; control-api applies the exact
// rules (at most 200 characters after cleaning).
const maxChatTextBytes = 2000

// handleChat forwards a chat message or reaction to control-api, which
// checks and stores it and publishes it to every gateway. Errors are
// answered with ERROR frames carrying the requestId. Message text is never
// logged.
func (c *Conn) handleChat(ctx context.Context, data []byte) {
	var m protocol.ChatSend
	if json.Unmarshal(data, &m) != nil || !uuidRe.MatchString(m.RequestID) || !uuidRe.MatchString(m.TableID) ||
		(m.Text == "") == (m.Emoji == "") || len(m.Text) > maxChatTextBytes || len(m.Emoji) > 64 {
		c.hub.metrics.ChatSends.WithLabelValues("rejected").Inc()
		c.sendError("VALIDATION_FAILED", "CHAT_SEND requires requestId/tableId UUIDs and either text or emoji", m.RequestID, m.TableID)
		return
	}
	reject := func(code, msg string) {
		c.hub.metrics.ChatSends.WithLabelValues("rejected").Inc()
		c.sendError(code, msg, m.RequestID, m.TableID)
	}
	if !c.subscribedTo(m.TableID) {
		reject("VALIDATION_FAILED", "subscribe to the table before chatting")
		return
	}
	if !c.allowCommand() {
		reject("RATE_LIMITED", "too many messages")
		return
	}
	if c.hub.chat == nil {
		reject("SERVICE_UNAVAILABLE", "chat is unavailable")
		return
	}
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	res, err := c.hub.chat.Send(cctx, m.TableID, chat.SendRequest{
		UserID: c.userID(), SessionID: c.sessionID(), RequestID: m.RequestID, Text: m.Text, Emoji: m.Emoji,
	})
	if err != nil {
		var apiErr *chat.APIError
		if errors.As(err, &apiErr) {
			reject(apiErr.Code, apiErr.Message)
			return
		}
		c.hub.metrics.ChatSends.WithLabelValues("error").Inc()
		c.log.Warn("chat_send_failed", slog.String("table_id", m.TableID), slog.String("error", err.Error()))
		c.sendError("SERVICE_UNAVAILABLE", "chat is unavailable; retry", m.RequestID, m.TableID)
		return
	}
	c.hub.metrics.ChatSends.WithLabelValues("accepted").Inc()
	if !res.Published {
		// The chat bus is down: at least this gateway's watchers get it.
		frame, err := chat.MessageFrame(m.TableID, res.Message)
		if err == nil {
			c.hub.DeliverChat(m.TableID, protocol.TypeChatMessage, frame)
		}
	}
}
