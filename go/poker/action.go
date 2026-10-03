package poker

// ActionKind is a player intent.
type ActionKind string

// Action kinds. ALL_IN is a convenience intent resolved by the engine into
// CALL, BET or RAISE for the player's whole stack.
const (
	ActionFold  ActionKind = "FOLD"
	ActionCheck ActionKind = "CHECK"
	ActionCall  ActionKind = "CALL"
	ActionBet   ActionKind = "BET"
	ActionRaise ActionKind = "RAISE"
	ActionAllIn ActionKind = "ALL_IN"
)

// Action is a player intent for the current actor.
type Action struct {
	Seat int
	Kind ActionKind
	// Amount is the "to" amount for BET/RAISE: the player's total
	// commitment in the current betting round after the action. It is
	// ignored for other kinds.
	Amount int64
}

// LegalAction describes one action the current actor may take.
type LegalAction struct {
	Kind ActionKind `json:"kind"`
	// Amount: for CALL the chips that will be added; for ALL_IN the
	// resulting street commitment ("to" amount).
	Amount int64 `json:"amount,omitempty"`
	// MinTo/MaxTo bound the "to" amount for BET and RAISE.
	MinTo int64 `json:"minTo,omitempty"`
	MaxTo int64 `json:"maxTo,omitempty"`
}
