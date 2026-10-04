package poker

import (
	"errors"
	"reflect"
	"testing"
)

func isInvalidConfig(err error) bool {
	var pe *Error
	return errors.As(err, &pe) && pe.Code == CodeInvalidConfig
}

func TestGameTypeValidation(t *testing.T) {
	if _, _, err := NewHand(HandConfig{Game: "STUD", SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(100, 100), Deck: NewOrderedDeck()}); !isInvalidConfig(err) {
		t.Fatalf("unknown game accepted by NewHand: %v", err)
	}
	if _, err := NewTable(TableConfig{Game: "STUD", MaxSeats: 6, SmallBlind: 5, BigBlind: 10}); !isInvalidConfig(err) {
		t.Fatalf("unknown game accepted by NewTable: %v", err)
	}
	if GameNLHE.HoleCardCount() != 2 || GamePLO.HoleCardCount() != 4 || GameType("").HoleCardCount() != 2 {
		t.Fatal("hole card counts")
	}
	h, events, _ := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(100, 100), Deck: NewOrderedDeck()})
	if h.Game() != GameNLHE || eventsOf[HandStarted](events)[0].Game != GameNLHE {
		t.Fatal("the zero game must be reported as NLHE")
	}
}

func TestPLODealsFourHoleCardsEach(t *testing.T) {
	h, events, err := NewHand(HandConfig{Game: GamePLO, SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(1000, 1000, 1000), Deck: NewOrderedDeck()})
	if err != nil {
		t.Fatal(err)
	}
	if h.Game() != GamePLO || eventsOf[HandStarted](events)[0].Game != GamePLO {
		t.Fatal("game type not reported")
	}
	// One card per round, four rounds, starting left of the button.
	dealt := eventsOf[HoleCardsDealt](events)
	deck := NewOrderedDeck()
	want := map[int][]Card{2: {deck[0], deck[3], deck[6], deck[9]}, 3: {deck[1], deck[4], deck[7], deck[10]}, 1: {deck[2], deck[5], deck[8], deck[11]}}
	for _, d := range dealt {
		if !reflect.DeepEqual(d.Cards, want[d.Seat]) {
			t.Fatalf("seat %d dealt %s, want %s", d.Seat, CardsString(d.Cards), CardsString(want[d.Seat]))
		}
	}
	for _, p := range h.Players() {
		if len(p.HoleCards) != 4 {
			t.Fatalf("seat %d has %d hole cards", p.Seat, len(p.HoleCards))
		}
	}
	// 12 players x 4 cards + 8 do not fit in a deck.
	stacks := make([]int64, 12)
	for i := range stacks {
		stacks[i] = 100
	}
	if _, _, err := NewHand(HandConfig{Game: GamePLO, SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(stacks...), Deck: NewOrderedDeck()}); !isInvalidConfig(err) {
		t.Fatalf("too many PLO players accepted: %v", err)
	}
}

// Heads-up 5/10: the pot limit bounds every bet and raise, all-in is only
// offered within the limit, and the hand is decided with Omaha rules.
func TestPotLimitBettingAndOmahaShowdown(t *testing.T) {
	// Dealing starts with seat 2 (left of the button heads-up). Seat 2 holds
	// the ace of hearts on a four-heart board, which would be the nut flush
	// in Hold'em but is only a pair of kings in Omaha; seat 1's two small
	// hearts make the flush.
	deck := stackedDeckN(t, [][]string{{"Ah", "Kc", "Kd", "7s"}, {"2h", "4h", "8c", "8d"}}, [5]string{"Qh", "9h", "5h", "3h", "Ts"})
	h, _, err := NewHand(HandConfig{Game: GamePLO, SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(1000, 1000), Deck: deck})
	if err != nil {
		t.Fatal(err)
	}

	// Preflop, small blind: pot-sized raise is to 30 (call 5, pot 20, raise 20).
	expectActor(t, h, 1)
	if r, _ := legal(h, ActionRaise); r.MinTo != 20 || r.MaxTo != 30 {
		t.Fatalf("SB raise bounds %+v", r)
	}
	if _, ok := legal(h, ActionAllIn); ok {
		t.Fatal("all-in above the pot limit must not be offered")
	}
	before := h.Clone()
	if _, err := h.Act(Action{Seat: 1, Kind: ActionRaise, Amount: 31}); !errors.Is(err, ErrInvalidRaise) {
		t.Fatalf("raise above the pot accepted: %v", err)
	}
	if _, err := h.Act(Action{Seat: 1, Kind: ActionAllIn}); !errors.Is(err, ErrInvalidRaise) {
		t.Fatalf("all-in above the pot accepted: %v", err)
	}
	if !reflect.DeepEqual(h, before) {
		t.Fatal("rejected action mutated the hand")
	}
	mustAct(t, h, 1, ActionRaise, 30)

	// Big blind facing 30: call 20 makes the pot 60, so the raise is to 90.
	if r, _ := legal(h, ActionRaise); r.MinTo != 50 || r.MaxTo != 90 {
		t.Fatalf("BB re-raise bounds %+v", r)
	}
	mustAct(t, h, 2, ActionRaise, 90)
	if r, _ := legal(h, ActionRaise); r.MinTo != 150 || r.MaxTo != 270 {
		t.Fatalf("SB 4-bet bounds %+v", r)
	}
	mustAct(t, h, 1, ActionCall, 0)

	// Flop, pot 180: the maximum bet is the pot.
	expectActor(t, h, 2)
	if b, _ := legal(h, ActionBet); b.MinTo != 10 || b.MaxTo != 180 {
		t.Fatalf("flop bet bounds %+v", b)
	}
	if _, err := h.Act(Action{Seat: 2, Kind: ActionBet, Amount: 181}); !errors.Is(err, ErrInvalidRaise) {
		t.Fatalf("bet above the pot accepted: %v", err)
	}
	mustAct(t, h, 2, ActionBet, 180)
	// Facing 180 into 360: raise to 180 + (360 + 180) = 720.
	if r, _ := legal(h, ActionRaise); r.MinTo != 360 || r.MaxTo != 720 {
		t.Fatalf("flop raise bounds %+v", r)
	}
	mustAct(t, h, 1, ActionRaise, 720)

	// Seat 2 has 910 in total for the street, within the limit: all-in is
	// offered and every raise size is all-in.
	if a, ok := legal(h, ActionAllIn); !ok || a.Amount != 910 {
		t.Fatalf("all-in within the limit %+v %v", a, ok)
	}
	if r, _ := legal(h, ActionRaise); r.MinTo != 910 || r.MaxTo != 910 {
		t.Fatalf("short re-raise bounds %+v", r)
	}
	mustAct(t, h, 2, ActionAllIn, 0)
	expectActor(t, h, 1)
	// Calling takes the rest of the stack (ALL_IN is that call).
	if !reflect.DeepEqual(legalKinds(h), []ActionKind{ActionFold, ActionCall, ActionAllIn}) {
		t.Fatalf("facing the all-in: %v", legalKinds(h))
	}
	ev := mustAct(t, h, 1, ActionCall, 0)
	if !h.IsComplete() || !h.ShowdownReached() {
		t.Fatal("expected a runout to showdown")
	}

	shown := map[int]CardsRevealed{}
	for _, c := range eventsOf[CardsRevealed](ev) {
		shown[c.Seat] = c
	}
	if len(shown[1].Cards) != 4 || len(shown[2].Cards) != 4 {
		t.Fatalf("all four hole cards are shown: %+v", shown)
	}
	if shown[1].Description != "Flush, Queen high" || shown[2].Description != "Pair of Kings" {
		t.Fatalf("Omaha evaluation: seat 1 %q, seat 2 %q", shown[1].Description, shown[2].Description)
	}
	if s := stacksBySeat(h); s[1] != 2000 || s[2] != 0 {
		t.Fatalf("stacks %v", s)
	}
}

func TestPotLimitCountsLimpersAndBlinds(t *testing.T) {
	// Three-handed 5/10, button seat 1 acts first: call 10, pot 25 -> to 35.
	h, _, _ := NewHand(HandConfig{Game: GamePLO, SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(1000, 1000, 1000), Deck: NewOrderedDeck()})
	expectActor(t, h, 1)
	if r, _ := legal(h, ActionRaise); r.MaxTo != 35 {
		t.Fatalf("button pot raise = %d, want 35", r.MaxTo)
	}
	mustAct(t, h, 1, ActionCall, 0)
	// Small blind: call 5, pot 30 -> to 40.
	if r, _ := legal(h, ActionRaise); r.MaxTo != 40 {
		t.Fatalf("SB pot raise = %d, want 40", r.MaxTo)
	}
	mustAct(t, h, 2, ActionCall, 0)
	// Big blind option: nothing to call, pot 30 -> to 40.
	if r, _ := legal(h, ActionRaise); r.MaxTo != 40 {
		t.Fatalf("BB pot raise = %d, want 40", r.MaxTo)
	}
}

func TestShortStackMayGoAllInUnderThePotLimit(t *testing.T) {
	h, _, _ := NewHand(HandConfig{Game: GamePLO, SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(1000, 40), Deck: NewOrderedDeck()})
	mustAct(t, h, 1, ActionRaise, 30)
	if a, ok := legal(h, ActionAllIn); !ok || a.Amount != 40 {
		t.Fatalf("short all-in %+v %v", a, ok)
	}
	mustAct(t, h, 2, ActionAllIn, 0)
	// An incomplete raise against a player who already acted: call or fold.
	if !reflect.DeepEqual(legalKinds(h), []ActionKind{ActionFold, ActionCall}) {
		t.Fatalf("after short all-in: %v", legalKinds(h))
	}
	if la, _ := legal(h, ActionCall); la.Amount != 10 {
		t.Fatalf("call %d, want 10", la.Amount)
	}
}

func TestPLOTableUsesGame(t *testing.T) {
	table, err := NewTable(TableConfig{Game: GamePLO, MaxSeats: 6, SmallBlind: 5, BigBlind: 10})
	if err != nil {
		t.Fatal(err)
	}
	_ = table.SitDown(1, "a", 1000)
	_ = table.SitDown(2, "b", 1000)
	h, _, err := table.StartHand(NewOrderedDeck())
	if err != nil {
		t.Fatal(err)
	}
	if h.Game() != GamePLO || len(h.Players()[0].HoleCards) != 4 {
		t.Fatal("table hands must use the table's game")
	}
	playOut(t, table)
}
