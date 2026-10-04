package tournament

import (
	"errors"
	"sort"
)

// TableSlot is a tournament table available for seating.
type TableSlot struct {
	ID       string
	No       int
	MaxSeats int
}

// Assignment places a player at a table seat.
type Assignment struct {
	Player  string
	TableID string
	Seat    int
}

// TablesNeeded is the fewest tables that seat n players.
func TablesNeeded(players, maxSeats int) int {
	if players <= 0 {
		return 0
	}
	return (players + maxSeats - 1) / maxSeats
}

// InitialSeating seats players (in the given, already randomized order) at
// the fewest tables that fit them, dealing them round-robin so table sizes
// differ by at most one. Seats are spread around each table. Tables are used
// in table-number order.
func InitialSeating(players []string, tables []TableSlot) ([]Assignment, error) {
	if len(players) < 2 {
		return nil, errors.New("tournament: at least two players are required")
	}
	if len(tables) == 0 {
		return nil, errors.New("tournament: no tables")
	}
	slots := append([]TableSlot(nil), tables...)
	sort.Slice(slots, func(i, j int) bool { return slots[i].No < slots[j].No })
	maxSeats := slots[0].MaxSeats
	for _, t := range slots {
		if t.MaxSeats != maxSeats || maxSeats < 2 {
			return nil, errors.New("tournament: tables must share a seat count of at least two")
		}
	}
	need := TablesNeeded(len(players), maxSeats)
	if need > len(slots) {
		return nil, errors.New("tournament: not enough tables")
	}
	byTable := make([][]string, need)
	for i, p := range players {
		byTable[i%need] = append(byTable[i%need], p)
	}
	var out []Assignment
	for t, ps := range byTable {
		for j, p := range ps {
			out = append(out, Assignment{Player: p, TableID: slots[t].ID, Seat: SpreadSeat(j, len(ps), maxSeats)})
		}
	}
	return out, nil
}

// SpreadSeat is the seat of the j-th of k players spread evenly around a
// table with maxSeats seats (1-based).
func SpreadSeat(j, k, maxSeats int) int {
	return 1 + j*maxSeats/k
}
