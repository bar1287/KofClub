// Package api exposes the game service's internal HTTP API (docs/protocols/
// internal-game-api.md). It is reachable only on the private network and
// requires the shared service token; the edge never routes /internal.
package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/bar1287/kofclub/apps/game-service/internal/history"
	"github.com/bar1287/kofclub/apps/game-service/internal/registry"
	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	"github.com/bar1287/kofclub/apps/game-service/internal/table"
	"github.com/bar1287/kofclub/go/observability"
)

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Server serves the internal API.
type Server struct {
	reg   *registry.Registry
	hist  *history.Reader
	token []byte
	log   *slog.Logger
}

// New creates the internal API server.
func New(reg *registry.Registry, hist *history.Reader, token string, log *slog.Logger) *Server {
	return &Server{reg: reg, hist: hist, token: []byte(token), log: log}
}

// Register mounts the routes on mux.
func (s *Server) Register(mux *http.ServeMux) {
	mux.Handle("POST /internal/v1/tables/{tableId}/seat", s.auth(s.seat))
	mux.Handle("POST /internal/v1/tables/{tableId}/leave", s.auth(s.leave))
	mux.Handle("POST /internal/v1/tables/{tableId}/sitting-out", s.auth(s.sittingOut))
	mux.Handle("POST /internal/v1/tables/{tableId}/top-up", s.auth(s.topUp))
	mux.Handle("PUT /internal/v1/tables/{tableId}/auto-top-up", s.auth(s.autoTopUp))
	mux.Handle("POST /internal/v1/tables/{tableId}/commands", s.auth(s.command))
	mux.Handle("POST /internal/v1/tables/{tableId}/close", s.auth(s.close))
	mux.Handle("GET /internal/v1/tables/{tableId}/snapshot", s.auth(s.snapshot))
	mux.Handle("GET /internal/v1/tables/{tableId}/events", s.auth(s.events))
	mux.Handle("GET /internal/v1/tables/{tableId}/route", s.auth(s.route))
	mux.Handle("GET /internal/v1/tables/{tableId}/stream", s.auth(s.stream))
	mux.Handle("GET /internal/v1/tables", s.auth(s.list))
	mux.Handle("GET /internal/v1/hands/{handId}/hole-cards", s.auth(s.holeCards))
}

func (s *Server) auth(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		token, ok := strings.CutPrefix(header, "Bearer ")
		if !ok || subtle.ConstantTimeCompare([]byte(token), s.token) != 1 {
			writeError(w, r, http.StatusUnauthorized, "AUTH_REQUIRED", "service token required", nil)
			return
		}
		next(w, r)
	})
}

// --- request bodies ---------------------------------------------------------

type seatBody struct {
	UserID    string `json:"userId"`
	SeatNo    int    `json:"seatNo"`
	BuyIn     int64  `json:"buyIn"`
	RequestID string `json:"requestId"`
}

type leaveBody struct {
	UserID    string `json:"userId"`
	RequestID string `json:"requestId"`
}

type topUpBody struct {
	UserID    string `json:"userId"`
	Amount    int64  `json:"amount"`
	RequestID string `json:"requestId"`
}

type autoTopUpBody struct {
	UserID string `json:"userId"`
	To     int64  `json:"to"`
}

type sittingOutBody struct {
	UserID     string `json:"userId"`
	SittingOut bool   `json:"sittingOut"`
}

type commandBody struct {
	UserID      string `json:"userId"`
	CommandID   string `json:"commandId"`
	ExpectedSeq *int64 `json:"expectedSeq"`
	Kind        string `json:"kind"`
	Amount      int64  `json:"amount"`
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_FAILED", "malformed request body", nil)
		return false
	}
	return true
}

func validID(w http.ResponseWriter, r *http.Request, name, v string) bool {
	if !uuidRe.MatchString(v) {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_FAILED", name+" must be a UUID", nil)
		return false
	}
	return true
}

// actor resolves the table actor, mapping registry errors.
func (s *Server) actor(w http.ResponseWriter, r *http.Request) (*table.Actor, bool) {
	id := r.PathValue("tableId")
	if !validID(w, r, "tableId", id) {
		return nil, false
	}
	a, err := s.reg.Get(r.Context(), id)
	if err == nil {
		return a, true
	}
	var notOwner *registry.NotOwnerError
	switch {
	case errors.As(err, &notOwner):
		writeError(w, r, http.StatusServiceUnavailable, "TABLE_UNAVAILABLE", "table is owned by another node",
			map[string]any{"ownerUrl": notOwner.OwnerURL})
	case errors.Is(err, store.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "TABLE_NOT_FOUND", "table not found", nil)
	case errors.Is(err, table.ErrTournamentNotStarted):
		writeError(w, r, http.StatusNotFound, "TABLE_NOT_FOUND", "the tournament has not started", nil)
	case errors.Is(err, registry.ErrDraining):
		writeError(w, r, http.StatusServiceUnavailable, "TABLE_UNAVAILABLE", "node is draining", nil)
	default:
		observability.Logger(r.Context(), s.log).Error("table_activation_failed", slog.String("error", err.Error()))
		writeError(w, r, http.StatusServiceUnavailable, "TABLE_UNAVAILABLE", "table temporarily unavailable", nil)
	}
	return nil, false
}

// --- handlers ---------------------------------------------------------------

func (s *Server) seat(w http.ResponseWriter, r *http.Request) {
	var b seatBody
	if !decode(w, r, &b) || !validID(w, r, "userId", b.UserID) {
		return
	}
	if b.RequestID == "" || len(b.RequestID) > 128 || b.BuyIn <= 0 {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_FAILED", "requestId and positive buyIn are required", nil)
		return
	}
	a, ok := s.actor(w, r)
	if !ok {
		return
	}
	res, err := a.Sit(r.Context(), table.SitRequest{UserID: b.UserID, SeatNo: b.SeatNo, BuyIn: b.BuyIn, RequestID: b.RequestID})
	respond(w, r, http.StatusOK, res, err)
}

func (s *Server) leave(w http.ResponseWriter, r *http.Request) {
	var b leaveBody
	if !decode(w, r, &b) || !validID(w, r, "userId", b.UserID) {
		return
	}
	if b.RequestID == "" || len(b.RequestID) > 128 {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_FAILED", "requestId is required", nil)
		return
	}
	a, ok := s.actor(w, r)
	if !ok {
		return
	}
	res, err := a.Leave(r.Context(), b.UserID, b.RequestID)
	respond(w, r, http.StatusOK, res, err)
}

func (s *Server) topUp(w http.ResponseWriter, r *http.Request) {
	var b topUpBody
	if !decode(w, r, &b) || !validID(w, r, "userId", b.UserID) {
		return
	}
	if b.RequestID == "" || len(b.RequestID) > 128 || b.Amount <= 0 {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_FAILED", "requestId and positive amount are required", nil)
		return
	}
	a, ok := s.actor(w, r)
	if !ok {
		return
	}
	res, err := a.TopUp(r.Context(), table.TopUpRequest{UserID: b.UserID, Amount: b.Amount, RequestID: b.RequestID})
	respond(w, r, http.StatusOK, res, err)
}

func (s *Server) autoTopUp(w http.ResponseWriter, r *http.Request) {
	var b autoTopUpBody
	if !decode(w, r, &b) || !validID(w, r, "userId", b.UserID) {
		return
	}
	if b.To < 0 {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_FAILED", "to must be 0 or positive", nil)
		return
	}
	a, ok := s.actor(w, r)
	if !ok {
		return
	}
	to, err := a.SetAutoTopUp(r.Context(), b.UserID, b.To)
	respond(w, r, http.StatusOK, map[string]any{"autoTopUpTo": to}, err)
}

func (s *Server) sittingOut(w http.ResponseWriter, r *http.Request) {
	var b sittingOutBody
	if !decode(w, r, &b) || !validID(w, r, "userId", b.UserID) {
		return
	}
	a, ok := s.actor(w, r)
	if !ok {
		return
	}
	seq, err := a.SetSittingOut(r.Context(), b.UserID, b.SittingOut)
	respond(w, r, http.StatusOK, map[string]any{"seq": seq, "sittingOut": b.SittingOut}, err)
}

func (s *Server) command(w http.ResponseWriter, r *http.Request) {
	received := time.Now()
	var b commandBody
	if !decode(w, r, &b) || !validID(w, r, "userId", b.UserID) || !validID(w, r, "commandId", b.CommandID) {
		return
	}
	a, ok := s.actor(w, r)
	if !ok {
		return
	}
	res, err := a.Command(r.Context(), table.CommandRequest{
		UserID: b.UserID, CommandID: b.CommandID, ExpectedSeq: b.ExpectedSeq, Kind: b.Kind, Amount: b.Amount, ReceivedAt: received,
	})
	if err != nil {
		var te *table.Error
		if errors.As(err, &te) {
			details := map[string]any{"commandId": b.CommandID, "seq": res.Seq, "duplicate": res.Duplicate}
			for k, v := range te.Details {
				details[k] = v
			}
			writeError(w, r, statusFor(te.Code), te.Code, te.Message, details)
			return
		}
	}
	respond(w, r, http.StatusOK, res, err)
}

func (s *Server) snapshot(w http.ResponseWriter, r *http.Request) {
	viewer := r.URL.Query().Get("viewer")
	if viewer != "" && !validID(w, r, "viewer", viewer) {
		return
	}
	a, ok := s.actor(w, r)
	if !ok {
		return
	}
	snap, err := a.Snapshot(r.Context(), viewer)
	respond(w, r, http.StatusOK, snap, err)
}

// WireEvent is an event rendered for one viewer.
type WireEvent struct {
	Seq        int64           `json:"seq"`
	HandID     string          `json:"handId,omitempty"`
	ServerTime time.Time       `json:"serverTime"`
	Event      json.RawMessage `json:"event"`
}

// RenderEvents renders events for a viewer.
func RenderEvents(events []table.Event, viewer string) []WireEvent {
	out := make([]WireEvent, len(events))
	for i, e := range events {
		out[i] = WireEvent{Seq: e.Seq, HandID: e.HandID, ServerTime: e.Time, Event: e.For(viewer)}
	}
	return out
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	viewer := r.URL.Query().Get("viewer")
	if viewer != "" && !validID(w, r, "viewer", viewer) {
		return
	}
	after, err := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	if err != nil || after < 0 {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_FAILED", "after must be a non-negative integer", nil)
		return
	}
	a, ok := s.actor(w, r)
	if !ok {
		return
	}
	evs, seq, err := a.EventsSince(r.Context(), after)
	respond(w, r, http.StatusOK, map[string]any{"seq": seq, "events": RenderEvents(evs, viewer)}, err)
}

func (s *Server) route(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("tableId")
	if !validID(w, r, "tableId", id) {
		return
	}
	a, err := s.reg.Get(r.Context(), id)
	var notOwner *registry.NotOwnerError
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]any{"tableId": id, "ownerUrl": s.reg.NodeURL(), "epoch": a.Epoch(), "clubId": a.ClubID()})
	case errors.As(err, &notOwner):
		writeJSON(w, http.StatusOK, map[string]any{"tableId": id, "ownerUrl": notOwner.OwnerURL})
	default:
		s.actor(w, r) // reuse error mapping
	}
}

func (s *Server) list(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"tables": s.reg.Tables()})
}

// --- responses ----------------------------------------------------------------

func respond(w http.ResponseWriter, r *http.Request, status int, body any, err error) {
	if err == nil {
		writeJSON(w, status, body)
		return
	}
	var te *table.Error
	if errors.As(err, &te) {
		writeError(w, r, statusFor(te.Code), te.Code, te.Message, te.Details)
		return
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		writeError(w, r, http.StatusServiceUnavailable, "TABLE_UNAVAILABLE", "request timed out", nil)
		return
	}
	writeError(w, r, http.StatusInternalServerError, "INTERNAL", "internal error", nil)
}

func statusFor(code string) int {
	switch code {
	case "VALIDATION_FAILED", "INVALID_BUY_IN", "INVALID_RAISE", "ILLEGAL_ACTION":
		return http.StatusBadRequest
	case "NOT_FOUND", "TABLE_NOT_FOUND":
		return http.StatusNotFound
	case "INSUFFICIENT_CHIPS":
		return http.StatusUnprocessableEntity
	case "TABLE_UNAVAILABLE":
		return http.StatusServiceUnavailable
	case "INTERNAL":
		return http.StatusInternalServerError
	default:
		return http.StatusConflict
	}
}

// close applies a table closure already recorded in the directory: no new
// hands, and every seat is cashed out once no hand is in progress.
func (s *Server) close(w http.ResponseWriter, r *http.Request) {
	a, ok := s.actor(w, r)
	if !ok {
		return
	}
	res, err := a.Close(r.Context())
	respond(w, r, http.StatusOK, res, err)
}

// holeCards returns the requesting participant's own hole cards for a
// finished hand. control-api passes the authenticated user's id; the row is
// selected by (hand, user), so no other player's cards can be returned.
func (s *Server) holeCards(w http.ResponseWriter, r *http.Request) {
	handID, userID := r.PathValue("handId"), r.URL.Query().Get("userId")
	if !validID(w, r, "handId", handID) || !validID(w, r, "userId", userID) {
		return
	}
	cards, err := s.hist.OwnHoleCards(r.Context(), handID, userID)
	switch {
	case errors.Is(err, history.ErrNotAvailable):
		writeError(w, r, http.StatusNotFound, "HAND_NOT_FOUND", "no hole cards for this user and hand", nil)
	case err != nil:
		observability.Logger(r.Context(), s.log).Error("hole_cards_read_failed", slog.String("hand_id", handID), slog.String("error", err.Error()))
		writeError(w, r, http.StatusInternalServerError, "INTERNAL", "could not read hand", nil)
	default:
		writeJSON(w, http.StatusOK, map[string]any{"handId": handID, "userId": userID, "cards": cards})
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, r *http.Request, status int, code, msg string, details map[string]any) {
	body := map[string]any{"code": code, "message": msg, "requestId": observability.RequestID(r.Context())}
	if details != nil {
		body["details"] = details
	}
	writeJSON(w, status, map[string]any{"error": body})
}
