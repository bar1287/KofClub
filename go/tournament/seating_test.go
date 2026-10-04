package tournament

import (
	"fmt"
	"testing"
)

func slots(n, maxSeats int) []TableSlot {
	out := make([]TableSlot, n)
	for i := range out {
		out[i] = TableSlot{ID: fmt.Sprintf("t%d", i+1), No: i + 1, MaxSeats: maxSeats}
	}
	return out
}

func TestInitialSeatingIsBalancedAndMinimal(t *testing.T) {
	for maxSeats := 2; maxSeats <= 10; maxSeats++ {
		for n := 2; n <= 100; n++ {
			players := make([]string, n)
			for i := range players {
				players[i] = fmt.Sprintf("p%d", i)
			}
			got, err := InitialSeating(players, slots(TablesNeeded(100, maxSeats), maxSeats))
			if err != nil {
				t.Fatalf("max %d n %d: %v", maxSeats, n, err)
			}
			counts := map[string]int{}
			seats := map[string]bool{}
			seen := map[string]bool{}
			for _, a := range got {
				key := fmt.Sprintf("%s/%d", a.TableID, a.Seat)
				if seats[key] || seen[a.Player] || a.Seat < 1 || a.Seat > maxSeats {
					t.Fatalf("max %d n %d: bad assignment %+v", maxSeats, n, a)
				}
				seats[key], seen[a.Player] = true, true
				counts[a.TableID]++
			}
			if len(seen) != n || len(counts) != TablesNeeded(n, maxSeats) {
				t.Fatalf("max %d n %d: %d players at %d tables", maxSeats, n, len(seen), len(counts))
			}
			lo, hi := n, 0
			for _, c := range counts {
				lo, hi = min(lo, c), max(hi, c)
			}
			if hi-lo > 1 || hi > maxSeats {
				t.Fatalf("max %d n %d: unbalanced %v", maxSeats, n, counts)
			}
		}
	}
	if _, err := InitialSeating([]string{"a"}, slots(1, 6)); err == nil {
		t.Fatal("one player accepted")
	}
	if _, err := InitialSeating([]string{"a", "b", "c"}, slots(1, 2)); err == nil {
		t.Fatal("too few tables accepted")
	}
	if got := SpreadSeat(1, 3, 6); got != 3 {
		t.Fatalf("spread seat %d", got)
	}
}
