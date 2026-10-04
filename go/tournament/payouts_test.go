package tournament

import (
	"reflect"
	"testing"
)

func TestPayoutSharesAndPrizes(t *testing.T) {
	for n := 1; n <= 300; n++ {
		shares := PayoutShares(n)
		var sum int64
		for i, s := range shares {
			sum += s
			if s <= 0 || (i > 0 && s > shares[i-1]) {
				t.Fatalf("%d entrants: shares must be positive and non-increasing: %v", n, shares)
			}
		}
		if sum != 10000 || len(shares) > max(n, 1) {
			t.Fatalf("%d entrants: shares %v", n, shares)
		}
		for _, pool := range []int64{0, 1, 7, 999, 1500 * int64(n), 100_000_000_000_000} {
			prizes := Prizes(n, pool)
			var total int64
			for i, p := range prizes {
				total += p
				if p < 0 || (i > 0 && p > prizes[i-1]) {
					t.Fatalf("%d entrants pool %d: prizes %v", n, pool, prizes)
				}
			}
			if total != pool {
				t.Fatalf("%d entrants pool %d: prizes sum to %d", n, pool, total)
			}
		}
	}
	if got := Prizes(9, 9000); !reflect.DeepEqual(got, []int64{4500, 2700, 1800}) {
		t.Fatalf("9 entrants: %v", got)
	}
	if got := Prizes(2, 1001); !reflect.DeepEqual(got, []int64{1001}) {
		t.Fatalf("heads-up: %v", got)
	}
	if got := Prizes(5, 1001); !reflect.DeepEqual(got, []int64{651, 350}) {
		t.Fatalf("remainder goes to first: %v", got)
	}
}

func TestEliminationPlacesAndTies(t *testing.T) {
	got := EliminationPlaces(5, []Bust{{"a", 100}, {"b", 100}, {"c", 50}})
	if want := map[string]int{"c": 5, "a": 3, "b": 3}; !reflect.DeepEqual(got, want) {
		t.Fatalf("places %v, want %v", got, want)
	}
	got = EliminationPlaces(2, []Bust{{"x", 10}})
	if got["x"] != 2 {
		t.Fatalf("heads-up bust: %v", got)
	}
	got = EliminationPlaces(4, []Bust{{"p", 30}, {"q", 20}, {"r", 10}})
	if want := map[string]int{"p": 2, "q": 3, "r": 4}; !reflect.DeepEqual(got, want) {
		t.Fatalf("ordered by stack: %v", got)
	}
}

func TestAwardSplitsTiedPlaces(t *testing.T) {
	prizes := []int64{500, 300, 200}
	got := Award(prizes, []Placement{{"w", 1}, {"b", 2}, {"a", 2}, {"z", 4}})
	// a and b share places 2 and 3: (300 + 200) / 2 each.
	if want := map[string]int64{"w": 500, "a": 250, "b": 250, "z": 0}; !reflect.DeepEqual(got, want) {
		t.Fatalf("awards %v, want %v", got, want)
	}
	got = Award([]int64{701, 300}, []Placement{{"b", 1}, {"a", 1}, {"c", 3}})
	// 1001 split two ways: 501 to "a" (first in order), 500 to "b".
	if want := map[string]int64{"a": 501, "b": 500, "c": 0}; !reflect.DeepEqual(got, want) {
		t.Fatalf("awards %v, want %v", got, want)
	}
	// A tie across the last paid place takes only the paid part.
	got = Award([]int64{600, 400}, []Placement{{"w", 1}, {"x", 2}, {"y", 2}, {"z", 2}})
	if got["x"]+got["y"]+got["z"] != 400 || got["w"] != 600 {
		t.Fatalf("awards %v", got)
	}
}
