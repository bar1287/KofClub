package poker

import (
	"fmt"
	"math/bits"
	"sort"
)

// Category is a poker hand category, ordered from weakest to strongest.
type Category uint8

// Hand categories.
const (
	HighCard Category = iota
	OnePair
	TwoPair
	ThreeOfAKind
	Straight
	Flush
	FullHouse
	FourOfAKind
	StraightFlush
)

var categoryNames = [...]string{
	"High Card", "Pair", "Two Pair", "Three of a Kind", "Straight",
	"Flush", "Full House", "Four of a Kind", "Straight Flush",
}

func (c Category) String() string {
	if int(c) < len(categoryNames) {
		return categoryNames[c]
	}
	return "Unknown"
}

// HandValue is a totally ordered hand strength: a higher value always beats
// a lower one and equal values tie. Layout: category<<20 | five 4-bit ranks
// (group ranks first, then kickers, high to low).
type HandValue uint32

// Category extracts the hand category.
func (v HandValue) Category() Category { return Category(v >> 20) }

func (v HandValue) rankAt(i int) Rank { return Rank((v >> (16 - 4*i)) & 0xF) }

func makeValue(cat Category, ranks ...Rank) HandValue {
	v := HandValue(cat) << 20
	for i, r := range ranks {
		if i >= 5 {
			break
		}
		v |= HandValue(r) << (16 - 4*i)
	}
	return v
}

var rankNames = map[Rank]string{
	Two: "Twos", Three: "Threes", Four: "Fours", Five: "Fives", Six: "Sixes", Seven: "Sevens",
	Eight: "Eights", Nine: "Nines", Ten: "Tens", Jack: "Jacks", Queen: "Queens", King: "Kings", Ace: "Aces",
}

var rankSingular = map[Rank]string{
	Two: "Two", Three: "Three", Four: "Four", Five: "Five", Six: "Six", Seven: "Seven",
	Eight: "Eight", Nine: "Nine", Ten: "Ten", Jack: "Jack", Queen: "Queen", King: "King", Ace: "Ace",
}

// Describe renders a human-readable description, e.g. "Two Pair, Kings and Sevens".
func (v HandValue) Describe() string {
	r0, r1 := v.rankAt(0), v.rankAt(1)
	switch v.Category() {
	case StraightFlush:
		if r0 == Ace {
			return "Royal Flush"
		}
		return fmt.Sprintf("Straight Flush, %s high", rankSingular[r0])
	case FourOfAKind:
		return fmt.Sprintf("Four of a Kind, %s", rankNames[r0])
	case FullHouse:
		return fmt.Sprintf("Full House, %s full of %s", rankNames[r0], rankNames[r1])
	case Flush:
		return fmt.Sprintf("Flush, %s high", rankSingular[r0])
	case Straight:
		return fmt.Sprintf("Straight, %s high", rankSingular[r0])
	case ThreeOfAKind:
		return fmt.Sprintf("Three of a Kind, %s", rankNames[r0])
	case TwoPair:
		return fmt.Sprintf("Two Pair, %s and %s", rankNames[r0], rankNames[r1])
	case OnePair:
		return fmt.Sprintf("Pair of %s", rankNames[r0])
	default:
		return fmt.Sprintf("High Card, %s", rankSingular[r0])
	}
}

// straightHigh returns the high rank of the best straight in mask (bit r set
// for rank r), or 0 when there is none. The wheel (A-2-3-4-5) is 5-high.
func straightHigh(mask uint16) Rank {
	if mask&(1<<Ace) != 0 {
		mask |= 1 << 1 // ace also plays low
	}
	for hi := Ace; hi >= Five; hi-- {
		need := uint16(0x1F) << (hi - 4)
		if mask&need == need {
			return hi
		}
	}
	return 0
}

// topRanks returns up to n ranks set in mask, high to low.
func topRanks(mask uint16, n int) []Rank {
	out := make([]Rank, 0, n)
	for r := Ace; r >= Two && len(out) < n; r-- {
		if mask&(1<<r) != 0 {
			out = append(out, r)
		}
	}
	return out
}

// Evaluate returns the value of the best five-card hand from 5–7 cards.
func Evaluate(cards []Card) HandValue {
	v, _ := evaluate(cards)
	return v
}

// evaluate also reports the flush suit (when relevant) for best-five selection.
func evaluate(cards []Card) (HandValue, Suit) {
	if len(cards) < 5 || len(cards) > 7 {
		panic(fmt.Sprintf("poker: Evaluate needs 5-7 cards, got %d", len(cards)))
	}
	var counts [Ace + 1]uint8
	var suitMask [4]uint16
	var rankMask uint16
	for _, c := range cards {
		r, s := c.Rank(), c.Suit()
		counts[r]++
		suitMask[s] |= 1 << r
		rankMask |= 1 << r
	}

	// With at most 7 cards a flush cannot coexist with quads or a full house,
	// so checking flushes first is correct.
	for s := Clubs; s <= Spades; s++ {
		if bits.OnesCount16(suitMask[s]) >= 5 {
			if hi := straightHigh(suitMask[s]); hi != 0 {
				return makeValue(StraightFlush, hi), s
			}
			return makeValue(Flush, topRanks(suitMask[s], 5)...), s
		}
	}

	var quads, trips, pairs []Rank
	for r := Ace; r >= Two; r-- {
		switch counts[r] {
		case 4:
			quads = append(quads, r)
		case 3:
			trips = append(trips, r)
		case 2:
			pairs = append(pairs, r)
		}
	}
	without := func(exclude ...Rank) uint16 {
		m := rankMask
		for _, r := range exclude {
			m &^= 1 << r
		}
		return m
	}

	switch {
	case len(quads) > 0:
		return makeValue(FourOfAKind, quads[0], topRanks(without(quads[0]), 1)[0]), 0
	case len(trips) > 0 && (len(trips) > 1 || len(pairs) > 0):
		pair := Rank(0)
		if len(trips) > 1 {
			pair = trips[1]
		}
		if len(pairs) > 0 && pairs[0] > pair {
			pair = pairs[0]
		}
		return makeValue(FullHouse, trips[0], pair), 0
	}
	if hi := straightHigh(rankMask); hi != 0 {
		return makeValue(Straight, hi), 0
	}
	switch {
	case len(trips) > 0:
		return makeValue(ThreeOfAKind, append([]Rank{trips[0]}, topRanks(without(trips[0]), 2)...)...), 0
	case len(pairs) >= 2:
		return makeValue(TwoPair, pairs[0], pairs[1], topRanks(without(pairs[0], pairs[1]), 1)[0]), 0
	case len(pairs) == 1:
		return makeValue(OnePair, append([]Rank{pairs[0]}, topRanks(without(pairs[0]), 3)...)...), 0
	default:
		return makeValue(HighCard, topRanks(rankMask, 5)...), 0
	}
}

// EvaluateBest returns the hand value and the five cards that make it
// (ordered by importance), for showdown display and hand history.
func EvaluateBest(cards []Card) (HandValue, []Card) {
	v, flushSuit := evaluate(cards)
	// Prefer higher suits when several cards of a rank qualify (deterministic).
	sorted := append([]Card(nil), cards...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] > sorted[j] })
	used := make(map[Card]bool, 5)
	best := make([]Card, 0, 5)
	take := func(r Rank, n int, suit *Suit) {
		for _, c := range sorted {
			if len(best) == 5 || n == 0 {
				return
			}
			if c.Rank() == r && !used[c] && (suit == nil || c.Suit() == *suit) {
				used[c] = true
				best = append(best, c)
				n--
			}
		}
	}
	straightRanks := func(hi Rank) []Rank {
		if hi == Five {
			return []Rank{Five, Four, Three, Two, Ace}
		}
		return []Rank{hi, hi - 1, hi - 2, hi - 3, hi - 4}
	}

	switch v.Category() {
	case StraightFlush:
		for _, r := range straightRanks(v.rankAt(0)) {
			take(r, 1, &flushSuit)
		}
	case Flush:
		for i := 0; i < 5; i++ {
			take(v.rankAt(i), 1, &flushSuit)
		}
	case Straight:
		for _, r := range straightRanks(v.rankAt(0)) {
			take(r, 1, nil)
		}
	case FourOfAKind:
		take(v.rankAt(0), 4, nil)
		take(v.rankAt(1), 1, nil)
	case FullHouse:
		take(v.rankAt(0), 3, nil)
		take(v.rankAt(1), 2, nil)
	case ThreeOfAKind:
		take(v.rankAt(0), 3, nil)
		take(v.rankAt(1), 1, nil)
		take(v.rankAt(2), 1, nil)
	case TwoPair:
		take(v.rankAt(0), 2, nil)
		take(v.rankAt(1), 2, nil)
		take(v.rankAt(2), 1, nil)
	case OnePair:
		take(v.rankAt(0), 2, nil)
		for i := 1; i < 4; i++ {
			take(v.rankAt(i), 1, nil)
		}
	default:
		for i := 0; i < 5; i++ {
			take(v.rankAt(i), 1, nil)
		}
	}
	return v, best
}
