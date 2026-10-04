package poker

import "sort"

// TableConfig holds the fixed parameters of a cash table.
type TableConfig struct {
	// Game selects the rule module ("" = NLHE).
	Game       GameType
	MaxSeats   int
	SmallBlind int64
	BigBlind   int64
}

// TablePhase is the table-level lifecycle state (spec §4.2).
type TablePhase string

// Table phases. A hand's own streets are reported by Hand.Street.
const (
	PhaseWaitingForPlayers TablePhase = "WAITING_FOR_PLAYERS"
	PhaseHandInProgress    TablePhase = "HAND_IN_PROGRESS"
	PhaseHandComplete      TablePhase = "HAND_COMPLETE"
)

// SeatState is a seated player at the table level.
type SeatState struct {
	Seat       int      `json:"seat"`
	Player     PlayerID `json:"player"`
	Stack      int64    `json:"stack"`
	SittingOut bool     `json:"sittingOut"`
}

// Table manages seats, the dealer button and hand sequencing. Like Hand it
// is pure and single-threaded; the table actor owns one instance.
//
// Simplified rules (documented in docs/game-engine.md): the button moves to
// the next dealt-in seat each hand (no dead button), and players who sit
// down are dealt into the next hand without posting a missed blind.
type Table struct {
	cfg    TableConfig
	seats  map[int]*SeatState
	button int // seat number of the last button, 0 before the first hand
	handNo int64
	hand   *Hand
	phase  TablePhase
}

// NewTable validates cfg and returns an empty table.
func NewTable(cfg TableConfig) (*Table, error) {
	if cfg.MaxSeats < 2 || cfg.MaxSeats > 10 {
		return nil, errorf(CodeInvalidConfig, "max seats must be between 2 and 10")
	}
	if cfg.SmallBlind <= 0 || cfg.BigBlind <= 0 || cfg.SmallBlind > cfg.BigBlind {
		return nil, errorf(CodeInvalidConfig, "blinds must be positive with small <= big")
	}
	if !cfg.Game.Valid() {
		return nil, errorf(CodeInvalidConfig, "unsupported game %q", cfg.Game)
	}
	return &Table{cfg: cfg, seats: map[int]*SeatState{}, phase: PhaseWaitingForPlayers}, nil
}

// RestoreTable rebuilds a table from durable state (used on actor recovery).
func RestoreTable(cfg TableConfig, seats []SeatState, lastButton int, lastHandNo int64) (*Table, error) {
	t, err := NewTable(cfg)
	if err != nil {
		return nil, err
	}
	for _, s := range seats {
		if err := t.SitDown(s.Seat, s.Player, s.Stack); err != nil {
			return nil, err
		}
		t.seats[s.Seat].SittingOut = s.SittingOut
	}
	t.button, t.handNo = lastButton, lastHandNo
	return t, nil
}

// Config returns the table configuration.
func (t *Table) Config() TableConfig { return t.cfg }

// Phase returns the table phase.
func (t *Table) Phase() TablePhase { return t.phase }

// HandNo returns the number of the most recent hand.
func (t *Table) HandNo() int64 { return t.handNo }

// ButtonSeat returns the current/last button seat (0 before the first hand).
func (t *Table) ButtonSeat() int { return t.button }

// Hand returns the hand in progress (or the just-completed hand), if any.
func (t *Table) Hand() *Hand { return t.hand }

// Seats returns the occupied seats ordered by seat number.
func (t *Table) Seats() []SeatState {
	out := make([]SeatState, 0, len(t.seats))
	for _, s := range t.seats {
		out = append(out, *s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Seat < out[j].Seat })
	return out
}

// SeatOf returns the seat number occupied by player, or 0.
func (t *Table) SeatOf(player PlayerID) int {
	for _, s := range t.seats {
		if s.Player == player {
			return s.Seat
		}
	}
	return 0
}

// FreeSeats lists empty seat numbers.
func (t *Table) FreeSeats() []int {
	var out []int
	for n := 1; n <= t.cfg.MaxSeats; n++ {
		if _, ok := t.seats[n]; !ok {
			out = append(out, n)
		}
	}
	return out
}

// SitDown seats a player. Players may sit down during a hand; they are
// dealt into the next one.
func (t *Table) SitDown(seat int, player PlayerID, stack int64) error {
	switch {
	case seat < 1 || seat > t.cfg.MaxSeats:
		return errorf(CodeInvalidConfig, "seat %d does not exist", seat)
	case player == "":
		return errorf(CodeInvalidConfig, "player required")
	case stack <= 0:
		return errorf(CodeInvalidConfig, "stack must be positive")
	case t.SeatOf(player) != 0:
		return errorf(CodeAlreadySeated, "player already seated")
	}
	if _, taken := t.seats[seat]; taken {
		return errorf(CodeSeatTaken, "seat %d is taken", seat)
	}
	t.seats[seat] = &SeatState{Seat: seat, Player: player, Stack: stack}
	return nil
}

// InHand reports whether the seat is dealt into the hand in progress.
func (t *Table) InHand(seat int) bool {
	if t.hand == nil || t.hand.IsComplete() {
		return false
	}
	return t.hand.index(seat) >= 0
}

// StandUp removes a player and returns their stack. It fails while the
// seat is part of the hand in progress (the actor folds/waits first).
func (t *Table) StandUp(seat int) (int64, error) {
	s, ok := t.seats[seat]
	if !ok {
		return 0, errorf(CodePlayerNotInHand, "seat %d is empty", seat)
	}
	if t.InHand(seat) {
		return 0, errorf(CodeIllegalAction, "seat %d is in the current hand", seat)
	}
	delete(t.seats, seat)
	return s.Stack, nil
}

// SetSittingOut toggles whether a seat is dealt into future hands.
func (t *Table) SetSittingOut(seat int, out bool) error {
	s, ok := t.seats[seat]
	if !ok {
		return errorf(CodePlayerNotInHand, "seat %d is empty", seat)
	}
	s.SittingOut = out
	return nil
}

// AddChips tops up a seat between hands (re-buy).
func (t *Table) AddChips(seat int, amount int64) error {
	s, ok := t.seats[seat]
	if !ok {
		return errorf(CodePlayerNotInHand, "seat %d is empty", seat)
	}
	if amount <= 0 || t.InHand(seat) {
		return errorf(CodeIllegalAction, "cannot add chips now")
	}
	s.Stack += amount
	return nil
}

// eligibleSeats returns seats that will be dealt in, ordered by seat.
func (t *Table) eligibleSeats() []int {
	var out []int
	for _, s := range t.Seats() {
		if !s.SittingOut && s.Stack > 0 {
			out = append(out, s.Seat)
		}
	}
	return out
}

// CanStartHand reports whether a new hand can begin.
func (t *Table) CanStartHand() bool {
	return (t.hand == nil || t.hand.IsComplete()) && len(t.eligibleSeats()) >= 2
}

// nextButton returns the first eligible seat clockwise after the previous
// button (or the lowest eligible seat for the first hand).
func (t *Table) nextButton(eligible []int) int {
	for _, s := range eligible {
		if s > t.button {
			return s
		}
	}
	return eligible[0]
}

// StartHand moves the button and starts the next hand with deck.
func (t *Table) StartHand(deck []Card) (*Hand, []Event, error) {
	if t.hand != nil && !t.hand.IsComplete() {
		return nil, nil, errorf(CodeIllegalAction, "a hand is already in progress")
	}
	eligible := t.eligibleSeats()
	if len(eligible) < 2 {
		return nil, nil, errorf(CodeIllegalAction, "need at least two players")
	}
	button := t.nextButton(eligible)
	setup := make([]SeatSetup, len(eligible))
	for i, seat := range eligible {
		s := t.seats[seat]
		setup[i] = SeatSetup{Seat: seat, Player: s.Player, Stack: s.Stack}
	}
	hand, events, err := NewHand(HandConfig{
		Game: t.cfg.Game, HandNo: t.handNo + 1, SmallBlind: t.cfg.SmallBlind, BigBlind: t.cfg.BigBlind,
		ButtonSeat: button, Seats: setup, Deck: deck,
	})
	if err != nil {
		return nil, nil, err
	}
	t.handNo++
	t.button = button
	t.hand = hand
	t.phase = PhaseHandInProgress
	t.syncStacks()
	if hand.IsComplete() {
		t.phase = PhaseHandComplete
	}
	return hand, events, nil
}

// Act applies an action to the hand in progress and keeps seat stacks in
// sync with the hand.
func (t *Table) Act(a Action) ([]Event, error) {
	if t.hand == nil || t.hand.IsComplete() {
		return nil, errorf(CodeHandNotActive, "no hand in progress")
	}
	events, err := t.hand.Act(a)
	if err != nil {
		return nil, err
	}
	t.syncStacks()
	if t.hand.IsComplete() {
		t.phase = PhaseHandComplete
	}
	return events, nil
}

// syncStacks mirrors the hand's stacks onto the seats of dealt-in players.
func (t *Table) syncStacks() {
	for _, p := range t.hand.players {
		if s, ok := t.seats[p.seat]; ok && s.Player == p.player {
			s.Stack = p.stack
		}
	}
}

// FinishHand acknowledges a completed hand (after settlement) and returns
// the table to waiting state. Busted players stay seated with zero chips
// until they leave or re-buy.
func (t *Table) FinishHand() {
	if t.hand != nil && t.hand.IsComplete() {
		t.phase = PhaseWaitingForPlayers
	}
}

// AbortHand discards an unfinished hand and restores every dealt-in
// player's stack to its value at hand start. Used when a hand cannot be
// completed safely (e.g. the authoritative node lost ownership): no chips
// are created or destroyed.
func (t *Table) AbortHand() {
	if t.hand == nil || t.hand.IsComplete() {
		return
	}
	for _, p := range t.hand.players {
		if s, ok := t.seats[p.seat]; ok && s.Player == p.player {
			s.Stack = p.startingStack
		}
	}
	t.hand = nil
	t.phase = PhaseWaitingForPlayers
}

// Clone returns a deep copy. The actor applies commands to a clone and only
// swaps it in after the resulting events were persisted, so a failed write
// never leaves in-memory state ahead of the database.
func (t *Table) Clone() *Table {
	c := *t
	c.seats = make(map[int]*SeatState, len(t.seats))
	for k, v := range t.seats {
		cp := *v
		c.seats[k] = &cp
	}
	if t.hand != nil {
		c.hand = t.hand.Clone()
	}
	return &c
}

// ResumeHand attaches a hand rebuilt from durable state (hand config +
// replayed actions) to a restored table. Every player in the hand must be
// seated at the same seat.
func (t *Table) ResumeHand(h *Hand) error {
	if t.hand != nil && !t.hand.IsComplete() {
		return errorf(CodeIllegalAction, "a hand is already in progress")
	}
	for _, p := range h.players {
		s, ok := t.seats[p.seat]
		if !ok || s.Player != p.player {
			return errorf(CodeInvalidConfig, "hand player %s is not seated at seat %d", p.player, p.seat)
		}
	}
	t.hand = h
	t.handNo = h.HandNo()
	t.button = h.ButtonSeat()
	t.phase = PhaseHandInProgress
	t.syncStacks()
	if h.IsComplete() {
		t.phase = PhaseHandComplete
	}
	return nil
}

// SeatState returns a copy of one seat's state.
func (t *Table) SeatState(seat int) (SeatState, bool) {
	s, ok := t.seats[seat]
	if !ok {
		return SeatState{}, false
	}
	return *s, true
}
