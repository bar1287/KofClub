//go:build integration

package table_test

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/bar1287/kofclub/apps/game-service/internal/history"
	"github.com/bar1287/kofclub/apps/game-service/internal/reseal"
	"github.com/bar1287/kofclub/apps/game-service/internal/sealer"
	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	"github.com/bar1287/kofclub/go/poker"
)

func keyring(t *testing.T, spec string) *sealer.Sealer {
	t.Helper()
	s, err := sealer.NewKeyring(spec)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// Deck-key rotation end to end: hands sealed with the old key resume after a
// failover to a node whose keyring has a new active key, new hands use the
// new key, re-sealing moves finished hands to it, and the old key can then
// be removed without losing any hole cards in history.
func TestDeckKeyRotation(t *testing.T) {
	newKey := func() string {
		k := make([]byte, 32)
		_, _ = rand.Read(k)
		return base64.StdEncoding.EncodeToString(k)
	}
	k1, k2 := newKey(), newKey()
	e := newEnv(t, "alice", "bob")
	e.seal = keyring(t, "1:"+k1)
	a := e.start("node-1", fast)
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 2, 1000)
	waitFor(t, "first hand", 5*time.Second, func() bool { s := e.snapshot(a, ""); return s.Hand != nil && s.Hand.ToActSeat != 0 })
	first := e.snapshot(a, "").Hand.HandID
	e.playHandToEnd(a, passive)
	waitFor(t, "second hand", 5*time.Second, func() bool {
		s := e.snapshot(a, "")
		return s.Hand != nil && s.Hand.HandID != first && s.Hand.ToActSeat != 0
	})
	second := e.snapshot(a, e.users["alice"])
	if _, err := e.actOnce(a, passive); err != nil {
		t.Fatal(err)
	}
	reader := func(s *sealer.Sealer) *history.Reader { return history.NewReader(store.New(e.pool, "reader"), s) }
	firstCards, err := reader(e.seal).OwnHoleCards(e.ctx, first, e.users["alice"])
	if err != nil {
		t.Fatal(err)
	}

	// Rotate: node-2 seals with key 2 and still opens key 1. The hand in
	// progress (sealed with key 1) resumes by replay.
	a.Stop(errors.New("simulated crash"))
	<-a.Done()
	e.exec(`UPDATE table_leases SET expires_at = now() - interval '1 second' WHERE table_id = $1`, e.tableID)
	rotated := keyring(t, fmt.Sprintf("2:%s,1:%s", k2, k1))
	if missing, err := reseal.MissingKeys(e.ctx, e.pool, keyring(t, "2:"+k2)); err != nil || fmt.Sprint(missing) != "[1]" {
		t.Fatalf("a node without key 1 must refuse to start: %v %v", missing, err)
	}
	e.seal = rotated
	b := e.start("node-2", fast)
	resumed := e.snapshot(b, e.users["alice"])
	if resumed.Hand == nil || resumed.Hand.HandID != second.Hand.HandID ||
		poker.CardsString(resumed.You.HoleCards) != poker.CardsString(second.You.HoleCards) {
		t.Fatalf("hand sealed with key 1 did not resume: %+v", resumed.Hand)
	}
	e.playHandToEnd(b, passive)
	waitFor(t, "a hand sealed with key 2", 5*time.Second, func() bool {
		var n int
		_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM hands WHERE table_id = $1 AND seal_key_id = 2`, e.tableID).Scan(&n)
		return n > 0
	})
	b.Stop(nil)
	<-b.Done()

	// Re-seal finished hands with key 2 (in-progress ones are skipped); a
	// second run has nothing left to do.
	res, err := reseal.Run(e.ctx, e.pool, rotated, 1)
	if err != nil || res.Hands < 2 || res.Players != 2*res.Hands {
		t.Fatalf("reseal: %+v %v", res, err)
	}
	if again, err := reseal.Run(e.ctx, e.pool, rotated, 1); err != nil || again.Hands != 0 {
		t.Fatalf("second reseal: %+v %v", again, err)
	}
	usage, err := reseal.KeyUsage(e.ctx, e.pool)
	if err != nil {
		t.Fatal(err)
	}
	var inProgressKey1 int64
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM hands WHERE seal_key_id = 1 AND status = 'IN_PROGRESS'`).Scan(&inProgressKey1)
	if usage[1] != inProgressKey1 || inProgressKey1 != 0 {
		t.Fatalf("key usage after reseal: %v (in progress with key 1: %d)", usage, inProgressKey1)
	}

	// Key 1 retired: history still shows the same cards.
	retired := keyring(t, "2:"+k2)
	got, err := reader(retired).OwnHoleCards(e.ctx, first, e.users["alice"])
	if err != nil || poker.CardsString(got) != poker.CardsString(firstCards) {
		t.Fatalf("hole cards after re-seal: %v %v, want %v", got, err, firstCards)
	}
	// And key 1 no longer opens them.
	if _, err := reader(keyring(t, "1:"+k1)).OwnHoleCards(e.ctx, first, e.users["alice"]); !errors.Is(err, sealer.ErrUnknownKey) {
		t.Fatalf("old key after re-seal: %v", err)
	}
}
