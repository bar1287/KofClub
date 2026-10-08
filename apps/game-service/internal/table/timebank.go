package table

import "time"

// timeBanks tracks each seat's time bank (roadmap W1.2): extra thinking
// time that starts only when the turn timer runs out. A player who acts
// within it keeps what is left; one who lets it expire loses all of it and
// the default action is applied. Every hand a player is dealt into adds the
// table's refill, up to the table's bank (the cap). The actor persists
// banks with the seat (table_seats.time_bank_ms) whenever they change, and
// applies a change in memory only once it is committed.
type timeBanks struct {
	full   time.Duration
	refill time.Duration
	left   map[string]time.Duration
}

func newTimeBanks(full, refill time.Duration) *timeBanks {
	return &timeBanks{full: max(full, 0), refill: max(refill, 0), left: map[string]time.Duration{}}
}

// get returns the user's bank (zero when unknown or when the table has none).
func (b *timeBanks) get(user string) time.Duration { return b.left[user] }

// seat gives a newly seated player the full bank.
func (b *timeBanks) seat(user string) { b.left[user] = b.full }

// load restores a persisted bank, capped at the table's bank.
func (b *timeBanks) load(user string, left time.Duration) { b.left[user] = min(max(left, 0), b.full) }

// refilled returns the banks of the given players after one hand's refill,
// without applying them (see set).
func (b *timeBanks) refilled(users []string) map[string]time.Duration {
	out := make(map[string]time.Duration, len(users))
	for _, u := range users {
		out[u] = min(b.left[u]+b.refill, b.full)
	}
	return out
}

// afterSpending returns the user's bank after using the given time of it.
func (b *timeBanks) afterSpending(user string, used time.Duration) time.Duration {
	return max(b.left[user]-max(used, 0), 0)
}

// set applies committed banks.
func (b *timeBanks) set(banks map[string]time.Duration) {
	for u, left := range banks {
		b.left[u] = left
	}
}
