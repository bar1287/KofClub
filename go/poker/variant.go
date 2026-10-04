package poker

// noLimit is the bet cap of no-limit games (only the stack limits a bet).
const noLimit int64 = 1<<63 - 1

// GameType selects a rule module. Hand and Table logic (blinds, streets,
// turn order, side pots, settlement) is shared; a rule module decides how
// many hole cards are dealt, how a hand is evaluated and how much may be
// bet (spec §16 M9: "separate rule module sharing generic table
// infrastructure").
type GameType string

// Supported games.
const (
	// GameNLHE is No-Limit Texas Hold'em (the zero value means NLHE).
	GameNLHE GameType = "NLHE"
	// GamePLO is Pot-Limit Omaha: four hole cards, exactly two of them plus
	// exactly three board cards make a hand, bets capped at the pot.
	GamePLO GameType = "PLO"
)

// Valid reports whether g names a supported game ("" counts as NLHE).
func (g GameType) Valid() bool { return g == "" || g == GameNLHE || g == GamePLO }

// HoleCardCount returns the number of hole cards dealt to each player.
func (g GameType) HoleCardCount() int { return rulesFor(g).holeCards() }

type rules interface {
	holeCards() int
	// best returns the hand value and the five cards that make it.
	best(hole, board []Card) (HandValue, []Card)
	// capTo is the largest street commitment ("to" amount) the player at
	// index i may reach by betting or raising, before stack limits.
	capTo(h *Hand, i int) int64
}

func rulesFor(g GameType) rules {
	if g == GamePLO {
		return potLimitOmaha{}
	}
	return noLimitHoldem{}
}

type noLimitHoldem struct{}

func (noLimitHoldem) holeCards() int { return 2 }

func (noLimitHoldem) best(hole, board []Card) (HandValue, []Card) {
	return EvaluateBest(append(append([]Card(nil), hole...), board...))
}

func (noLimitHoldem) capTo(*Hand, int) int64 { return noLimit }

type potLimitOmaha struct{}

func (potLimitOmaha) holeCards() int { return 4 }

func (potLimitOmaha) best(hole, board []Card) (HandValue, []Card) { return EvaluateOmaha(hole, board) }

// capTo implements the pot limit: a raise may add at most the pot as it
// would be after calling, i.e. to = currentBet + (pot + amount to call).
// With no bet this street the maximum bet equals the pot.
func (potLimitOmaha) capTo(h *Hand, i int) int64 {
	p := h.players[i]
	toCall := max(0, h.currentBet-p.streetBet)
	return h.currentBet + h.Pot() + toCall
}
