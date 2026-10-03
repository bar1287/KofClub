package poker

import (
	mrand "math/rand/v2"
	"os"
	"sort"
	"testing"
)

func TestEvaluateKnownVectors(t *testing.T) {
	cases := []struct {
		cards string
		cat   Category
		desc  string
	}{
		{"As Ks Qs Js Ts 2c 3d", StraightFlush, "Royal Flush"},
		{"5h 4h 3h 2h Ah Kd Kc", StraightFlush, "Straight Flush, Five high"},
		{"9c 9d 9h 9s Ad 2c 3c", FourOfAKind, "Four of a Kind, Nines"},
		{"Kc Kd Kh 7s 7d 2c 3c", FullHouse, "Full House, Kings full of Sevens"},
		{"Kc Kd Kh 7s 7d 7c 3c", FullHouse, "Full House, Kings full of Sevens"},
		{"2c 9c Jc Qc Kc Ah Ad", Flush, "Flush, King high"},
		{"Ah 2d 3c 4s 5h Kd Qc", Straight, "Straight, Five high"},
		{"Th Jd Qc Ks Ah 2d 3c", Straight, "Straight, Ace high"},
		{"7h 7d 7c As Kd 2c 3h", ThreeOfAKind, "Three of a Kind, Sevens"},
		{"Kh Kd 7c 7s 3d 3c Ah", TwoPair, "Two Pair, Kings and Sevens"},
		{"Ah Ad 9c 7s 5d 3c 2h", OnePair, "Pair of Aces"},
		{"Ah Kd 9c 7s 5d 3c 2h", HighCard, "High Card, Ace"},
	}
	for _, tc := range cases {
		v := Evaluate(MustParseCards(tc.cards))
		if v.Category() != tc.cat || v.Describe() != tc.desc {
			t.Errorf("%s: got %v / %q, want %v / %q", tc.cards, v.Category(), v.Describe(), tc.cat, tc.desc)
		}
	}
}

func TestEvaluateOrdering(t *testing.T) {
	// Each hand must beat the next one.
	ordered := []string{
		"As Ks Qs Js Ts",
		"Ks Qs Js Ts 9s",
		"6d 5d 4d 3d 2d",
		"5c 4c 3c 2c Ac",
		"Ah Ad Ac As Kd",
		"Ah Ad Ac As Qd",
		"2h 2d 2c 2s Ad",
		"Ah Ad Ac Kd Ks",
		"Kh Kd Kc Ad As",
		"Ah Kh Qh Jh 9h",
		"Ah Kh Qh Jh 8h",
		"Th Jd Qc Ks Ah",
		"6h 5d 4c 3s 2h",
		"5h 4d 3c 2s Ah",
		"Ah Ad Ac Kd Qs",
		"Ah Ad Kc Kd Qs",
		"Ah Ad Kc Kd Js",
		"Ah Ad Qc Qd Ks",
		"Ah Ad Kc Qd Js",
		"Kh Kd Ac Qd Js",
		"Ah Kd Qc Jd 9s",
		"Ah Kd Qc Jd 8s",
		"7h 5d 4c 3d 2s",
	}
	for i := 0; i+1 < len(ordered); i++ {
		a, b := Evaluate(MustParseCards(ordered[i])), Evaluate(MustParseCards(ordered[i+1]))
		if a <= b {
			t.Errorf("%q (%s) should beat %q (%s)", ordered[i], a.Describe(), ordered[i+1], b.Describe())
		}
	}
	// Ties: board plays / suits irrelevant.
	if Evaluate(MustParseCards("Ah Kd Qc Jd 9s")) != Evaluate(MustParseCards("Ad Kh Qs Jc 9d")) {
		t.Error("identical ranks must tie")
	}
	board := "Ts Js Qd Kc Ad"
	if Evaluate(MustParseCards(board+" 2c 3d")) != Evaluate(MustParseCards(board+" 4h 5h")) {
		t.Error("board straight should split")
	}
}

// Exhaustive enumeration of all C(52,5) = 2,598,960 five-card hands checks
// the evaluator against the known category frequencies and the known number
// of distinct hand ranks (7,462).
func TestEvaluateExhaustiveFiveCard(t *testing.T) {
	want := map[Category]int{
		StraightFlush: 40, FourOfAKind: 624, FullHouse: 3744, Flush: 5108, Straight: 10200,
		ThreeOfAKind: 54912, TwoPair: 123552, OnePair: 1098240, HighCard: 1302540,
	}
	got := map[Category]int{}
	distinct := map[HandValue]struct{}{}
	hand := make([]Card, 5)
	for a := 0; a < 52; a++ {
		for b := a + 1; b < 52; b++ {
			for c := b + 1; c < 52; c++ {
				for d := c + 1; d < 52; d++ {
					for e := d + 1; e < 52; e++ {
						hand[0], hand[1], hand[2], hand[3], hand[4] = Card(a), Card(b), Card(c), Card(d), Card(e)
						v := Evaluate(hand)
						got[v.Category()]++
						distinct[v] = struct{}{}
					}
				}
			}
		}
	}
	for cat, n := range want {
		if got[cat] != n {
			t.Errorf("%s: got %d want %d", cat, got[cat], n)
		}
	}
	if len(distinct) != 7462 {
		t.Errorf("distinct hand values = %d, want 7462", len(distinct))
	}
}

// naiveEvaluate5 is an independent, sort-based reference evaluator.
func naiveEvaluate5(cards []Card) HandValue {
	ranks := make([]int, 5)
	flush := true
	for i, c := range cards {
		ranks[i] = int(c.Rank())
		if c.Suit() != cards[0].Suit() {
			flush = false
		}
	}
	sort.Sort(sort.Reverse(sort.IntSlice(ranks)))
	counts := map[int]int{}
	for _, r := range ranks {
		counts[r]++
	}
	type group struct{ rank, n int }
	var groups []group
	for r, n := range counts {
		groups = append(groups, group{r, n})
	}
	sort.Slice(groups, func(i, j int) bool {
		if groups[i].n != groups[j].n {
			return groups[i].n > groups[j].n
		}
		return groups[i].rank > groups[j].rank
	})
	straight, hi := false, 0
	if len(groups) == 5 {
		if ranks[0]-ranks[4] == 4 {
			straight, hi = true, ranks[0]
		} else if ranks[0] == 14 && ranks[1] == 5 {
			straight, hi = true, 5
		}
	}
	rs := func() []Rank {
		out := []Rank{}
		for _, g := range groups {
			out = append(out, Rank(g.rank))
		}
		return out
	}
	switch {
	case straight && flush:
		return makeValue(StraightFlush, Rank(hi))
	case groups[0].n == 4:
		return makeValue(FourOfAKind, rs()...)
	case groups[0].n == 3 && groups[1].n == 2:
		return makeValue(FullHouse, rs()...)
	case flush:
		return makeValue(Flush, rs()...)
	case straight:
		return makeValue(Straight, Rank(hi))
	case groups[0].n == 3:
		return makeValue(ThreeOfAKind, rs()...)
	case groups[0].n == 2 && groups[1].n == 2:
		return makeValue(TwoPair, rs()...)
	case groups[0].n == 2:
		return makeValue(OnePair, rs()...)
	default:
		return makeValue(HighCard, rs()...)
	}
}

func bestOfSubsets(cards []Card) HandValue {
	var best HandValue
	n := len(cards)
	sub := make([]Card, 5)
	var rec func(start, depth int)
	rec = func(start, depth int) {
		if depth == 5 {
			if v := naiveEvaluate5(sub); v > best {
				best = v
			}
			return
		}
		for i := start; i < n; i++ {
			sub[depth] = cards[i]
			rec(i+1, depth+1)
		}
	}
	rec(0, 0)
	return best
}

func TestEvaluateMatchesReferenceOnRandomSevenCardHands(t *testing.T) {
	rng := mrand.NewChaCha8([32]byte{9})
	n := 200000
	if testing.Short() {
		n = 20000
	}
	for i := 0; i < n; i++ {
		deck, _ := NewShuffledDeck(rng)
		size := 5 + i%3
		cards := deck[:size]
		got := Evaluate(cards)
		if want := bestOfSubsets(cards); got != want {
			t.Fatalf("%s: got %s (%x) want %s (%x)", CardsString(cards), got.Describe(), got, want.Describe(), want)
		}
		v, best := EvaluateBest(cards)
		if len(best) != 5 || Evaluate(best) != v {
			t.Fatalf("%s: best five %s does not reproduce %s", CardsString(cards), CardsString(best), v.Describe())
		}
		seen := map[Card]bool{}
		for _, c := range best {
			found := false
			for _, x := range cards {
				found = found || x == c
			}
			if !found || seen[c] {
				t.Fatalf("best five %s not a subset of %s", CardsString(best), CardsString(cards))
			}
			seen[c] = true
		}
	}
}

// Full C(52,7) enumeration (133,784,560 hands). Slow; run with
// POKER_EXHAUSTIVE=1 go test -run SevenCard ./go/poker.
func TestEvaluateExhaustiveSevenCard(t *testing.T) {
	if os.Getenv("POKER_EXHAUSTIVE") != "1" {
		t.Skip("set POKER_EXHAUSTIVE=1 to enumerate all 7-card hands")
	}
	want := map[Category]int{
		StraightFlush: 41584, FourOfAKind: 224848, FullHouse: 3473184, Flush: 4047644, Straight: 6180020,
		ThreeOfAKind: 6461620, TwoPair: 31433400, OnePair: 58627800, HighCard: 23294460,
	}
	got := map[Category]int{}
	h := make([]Card, 7)
	for a := 0; a < 52; a++ {
		for b := a + 1; b < 52; b++ {
			for c := b + 1; c < 52; c++ {
				for d := c + 1; d < 52; d++ {
					for e := d + 1; e < 52; e++ {
						for f := e + 1; f < 52; f++ {
							for g := f + 1; g < 52; g++ {
								h[0], h[1], h[2], h[3], h[4], h[5], h[6] = Card(a), Card(b), Card(c), Card(d), Card(e), Card(f), Card(g)
								got[Evaluate(h).Category()]++
							}
						}
					}
				}
			}
		}
	}
	for cat, n := range want {
		if got[cat] != n {
			t.Errorf("%s: got %d want %d", cat, got[cat], n)
		}
	}
}

func BenchmarkEvaluate7(b *testing.B) {
	cards := MustParseCards("As Kd 9c 7s 5d 3c 2h")
	for i := 0; i < b.N; i++ {
		Evaluate(cards)
	}
}
