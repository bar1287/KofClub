//go:build integration

package table_test

import (
	"context"
	"regexp"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/bar1287/kofclub/apps/game-service/internal/table"
	"github.com/bar1287/kofclub/go/poker"
)

var cardValue = regexp.MustCompile(`^[2-9TJQKA][shdc]$`)

// A player action is one trace: the caller's span -> table.command ->
// table.persist (fenced transaction, including the hand settlement's
// ledger.post) and table.broadcast. No span attribute carries a card.
func TestCommandIsTracedEndToEndWithoutCards(t *testing.T) {
	rec := tracetest.NewSpanRecorder()
	prev := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec)))
	t.Cleanup(func() { otel.SetTracerProvider(prev) })

	e := newEnv(t, "alice", "bob")
	a := e.start("node-1", fast)
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 2, 1000)
	waitFor(t, "hand", 5*time.Second, func() bool { s := e.snapshot(a, ""); return s.Hand != nil && s.Hand.ToActSeat != 0 })
	pub := e.snapshot(a, "")
	actor := e.seatUser(pub, pub.Hand.ToActSeat)
	var holeCards []string
	for _, u := range []string{e.users["alice"], e.users["bob"]} {
		for _, c := range e.snapshot(a, u).You.HoleCards {
			holeCards = append(holeCards, c.String())
		}
	}

	ctx, root := otel.Tracer("test").Start(context.Background(), "gateway.ws.command")
	res, err := a.Command(ctx, table.CommandRequest{UserID: actor, CommandID: uuid.NewString(), Kind: string(poker.ActionFold), ReceivedAt: time.Now()})
	root.End()
	if err != nil || !res.Accepted {
		t.Fatalf("fold: %+v %v", res, err)
	}

	traceID := root.SpanContext().TraceID()
	byName := map[string]sdktrace.ReadOnlySpan{}
	for _, s := range rec.Ended() {
		for _, kv := range s.Attributes() {
			for _, v := range attrStrings(kv) {
				if cardValue.MatchString(v) || slices.Contains(holeCards, v) {
					t.Fatalf("span %s attribute %s carries a card value %q", s.Name(), kv.Key, v)
				}
			}
		}
		if s.SpanContext().TraceID() == traceID {
			byName[s.Name()] = s
		}
	}
	for _, name := range []string{"table.command", "table.persist", "table.broadcast", "ledger.post"} {
		if byName[name] == nil {
			t.Fatalf("missing span %s in the command's trace (have %v)", name, keys(byName))
		}
	}
	parentOf := func(name string) string { return byName[name].Parent().SpanID().String() }
	if parentOf("table.command") != root.SpanContext().SpanID().String() {
		t.Fatal("table.command must continue the caller's span")
	}
	if parentOf("table.persist") != byName["table.command"].SpanContext().SpanID().String() ||
		parentOf("table.broadcast") != byName["table.command"].SpanContext().SpanID().String() {
		t.Fatal("persist and broadcast must be children of table.command")
	}
	if parentOf("ledger.post") != byName["table.persist"].SpanContext().SpanID().String() {
		t.Fatal("the hand settlement must be traced inside the fenced transaction")
	}
}

func attrStrings(kv attribute.KeyValue) []string {
	switch kv.Value.Type() {
	case attribute.STRING:
		return []string{kv.Value.AsString()}
	case attribute.STRINGSLICE:
		return kv.Value.AsStringSlice()
	default:
		return nil
	}
}

func keys(m map[string]sdktrace.ReadOnlySpan) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
