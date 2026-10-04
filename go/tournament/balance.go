package tournament

import "sort"

// TableLoad is a tournament table's current population: seated players and
// players already on their way to it (pending transfers).
type TableLoad struct {
	ID       string
	No       int
	Seated   int
	Inbound  int
	MaxSeats int
}

func (t TableLoad) count() int { return t.Seated + t.Inbound }

// Plan is what a table must do between hands to keep the tournament
// balanced.
type Plan struct {
	// Break is set when the table closes: every seated player moves and
	// every pending transfer to it is redirected.
	Break bool
	// Moves lists one destination table per player leaving the table. When
	// Break is set, the first Seated entries are for seated players and the
	// rest redirect the pending inbound transfers.
	Moves []string
}

// Rebalance decides, for the table `from` that is between hands, which
// players must leave it (spec §16 M10, TDA-style):
//
//  1. Breaking: when fewer tables would seat everyone, the active table with
//     the fewest players (ties: the highest table number) breaks. If that is
//     `from`, all its players move; otherwise `from` waits for that table.
//  2. Balancing: otherwise `from` gives players to the smallest other table
//     until it has at most one player more than it.
//
// Players always go to the active table with the fewest players (ties: the
// lowest table number) that has room. Only tables between hands lose
// players, so a decision never interrupts a hand; tables gain players at any
// time (they are dealt in from the next hand).
func Rebalance(tables []TableLoad, from string) Plan {
	var active []TableLoad
	var self *TableLoad
	total, maxSeats := 0, 0
	for _, t := range tables {
		if t.count() == 0 {
			continue
		}
		active = append(active, t)
		total += t.count()
		maxSeats = max(maxSeats, t.MaxSeats)
	}
	for i := range active {
		if active[i].ID == from {
			self = &active[i]
		}
	}
	if self == nil || len(active) < 2 {
		return Plan{}
	}
	counts := map[string]int{}
	for _, t := range active {
		counts[t.ID] = t.count()
	}
	// Destinations: fewest players first, then lowest table number.
	pick := func(exclude string) string {
		cands := make([]TableLoad, 0, len(active))
		for _, t := range active {
			if t.ID != from && t.ID != exclude && counts[t.ID] < t.MaxSeats {
				cands = append(cands, t)
			}
		}
		if len(cands) == 0 {
			return ""
		}
		sort.Slice(cands, func(i, j int) bool {
			ci, cj := counts[cands[i].ID], counts[cands[j].ID]
			if ci != cj {
				return ci < cj
			}
			return cands[i].No < cands[j].No
		})
		return cands[0].ID
	}

	if len(active) > TablesNeeded(total, maxSeats) {
		breaking := active[0]
		for _, t := range active[1:] {
			if t.count() < breaking.count() || (t.count() == breaking.count() && t.No > breaking.No) {
				breaking = t
			}
		}
		if breaking.ID != from {
			return Plan{}
		}
		plan := Plan{Break: true}
		for i := 0; i < self.count(); i++ {
			dest := pick("")
			if dest == "" {
				return Plan{} // cannot happen: the others have room by construction
			}
			counts[dest]++
			plan.Moves = append(plan.Moves, dest)
		}
		return plan
	}

	var plan Plan
	for moved := 0; moved < self.Seated; moved++ {
		dest := pick("")
		if dest == "" || counts[from]-counts[dest] < 2 {
			break
		}
		counts[from]--
		counts[dest]++
		plan.Moves = append(plan.Moves, dest)
	}
	return plan
}
