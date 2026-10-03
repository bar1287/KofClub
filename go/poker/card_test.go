package poker

import (
	"crypto/rand"
	"encoding/json"
	"math"
	mrand "math/rand/v2"
	"testing"
)

func TestCardRoundTrip(t *testing.T) {
	for i := 0; i < DeckSize; i++ {
		c := Card(i)
		parsed, err := ParseCard(c.String())
		if err != nil || parsed != c {
			t.Fatalf("round trip %d -> %s -> %d (%v)", i, c, parsed, err)
		}
	}
	if c, _ := ParseCard("As"); c.Rank() != Ace || c.Suit() != Spades {
		t.Fatal("As parsed wrong")
	}
	if c, _ := ParseCard("tD"); c.String() != "Td" {
		t.Fatalf("case-insensitive parse failed: %s", c)
	}
	for _, bad := range []string{"", "A", "1s", "Ax", "Asd"} {
		if _, err := ParseCard(bad); err == nil {
			t.Errorf("expected error for %q", bad)
		}
	}
	b, _ := json.Marshal([]Card{NewCard(Ace, Spades), NewCard(Ten, Hearts)})
	if string(b) != `["As","Th"]` {
		t.Fatalf("json = %s", b)
	}
	var back []Card
	if err := json.Unmarshal(b, &back); err != nil || back[1] != NewCard(Ten, Hearts) {
		t.Fatalf("json decode: %v %v", back, err)
	}
}

func TestShuffleProducesPermutation(t *testing.T) {
	for i := 0; i < 200; i++ {
		d, err := NewShuffledDeck(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		if err := ValidateDeck(d); err != nil {
			t.Fatal(err)
		}
	}
}

func TestShuffleIsDeterministicForSeededSource(t *testing.T) {
	a, _ := NewShuffledDeck(mrand.NewChaCha8([32]byte{1}))
	b, _ := NewShuffledDeck(mrand.NewChaCha8([32]byte{1}))
	c, _ := NewShuffledDeck(mrand.NewChaCha8([32]byte{2}))
	if CardsString(a) != CardsString(b) {
		t.Fatal("same seed must give same order (replay/debugging)")
	}
	if CardsString(a) == CardsString(c) {
		t.Fatal("different seeds should give different orders")
	}
}

// Statistical sanity check (spec §10: not a proof of correctness). Each card
// should land in each position with probability 1/52; a chi-square test over
// position 0 and position 51 catches gross bias such as off-by-one swaps.
func TestShuffleUniformity(t *testing.T) {
	const trials = 104000
	rng := mrand.NewChaCha8([32]byte{42})
	var first, last [DeckSize]int
	d := NewOrderedDeck()
	for i := 0; i < trials; i++ {
		for j := range d {
			d[j] = Card(j)
		}
		if err := Shuffle(d, rng); err != nil {
			t.Fatal(err)
		}
		first[d[0]]++
		last[d[DeckSize-1]]++
	}
	expected := float64(trials) / DeckSize
	for name, counts := range map[string][DeckSize]int{"first": first, "last": last} {
		chi := 0.0
		for _, n := range counts {
			diff := float64(n) - expected
			chi += diff * diff / expected
		}
		// 51 degrees of freedom; p=0.001 critical value ≈ 87.97.
		if chi > 87.97 || math.IsNaN(chi) {
			t.Errorf("%s position chi-square %.1f exceeds critical value", name, chi)
		}
	}
}

func TestUniformIntRejectsBias(t *testing.T) {
	rng := mrand.NewChaCha8([32]byte{7})
	counts := make([]int, 3)
	for i := 0; i < 30000; i++ {
		v, err := uniformInt(rng, 3)
		if err != nil {
			t.Fatal(err)
		}
		counts[v]++
	}
	for _, n := range counts {
		if n < 9500 || n > 10500 {
			t.Fatalf("non-uniform counts %v", counts)
		}
	}
}

func TestDeckCommitmentDependsOnOrderAndSalt(t *testing.T) {
	d := NewOrderedDeck()
	c1 := DeckCommitment(d, []byte("salt"))
	d[0], d[1] = d[1], d[0]
	if c1 == DeckCommitment(d, []byte("salt")) {
		t.Fatal("commitment must change with order")
	}
	if DeckCommitment(d, []byte("a")) == DeckCommitment(d, []byte("b")) {
		t.Fatal("commitment must change with salt")
	}
}

func TestValidateDeckRejectsDuplicates(t *testing.T) {
	d := NewOrderedDeck()
	d[5] = d[6]
	if ValidateDeck(d) == nil {
		t.Fatal("duplicate not detected")
	}
	if ValidateDeck(d[:51]) == nil {
		t.Fatal("short deck not detected")
	}
}
