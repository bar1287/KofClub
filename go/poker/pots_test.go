package poker

import (
	"reflect"
	"testing"
)

func TestBuildPotsSimple(t *testing.T) {
	pots := BuildPots([]Contribution{{1, 100, false}, {2, 100, false}, {3, 100, true}})
	want := []Pot{{Amount: 300, Eligible: []int{1, 2}}}
	if !reflect.DeepEqual(pots, want) {
		t.Fatalf("got %+v", pots)
	}
}

func TestBuildPotsMultipleAllIns(t *testing.T) {
	// Seat 1 all-in 50, seat 2 all-in 120, seats 3 and 4 put in 300, seat 5 folded after 30.
	pots := BuildPots([]Contribution{
		{1, 50, false}, {2, 120, false}, {3, 300, false}, {4, 300, false}, {5, 30, true},
	})
	want := []Pot{
		{Amount: 50*4 + 30, Eligible: []int{1, 2, 3, 4}},
		{Amount: 70 * 3, Eligible: []int{2, 3, 4}},
		{Amount: 180 * 2, Eligible: []int{3, 4}},
	}
	if !reflect.DeepEqual(pots, want) {
		t.Fatalf("got %+v want %+v", pots, want)
	}
	var sum int64
	for _, p := range pots {
		sum += p.Amount
	}
	if sum != 50+120+300+300+30 {
		t.Fatalf("pots do not conserve chips: %d", sum)
	}
}

func TestBuildPotsFoldedDeadMoneyAboveLiveLevels(t *testing.T) {
	pots := BuildPots([]Contribution{{1, 500, true}, {2, 200, false}, {3, 200, false}})
	want := []Pot{{Amount: 900, Eligible: []int{2, 3}}}
	if !reflect.DeepEqual(pots, want) {
		t.Fatalf("got %+v", pots)
	}
}

func TestAwardPotSplitWithOddChip(t *testing.T) {
	pot := Pot{Amount: 101, Eligible: []int{2, 5, 7}}
	tie := Evaluate(MustParseCards("As Ks Qd Jc 9h"))
	values := map[int]HandValue{2: tie, 5: tie, 7: Evaluate(MustParseCards("2c 3d 4h 5s 7c"))}
	// Button on seat 3: order left of button is 5, 7, 2.
	shares := AwardPot(pot, values, []int{5, 7, 2})
	want := []WinnerShare{{Seat: 5, Amount: 51}, {Seat: 2, Amount: 50}}
	if !reflect.DeepEqual(shares, want) {
		t.Fatalf("got %+v", shares)
	}
}

func TestAwardPotIgnoresIneligibleBetterHands(t *testing.T) {
	pot := Pot{Amount: 60, Eligible: []int{2, 3}}
	values := map[int]HandValue{
		1: Evaluate(MustParseCards("As Ad Ac Ah Ks")), // not eligible (all-in for less)
		2: Evaluate(MustParseCards("2s 2d 5c 7h 9s")),
		3: Evaluate(MustParseCards("3s 3d 5c 7h 9s")),
	}
	shares := AwardPot(pot, values, []int{1, 2, 3})
	if len(shares) != 1 || shares[0] != (WinnerShare{Seat: 3, Amount: 60}) {
		t.Fatalf("got %+v", shares)
	}
}
