// Package history serves hand-history data that only the game plane can
// produce: a participant's own hole cards, which are encrypted at rest with
// a key that never leaves the game service (ADR-008).
package history

import (
	"context"
	"errors"

	"github.com/bar1287/kofclub/apps/game-service/internal/sealer"
	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	"github.com/bar1287/kofclub/go/poker"
)

// ErrNotAvailable means the hand is unknown, still in progress, or the user
// was not dealt into it.
var ErrNotAvailable = errors.New("history: hole cards not available")

// Reader decrypts hole cards for finished hands.
type Reader struct {
	store  *store.Store
	sealer *sealer.Sealer
}

// NewReader creates a Reader.
func NewReader(s *store.Store, seal *sealer.Sealer) *Reader {
	return &Reader{store: s, sealer: seal}
}

// OwnHoleCards returns the hole cards userID was dealt in handID, only once
// the hand is finished (COMPLETED or VOIDED). Callers must have verified
// that userID is the authenticated requester: this never returns anyone
// else's cards because the row is selected by (hand, user).
func (r *Reader) OwnHoleCards(ctx context.Context, handID, userID string) ([]poker.Card, error) {
	h, err := r.store.SealedHoleCards(ctx, handID, userID)
	if errors.Is(err, store.ErrNotFound) {
		return nil, ErrNotAvailable
	}
	if err != nil {
		return nil, err
	}
	if h.Status != "COMPLETED" && h.Status != "VOIDED" {
		return nil, ErrNotAvailable
	}
	plain, err := r.sealer.Open(h.HoleCardsEnc, "hole:"+handID+":"+userID)
	if err != nil {
		return nil, err
	}
	// Two cards in Hold'em, four in Omaha.
	if game := poker.GameType(h.GameType); !game.Valid() || len(plain) != game.HoleCardCount() {
		return nil, errors.New("history: corrupt hole cards")
	}
	cards := make([]poker.Card, len(plain))
	for i, b := range plain {
		if cards[i] = poker.Card(b); !cards[i].Valid() {
			return nil, errors.New("history: corrupt hole cards")
		}
	}
	return cards, nil
}
