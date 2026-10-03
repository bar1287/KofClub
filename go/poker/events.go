package poker

// PlayerID identifies a player (a user id in practice). The engine treats it
// as opaque.
type PlayerID string

// Street is a betting round or terminal phase of a hand.
type Street string

// Streets/phases of a hand (spec §4.2; blinds are posted inside NewHand and
// settlement happens outside the pure engine).
const (
	StreetPreflop  Street = "PREFLOP"
	StreetFlop     Street = "FLOP"
	StreetTurn     Street = "TURN"
	StreetRiver    Street = "RIVER"
	StreetShowdown Street = "SHOWDOWN"
	StreetComplete Street = "COMPLETE"
)

// Event is a domain event emitted by the engine. Events are produced in
// order and fully describe the hand; replaying them reproduces its history.
type Event interface{ EventKind() string }

// Private events contain information for a single player only.
type Private interface{ PrivateTo() int }

// PlayerStart describes a dealt-in player at hand start.
type PlayerStart struct {
	Seat   int      `json:"seat"`
	Player PlayerID `json:"player"`
	Stack  int64    `json:"stack"`
}

// HandStarted is emitted first.
type HandStarted struct {
	HandNo         int64         `json:"handNo"`
	ButtonSeat     int           `json:"buttonSeat"`
	SmallBlindSeat int           `json:"smallBlindSeat"`
	BigBlindSeat   int           `json:"bigBlindSeat"`
	SmallBlind     int64         `json:"smallBlind"`
	BigBlind       int64         `json:"bigBlind"`
	Players        []PlayerStart `json:"players"`
}

// BlindPosted records a forced bet.
type BlindPosted struct {
	Seat   int    `json:"seat"`
	Blind  string `json:"blind"` // SMALL or BIG
	Amount int64  `json:"amount"`
	AllIn  bool   `json:"allIn"`
	Stack  int64  `json:"stack"`
	Pot    int64  `json:"pot"`
}

// HoleCardsDealt is private to the receiving seat.
type HoleCardsDealt struct {
	Seat   int      `json:"seat"`
	Player PlayerID `json:"player"`
	Cards  [2]Card  `json:"cards"`
}

// PlayerActed records an accepted action.
type PlayerActed struct {
	Seat      int        `json:"seat"`
	Kind      ActionKind `json:"action"`
	Added     int64      `json:"added"`     // chips moved from stack to pot
	StreetBet int64      `json:"streetBet"` // player's commitment this round
	Stack     int64      `json:"stack"`
	AllIn     bool       `json:"allIn"`
	Pot       int64      `json:"pot"`
}

// UncalledBetReturned records chips returned because nobody matched them.
type UncalledBetReturned struct {
	Seat   int   `json:"seat"`
	Amount int64 `json:"amount"`
	Stack  int64 `json:"stack"`
	Pot    int64 `json:"pot"`
}

// StreetDealt records new community cards.
type StreetDealt struct {
	Street Street `json:"street"`
	Cards  []Card `json:"cards"`
	Board  []Card `json:"board"`
}

// CardsRevealed is emitted for every player who reaches showdown.
type CardsRevealed struct {
	Seat        int     `json:"seat"`
	Cards       [2]Card `json:"cards"`
	HandValue   uint32  `json:"handValue"`
	Description string  `json:"description"`
	BestFive    []Card  `json:"bestFive"`
}

// WinnerShare is one winner's share of a pot.
type WinnerShare struct {
	Seat   int   `json:"seat"`
	Amount int64 `json:"amount"`
}

// PotAwarded records the distribution of one pot.
type PotAwarded struct {
	PotIndex    int           `json:"potIndex"` // 0 = main pot
	Amount      int64         `json:"amount"`
	Eligible    []int         `json:"eligibleSeats"`
	Winners     []WinnerShare `json:"winners"`
	Description string        `json:"description"`
}

// SeatResult summarizes one player's hand.
type SeatResult struct {
	Seat          int      `json:"seat"`
	Player        PlayerID `json:"player"`
	StartingStack int64    `json:"startingStack"`
	EndingStack   int64    `json:"endingStack"`
	Contributed   int64    `json:"contributed"`
	Won           int64    `json:"won"`
	Net           int64    `json:"net"`
	Folded        bool     `json:"folded"`
	ShowedDown    bool     `json:"showedDown"`
}

// HandCompleted is emitted last.
type HandCompleted struct {
	HandNo          int64        `json:"handNo"`
	Board           []Card       `json:"board"`
	ShowdownReached bool         `json:"showdownReached"`
	Results         []SeatResult `json:"results"`
}

func (HandStarted) EventKind() string         { return "HAND_STARTED" }
func (BlindPosted) EventKind() string         { return "BLIND_POSTED" }
func (HoleCardsDealt) EventKind() string      { return "HOLE_CARDS_DEALT" }
func (PlayerActed) EventKind() string         { return "PLAYER_ACTED" }
func (UncalledBetReturned) EventKind() string { return "UNCALLED_BET_RETURNED" }
func (StreetDealt) EventKind() string         { return "STREET_DEALT" }
func (CardsRevealed) EventKind() string       { return "CARDS_REVEALED" }
func (PotAwarded) EventKind() string          { return "POT_AWARDED" }
func (HandCompleted) EventKind() string       { return "HAND_COMPLETED" }

// PrivateTo marks hole cards as visible only to their owner.
func (e HoleCardsDealt) PrivateTo() int { return e.Seat }
