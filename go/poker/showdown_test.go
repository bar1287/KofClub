package poker

import (
	"errors"
	"reflect"
	"testing"
)

// checkDown checks (or calls the blinds) until the hand reaches showdown.
func checkDown(t *testing.T, h *Hand) []Event {
	t.Helper()
	var events []Event
	for !h.IsComplete() {
		seat, _ := h.CurrentActor()
		kind := ActionCheck
		if _, ok := legal(h, ActionCall); ok {
			kind = ActionCall
		}
		events = append(events, mustAct(t, h, seat, kind, 0)...)
	}
	return events
}

func showdownOrder(events []Event) []string {
	var out []string
	for _, e := range events {
		switch ev := e.(type) {
		case CardsRevealed:
			out = append(out, "show "+string(rune('0'+ev.Seat)))
		case CardsMucked:
			out = append(out, "muck "+string(rune('0'+ev.Seat)))
		}
	}
	return out
}

// Button seat 1; dealing order seat 2, seat 3, seat 1. Seat 2: aces,
// seat 3: kings, seat 1: queens; nobody bets, so seat 2 shows first.
func threeWayCheckDown(t *testing.T, muck ...bool) (*Hand, []Event) {
	t.Helper()
	deck := stackedDeck(t, [][2]string{{"Ah", "Ac"}, {"Kh", "Kc"}, {"Qh", "Qc"}}, [5]string{"2s", "7d", "9c", "3h", "4d"})
	setup := seats(1000, 1000, 1000)
	for i := range setup {
		setup[i].MuckLosing = len(muck) > i && muck[i]
	}
	h, _, err := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: setup, Deck: deck})
	if err != nil {
		t.Fatal(err)
	}
	return h, checkDown(t, h)
}

func TestLosingHandsAreMuckedOnlyWhenChosen(t *testing.T) {
	_, all := threeWayCheckDown(t)
	if got := showdownOrder(all); !reflect.DeepEqual(got, []string{"show 2", "show 3", "show 1"}) {
		t.Fatalf("without mucking everyone shows: %v", got)
	}

	h, ev := threeWayCheckDown(t, true, true, false) // seats 1, 2, 3
	if got := showdownOrder(ev); !reflect.DeepEqual(got, []string{"show 2", "show 3", "muck 1"}) {
		t.Fatalf("seat 1 mucks its beaten queens, seat 3 shows by choice: %v", got)
	}
	if !reflect.DeepEqual(eventsOf[PotAwarded](ev), eventsOf[PotAwarded](all)) {
		t.Fatal("mucking changed the award")
	}
	for _, r := range h.Results() {
		if r.Seat == 1 && (!r.Mucked || r.ShowedDown) || r.Seat != 1 && (r.Mucked || !r.ShowedDown) {
			t.Fatalf("result %+v", r)
		}
	}
}

func TestTheFirstHandAndTiesAreAlwaysShown(t *testing.T) {
	// Board straight: everyone ties; all must show to split.
	deck := stackedDeck(t, [][2]string{{"2h", "3c"}, {"2d", "3s"}}, [5]string{"Ts", "Jd", "Qc", "Kh", "Ad"})
	h, _, err := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: []SeatSetup{
		{Seat: 1, Player: "p1", Stack: 1000, MuckLosing: true}, {Seat: 2, Player: "p2", Stack: 1000, MuckLosing: true},
	}, Deck: deck})
	if err != nil {
		t.Fatal(err)
	}
	ev := checkDown(t, h)
	if len(eventsOf[CardsMucked](ev)) != 0 || len(eventsOf[CardsRevealed](ev)) != 2 {
		t.Fatalf("a tie must be shown: %v", showdownOrder(ev))
	}
}

func TestTheRiverAggressorShowsFirst(t *testing.T) {
	// Heads-up, button seat 1 (small blind). Dealing order: seat 2, seat 1.
	// Seat 2 bets the river with a worse hand and must show it; seat 1
	// calls and shows the winner.
	deck := stackedDeck(t, [][2]string{{"2h", "3c"}, {"Ah", "Ac"}}, [5]string{"8s", "9d", "Jc", "4h", "6d"})
	h, _, err := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: []SeatSetup{
		{Seat: 1, Player: "p1", Stack: 1000, MuckLosing: true}, {Seat: 2, Player: "p2", Stack: 1000, MuckLosing: true},
	}, Deck: deck})
	if err != nil {
		t.Fatal(err)
	}
	mustAct(t, h, 1, ActionCall, 0)
	mustAct(t, h, 2, ActionCheck, 0)
	for _, street := range []Street{StreetFlop, StreetTurn} {
		if h.Street() != street {
			t.Fatalf("street %s", h.Street())
		}
		mustAct(t, h, 2, ActionCheck, 0)
		mustAct(t, h, 1, ActionCheck, 0)
	}
	mustAct(t, h, 2, ActionBet, 50)
	ev := mustAct(t, h, 1, ActionCall, 0)
	if got := showdownOrder(ev); !reflect.DeepEqual(got, []string{"show 2", "show 1"}) {
		t.Fatalf("aggressor first, then the winner: %v", got)
	}

	// Reversed: the aggressor holds the winner, the caller may muck.
	deck = stackedDeck(t, [][2]string{{"Ah", "Ac"}, {"2h", "3c"}}, [5]string{"8s", "9d", "Jc", "4h", "6d"})
	h, _, _ = NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: []SeatSetup{
		{Seat: 1, Player: "p1", Stack: 1000, MuckLosing: true}, {Seat: 2, Player: "p2", Stack: 1000, MuckLosing: true},
	}, Deck: deck})
	mustAct(t, h, 1, ActionCall, 0)
	mustAct(t, h, 2, ActionCheck, 0)
	for range 2 {
		mustAct(t, h, 2, ActionCheck, 0)
		mustAct(t, h, 1, ActionCheck, 0)
	}
	mustAct(t, h, 2, ActionBet, 50)
	ev = mustAct(t, h, 1, ActionCall, 0)
	if got := showdownOrder(ev); !reflect.DeepEqual(got, []string{"show 2", "muck 1"}) {
		t.Fatalf("the beaten caller mucks: %v", got)
	}
}

func TestEveryHandIsShownInAnAllInShowdown(t *testing.T) {
	// Seat 2 is all-in preflop with the best hand; seats 3 and 1 would muck.
	deck := stackedDeck(t, [][2]string{{"Ah", "Ac"}, {"Kh", "Kc"}, {"Qh", "Qc"}}, [5]string{"2s", "7d", "9c", "3h", "4d"})
	h, _, err := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: []SeatSetup{
		{Seat: 1, Player: "p1", Stack: 1000, MuckLosing: true},
		{Seat: 2, Player: "p2", Stack: 100, MuckLosing: true},
		{Seat: 3, Player: "p3", Stack: 1000, MuckLosing: true},
	}, Deck: deck})
	if err != nil {
		t.Fatal(err)
	}
	mustAct(t, h, 1, ActionCall, 0)
	mustAct(t, h, 2, ActionAllIn, 0)
	mustAct(t, h, 3, ActionCall, 0)
	ev := mustAct(t, h, 1, ActionCall, 0)
	ev = append(ev, checkDown(t, h)...)
	if len(eventsOf[CardsMucked](ev)) != 0 || len(eventsOf[CardsRevealed](ev)) != 3 {
		t.Fatalf("all-in showdown: %v", showdownOrder(ev))
	}
}

func TestPlayersShowCardsAfterTheHand(t *testing.T) {
	deck := stackedDeck(t, [][2]string{{"Ah", "Ac"}, {"Kh", "Kc"}, {"Qh", "Qc"}}, [5]string{"2s", "7d", "9c", "3h", "4d"})
	h, _, _ := NewHand(HandConfig{SmallBlind: 5, BigBlind: 10, ButtonSeat: 1, Seats: seats(1000, 1000, 1000), Deck: deck})
	ah, _ := ParseCard("Ah")
	qh, _ := ParseCard("Qh")
	qc, _ := ParseCard("Qc")
	if _, err := h.ShowCards(1, []Card{qh}); !errors.Is(err, ErrIllegalAction) {
		t.Fatalf("showing during the hand: %v", err)
	}
	mustAct(t, h, 1, ActionRaise, 40)
	mustAct(t, h, 2, ActionFold, 0)
	mustAct(t, h, 3, ActionFold, 0)
	if !h.IsComplete() {
		t.Fatal("hand should be over")
	}

	// The uncontested winner shows one card, then the other.
	shown, err := h.ShowCards(1, []Card{qh})
	if err != nil || shown.Seat != 1 || !reflect.DeepEqual(shown.Cards, []Card{qh}) {
		t.Fatalf("show one card: %+v %v", shown, err)
	}
	if _, err := h.ShowCards(1, []Card{qh}); !errors.Is(err, ErrIllegalAction) {
		t.Fatalf("showing a card twice: %v", err)
	}
	if _, err := h.ShowCards(1, []Card{qc}); err != nil {
		t.Fatal(err)
	}
	// A folded player may show too, but only their own cards.
	if _, err := h.ShowCards(2, []Card{ah}); err != nil {
		t.Fatalf("folded player shows: %v", err)
	}
	for _, bad := range [][]Card{nil, {qh}, {ah, ah}} {
		if _, err := h.ShowCards(3, bad); !errors.Is(err, ErrIllegalAction) {
			t.Fatalf("show %v: %v", bad, err)
		}
	}
	if _, err := h.ShowCards(5, []Card{ah}); err == nil {
		t.Fatal("a seat not dealt in cannot show")
	}
	got := map[int][]Card{}
	for _, r := range h.Results() {
		got[r.Seat] = r.Shown
	}
	if !reflect.DeepEqual(got[1], []Card{qh, qc}) || len(got[2]) != 1 || got[3] != nil {
		t.Fatalf("results shown: %v", got)
	}

	// Hands revealed at showdown cannot be "shown" again.
	sd, _ := threeWayCheckDown(t)
	if _, err := sd.ShowCards(2, []Card{ah}); !errors.Is(err, ErrIllegalAction) {
		t.Fatalf("show after showdown reveal: %v", err)
	}
}

func TestTableTracksTheMuckPreference(t *testing.T) {
	tb, _ := NewTable(TableConfig{MaxSeats: 6, SmallBlind: 5, BigBlind: 10})
	_ = tb.SitDown(1, "a", 1000)
	_ = tb.SitDown(2, "b", 1000)
	if err := tb.SetMuckLosing(1, true); err != nil {
		t.Fatal(err)
	}
	if err := tb.SetMuckLosing(4, true); err == nil {
		t.Fatal("an empty seat has no preference")
	}
	if _, err := tb.ShowCards(1, nil); !errors.Is(err, ErrIllegalAction) {
		t.Fatalf("no hand yet: %v", err)
	}
	h, _, err := tb.StartHand(NewOrderedDeck())
	if err != nil {
		t.Fatal(err)
	}
	if !h.players[0].muckLosing || h.players[1].muckLosing {
		t.Fatal("the preference is dealt into the hand")
	}
	r, err := RestoreTable(tb.Config(), tb.Seats(), tb.ButtonSeat(), tb.HandNo())
	if err != nil {
		t.Fatal(err)
	}
	if s, _ := r.SeatState(1); !s.MuckLosing {
		t.Fatal("restored seats keep the preference")
	}
}
