package tournament

import (
	"fmt"
	mrand "math/rand/v2"
	"reflect"
	"testing"
)

func TestRebalanceBalancesFromTheLargestTable(t *testing.T) {
	loads := []TableLoad{{ID: "a", No: 1, Seated: 6, MaxSeats: 6}, {ID: "b", No: 2, Seated: 4, MaxSeats: 6}, {ID: "c", No: 3, Seated: 3, MaxSeats: 6}}
	// One move to the smallest table leaves 5/4/4.
	if p := Rebalance(loads, "a"); p.Break || !reflect.DeepEqual(p.Moves, []string{"c"}) {
		t.Fatalf("plan %+v", p)
	}
	two := []TableLoad{{ID: "a", No: 1, Seated: 6, MaxSeats: 6}, {ID: "b", No: 2, Seated: 1, MaxSeats: 6}}
	if p := Rebalance(two, "a"); !reflect.DeepEqual(p.Moves, []string{"b", "b"}) {
		t.Fatalf("6/1 -> 4/3: %+v", p)
	}
	if p := Rebalance(loads, "b"); len(p.Moves) != 0 {
		t.Fatalf("b is not the largest: %+v", p)
	}
	// Inbound players count towards a table's size.
	loads = []TableLoad{{ID: "a", No: 1, Seated: 5, MaxSeats: 6}, {ID: "b", No: 2, Seated: 2, Inbound: 2, MaxSeats: 6}}
	if p := Rebalance(loads, "a"); len(p.Moves) != 0 {
		t.Fatalf("pending arrivals already balance: %+v", p)
	}
}

func TestRebalanceBreaksTheSmallestTable(t *testing.T) {
	loads := []TableLoad{{ID: "a", No: 1, Seated: 4, MaxSeats: 6}, {ID: "b", No: 2, Seated: 2, MaxSeats: 6}, {ID: "c", No: 3, Seated: 2, Inbound: 1, MaxSeats: 6}}
	// 9 players fit at two 6-max tables: b breaks (fewest; c has an arrival).
	if p := Rebalance(loads, "c"); len(p.Moves) != 0 || p.Break {
		t.Fatalf("c waits for b: %+v", p)
	}
	p := Rebalance(loads, "b")
	if !p.Break || !reflect.DeepEqual(p.Moves, []string{"c", "a"}) {
		t.Fatalf("plan %+v", p)
	}
	// Ties break the highest-numbered table, and inbound transfers are redirected.
	loads = []TableLoad{{ID: "a", No: 1, Seated: 2, MaxSeats: 6}, {ID: "b", No: 2, Seated: 1, Inbound: 1, MaxSeats: 6}}
	p = Rebalance(loads, "b")
	if !p.Break || !reflect.DeepEqual(p.Moves, []string{"a", "a"}) {
		t.Fatalf("plan %+v", p)
	}
	if p := Rebalance([]TableLoad{{ID: "a", No: 1, Seated: 3, MaxSeats: 6}}, "a"); len(p.Moves) != 0 {
		t.Fatalf("a single table never moves players: %+v", p)
	}
}

// Simulates whole tournaments: hands at random tables eliminate random
// players, every table rebalances between its hands, transfers arrive with
// delay. Invariants: capacity is never exceeded, no player is lost, and
// once every table has rebalanced the tournament uses the fewest tables
// with sizes differing by at most one, down to a single final table.
func TestRebalanceSimulation(t *testing.T) {
	for seed := uint64(1); seed <= 400; seed++ {
		r := mrand.New(mrand.NewPCG(seed, seed*31))
		maxSeats := 2 + r.IntN(9)
		n := 2 + r.IntN(99)
		tables := make([]*simTable, TablesNeeded(n, maxSeats))
		for i := range tables {
			tables[i] = &simTable{load: TableLoad{ID: fmt.Sprintf("t%d", i+1), No: i + 1, MaxSeats: maxSeats}}
		}
		players := make([]string, n)
		for i := range players {
			players[i] = fmt.Sprintf("p%d", i)
		}
		slotsList := make([]TableSlot, len(tables))
		for i, tb := range tables {
			slotsList[i] = TableSlot{ID: tb.load.ID, No: tb.load.No, MaxSeats: maxSeats}
		}
		seating, err := InitialSeating(players, slotsList)
		if err != nil {
			t.Fatal(err)
		}
		byID := map[string]*simTable{}
		for _, tb := range tables {
			byID[tb.load.ID] = tb
		}
		for _, a := range seating {
			byID[a.TableID].load.Seated++
		}
		var transit []string // destination per player in transit
		alive := n
		check := func(stage string) {
			total := len(transit)
			for _, tb := range tables {
				if tb.load.Seated+tb.load.Inbound > maxSeats {
					t.Fatalf("seed %d %s: %s over capacity %+v", seed, stage, tb.load.ID, tb.load)
				}
				total += tb.load.Seated
			}
			if total != alive {
				t.Fatalf("seed %d %s: %d players accounted for, %d alive", seed, stage, total, alive)
			}
		}
		settle := func() {
			for round := 0; round < 1000; round++ {
				moved := false
				for _, tb := range tables {
					// Arrivals first (the table claims pending transfers).
					var rest []string
					for _, dst := range transit {
						if dst == tb.load.ID {
							tb.load.Seated++
							tb.load.Inbound--
							moved = true
						} else {
							rest = append(rest, dst)
						}
					}
					transit = rest
					if p := apply(byID, tables, tb, &transit); p {
						moved = true
					}
					check("settle")
				}
				if !moved && len(transit) == 0 {
					return
				}
			}
			t.Fatalf("seed %d: rebalancing did not converge", seed)
		}
		settle()
		assertBalanced(t, seed, tables, alive, maxSeats)
		for steps := 0; alive > 1; steps++ {
			if steps > 10000 {
				t.Fatalf("seed %d: tournament did not finish", seed)
			}
			// A hand finishes at a random active table and eliminates up to
			// all but one of its seated players.
			var active []*simTable
			for _, tb := range tables {
				if tb.load.Seated >= 2 {
					active = append(active, tb)
				}
			}
			if len(active) > 0 {
				tb := active[r.IntN(len(active))]
				bust := r.IntN(tb.load.Seated)
				if r.IntN(3) > 0 {
					bust = min(bust, 1)
				}
				tb.load.Seated -= bust
				alive -= bust
				check("bust")
				apply(byID, tables, tb, &transit)
				check("after hand")
			}
			// Some transfers land, some tables are idle and rebalance.
			if r.IntN(2) == 0 || len(active) == 0 {
				settle()
				assertBalanced(t, seed, tables, alive, maxSeats)
			}
		}
		settle()
		final := 0
		for _, tb := range tables {
			if tb.load.Seated > 0 {
				final++
			}
		}
		if final != 1 {
			t.Fatalf("seed %d: the winner must sit at one table, got %d", seed, final)
		}
	}
}

type simTable struct{ load TableLoad }

// apply runs Rebalance for tb and applies the plan; it reports whether
// anybody moved.
func apply(byID map[string]*simTable, tables []*simTable, tb *simTable, transit *[]string) bool {
	loads := make([]TableLoad, len(tables))
	for i, x := range tables {
		loads[i] = x.load
	}
	p := Rebalance(loads, tb.load.ID)
	if len(p.Moves) == 0 {
		return false
	}
	seatedMoves := p.Moves
	if p.Break {
		seatedMoves = p.Moves[:tb.load.Seated]
		// Redirect transfers already heading here.
		redirect := p.Moves[tb.load.Seated:]
		k := 0
		for i, dst := range *transit {
			if dst == tb.load.ID {
				(*transit)[i] = redirect[k]
				byID[redirect[k]].load.Inbound++
				tb.load.Inbound--
				k++
			}
		}
	}
	for _, dst := range seatedMoves {
		tb.load.Seated--
		byID[dst].load.Inbound++
		*transit = append(*transit, dst)
	}
	return true
}

func assertBalanced(t *testing.T, seed uint64, tables []*simTable, alive, maxSeats int) {
	t.Helper()
	lo, hi, used := alive, 0, 0
	for _, tb := range tables {
		if c := tb.load.Seated; c > 0 {
			used++
			lo, hi = min(lo, c), max(hi, c)
		}
	}
	if used != TablesNeeded(alive, maxSeats) || hi-lo > 1 {
		loads := []TableLoad{}
		for _, tb := range tables {
			loads = append(loads, tb.load)
		}
		t.Fatalf("seed %d: %d alive at %d tables (need %d), sizes %d..%d: %+v", seed, alive, used, TablesNeeded(alive, maxSeats), lo, hi, loads)
	}
}
