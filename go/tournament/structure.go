package tournament

import (
	"errors"
	"time"
)

// MaxBlind is the largest blind a level may reach (mirrors the tables
// directory constraint).
const MaxBlind int64 = 1_000_000_000_000

// levelMultipliers are the level-1 blinds multipliers in halves: x1, x1.5,
// x2, x3, x4, x5, x6, x8, x10, x15, x20, x25, x30, x40, x50, x60, x80, x100,
// x150, x200. Later levels keep doubling.
var levelMultipliers = []int64{2, 3, 4, 6, 8, 10, 12, 16, 20, 30, 40, 50, 60, 80, 100, 120, 160, 200, 300, 400}

// Structure is a tournament's blind schedule: level 1 blinds, a fixed level
// duration and a standard progression.
type Structure struct {
	SmallBlind    int64
	BigBlind      int64
	LevelDuration time.Duration
}

// Level is one blind level (Number starts at 1).
type Level struct {
	Number     int   `json:"level"`
	SmallBlind int64 `json:"smallBlind"`
	BigBlind   int64 `json:"bigBlind"`
}

// Validate checks the structure's parameters.
func (s Structure) Validate() error {
	switch {
	case s.SmallBlind <= 0 || s.BigBlind < 2 || s.SmallBlind > s.BigBlind:
		return errors.New("tournament: level 1 needs 0 < small blind <= big blind and a big blind of at least 2")
	case s.BigBlind > MaxBlind:
		return errors.New("tournament: blinds too large")
	case s.LevelDuration < time.Second:
		return errors.New("tournament: level duration must be at least a second")
	}
	return nil
}

// Level returns level n (1-based). The big blind strictly increases until
// it reaches MaxBlind.
func (s Structure) Level(n int) Level {
	if n < 1 {
		n = 1
	}
	k := n - 1
	if k < len(levelMultipliers) {
		m := levelMultipliers[k]
		return Level{Number: n, SmallBlind: capBlind(s.SmallBlind, m, 2), BigBlind: capBlind(s.BigBlind, m, 2)}
	}
	last := levelMultipliers[len(levelMultipliers)-1]
	sb, bb := capBlind(s.SmallBlind, last, 2), capBlind(s.BigBlind, last, 2)
	for i := len(levelMultipliers); i <= k && bb < MaxBlind; i++ {
		sb, bb = min(sb*2, MaxBlind), min(bb*2, MaxBlind)
	}
	return Level{Number: n, SmallBlind: sb, BigBlind: bb}
}

// capBlind returns base*num/den capped at MaxBlind without overflowing.
func capBlind(base, num, den int64) int64 {
	if base > MaxBlind/num {
		return MaxBlind
	}
	return min(base*num/den, MaxBlind)
}

// LevelAt returns the level in effect after elapsed play time and how long
// until the next level starts.
func (s Structure) LevelAt(elapsed time.Duration) (Level, time.Duration) {
	if elapsed < 0 {
		elapsed = 0
	}
	idx := int(elapsed / s.LevelDuration)
	next := time.Duration(idx+1) * s.LevelDuration
	return s.Level(idx + 1), next - elapsed
}

// Levels returns the first n levels (for display).
func (s Structure) Levels(n int) []Level {
	out := make([]Level, n)
	for i := range out {
		out[i] = s.Level(i + 1)
	}
	return out
}
