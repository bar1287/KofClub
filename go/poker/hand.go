package poker

import (
	"sort"
)

// SeatSetup is a player dealt into a hand.
type SeatSetup struct {
	Seat   int // 1-based seat number
	Player PlayerID
	Stack  int64
}

// HandConfig fully determines a hand together with the actions applied to it.
type HandConfig struct {
	HandNo     int64
	SmallBlind int64
	BigBlind   int64
	ButtonSeat int
	Seats      []SeatSetup
	// Deck is the complete 52-card order, fixed before the hand begins.
	Deck []Card
}

type handPlayer struct {
	seat          int
	player        PlayerID
	startingStack int64
	stack         int64
	streetBet     int64 // committed in the current betting round
	contributed   int64 // committed in the whole hand
	hole          [2]Card
	folded        bool
	allIn         bool
	acted         bool  // acted in the current betting round
	actedAtBet    int64 // current bet level right after this player's last action
	won           int64
	showedDown    bool
}

// Hand is one Texas Hold'em hand. It is not safe for concurrent use; the
// table actor serializes access (spec §4.1).
type Hand struct {
	cfg        HandConfig
	players    []*handPlayer // sorted by seat
	button     int           // index into players
	sb, bb     int
	deck       []Card
	deckPos    int
	board      []Card
	street     Street
	currentBet int64
	minRaise   int64 // size of the last full bet/raise (at least the big blind)
	toAct      int   // index of the player to act, -1 when nobody
	lastAggr   int   // index of the last full bettor/raiser in the current round, -1 if none
	showdown   bool
	results    []SeatResult
}

// NewHand validates cfg, posts blinds, deals hole cards and returns the
// hand ready for the first action, together with the events produced.
func NewHand(cfg HandConfig) (*Hand, []Event, error) {
	if err := validateConfig(cfg); err != nil {
		return nil, nil, err
	}
	h := &Hand{cfg: cfg, deck: append([]Card(nil), cfg.Deck...), street: StreetPreflop, toAct: -1, lastAggr: -1}
	seats := append([]SeatSetup(nil), cfg.Seats...)
	sort.Slice(seats, func(i, j int) bool { return seats[i].Seat < seats[j].Seat })
	for i, s := range seats {
		h.players = append(h.players, &handPlayer{seat: s.Seat, player: s.Player, startingStack: s.Stack, stack: s.Stack})
		if s.Seat == cfg.ButtonSeat {
			h.button = i
		}
	}
	n := len(h.players)
	if n == 2 {
		// Heads-up: the button posts the small blind and acts first preflop.
		h.sb, h.bb = h.button, (h.button+1)%n
	} else {
		h.sb = (h.button + 1) % n
		h.bb = (h.button + 2) % n
	}

	starts := make([]PlayerStart, n)
	for i, p := range h.players {
		starts[i] = PlayerStart{Seat: p.seat, Player: p.player, Stack: p.stack}
	}
	events := []Event{HandStarted{
		HandNo: cfg.HandNo, ButtonSeat: cfg.ButtonSeat,
		SmallBlindSeat: h.players[h.sb].seat, BigBlindSeat: h.players[h.bb].seat,
		SmallBlind: cfg.SmallBlind, BigBlind: cfg.BigBlind, Players: starts,
	}}
	events = append(events, h.postBlind(h.sb, "SMALL", cfg.SmallBlind))
	events = append(events, h.postBlind(h.bb, "BIG", cfg.BigBlind))
	// The amount to call is the full big blind even if the big blind is short.
	h.currentBet = cfg.BigBlind
	h.minRaise = cfg.BigBlind

	// Deal two rounds of one card, starting left of the button (the small
	// blind in ring games; the big blind heads-up).
	first := (h.button + 1) % n
	for round := 0; round < 2; round++ {
		for k := 0; k < n; k++ {
			p := h.players[(first+k)%n]
			p.hole[round] = h.draw()
		}
	}
	for k := 0; k < n; k++ {
		p := h.players[(first+k)%n]
		events = append(events, HoleCardsDealt{Seat: p.seat, Player: p.player, Cards: p.hole})
	}

	// Preflop the first actor is left of the big blind (the button heads-up).
	h.toAct = h.nextToAct((h.bb + 1) % n)
	events = append(events, h.progress()...)
	return h, events, nil
}

func validateConfig(cfg HandConfig) error {
	if cfg.SmallBlind <= 0 || cfg.BigBlind <= 0 || cfg.SmallBlind > cfg.BigBlind {
		return errorf(CodeInvalidConfig, "blinds must be positive with small <= big")
	}
	if len(cfg.Seats) < 2 {
		return errorf(CodeInvalidConfig, "at least two players are required")
	}
	if len(cfg.Seats)*2+8 > DeckSize {
		return errorf(CodeInvalidConfig, "too many players")
	}
	seen := map[int]bool{}
	players := map[PlayerID]bool{}
	button := false
	for _, s := range cfg.Seats {
		if s.Seat <= 0 || seen[s.Seat] {
			return errorf(CodeInvalidConfig, "invalid or duplicate seat %d", s.Seat)
		}
		if s.Player == "" || players[s.Player] {
			return errorf(CodeInvalidConfig, "invalid or duplicate player at seat %d", s.Seat)
		}
		if s.Stack <= 0 {
			return errorf(CodeInvalidConfig, "seat %d has no chips", s.Seat)
		}
		seen[s.Seat], players[s.Player] = true, true
		button = button || s.Seat == cfg.ButtonSeat
	}
	if !button {
		return errorf(CodeInvalidConfig, "button seat %d is not dealt in", cfg.ButtonSeat)
	}
	if err := ValidateDeck(cfg.Deck); err != nil {
		return errorf(CodeInvalidConfig, "%v", err)
	}
	return nil
}

func (h *Hand) draw() Card {
	c := h.deck[h.deckPos]
	h.deckPos++
	return c
}

func (h *Hand) postBlind(i int, kind string, amount int64) Event {
	p := h.players[i]
	posted := min(amount, p.stack)
	h.commit(p, posted)
	return BlindPosted{Seat: p.seat, Blind: kind, Amount: posted, AllIn: p.allIn, Stack: p.stack, Pot: h.Pot()}
}

// commit moves chips from a player's stack into the pot.
func (h *Hand) commit(p *handPlayer, amount int64) {
	p.stack -= amount
	p.streetBet += amount
	p.contributed += amount
	if p.stack == 0 {
		p.allIn = true
	}
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// HandNo returns the configured hand number.
func (h *Hand) HandNo() int64 { return h.cfg.HandNo }

// Street returns the current street or terminal phase.
func (h *Hand) Street() Street { return h.street }

// IsComplete reports whether the hand has been settled.
func (h *Hand) IsComplete() bool { return h.street == StreetComplete }

// Board returns a copy of the community cards dealt so far.
func (h *Hand) Board() []Card { return append([]Card(nil), h.board...) }

// Pot returns the total chips committed by all players.
func (h *Hand) Pot() int64 {
	var total int64
	for _, p := range h.players {
		total += p.contributed
	}
	return total
}

// CurrentBet returns the highest commitment in the current betting round.
func (h *Hand) CurrentBet() int64 { return h.currentBet }

// MinRaise returns the current minimum raise increment.
func (h *Hand) MinRaise() int64 { return h.minRaise }

// ButtonSeat returns the dealer button seat.
func (h *Hand) ButtonSeat() int { return h.players[h.button].seat }

// SmallBlindSeat and BigBlindSeat return the blind positions.
func (h *Hand) SmallBlindSeat() int { return h.players[h.sb].seat }

// BigBlindSeat returns the big blind seat.
func (h *Hand) BigBlindSeat() int { return h.players[h.bb].seat }

// CurrentActor returns the seat expected to act.
func (h *Hand) CurrentActor() (seat int, ok bool) {
	if h.toAct < 0 || h.IsComplete() {
		return 0, false
	}
	return h.players[h.toAct].seat, true
}

// PlayerView is a read-only snapshot of one player in the hand.
type PlayerView struct {
	Seat        int
	Player      PlayerID
	Stack       int64
	StreetBet   int64
	Contributed int64
	Folded      bool
	AllIn       bool
	HoleCards   [2]Card
	Won         int64
}

// Players returns snapshots of every dealt-in player, ordered by seat.
// Hole cards are included; callers are responsible for redaction.
func (h *Hand) Players() []PlayerView {
	out := make([]PlayerView, len(h.players))
	for i, p := range h.players {
		out[i] = PlayerView{
			Seat: p.seat, Player: p.player, Stack: p.stack, StreetBet: p.streetBet,
			Contributed: p.contributed, Folded: p.folded, AllIn: p.allIn, HoleCards: p.hole, Won: p.won,
		}
	}
	return out
}

// Results returns per-seat results once the hand is complete.
func (h *Hand) Results() []SeatResult { return append([]SeatResult(nil), h.results...) }

// ShowdownReached reports whether the hand ended in a showdown.
func (h *Hand) ShowdownReached() bool { return h.showdown }

func (h *Hand) index(seat int) int {
	for i, p := range h.players {
		if p.seat == seat {
			return i
		}
	}
	return -1
}

func (h *Hand) activeCount() int {
	n := 0
	for _, p := range h.players {
		if !p.folded {
			n++
		}
	}
	return n
}

// canAct reports whether a player may still make betting decisions.
func (p *handPlayer) canAct() bool { return !p.folded && !p.allIn }

// maxOtherStreetBet returns the highest street commitment of any other
// player still in the hand.
func (h *Hand) maxOtherStreetBet(i int) int64 {
	var m int64
	for j, p := range h.players {
		if j != i && !p.folded && p.streetBet > m {
			m = p.streetBet
		}
	}
	return m
}

// opponentCanRespond reports whether someone other than i could still act
// on a bet or raise.
func (h *Hand) opponentCanRespond(i int) bool {
	for j, p := range h.players {
		if j != i && p.canAct() {
			return true
		}
	}
	return false
}

// needsAction reports whether player i still has a decision this round.
func (h *Hand) needsAction(i int) bool {
	p := h.players[i]
	if !p.canAct() {
		return false
	}
	if !h.opponentCanRespond(i) {
		// Everyone else is all-in or folded: only an unmatched bet matters.
		return p.streetBet < h.maxOtherStreetBet(i)
	}
	return !p.acted || p.streetBet < h.currentBet
}

// nextToAct returns the first index at or after start that needs action, or -1.
func (h *Hand) nextToAct(start int) int {
	n := len(h.players)
	for k := 0; k < n; k++ {
		i := (start + k) % n
		if h.needsAction(i) {
			return i
		}
	}
	return -1
}

// raiseOpen applies the no-limit reopening rule: a player who already acted
// may raise again only when facing at least a full raise in total since
// their last action (an incomplete all-in raise does not reopen betting).
func (h *Hand) raiseOpen(p *handPlayer) bool {
	return !p.acted || h.currentBet-p.actedAtBet >= h.minRaise
}

// LegalActions returns the actions available to the current actor.
func (h *Hand) LegalActions() []LegalAction {
	if h.toAct < 0 || h.IsComplete() {
		return nil
	}
	i := h.toAct
	p := h.players[i]
	toCall := max(0, h.currentBet-p.streetBet)
	out := []LegalAction{{Kind: ActionFold}}
	if toCall == 0 {
		out = append(out, LegalAction{Kind: ActionCheck})
	} else {
		out = append(out, LegalAction{Kind: ActionCall, Amount: min(toCall, p.stack)})
	}
	maxTo := p.streetBet + p.stack
	canAggress := p.stack > toCall && h.opponentCanRespond(i)
	if canAggress && h.currentBet == 0 {
		out = append(out, LegalAction{Kind: ActionBet, MinTo: min(h.cfg.BigBlind, maxTo), MaxTo: maxTo})
	} else if canAggress && h.raiseOpen(p) {
		out = append(out, LegalAction{Kind: ActionRaise, MinTo: min(h.currentBet+h.minRaise, maxTo), MaxTo: maxTo})
	} else {
		canAggress = false
	}
	if p.stack > 0 && (p.stack <= toCall || canAggress) {
		out = append(out, LegalAction{Kind: ActionAllIn, Amount: maxTo})
	}
	return out
}

// DefaultAction is what the server applies when the actor times out:
// check when possible, otherwise fold (spec §4.2 "Timeout").
func (h *Hand) DefaultAction() (Action, bool) {
	seat, ok := h.CurrentActor()
	if !ok {
		return Action{}, false
	}
	for _, la := range h.LegalActions() {
		if la.Kind == ActionCheck {
			return Action{Seat: seat, Kind: ActionCheck}, true
		}
	}
	return Action{Seat: seat, Kind: ActionFold}, true
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

// Act validates and applies an action by the current actor. On error the
// hand state is unchanged.
func (h *Hand) Act(a Action) ([]Event, error) {
	if h.IsComplete() || h.toAct < 0 {
		return nil, errorf(CodeHandNotActive, "hand is not accepting actions")
	}
	i := h.index(a.Seat)
	if i < 0 {
		return nil, errorf(CodePlayerNotInHand, "seat %d is not in this hand", a.Seat)
	}
	if i != h.toAct {
		return nil, errorf(CodeNotYourTurn, "seat %d acts next", h.players[h.toAct].seat)
	}
	p := h.players[i]
	toCall := max(0, h.currentBet-p.streetBet)
	maxTo := p.streetBet + p.stack

	kind, to := a.Kind, a.Amount
	if kind == ActionAllIn {
		switch {
		case p.stack == 0:
			return nil, errorf(CodeIllegalAction, "no chips behind")
		case p.stack <= toCall:
			kind = ActionCall
		case h.currentBet == 0:
			kind, to = ActionBet, maxTo
		default:
			kind, to = ActionRaise, maxTo
		}
	}
	if !h.isLegal(i, kind) {
		return nil, errorf(CodeIllegalAction, "%s is not legal now", a.Kind)
	}

	var added int64
	switch kind {
	case ActionFold:
		p.folded = true
	case ActionCheck:
	case ActionCall:
		added = min(toCall, p.stack)
		h.commit(p, added)
	case ActionBet, ActionRaise:
		if to > maxTo {
			return nil, errorf(CodeInvalidRaise, "cannot commit %d with %d available", to, maxTo)
		}
		minTo := h.currentBet + h.minRaise
		if kind == ActionBet {
			minTo = h.cfg.BigBlind
		}
		if to < minTo && to != maxTo {
			return nil, errorf(CodeInvalidRaise, "minimum is %d unless all-in", minTo)
		}
		if to <= h.currentBet {
			return nil, errorf(CodeInvalidRaise, "must exceed the current bet of %d", h.currentBet)
		}
		increment := to - h.currentBet
		if kind == ActionBet || increment >= h.minRaise {
			// Full bet/raise: sets the new minimum raise and reopens action.
			h.minRaise = max(increment, h.cfg.BigBlind)
			h.lastAggr = i
		}
		added = to - p.streetBet
		h.currentBet = to
		h.commit(p, added)
	}
	p.acted = true
	p.actedAtBet = h.currentBet

	events := []Event{PlayerActed{
		Seat: p.seat, Kind: kind, Added: added, StreetBet: p.streetBet,
		Stack: p.stack, AllIn: p.allIn, Pot: h.Pot(),
	}}
	h.toAct = h.nextToAct((i + 1) % len(h.players))
	events = append(events, h.progress()...)
	return events, nil
}

func (h *Hand) isLegal(i int, kind ActionKind) bool {
	if i != h.toAct {
		return false
	}
	for _, la := range h.LegalActions() {
		if la.Kind == kind {
			return true
		}
	}
	return false
}

// progress advances streets while no decision is pending: it ends the hand
// when one player remains, closes completed betting rounds, deals the next
// street, runs out the board when nobody can bet, and settles at showdown.
func (h *Hand) progress() []Event {
	var events []Event
	for !h.IsComplete() {
		if h.activeCount() == 1 {
			events = append(events, h.returnUncalled()...)
			events = append(events, h.finishUncontested()...)
			return events
		}
		if h.toAct >= 0 {
			return events
		}
		// Betting round complete.
		events = append(events, h.returnUncalled()...)
		if h.street == StreetRiver {
			events = append(events, h.finishShowdown()...)
			return events
		}
		events = append(events, h.dealNextStreet())
		h.toAct = h.nextToAct((h.button + 1) % len(h.players))
	}
	return events
}

// returnUncalled gives back the part of the highest bet nobody matched.
func (h *Hand) returnUncalled() []Event {
	top := -1
	for i, p := range h.players {
		if top < 0 || p.streetBet > h.players[top].streetBet {
			top = i
		}
	}
	if top < 0 {
		return nil
	}
	p := h.players[top]
	var second int64
	for i, q := range h.players {
		if i != top && q.streetBet > second {
			second = q.streetBet
		}
	}
	refund := p.streetBet - second
	if refund <= 0 || p.folded {
		return nil
	}
	p.streetBet -= refund
	p.contributed -= refund
	p.stack += refund
	p.allIn = false
	if h.currentBet > p.streetBet {
		h.currentBet = p.streetBet
	}
	return []Event{UncalledBetReturned{Seat: p.seat, Amount: refund, Stack: p.stack, Pot: h.Pot()}}
}

func (h *Hand) dealNextStreet() Event {
	var next Street
	var count int
	switch h.street {
	case StreetPreflop:
		next, count = StreetFlop, 3
	case StreetFlop:
		next, count = StreetTurn, 1
	default:
		next, count = StreetRiver, 1
	}
	h.draw() // burn card
	cards := make([]Card, count)
	for k := range cards {
		cards[k] = h.draw()
	}
	h.board = append(h.board, cards...)
	h.street = next
	h.currentBet = 0
	h.minRaise = h.cfg.BigBlind
	h.lastAggr = -1
	for _, p := range h.players {
		p.streetBet = 0
		p.acted = false
		p.actedAtBet = 0
	}
	return StreetDealt{Street: next, Cards: cards, Board: h.Board()}
}

// oddChipOrder lists seats clockwise starting left of the button.
func (h *Hand) oddChipOrder() []int {
	n := len(h.players)
	out := make([]int, 0, n)
	for k := 1; k <= n; k++ {
		out = append(out, h.players[(h.button+k)%n].seat)
	}
	return out
}

func (h *Hand) finishUncontested() []Event {
	var winner *handPlayer
	for _, p := range h.players {
		if !p.folded {
			winner = p
		}
	}
	pot := h.Pot()
	winner.won = pot
	winner.stack += pot
	events := []Event{PotAwarded{
		PotIndex: 0, Amount: pot, Eligible: []int{winner.seat},
		Winners: []WinnerShare{{Seat: winner.seat, Amount: pot}}, Description: "Uncontested",
	}}
	return append(events, h.complete())
}

func (h *Hand) finishShowdown() []Event {
	h.street = StreetShowdown
	h.showdown = true
	var events []Event

	// Reveal order: last aggressor on the river first, otherwise first
	// active player left of the button; then clockwise.
	n := len(h.players)
	start := (h.button + 1) % n
	if h.lastAggr >= 0 {
		start = h.lastAggr
	}
	values := map[int]HandValue{}
	for k := 0; k < n; k++ {
		p := h.players[(start+k)%n]
		if p.folded {
			continue
		}
		cards := append([]Card{p.hole[0], p.hole[1]}, h.board...)
		v, best := EvaluateBest(cards)
		values[p.seat] = v
		p.showedDown = true
		events = append(events, CardsRevealed{
			Seat: p.seat, Cards: p.hole, HandValue: uint32(v), Description: v.Describe(), BestFive: best,
		})
	}

	contribs := make([]Contribution, n)
	for i, p := range h.players {
		contribs[i] = Contribution{Seat: p.seat, Amount: p.contributed, Folded: p.folded}
	}
	order := h.oddChipOrder()
	for idx, pot := range BuildPots(contribs) {
		shares := AwardPot(pot, values, order)
		desc := ""
		for _, s := range shares {
			p := h.players[h.index(s.Seat)]
			p.won += s.Amount
			p.stack += s.Amount
			desc = values[s.Seat].Describe()
		}
		events = append(events, PotAwarded{
			PotIndex: idx, Amount: pot.Amount, Eligible: pot.Eligible, Winners: shares, Description: desc,
		})
	}
	return append(events, h.complete())
}

func (h *Hand) complete() Event {
	h.street = StreetComplete
	h.toAct = -1
	h.results = make([]SeatResult, len(h.players))
	for i, p := range h.players {
		h.results[i] = SeatResult{
			Seat: p.seat, Player: p.player, StartingStack: p.startingStack, EndingStack: p.stack,
			Contributed: p.contributed, Won: p.won, Net: p.stack - p.startingStack,
			Folded: p.folded, ShowedDown: p.showedDown,
		}
	}
	return HandCompleted{HandNo: h.cfg.HandNo, Board: h.Board(), ShowdownReached: h.showdown, Results: h.Results()}
}

// Clone returns a deep copy (used by tests and simulations).
func (h *Hand) Clone() *Hand {
	c := *h
	c.deck = append([]Card(nil), h.deck...)
	c.board = append([]Card(nil), h.board...)
	c.results = append([]SeatResult(nil), h.results...)
	c.cfg.Seats = append([]SeatSetup(nil), h.cfg.Seats...)
	c.players = make([]*handPlayer, len(h.players))
	for i, p := range h.players {
		cp := *p
		c.players[i] = &cp
	}
	return &c
}
