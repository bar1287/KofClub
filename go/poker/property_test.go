package poker

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	mrand "math/rand/v2"
	"reflect"
	"testing"
)

func newSeededReader(seed uint64) io.Reader {
	var s [32]byte
	binary.LittleEndian.PutUint64(s[:], seed)
	return mrand.NewChaCha8(s)
}

type randomHandStats struct {
	hands, showdowns, uncontested, sidePots, splitPots, allInRunouts, actions int
}

// randomHand builds a random hand configuration of the given game from seed.
func randomHand(seed uint64, game GameType) (HandConfig, *mrand.Rand) {
	r := mrand.New(mrand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	n := 2 + r.IntN(8)
	sb := []int64{1, 5, 10, 25}[r.IntN(4)]
	bb := sb * 2
	seatNos := r.Perm(10)[:n]
	setup := make([]SeatSetup, n)
	for i := range setup {
		var stack int64
		switch r.IntN(5) {
		case 0:
			stack = 1 + r.Int64N(3*bb) // short: forces all-ins and short blinds
		case 1:
			stack = bb * (5 + r.Int64N(20))
		default:
			stack = bb * (20 + r.Int64N(280))
		}
		setup[i] = SeatSetup{Seat: seatNos[i] + 1, Player: PlayerID(fmt.Sprintf("player-%d", i)), Stack: stack}
	}
	deck, _ := NewShuffledDeck(newSeededReader(seed))
	return HandConfig{
		Game: game, HandNo: int64(seed), SmallBlind: sb, BigBlind: bb,
		ButtonSeat: setup[r.IntN(n)].Seat, Seats: setup, Deck: deck,
	}, r
}

// chooseAction picks a random legal action with weights that keep most
// hands going across several streets while producing folds, raises,
// all-ins and varied sizing.
func chooseAction(r *mrand.Rand, seat int, legal []LegalAction) Action {
	byKind := map[ActionKind]LegalAction{}
	for _, la := range legal {
		byKind[la.Kind] = la
	}
	pick := func(kinds ...ActionKind) (LegalAction, bool) {
		for _, k := range kinds {
			if la, ok := byKind[k]; ok {
				return la, true
			}
		}
		return LegalAction{}, false
	}
	roll := r.IntN(100)
	var la LegalAction
	var ok bool
	if _, facingBet := byKind[ActionCall]; facingBet {
		// Facing a bet: fold 35%, call 40%, raise 18%, all-in 7%.
		switch {
		case roll < 35:
			la, ok = pick(ActionFold)
		case roll < 75:
			la, ok = pick(ActionCall)
		case roll < 93:
			la, ok = pick(ActionRaise)
		default:
			la, ok = pick(ActionAllIn)
		}
	} else {
		// Unopened: check 60%, bet 33%, all-in 7%.
		switch {
		case roll < 60:
			la, ok = pick(ActionCheck)
		case roll < 93:
			la, ok = pick(ActionBet, ActionRaise)
		default:
			la, ok = pick(ActionAllIn)
		}
	}
	if !ok {
		la, _ = pick(ActionCheck, ActionCall)
	}
	a := Action{Seat: seat, Kind: la.Kind}
	if la.Kind == ActionBet || la.Kind == ActionRaise {
		switch n := r.IntN(10); {
		case n < 5:
			a.Amount = la.MinTo
		case n < 9:
			span := min(la.MaxTo-la.MinTo, 4*la.MinTo)
			a.Amount = la.MinTo + r.Int64N(span+1)
		default:
			a.Amount = la.MaxTo
		}
	}
	return a
}

func checkRunningInvariants(t *testing.T, h *Hand, startTotal int64) {
	t.Helper()
	seen := map[Card]bool{}
	var total int64
	for _, p := range h.Players() {
		if p.Stack < 0 || p.StreetBet < 0 || p.Contributed < 0 {
			t.Fatalf("negative chips: %+v", p)
		}
		if p.StreetBet > p.Contributed {
			t.Fatalf("street bet exceeds contribution: %+v", p)
		}
		total += p.Stack + p.Contributed
		for _, c := range p.HoleCards {
			if seen[c] {
				t.Fatalf("duplicate card %s", c)
			}
			seen[c] = true
		}
	}
	for _, c := range h.Board() {
		if seen[c] {
			t.Fatalf("duplicate board card %s", c)
		}
		seen[c] = true
	}
	if !h.IsComplete() && total != startTotal {
		t.Fatalf("chips not conserved mid-hand: %d != %d", total, startTotal)
	}
	wantBoard := map[Street]int{StreetPreflop: 0, StreetFlop: 3, StreetTurn: 4, StreetRiver: 5}
	if n, ok := wantBoard[h.Street()]; ok && len(h.Board()) != n {
		t.Fatalf("street %s with %d board cards", h.Street(), len(h.Board()))
	}
}

// Every emitted legal action must be accepted by the engine (spec §15.1),
// at both ends of its sizing range.
func checkLegalActionsAccepted(t *testing.T, h *Hand) {
	t.Helper()
	seat, _ := h.CurrentActor()
	for _, la := range h.LegalActions() {
		amounts := []int64{0}
		if la.Kind == ActionBet || la.Kind == ActionRaise {
			if la.MinTo > la.MaxTo || la.MinTo <= 0 {
				t.Fatalf("bad bounds %+v", la)
			}
			amounts = []int64{la.MinTo, la.MaxTo}
		}
		for _, amt := range amounts {
			if _, err := h.Clone().Act(Action{Seat: seat, Kind: la.Kind, Amount: amt}); err != nil {
				t.Fatalf("legal action %+v (amount %d) rejected: %v", la, amt, err)
			}
		}
	}
}

// Illegal intents are rejected without mutating state.
func checkIllegalActionsRejected(t *testing.T, h *Hand, r *mrand.Rand) {
	t.Helper()
	seat, _ := h.CurrentActor()
	before := h.Clone()
	var other int
	for _, p := range h.Players() {
		if p.Seat != seat {
			other = p.Seat
			break
		}
	}
	if _, err := h.Act(Action{Seat: other, Kind: ActionFold}); !errors.Is(err, ErrNotYourTurn) {
		t.Fatalf("out-of-turn fold: %v", err)
	}
	for _, la := range h.LegalActions() {
		if (la.Kind == ActionBet || la.Kind == ActionRaise) && la.MinTo < la.MaxTo && la.MinTo-1 > h.CurrentBet() {
			if _, err := h.Act(Action{Seat: seat, Kind: la.Kind, Amount: la.MinTo - 1}); !errors.Is(err, ErrInvalidRaise) {
				t.Fatalf("undersized %s accepted: %v", la.Kind, err)
			}
			if _, err := h.Act(Action{Seat: seat, Kind: la.Kind, Amount: la.MaxTo + 1 + r.Int64N(100)}); !errors.Is(err, ErrInvalidRaise) {
				t.Fatalf("oversized %s accepted: %v", la.Kind, err)
			}
		}
	}
	// All-in is only accepted when offered (in PLO it may exceed the limit).
	if _, ok := legal(h, ActionAllIn); !ok {
		if _, err := h.Act(Action{Seat: seat, Kind: ActionAllIn}); err == nil {
			t.Fatal("all-in accepted although not offered")
		}
	}
	if !reflect.DeepEqual(h, before) {
		t.Fatal("rejected action mutated the hand")
	}
}

func checkFinalInvariants(t *testing.T, h *Hand, cfg HandConfig, events []Event, stats *randomHandStats) {
	t.Helper()
	var startTotal, endTotal, netSum, contributed, awarded int64
	results := h.Results()
	contribByseat := map[int]int64{}
	for _, r := range results {
		contribByseat[r.Seat] = r.Contributed
	}
	for _, s := range cfg.Seats {
		startTotal += s.Stack
	}
	revealed := map[int]int{}
	for _, e := range events {
		switch ev := e.(type) {
		case PotAwarded:
			awarded += ev.Amount
			var share int64
			for _, w := range ev.Winners {
				share += w.Amount
			}
			if share != ev.Amount {
				t.Fatalf("pot %d shares %d != amount %d", ev.PotIndex, share, ev.Amount)
			}
			if len(ev.Winners) > 1 {
				stats.splitPots++
			}
			if ev.PotIndex > 0 {
				stats.sidePots++
			}
		case CardsRevealed:
			revealed[ev.Seat]++
		}
	}
	if _, ok := events[len(events)-1].(HandCompleted); !ok {
		t.Fatal("HandCompleted must be the last event")
	}
	for _, r := range results {
		endTotal += r.EndingStack
		netSum += r.Net
		contributed += r.Contributed
		if r.EndingStack < 0 {
			t.Fatalf("negative final stack %+v", r)
		}
		if r.Folded && (r.Won != 0 || revealed[r.Seat] != 0) {
			t.Fatalf("folded player won or showed cards: %+v", r)
		}
		if h.ShowdownReached() && !r.Folded && revealed[r.Seat] != 1 {
			t.Fatalf("live player not revealed exactly once at showdown: %+v", r)
		}
		// Side-pot eligibility bound: a player can win at most what every
		// opponent contributed up to the player's own contribution.
		var bound int64
		for _, c := range contribByseat {
			bound += min(c, r.Contributed)
		}
		if r.Won > bound {
			t.Fatalf("seat %d won %d above eligibility bound %d", r.Seat, r.Won, bound)
		}
	}
	if endTotal != startTotal || netSum != 0 {
		t.Fatalf("chips created/destroyed: start %d end %d net %d", startTotal, endTotal, netSum)
	}
	if awarded != contributed {
		t.Fatalf("awarded %d != contributed %d", awarded, contributed)
	}
	if h.ShowdownReached() {
		stats.showdowns++
	} else {
		stats.uncontested++
		if len(revealed) != 0 {
			t.Fatal("cards revealed without showdown")
		}
	}
}

func TestRandomHandsPreserveInvariants(t *testing.T) {
	n := 12000
	if testing.Short() {
		n = 2000
	}
	runRandomHands(t, GameNLHE, n)
}

func TestRandomPLOHandsPreserveInvariants(t *testing.T) {
	n := 8000
	if testing.Short() {
		n = 1500
	}
	runRandomHands(t, GamePLO, n)
}

func runRandomHands(t *testing.T, game GameType, n int) {
	t.Helper()
	var stats randomHandStats
	streetsReached := map[Street]int{}
	for seed := uint64(1); seed <= uint64(n); seed++ {
		cfg, r := randomHand(seed, game)
		var startTotal int64
		for _, s := range cfg.Seats {
			startTotal += s.Stack
		}
		h, events, err := NewHand(cfg)
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		var actions []Action
		for steps := 0; !h.IsComplete(); steps++ {
			if steps > 500 {
				t.Fatalf("seed %d: hand did not terminate", seed)
			}
			checkRunningInvariants(t, h, startTotal)
			checkLegalActionsAccepted(t, h)
			if seed%7 == 0 {
				checkIllegalActionsRejected(t, h, r)
			}
			seat, _ := h.CurrentActor()
			a := chooseAction(r, seat, h.LegalActions())
			ev, err := h.Act(a)
			if err != nil {
				t.Fatalf("seed %d: chosen legal action %+v rejected: %v", seed, a, err)
			}
			actions = append(actions, a)
			events = append(events, ev...)
			stats.actions++
		}
		checkRunningInvariants(t, h, startTotal)
		checkFinalInvariants(t, h, cfg, events, &stats)
		for _, p := range h.Players() {
			if len(p.HoleCards) != game.HoleCardCount() {
				t.Fatalf("seed %d: seat %d has %d hole cards", seed, p.Seat, len(p.HoleCards))
			}
		}
		for _, sd := range eventsOf[StreetDealt](events) {
			streetsReached[sd.Street]++
		}
		if len(eventsOf[StreetDealt](events)) > 0 && h.ShowdownReached() {
			for _, p := range h.Players() {
				if p.AllIn {
					stats.allInRunouts++
					break
				}
			}
		}

		// Deterministic replay: the same deck and actions reproduce the events.
		if seed%50 == 0 {
			h2, ev2, _ := NewHand(cfg)
			for _, a := range actions {
				more, err := h2.Act(a)
				if err != nil {
					t.Fatalf("seed %d replay: %v", seed, err)
				}
				ev2 = append(ev2, more...)
			}
			if !reflect.DeepEqual(events, ev2) {
				t.Fatalf("seed %d: replay diverged", seed)
			}
		}
		stats.hands++
	}
	t.Logf("%s: %+v streets=%v", game, stats, streetsReached)
	// The generator must actually exercise the interesting paths.
	if stats.showdowns < n/10 || stats.uncontested < n/10 || stats.sidePots == 0 || stats.splitPots == 0 ||
		stats.allInRunouts == 0 || streetsReached[StreetRiver] < n/5 {
		t.Fatalf("insufficient coverage: %+v", stats)
	}
}

// Many consecutive hands at one table: chips are conserved across hands,
// the button moves, and busted players stop being dealt in.
func TestTableSessionConservesChips(t *testing.T) {
	for _, game := range []GameType{GameNLHE, GamePLO} {
		t.Run(string(game), func(t *testing.T) { tableSession(t, game) })
	}
}

func tableSession(t *testing.T, game GameType) {
	r := mrand.New(mrand.NewPCG(5, 6))
	table, _ := NewTable(TableConfig{Game: game, MaxSeats: 6, SmallBlind: 5, BigBlind: 10})
	var total int64
	for seat := 1; seat <= 6; seat++ {
		stack := int64(50 + r.IntN(500))
		total += stack
		if err := table.SitDown(seat, PlayerID(fmt.Sprintf("p%d", seat)), stack); err != nil {
			t.Fatal(err)
		}
	}
	rng := newSeededReader(99)
	buttons := map[int]bool{}
	hands := 0
	for table.CanStartHand() && hands < 2000 {
		deck, _ := NewShuffledDeck(rng)
		h, _, err := table.StartHand(deck)
		if err != nil {
			t.Fatal(err)
		}
		buttons[h.ButtonSeat()] = true
		for !h.IsComplete() {
			seat, _ := h.CurrentActor()
			if _, err := table.Act(chooseAction(r, seat, h.LegalActions())); err != nil {
				t.Fatal(err)
			}
		}
		table.FinishHand()
		var sum int64
		for _, s := range table.Seats() {
			sum += s.Stack
		}
		if sum != total {
			t.Fatalf("hand %d: table chips %d != %d", h.HandNo(), sum, total)
		}
		hands++
	}
	if len(buttons) < 2 {
		t.Fatalf("button never moved: %v", buttons)
	}
}
