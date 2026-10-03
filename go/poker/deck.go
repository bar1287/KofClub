package poker

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"
)

// NewOrderedDeck returns the 52 cards in canonical order.
func NewOrderedDeck() []Card {
	d := make([]Card, DeckSize)
	for i := range d {
		d[i] = Card(i)
	}
	return d
}

// Shuffle permutes deck in place with the Fisher–Yates algorithm, drawing
// unbiased integers from rng (spec §10). Production callers pass
// crypto/rand.Reader; tests may pass a seeded deterministic reader.
func Shuffle(deck []Card, rng io.Reader) error {
	for i := len(deck) - 1; i > 0; i-- {
		j, err := uniformInt(rng, uint64(i+1))
		if err != nil {
			return err
		}
		deck[i], deck[j] = deck[j], deck[i]
	}
	return nil
}

// NewShuffledDeck returns a freshly shuffled deck.
func NewShuffledDeck(rng io.Reader) ([]Card, error) {
	d := NewOrderedDeck()
	if err := Shuffle(d, rng); err != nil {
		return nil, err
	}
	return d, nil
}

// uniformInt returns a uniformly distributed integer in [0, n) using
// rejection sampling, so no value is favoured by modulo bias.
func uniformInt(rng io.Reader, n uint64) (uint64, error) {
	if n == 0 {
		return 0, errors.New("poker: uniformInt with n=0")
	}
	// Largest multiple of n that fits in uint64; values at or above it are rejected.
	limit := ^uint64(0) - (^uint64(0) % n)
	var buf [8]byte
	for {
		if _, err := io.ReadFull(rng, buf[:]); err != nil {
			return 0, err
		}
		v := binary.BigEndian.Uint64(buf[:])
		if v < limit {
			return v % n, nil
		}
	}
}

// ValidateDeck checks that deck is a permutation of the 52 cards.
func ValidateDeck(deck []Card) error {
	if len(deck) != DeckSize {
		return errors.New("poker: deck must contain 52 cards")
	}
	var seen [DeckSize]bool
	for _, c := range deck {
		if !c.Valid() || seen[c] {
			return errors.New("poker: deck contains invalid or duplicate cards")
		}
		seen[c] = true
	}
	return nil
}

// DeckCommitment returns SHA-256(salt || deck order). Persisting the
// commitment at hand start lets auditors later verify that the revealed deck
// was fixed before the hand began, without exposing it during play.
func DeckCommitment(deck []Card, salt []byte) [32]byte {
	h := sha256.New()
	h.Write(salt)
	for _, c := range deck {
		h.Write([]byte{byte(c)})
	}
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}
