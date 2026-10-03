package poker

import (
	"errors"
	"fmt"
	"reflect"
	"testing"
)

// stackedDeck builds a deck that deals the given hole cards (listed in
// dealing order: first player left of the button first) and board.
func stackedDeck(t *testing.T, holes [][2]string, board [5]string) []Card {
	t.Helper()
	n := len(holes)
	deck := make([]Card, 0, DeckSize)
	used := map[Card]bool{}
	add := func(s string) {
		c, err := ParseCard(s)
		if err != nil || used[c] {
			t.Fatalf("bad or duplicate card %q", s)
		}
		used[c] = true
		deck = append(deck, c)
	}
	for round := 0; round < 2; round++ {
		for i := 0; i < n; i++ {
			add(holes[i][round])
		}
	}
	filler := func() string {
		for i := 0; i < DeckSize; i++ {
			if c := Card(i); !used[c] && !inBoard(c, board) {
				return c.String()
			}
		}
		t.Fatal("deck exhausted")
		return ""
	}
	add(filler()) // burn
	add(board[0])
	add(board[1])
	add(board[2])
	add(filler())
	add(board[3])
	add(filler())
	add(board[4])
	for i := 0; i < DeckSize; i++ {
		if c := Card(i); !used[c] {
			used[c] = true
			deck = append(deck, c)
		}
	}
	return deck
}

func inBoard(c Card, board [5]string) bool {
	for _, s := range board {
		if b, _ := ParseCard(s); b == c {
			return true
		}
	}
	return false
}

func seats(stacks ...int64) []SeatSetup {
	out := make([]SeatSetup, len(stacks))
	for i, s := range stacks {
		out[i] = SeatSetup{Seat: i + 1, Player: PlayerID(fmt.Sprintf("p%d", i+1)), Stack: s}
	}
	return out
}

func mustAct(t *testing.T, h *Hand, seat int, kind ActionKind, amount int64) []Event {
	t.Helper()
	ev, err := h.Act(Action{Seat: seat, Kind: kind, Amount: amount})
	if err != nil {
		t.Fatalf("seat %d %s %d: %v", seat, kind, amount, err)
	}
	return ev
}

func expectActor(t *testing.T, h *Hand, seat int) {
	t.Helper()
	got, ok := h.CurrentActor()
	if !ok || got != seat {
		t.Fatalf("actor = %d (%v), want %d", got, ok, seat)
	}
}

func legalKinds(h *Hand) []ActionKind {
	var out []ActionKind
	for _, la := range h.LegalActions() {
		out = append(out, la.Kind)
	}
	return out
}

func legal(h *Hand, kind ActionKind) (LegalAction, bool) {
	for _, la := range h.LegalActions() {
		if la.Kind == kind {
			return la, true
		}
	}
	return LegalAction{}, false
}

func stacksBySeat(h *Hand) map[int]int64 {
	out := map[int]int64{}
	for _, p := range h.Players() {
		out[p.Seat] = p.Stack
	}
	return out
}

func eventsOf[T Event](events []Event) []T {
	var out []T
	for _, e := range events {
		if v, ok := e.(T); ok {
			out = append(out, v)
		}
	}
	return out
}

var anyBoard = [5]string{"2c", "7d", "9h", "Js", "3d"}

func TestHeadsUpBlindsAndActionOrder(t *testing.T) {
	deck := stackedDeck(t, [][2]string{{"As", "Ad"}, {"Ks", "Kd"}}, anyBoard)
	h, events, err := NewHand(HandConfig{HandNo: 1, SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(1000, 1000), Deck: deck})
	if err != nil {
		t.Fatal(err)
	}
	blinds := eventsOf[BlindPosted](events)
	if blinds[0].Seat != 1 || blinds[0].Amount != 5 || blinds[1].Seat != 2 || blinds[1].Amount != 10 {
		t.Fatalf("heads-up: button posts small blind; got %+v", blinds)
	}
	// Dealing starts left of the button: seat 2 receives the first card.
	dealt := eventsOf[HoleCardsDealt](events)
	if dealt[0].Seat != 2 || dealt[0].Cards[0].String() != "As" {
		t.Fatalf("dealing order wrong: %+v", dealt)
	}
	expectActor(t, h, 1) // button/small blind acts first preflop
	if la, _ := legal(h, ActionCall); la.Amount != 5 {
		t.Fatalf("SB call amount = %d", la.Amount)
	}
	mustAct(t, h, 1, ActionCall, 0)
	expectActor(t, h, 2) // big blind option
	if !reflect.DeepEqual(legalKinds(h), []ActionKind{ActionFold, ActionCheck, ActionRaise, ActionAllIn}) {
		t.Fatalf("BB option legal actions = %v", legalKinds(h))
	}
	ev := mustAct(t, h, 2, ActionCheck, 0)
	if sd := eventsOf[StreetDealt](ev); len(sd) != 1 || sd[0].Street != StreetFlop || CardsString(sd[0].Cards) != "2c 7d 9h" {
		t.Fatalf("flop not dealt correctly: %+v", sd)
	}
	expectActor(t, h, 2) // big blind acts first postflop heads-up
}

func TestRingGameActionOrder(t *testing.T) {
	deck := NewOrderedDeck()
	h, _, err := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 2, Seats: seats(500, 500, 500, 500), Deck: deck})
	if err != nil {
		t.Fatal(err)
	}
	if h.SmallBlindSeat() != 3 || h.BigBlindSeat() != 4 {
		t.Fatalf("blinds at %d/%d", h.SmallBlindSeat(), h.BigBlindSeat())
	}
	expectActor(t, h, 1) // UTG: left of the big blind (wraps around)
	mustAct(t, h, 1, ActionCall, 0)
	mustAct(t, h, 2, ActionCall, 0)
	mustAct(t, h, 3, ActionCall, 0)
	expectActor(t, h, 4)
	mustAct(t, h, 4, ActionCheck, 0)
	if h.Street() != StreetFlop {
		t.Fatalf("street = %s", h.Street())
	}
	expectActor(t, h, 3) // first active left of the button
}

func TestMinimumRaiseRules(t *testing.T) {
	h, _, _ := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(1000, 1000, 1000), Deck: NewOrderedDeck()})
	expectActor(t, h, 1)
	if la, _ := legal(h, ActionRaise); la.MinTo != 20 || la.MaxTo != 1000 {
		t.Fatalf("opening raise bounds %+v", la)
	}
	if _, err := h.Act(Action{Seat: 1, Kind: ActionRaise, Amount: 15}); !errors.Is(err, ErrInvalidRaise) {
		t.Fatalf("raise below minimum: %v", err)
	}
	mustAct(t, h, 1, ActionRaise, 30) // raise of 20
	if la, _ := legal(h, ActionRaise); la.MinTo != 50 {
		t.Fatalf("re-raise min = %d, want 50", la.MinTo)
	}
	if _, err := h.Act(Action{Seat: 2, Kind: ActionRaise, Amount: 45}); !errors.Is(err, ErrInvalidRaise) {
		t.Fatalf("re-raise below minimum: %v", err)
	}
	mustAct(t, h, 2, ActionRaise, 100) // raise of 70
	if la, _ := legal(h, ActionRaise); la.MinTo != 170 {
		t.Fatalf("min after 70 raise = %d", la.MinTo)
	}
	if _, err := h.Act(Action{Seat: 3, Kind: ActionRaise, Amount: 1001}); !errors.Is(err, ErrInvalidRaise) {
		t.Fatalf("raise above stack: %v", err)
	}
}

func TestIncompleteAllInDoesNotReopenBetting(t *testing.T) {
	// Seat 3 is short. Flop: seat 2 bets 100, seat 3 all-in 150 (incomplete
	// raise), seat 1 calls; seat 2 may only call or fold.
	h, _, _ := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(1000, 1000, 160), Deck: NewOrderedDeck()})
	mustAct(t, h, 1, ActionCall, 0)
	mustAct(t, h, 2, ActionCall, 0)
	mustAct(t, h, 3, ActionCheck, 0)
	expectActor(t, h, 2)
	mustAct(t, h, 2, ActionBet, 100)
	mustAct(t, h, 3, ActionAllIn, 0)
	if h.CurrentBet() != 150 || h.MinRaise() != 100 {
		t.Fatalf("current bet %d min raise %d", h.CurrentBet(), h.MinRaise())
	}
	// Seat 1 has not acted yet in this round: may still raise.
	if la, ok := legal(h, ActionRaise); !ok || la.MinTo != 250 {
		t.Fatalf("seat 1 should be able to raise to >= 250: %+v %v", la, ok)
	}
	mustAct(t, h, 1, ActionCall, 0)
	expectActor(t, h, 2)
	if !reflect.DeepEqual(legalKinds(h), []ActionKind{ActionFold, ActionCall}) {
		t.Fatalf("incomplete raise must not reopen: %v", legalKinds(h))
	}
	if _, err := h.Act(Action{Seat: 2, Kind: ActionRaise, Amount: 400}); !errors.Is(err, ErrIllegalAction) {
		t.Fatalf("raise should be illegal: %v", err)
	}
	mustAct(t, h, 2, ActionCall, 0)
	if h.Street() != StreetTurn {
		t.Fatalf("street = %s", h.Street())
	}
}

func TestCumulativeIncompleteRaisesReopenBetting(t *testing.T) {
	// Seat 2 bets 100; seats 3 and 4 move all-in for 150 and 210 (each an
	// incomplete raise, together 110 more than seat 2's bet >= 100): seat 2
	// faces a full raise in total and may re-raise (TDA rule).
	h, _, _ := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(1000, 1000, 160, 220), Deck: NewOrderedDeck()})
	// Preflop: blinds 2/3, UTG seat 4.
	mustAct(t, h, 4, ActionCall, 0)
	mustAct(t, h, 1, ActionCall, 0)
	mustAct(t, h, 2, ActionCall, 0)
	mustAct(t, h, 3, ActionCheck, 0)
	expectActor(t, h, 2)
	mustAct(t, h, 2, ActionBet, 100)
	mustAct(t, h, 3, ActionAllIn, 0) // to 150
	mustAct(t, h, 4, ActionAllIn, 0) // to 210
	mustAct(t, h, 1, ActionCall, 0)
	expectActor(t, h, 2)
	if _, ok := legal(h, ActionRaise); !ok {
		t.Fatalf("cumulative full raise should reopen betting: %v", legalKinds(h))
	}
}

func TestBigBlindOptionCanRaise(t *testing.T) {
	h, _, _ := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(1000, 1000, 1000), Deck: NewOrderedDeck()})
	mustAct(t, h, 1, ActionCall, 0)
	mustAct(t, h, 2, ActionCall, 0)
	expectActor(t, h, 3)
	mustAct(t, h, 3, ActionRaise, 40)
	expectActor(t, h, 1)
	if la, _ := legal(h, ActionCall); la.Amount != 30 {
		t.Fatalf("call amount = %d", la.Amount)
	}
}

func TestFoldToRaiseReturnsUncalledAndWinsWithoutShowdown(t *testing.T) {
	h, _, _ := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(1000, 1000, 1000), Deck: NewOrderedDeck()})
	mustAct(t, h, 1, ActionRaise, 30)
	mustAct(t, h, 2, ActionFold, 0)
	ev := mustAct(t, h, 3, ActionFold, 0)
	if !h.IsComplete() {
		t.Fatal("hand should be complete")
	}
	ret := eventsOf[UncalledBetReturned](ev)
	if len(ret) != 1 || ret[0].Seat != 1 || ret[0].Amount != 20 {
		t.Fatalf("uncalled return %+v", ret)
	}
	if len(eventsOf[CardsRevealed](ev)) != 0 {
		t.Fatal("no cards may be revealed in an uncontested pot")
	}
	award := eventsOf[PotAwarded](ev)
	if len(award) != 1 || award[0].Amount != 25 || award[0].Winners[0].Seat != 1 {
		t.Fatalf("award %+v", award)
	}
	if s := stacksBySeat(h); s[1] != 1015 || s[2] != 995 || s[3] != 990 {
		t.Fatalf("stacks %v", s)
	}
}

func TestThreeWayAllInSidePots(t *testing.T) {
	// Button seat 1. Dealing order: seat 2, seat 3, seat 1.
	// seat 2 (stack 50): quad aces -> wins main pot
	// seat 3 (stack 150): kings full -> wins side pot
	// seat 1 (stack 300): queens -> gets back only its uncalled excess
	deck := stackedDeck(t, [][2]string{{"Ah", "Ac"}, {"Kh", "Kc"}, {"Qh", "Qc"}}, [5]string{"As", "Ad", "Ks", "2c", "7d"})
	h, _, err := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: []SeatSetup{
		{Seat: 1, Player: "p1", Stack: 300}, {Seat: 2, Player: "p2", Stack: 50}, {Seat: 3, Player: "p3", Stack: 150},
	}, Deck: deck})
	if err != nil {
		t.Fatal(err)
	}
	mustAct(t, h, 1, ActionAllIn, 0) // to 300
	mustAct(t, h, 2, ActionAllIn, 0) // 50 total
	ev := mustAct(t, h, 3, ActionAllIn, 0)
	if !h.IsComplete() || !h.ShowdownReached() {
		t.Fatal("expected runout to showdown")
	}
	if ret := eventsOf[UncalledBetReturned](ev); len(ret) != 1 || ret[0].Seat != 1 || ret[0].Amount != 150 {
		t.Fatalf("uncalled: %+v", ret)
	}
	pots := eventsOf[PotAwarded](ev)
	if len(pots) != 2 {
		t.Fatalf("pots: %+v", pots)
	}
	if pots[0].Amount != 150 || pots[0].Winners[0].Seat != 2 || pots[1].Amount != 200 || pots[1].Winners[0].Seat != 3 {
		t.Fatalf("pots: %+v", pots)
	}
	if s := stacksBySeat(h); s[1] != 150 || s[2] != 150 || s[3] != 200 {
		t.Fatalf("stacks %v", s)
	}
	if len(eventsOf[StreetDealt](ev)) != 3 {
		t.Fatal("flop, turn and river should be run out")
	}
}

func TestSplitPotOddChipGoesLeftOfButton(t *testing.T) {
	// Board makes a straight for everyone; the small blind folds after
	// posting, leaving an odd pot of 25 split between seats 1 and 3.
	deck := stackedDeck(t, [][2]string{{"2c", "2d"}, {"3c", "3d"}, {"4c", "4d"}}, [5]string{"Th", "Js", "Qd", "Kc", "Ah"})
	h, _, _ := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(100, 100, 100), Deck: deck})
	mustAct(t, h, 1, ActionCall, 0)
	mustAct(t, h, 2, ActionFold, 0)
	mustAct(t, h, 3, ActionCheck, 0)
	for !h.IsComplete() {
		seat, _ := h.CurrentActor()
		mustAct(t, h, seat, ActionCheck, 0)
	}
	if s := stacksBySeat(h); s[3] != 103 || s[1] != 102 || s[2] != 95 {
		t.Fatalf("odd chip should go to seat 3 (first left of button among winners): %v", s)
	}
}

func TestShortBigBlindHeadsUp(t *testing.T) {
	h, events, _ := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(100, 7), Deck: NewOrderedDeck()})
	if b := eventsOf[BlindPosted](events); b[1].Amount != 7 || !b[1].AllIn {
		t.Fatalf("short BB: %+v", b)
	}
	expectActor(t, h, 1)
	if !reflect.DeepEqual(legalKinds(h), []ActionKind{ActionFold, ActionCall}) {
		t.Fatalf("nobody can respond to a raise: %v", legalKinds(h))
	}
	ev := mustAct(t, h, 1, ActionCall, 0)
	if !h.IsComplete() {
		t.Fatal("should run out")
	}
	if ret := eventsOf[UncalledBetReturned](ev); len(ret) != 1 || ret[0].Amount != 3 {
		t.Fatalf("uncalled %+v", ret)
	}
	var total int64
	for _, s := range stacksBySeat(h) {
		total += s
	}
	if total != 107 {
		t.Fatalf("chips not conserved: %d", total)
	}
}

func TestEveryoneAllInFromBlindsCompletesImmediately(t *testing.T) {
	h, events, err := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(5, 8), Deck: NewOrderedDeck()})
	if err != nil {
		t.Fatal(err)
	}
	if !h.IsComplete() {
		t.Fatal("hand with no possible decisions must complete inside NewHand")
	}
	if _, ok := events[len(events)-1].(HandCompleted); !ok {
		t.Fatal("last event must be HandCompleted")
	}
}

func TestActionErrorsLeaveStateUnchanged(t *testing.T) {
	h, _, _ := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(1000, 1000, 1000), Deck: NewOrderedDeck()})
	before := h.Clone()
	cases := []struct {
		a    Action
		want error
	}{
		{Action{Seat: 2, Kind: ActionCall}, ErrNotYourTurn},
		{Action{Seat: 9, Kind: ActionCall}, ErrPlayerNotInHand},
		{Action{Seat: 1, Kind: ActionCheck}, ErrIllegalAction},
		{Action{Seat: 1, Kind: ActionBet, Amount: 50}, ErrIllegalAction},
		{Action{Seat: 1, Kind: ActionRaise, Amount: 5000}, ErrInvalidRaise},
		{Action{Seat: 1, Kind: "DANCE"}, ErrIllegalAction},
	}
	for _, tc := range cases {
		if _, err := h.Act(tc.a); !errors.Is(err, tc.want) {
			t.Errorf("%+v: got %v want %v", tc.a, err, tc.want)
		}
	}
	if !reflect.DeepEqual(h, before) {
		t.Fatal("rejected actions must not mutate state")
	}
	mustAct(t, h, 1, ActionFold, 0)
	mustAct(t, h, 2, ActionFold, 0)
	if _, err := h.Act(Action{Seat: 3, Kind: ActionCheck}); !errors.Is(err, ErrHandNotActive) {
		t.Fatalf("after completion: %v", err)
	}
}

func TestDefaultActionChecksOrFolds(t *testing.T) {
	h, _, _ := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(1000, 1000), Deck: NewOrderedDeck()})
	if a, _ := h.DefaultAction(); a.Kind != ActionFold || a.Seat != 1 {
		t.Fatalf("facing a bet the default is fold: %+v", a)
	}
	mustAct(t, h, 1, ActionCall, 0)
	if a, _ := h.DefaultAction(); a.Kind != ActionCheck || a.Seat != 2 {
		t.Fatalf("with a free check the default is check: %+v", a)
	}
}

func TestInvalidConfigsAreRejected(t *testing.T) {
	good := HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(100, 100), Deck: NewOrderedDeck()}
	mutate := []func(*HandConfig){
		func(c *HandConfig) { c.SmallBlind = 0 },
		func(c *HandConfig) { c.SmallBlind = 20 },
		func(c *HandConfig) { c.Seats = c.Seats[:1] },
		func(c *HandConfig) { c.ButtonSeat = 7 },
		func(c *HandConfig) { c.Seats = []SeatSetup{{1, "a", 100}, {1, "b", 100}} },
		func(c *HandConfig) { c.Seats = []SeatSetup{{1, "a", 100}, {2, "a", 100}} },
		func(c *HandConfig) { c.Seats = []SeatSetup{{1, "a", 100}, {2, "b", 0}} },
		func(c *HandConfig) { c.Deck = c.Deck[:40] },
	}
	for i, m := range mutate {
		cfg := good
		cfg.Seats = append([]SeatSetup(nil), good.Seats...)
		m(&cfg)
		if _, _, err := NewHand(cfg); err == nil {
			t.Errorf("mutation %d should be rejected", i)
		}
	}
}

func TestReplayIsDeterministic(t *testing.T) {
	deck, _ := NewShuffledDeck(newSeededReader(77))
	cfg := HandConfig{HandNo: 3, SmallBlind: 5, BigBlind: 10, ButtonSeat: 2, Seats: seats(300, 120, 900, 45), Deck: deck}
	run := func() []Event {
		h, events, err := NewHand(cfg)
		if err != nil {
			t.Fatal(err)
		}
		script := []ActionKind{ActionCall, ActionRaise, ActionAllIn, ActionCall, ActionCall, ActionCheck}
		for i := 0; !h.IsComplete(); i++ {
			seat, _ := h.CurrentActor()
			kind := script[i%len(script)]
			a := Action{Seat: seat, Kind: kind}
			if la, ok := legal(h, kind); ok {
				a.Amount = la.MinTo
			} else if _, ok := legal(h, ActionCheck); ok {
				a.Kind = ActionCheck
			} else {
				a.Kind = ActionCall
			}
			ev, err := h.Act(a)
			if err != nil {
				t.Fatal(err)
			}
			events = append(events, ev...)
		}
		return events
	}
	if a, b := run(), run(); !reflect.DeepEqual(a, b) {
		t.Fatal("same deck and actions must produce identical events")
	}
}
