package tournament

import "sort"

// payoutTable maps field sizes to prize shares in basis points (1/100 %).
// Every row sums to 10,000; the fixed structure pays roughly the top 15%.
var payoutTable = []struct {
	maxEntrants int
	shares      []int64
}{
	{3, []int64{10000}},
	{6, []int64{6500, 3500}},
	{10, []int64{5000, 3000, 2000}},
	{20, []int64{4000, 2500, 1600, 1100, 800}},
	{35, []int64{3200, 2000, 1400, 1000, 800, 650, 550, 400}},
	{1 << 30, []int64{2700, 1700, 1200, 900, 750, 600, 500, 400, 350, 300, 300, 300}},
}

// PayoutShares returns the prize shares (basis points) for a field size.
func PayoutShares(entrants int) []int64 {
	for _, row := range payoutTable {
		if entrants <= row.maxEntrants {
			paid := min(len(row.shares), max(entrants, 1))
			out := append([]int64(nil), row.shares[:paid]...)
			// Fewer entrants than paid places (cannot happen with the table
			// above, kept for safety): the unpaid shares go to first place.
			var sum int64
			for _, s := range out {
				sum += s
			}
			out[0] += 10000 - sum
			return out
		}
	}
	return []int64{10000}
}

// Prizes splits pool by place: each place gets floor(pool*share/10000) and
// the rounding remainder goes to first place, so the prizes sum to pool
// exactly. pool must not exceed 10^14 (int64-safe arithmetic).
func Prizes(entrants int, pool int64) []int64 {
	shares := PayoutShares(entrants)
	out := make([]int64, len(shares))
	var paid int64
	for i, s := range shares {
		out[i] = pool * s / 10000
		paid += out[i]
	}
	out[0] += pool - paid
	return out
}

// Bust is a player eliminated in a hand, with their stack at the start of
// that hand.
type Bust struct {
	Player        string
	StartingStack int64
}

// EliminationPlaces assigns finishing places to the players eliminated in
// one hand. remaining is the number of players still in the tournament
// before these eliminations (so the busted players take places
// remaining-len(busted)+1 .. remaining). A larger stack at the start of the
// hand finishes higher; players with equal stacks share the better place
// (TDA rule; they later split the prizes of the places they span).
func EliminationPlaces(remaining int, busted []Bust) map[string]int {
	sorted := append([]Bust(nil), busted...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].StartingStack > sorted[j].StartingStack })
	out := make(map[string]int, len(sorted))
	first := remaining - len(sorted) + 1 // best place among the busted
	for i := 0; i < len(sorted); {
		j := i
		for j < len(sorted) && sorted[j].StartingStack == sorted[i].StartingStack {
			j++
		}
		for k := i; k < j; k++ {
			out[sorted[k].Player] = first + i
		}
		i = j
	}
	return out
}

// Placement is a player's finishing place.
type Placement struct {
	Player string
	Place  int
}

// Award distributes prizes (prizes[0] = 1st place) to finishing places.
// Players sharing a place split the prizes of every place their group spans
// equally; leftover chips go one each to the group's players in ascending
// player order. The awards sum to the paid prizes exactly.
func Award(prizes []int64, placements []Placement) map[string]int64 {
	groups := map[int][]string{}
	for _, p := range placements {
		groups[p.Place] = append(groups[p.Place], p.Player)
	}
	out := make(map[string]int64, len(placements))
	for place, players := range groups {
		sort.Strings(players)
		var total int64
		for i := place; i < place+len(players); i++ {
			if i >= 1 && i <= len(prizes) {
				total += prizes[i-1]
			}
		}
		share, rem := total/int64(len(players)), total%int64(len(players))
		for i, p := range players {
			out[p] = share
			if int64(i) < rem {
				out[p]++
			}
		}
	}
	return out
}
