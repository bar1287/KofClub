// Package tournament holds the pure rules of virtual-chip tournaments
// (spec §16 M10): the blind schedule, the payout structure, finishing places
// (including ties), initial seating and table balancing/breaking.
//
// Like go/poker it has no infrastructure dependencies and never reads the
// clock: callers pass elapsed time, entrant lists and table loads in and act
// on the decisions that come out (the game service persists and applies
// them). See ADR-016 and docs/tournaments.md.
package tournament
