package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDecodeAcceptsOnlyChatFramesForTheirTable(t *testing.T) {
	table := "0191f2a0-0000-7000-8000-000000000001"
	ok := `{"tableId":"` + table + `","frame":{"type":"CHAT_HIDDEN","tableId":"` + table + `","messageId":"m"}}`
	id, typ, frame, err := Decode([]byte(ok))
	if err != nil || id != table || typ != TypeHidden || string(frame) != `{"type":"CHAT_HIDDEN","tableId":"`+table+`","messageId":"m"}` {
		t.Fatalf("decode: %q %q %s %v", id, typ, frame, err)
	}
	for _, bad := range []string{
		`not json`,
		`{"tableId":"` + table + `","frame":{"type":"TABLE_EVENT","tableId":"` + table + `"}}`,
		`{"tableId":"` + table + `","frame":{"type":"CHAT_MESSAGE","tableId":"other"}}`,
		`{"tableId":"","frame":{"type":"CHAT_MESSAGE","tableId":""}}`,
	} {
		if _, _, _, err := Decode([]byte(bad)); err == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
}

func TestHTTPSenderForwardsAndMapsRejections(t *testing.T) {
	var got SendRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" || r.URL.Path != "/internal/v1/tables/t1/chat" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		if got.Text == "too fast" {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"code":"RATE_LIMITED","message":"slow down","requestId":"r"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"message":{"id":"m1","kind":"MESSAGE"},"published":true}`))
	}))
	defer srv.Close()
	s := NewHTTPSender(srv.URL, "secret")

	res, err := s.Send(context.Background(), "t1", SendRequest{UserID: "u", RequestID: "r", Text: "hi"})
	if err != nil || !res.Published || string(res.Message) != `{"id":"m1","kind":"MESSAGE"}` || got.Text != "hi" || got.UserID != "u" {
		t.Fatalf("send: %+v %v (got %+v)", res, err, got)
	}
	_, err = s.Send(context.Background(), "t1", SendRequest{UserID: "u", RequestID: "r", Text: "too fast"})
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Code != "RATE_LIMITED" || apiErr.Status != http.StatusTooManyRequests {
		t.Fatalf("rejection: %v", err)
	}
	if _, err := NewHTTPSender(srv.URL, "wrong").Send(context.Background(), "t1", SendRequest{}); err == nil || errors.As(err, &apiErr) {
		t.Fatalf("an error without an envelope is not a rejection: %v", err)
	}
}

func TestMessageFrame(t *testing.T) {
	b, err := MessageFrame("t1", json.RawMessage(`{"id":"m1"}`))
	if err != nil || string(b) != `{"type":"CHAT_MESSAGE","tableId":"t1","message":{"id":"m1"}}` {
		t.Fatalf("frame: %s %v", b, err)
	}
}
