package poker

import (
	"errors"
	"reflect"
	"testing"
)

func newTestTable(t *testing.T) *Table {
	t.Helper()
	table, err := NewTable(TableConfig{MaxSeats: 6, SmallBlind: 5, BigBlind: 10})
	if err != nil {
		t.Fatal(err)
	}
	return table
}

func playOut(t *testing.T, table *Table) {
	t.Helper()
	h := table.Hand()
	for !h.IsComplete() {
		a, _ := h.DefaultAction()
		if _, err := table.Act(a); err != nil {
			t.Fatal(err)
		}
	}
	table.FinishHand()
}

func TestTableSeatingRules(t *testing.T) {
	table := newTestTable(t)
	if err := table.SitDown(1, "a", 1000); err != nil {
		t.Fatal(err)
	}
	if err := table.SitDown(1, "b", 1000); !errors.Is(err, &Error{Code: CodeSeatTaken}) {
		t.Fatalf("seat taken: %v", err)
	}
	if err := table.SitDown(2, "a", 1000); !errors.Is(err, &Error{Code: CodeAlreadySeated}) {
		t.Fatalf("already seated: %v", err)
	}
	for _, bad := range []int{0, 7} {
		if err := table.SitDown(bad, "z", 100); err == nil {
			t.Fatalf("seat %d should not exist", bad)
		}
	}
	if table.CanStartHand() {
		t.Fatal("one player cannot start a hand")
	}
	if _, _, err := table.StartHand(NewOrderedDeck()); err == nil {
		t.Fatal("start with one player must fail")
	}
}

func TestButtonRotationAndJoiningBetweenHands(t *testing.T) {
	table := newTestTable(t)
	_ = table.SitDown(2, "a", 1000)
	_ = table.SitDown(5, "b", 1000)
	h, _, err := table.StartHand(NewOrderedDeck())
	if err != nil {
		t.Fatal(err)
	}
	if h.ButtonSeat() != 2 || table.Phase() != PhaseHandInProgress {
		t.Fatalf("first button %d phase %s", h.ButtonSeat(), table.Phase())
	}
	// A player sitting down mid-hand waits for the next hand.
	if err := table.SitDown(4, "c", 1000); err != nil {
		t.Fatal(err)
	}
	if table.InHand(4) {
		t.Fatal("late joiner must not be dealt into the current hand")
	}
	playOut(t, table)
	h2, _, _ := table.StartHand(NewOrderedDeck())
	if h2.ButtonSeat() != 4 || len(h2.Players()) != 3 {
		t.Fatalf("button should move clockwise to seat 4 with 3 players, got %d/%d", h2.ButtonSeat(), len(h2.Players()))
	}
	playOut(t, table)
	h3, _, _ := table.StartHand(NewOrderedDeck())
	if h3.ButtonSeat() != 5 {
		t.Fatalf("button = %d, want 5", h3.ButtonSeat())
	}
	playOut(t, table)
	h4, _, _ := table.StartHand(NewOrderedDeck())
	if h4.ButtonSeat() != 2 || h4.HandNo() != 4 {
		t.Fatalf("button should wrap to seat 2 (hand 4), got %d (hand %d)", h4.ButtonSeat(), h4.HandNo())
	}
}

func TestSittingOutAndStandingUp(t *testing.T) {
	table := newTestTable(t)
	_ = table.SitDown(1, "a", 1000)
	_ = table.SitDown(2, "b", 1000)
	_ = table.SitDown(3, "c", 1000)
	_ = table.SetSittingOut(3, true)
	h, _, _ := table.StartHand(NewOrderedDeck())
	if len(h.Players()) != 2 {
		t.Fatalf("sitting-out player dealt in: %d players", len(h.Players()))
	}
	if _, err := table.StandUp(1); err == nil {
		t.Fatal("cannot stand up during own hand")
	}
	stack, err := table.StandUp(3)
	if err != nil || stack != 1000 {
		t.Fatalf("sitting-out player may leave mid-hand: %d %v", stack, err)
	}
	playOut(t, table)
	if _, err := table.StandUp(1); err != nil {
		t.Fatalf("stand up after hand: %v", err)
	}
	if table.SeatOf("a") != 0 || len(table.FreeSeats()) != 5 {
		t.Fatal("seat not freed")
	}
}

func TestAbortHandRestoresStartingStacks(t *testing.T) {
	table := newTestTable(t)
	_ = table.SitDown(1, "a", 1000)
	_ = table.SitDown(2, "b", 500)
	h, _, _ := table.StartHand(NewOrderedDeck())
	seat, _ := h.CurrentActor()
	if _, err := table.Act(Action{Seat: seat, Kind: ActionRaise, Amount: 100}); err != nil {
		t.Fatal(err)
	}
	table.AbortHand()
	stacks := map[int]int64{}
	for _, s := range table.Seats() {
		stacks[s.Seat] = s.Stack
	}
	if stacks[1] != 1000 || stacks[2] != 500 || table.Phase() != PhaseWaitingForPlayers || table.Hand() != nil {
		t.Fatalf("abort must restore stacks: %v phase %s", stacks, table.Phase())
	}
	// Hand numbers keep increasing so a voided hand id is never reused.
	h2, _, _ := table.StartHand(NewOrderedDeck())
	if h2.HandNo() != 2 {
		t.Fatalf("hand no = %d", h2.HandNo())
	}
}

func TestRestoreTable(t *testing.T) {
	table, err := RestoreTable(TableConfig{MaxSeats: 6, SmallBlind: 5, BigBlind: 10},
		[]SeatState{{Seat: 2, Player: "a", Stack: 300}, {Seat: 4, Player: "b", Stack: 200, SittingOut: true}, {Seat: 6, Player: "c", Stack: 100}},
		4, 41)
	if err != nil {
		t.Fatal(err)
	}
	h, _, _ := table.StartHand(NewOrderedDeck())
	if h.ButtonSeat() != 6 || h.HandNo() != 42 || len(h.Players()) != 2 {
		t.Fatalf("restored table: button %d hand %d players %d", h.ButtonSeat(), h.HandNo(), len(h.Players()))
	}
}

func TestCloneIsIndependent(t *testing.T) {
	table := newTestTable(t)
	_ = table.SitDown(1, "a", 1000)
	_ = table.SitDown(2, "b", 1000)
	_, _, _ = table.StartHand(NewOrderedDeck())
	clone := table.Clone()
	seat, _ := clone.Hand().CurrentActor()
	if _, err := clone.Act(Action{Seat: seat, Kind: ActionRaise, Amount: 50}); err != nil {
		t.Fatal(err)
	}
	if table.Hand().CurrentBet() != 10 {
		t.Fatal("acting on a clone must not change the original")
	}
	if s, _ := table.SeatState(seat); s.Stack != 995 {
		t.Fatalf("original seat stack changed: %d", s.Stack)
	}
}

func TestResumeHandByReplay(t *testing.T) {
	// Play part of a hand, then rebuild it from config + actions on a
	// freshly restored table and verify the states match.
	table := newTestTable(t)
	_ = table.SitDown(1, "a", 1000)
	_ = table.SitDown(3, "b", 700)
	_ = table.SitDown(5, "c", 400)
	deck, _ := NewShuffledDeck(newSeededReader(3))
	h, _, _ := table.StartHand(deck)
	var players []SeatSetup
	for _, p := range h.Players() {
		players = append(players, SeatSetup{Seat: p.Seat, Player: p.Player, Stack: p.Stack + p.Contributed})
	}
	var actions []Action
	for i := 0; i < 4 && !h.IsComplete(); i++ {
		seat, _ := h.CurrentActor()
		a := Action{Seat: seat, Kind: ActionCall}
		if i == 1 {
			la, _ := legal(h, ActionRaise)
			a = Action{Seat: seat, Kind: ActionRaise, Amount: la.MinTo}
		}
		if _, err := table.Act(a); err != nil {
			t.Fatal(err)
		}
		actions = append(actions, a)
	}

	restored, _ := RestoreTable(table.Config(), []SeatState{
		{Seat: 1, Player: "a", Stack: 1000}, {Seat: 3, Player: "b", Stack: 700}, {Seat: 5, Player: "c", Stack: 400},
		{Seat: 6, Player: "late", Stack: 300}, // sat down mid-hand: not part of the replayed hand
	}, 0, 0)
	replayed, _, err := NewHand(HandConfig{HandNo: h.HandNo(), SmallBlind: 5, BigBlind: 10, ButtonSeat: h.ButtonSeat(), Seats: players, Deck: deck})
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range actions {
		if _, err := replayed.Act(a); err != nil {
			t.Fatal(err)
		}
	}
	if err := restored.ResumeHand(replayed); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored.Hand().Players(), table.Hand().Players()) || restored.HandNo() != table.HandNo() {
		t.Fatal("replayed hand diverged from the original")
	}
	for _, s := range table.Seats() {
		got, _ := restored.SeatState(s.Seat)
		if got.Stack != s.Stack {
			t.Fatalf("seat %d stack %d want %d", s.Seat, got.Stack, s.Stack)
		}
	}
	if restored.InHand(6) {
		t.Fatal("late joiner must not be in the resumed hand")
	}
}

func TestTournamentTableOptions(t *testing.T) {
	table, _ := NewTable(TableConfig{MaxSeats: 6, SmallBlind: 5, BigBlind: 10, DealSittingOut: true})
	for _, seat := range []int{1, 3, 5, 6} {
		if err := table.SitDown(seat, PlayerID(string(rune('a'+seat))), 1000); err != nil {
			t.Fatal(err)
		}
	}
	_ = table.SetSittingOut(3, true)
	// First hand: button 1, SB 3, BB 5 -> big blinds in order 5, 6, 1, 3.
	if got := table.BigBlindOrder(); !reflect.DeepEqual(got, []int{5, 6, 1, 3}) {
		t.Fatalf("big blind order %v", got)
	}
	if err := table.SetBlinds(10, 20); err != nil {
		t.Fatal(err)
	}
	h, _, err := table.StartHand(NewOrderedDeck())
	if err != nil {
		t.Fatal(err)
	}
	if h.BigBlind() != 20 || h.BigBlindSeat() != 5 {
		t.Fatalf("hand blinds %d at seat %d", h.BigBlind(), h.BigBlindSeat())
	}
	if !table.InHand(3) {
		t.Fatal("sitting-out players are dealt in at tournament tables")
	}
	if err := table.SetBlinds(20, 40); err == nil {
		t.Fatal("blinds changed during a hand")
	}
	playOut(t, table)
	// Next hand: button 3 -> SB 5, BB 6.
	if got := table.BigBlindOrder(); !reflect.DeepEqual(got, []int{6, 1, 3, 5}) {
		t.Fatalf("big blind order after one hand %v", got)
	}
	if err := table.SetBlinds(0, 10); err == nil {
		t.Fatal("invalid blinds accepted")
	}

	// Heads-up the button posts the small blind, the other seat the big blind.
	hu, _ := NewTable(TableConfig{MaxSeats: 6, SmallBlind: 5, BigBlind: 10})
	_ = hu.SitDown(2, "x", 100)
	_ = hu.SitDown(4, "y", 100)
	if got := hu.BigBlindOrder(); !reflect.DeepEqual(got, []int{4, 2}) {
		t.Fatalf("heads-up big blind order %v", got)
	}
	// Cash tables still skip sitting-out players.
	_ = hu.SitDown(5, "z", 100)
	_ = hu.SetSittingOut(5, true)
	if got := hu.BigBlindOrder(); len(got) != 2 {
		t.Fatalf("cash table must not deal sitting-out players: %v", got)
	}
}
