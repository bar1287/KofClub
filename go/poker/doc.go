// Package poker is the pure, deterministic Texas Hold'em domain engine.
//
// It has no dependencies on networking, persistence, time or UI (enforced by
// deps_test.go). Given the same seats, deck order and actions it always
// produces the same state and events, which makes it exhaustively testable
// and replayable. Randomness enters only through the deck passed to NewHand
// (see Shuffle, which must be fed a cryptographically secure source in
// production).
//
// Chip amounts are int64 everywhere. Bet amounts in actions are "to"
// amounts: the player's total commitment for the current betting round
// after the action (see docs/game-engine.md).
package poker
