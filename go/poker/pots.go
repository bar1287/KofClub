package poker

import "sort"

// Contribution is one player's total commitment to the hand.
type Contribution struct {
	Seat   int
	Amount int64
	Folded bool
}

// Pot is a main or side pot with the seats eligible to win it.
type Pot struct {
	Amount   int64 `json:"amount"`
	Eligible []int `json:"eligibleSeats"`
}

// BuildPots derives the main pot and side pots deterministically from
// contribution levels (spec §4.2). A player is eligible for a pot only if
// they did not fold and contributed at least that pot's level, so an all-in
// player can never win more than their contribution covers. Chips of folded
// players are dead money in the pots their contribution reaches.
func BuildPots(contribs []Contribution) []Pot {
	levels := make([]int64, 0, len(contribs))
	seenLevel := map[int64]bool{}
	var total int64
	for _, c := range contribs {
		total += c.Amount
		if !c.Folded && c.Amount > 0 && !seenLevel[c.Amount] {
			seenLevel[c.Amount] = true
			levels = append(levels, c.Amount)
		}
	}
	sort.Slice(levels, func(i, j int) bool { return levels[i] < levels[j] })

	var pots []Pot
	var prev, assigned int64
	for _, level := range levels {
		var amount int64
		var eligible []int
		for _, c := range contribs {
			amount += min(c.Amount, level) - min(c.Amount, prev)
			if !c.Folded && c.Amount >= level {
				eligible = append(eligible, c.Seat)
			}
		}
		sort.Ints(eligible)
		if n := len(pots); n > 0 && equalInts(pots[n-1].Eligible, eligible) {
			pots[n-1].Amount += amount
		} else {
			pots = append(pots, Pot{Amount: amount, Eligible: eligible})
		}
		assigned += amount
		prev = level
	}
	// Folded chips above the highest live level join the last pot.
	if leftover := total - assigned; leftover > 0 && len(pots) > 0 {
		pots[len(pots)-1].Amount += leftover
	}
	return pots
}

// AwardPot splits a pot among the eligible seats holding the best hand.
// Odd chips go one at a time to winners in oddChipOrder (seats clockwise
// starting left of the button).
func AwardPot(pot Pot, values map[int]HandValue, oddChipOrder []int) []WinnerShare {
	var best HandValue
	var winners []int
	for _, seat := range pot.Eligible {
		v, ok := values[seat]
		if !ok {
			continue
		}
		switch {
		case len(winners) == 0 || v > best:
			best, winners = v, []int{seat}
		case v == best:
			winners = append(winners, seat)
		}
	}
	if len(winners) == 0 {
		return nil
	}
	ordered := orderSeats(winners, oddChipOrder)
	share := pot.Amount / int64(len(ordered))
	remainder := pot.Amount % int64(len(ordered))
	out := make([]WinnerShare, len(ordered))
	for i, seat := range ordered {
		out[i] = WinnerShare{Seat: seat, Amount: share}
		if int64(i) < remainder {
			out[i].Amount++
		}
	}
	return out
}

func orderSeats(seats []int, order []int) []int {
	pos := make(map[int]int, len(order))
	for i, s := range order {
		pos[s] = i
	}
	out := append([]int(nil), seats...)
	sort.Slice(out, func(i, j int) bool { return pos[out[i]] < pos[out[j]] })
	return out
}

func equalInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
