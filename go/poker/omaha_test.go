package poker

import (
	mrand "math/rand/v2"
	"testing"
)

func TestEvaluateOmahaUsesExactlyTwoHoleAndThreeBoardCards(t *testing.T) {
	cases := []struct {
		name, hole, board string
		cat               Category
		desc              string
	}{
		// A royal flush on the board plays for nobody: two hole cards must be used.
		{"board royal", "2c 3d 4h 7c", "As Ks Qs Js Ts", HighCard, "High Card, Ace"},
		// Four of a suit on the board and one suited hole card is no flush.
		{"one suited hole card", "Ah Kc 7d 2c", "Qh 9h 5h 3h Ts", HighCard, "High Card, Ace"},
		{"two suited hole cards", "Ah 2h 7d 8c", "Qh 9h 5h 3s Ts", Flush, "Flush, Ace high"},
		// Quads on the board: only one of the four can play.
		{"board quads", "Kc Kd 2s 3s", "9c 9d 9h 9s 4d", FullHouse, "Full House, Nines full of Kings"},
		// Board trips plus a hole pair make a full house.
		{"board trips", "Ac Ad 7s 2h", "Qc Qd Qh 5s 4d", FullHouse, "Full House, Queens full of Aces"},
		// Three of a kind in the hand cannot all play.
		{"hole trips", "Ac Ad Ah 2s", "Kd 9c 7s 5h 3d", OnePair, "Pair of Aces"},
		{"wheel", "Ah 2d Kc Kd", "3s 4h 5c Jd Qs", Straight, "Straight, Five high"},
	}
	for _, tc := range cases {
		v, best := EvaluateOmaha(MustParseCards(tc.hole), MustParseCards(tc.board))
		if v.Category() != tc.cat || v.Describe() != tc.desc {
			t.Errorf("%s: got %v / %q, want %v / %q", tc.name, v.Category(), v.Describe(), tc.cat, tc.desc)
		}
		if len(best) != 5 || Evaluate(best) != v {
			t.Errorf("%s: best five %s does not reproduce the value", tc.name, CardsString(best))
		}
	}
}

// Reference check: on random deals the evaluator equals the maximum over
// every 2-of-hole x 3-of-board combination (reference 5-card evaluator), and
// the reported five cards are such a combination.
func TestEvaluateOmahaMatchesReference(t *testing.T) {
	rng := mrand.NewChaCha8([32]byte{4})
	n := 20000
	if testing.Short() {
		n = 3000
	}
	for i := 0; i < n; i++ {
		deck, _ := NewShuffledDeck(rng)
		hole, board := deck[:4], deck[4:9]
		var want HandValue
		for a := 0; a < 4; a++ {
			for b := a + 1; b < 4; b++ {
				for x := 0; x < 5; x++ {
					for y := x + 1; y < 5; y++ {
						for z := y + 1; z < 5; z++ {
							if v := naiveEvaluate5([]Card{hole[a], hole[b], board[x], board[y], board[z]}); v > want {
								want = v
							}
						}
					}
				}
			}
		}
		got, best := EvaluateOmaha(hole, board)
		if got != want {
			t.Fatalf("%s | %s: got %s want %s", CardsString(hole), CardsString(board), got.Describe(), want.Describe())
		}
		fromHole, fromBoard := 0, 0
		for _, c := range best {
			fromHole += countOf(c, hole)
			fromBoard += countOf(c, board)
		}
		if len(best) != 5 || fromHole != 2 || fromBoard != 3 || Evaluate(best) != got {
			t.Fatalf("%s | %s: best five %s must use 2 hole + 3 board cards", CardsString(hole), CardsString(board), CardsString(best))
		}
	}
}

func countOf(c Card, cards []Card) int {
	n := 0
	for _, x := range cards {
		if x == c {
			n++
		}
	}
	return n
}
