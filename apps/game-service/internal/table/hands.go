package table

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	ledger "github.com/bar1287/kofclub/go/ledger-client"
	"github.com/bar1287/kofclub/go/poker"
)

const saltSize = 16

// startHand shuffles a fresh deck from the cryptographic source, deals the
// next hand and persists it (encrypted deck, encrypted hole cards, deck
// commitment) before any card is shown to anyone.
func (a *Actor) startHand() {
	defer a.afterChange()
	if h := a.table.Hand(); (h != nil && !h.IsComplete()) || a.draining || a.cfg.Status != "OPEN" {
		return
	}
	// Tournament tables seat arrivals and rebalance before dealing.
	a.tourTick()
	if !a.table.CanStartHand() || (a.tour != nil && a.tour.finished) {
		return
	}
	if a.refreshStatus(); a.cfg.Status != "OPEN" {
		return
	}
	deck, err := poker.NewShuffledDeck(a.deps.Rand)
	if err != nil {
		a.log.Error("shuffle_failed", slog.String("error", err.Error()))
		return
	}
	salt := make([]byte, saltSize)
	if _, err := io.ReadFull(a.deps.Rand, salt); err != nil {
		a.log.Error("salt_failed", slog.String("error", err.Error()))
		return
	}
	commitment := poker.DeckCommitment(deck, salt)
	commitHex := hex.EncodeToString(commitment[:])
	handID := uuid.Must(uuid.NewV7()).String()

	next := a.table.Clone()
	if a.tour != nil {
		lvl := a.tour.level(time.Now())
		if err := next.SetBlinds(lvl.SmallBlind, lvl.BigBlind); err != nil {
			a.log.Error("set_blinds_failed", slog.String("error", err.Error()))
			return
		}
	}
	hand, evs, err := next.StartHand(deck)
	if err != nil {
		a.log.Error("start_hand_failed", slog.String("error", err.Error()))
		return
	}
	deckPlain := append(append([]byte{}, salt...), cardBytes(deck)...)
	deckEnc, err := a.deps.Sealer.Seal(deckPlain, "deck:"+handID)
	if err != nil {
		a.log.Error("seal_failed", slog.String("error", err.Error()))
		return
	}
	newHand := store.NewHand{
		ID: handID, GameType: string(hand.Game()), TableID: a.cfg.ID, ClubID: a.cfg.ClubID, HandNo: hand.HandNo(), ButtonSeat: hand.ButtonSeat(),
		SmallBlind: hand.SmallBlind(), BigBlind: hand.BigBlind(), DeckCommitment: commitHex, DeckEnc: deckEnc, LeaseEpoch: a.fence.Epoch,
	}
	for _, p := range hand.Players() {
		enc, err := a.deps.Sealer.Seal(cardBytes(p.HoleCards), "hole:"+handID+":"+string(p.Player))
		if err != nil {
			a.log.Error("seal_failed", slog.String("error", err.Error()))
			return
		}
		newHand.Players = append(newHand.Players, store.HandPlayerRecord{
			UserID: string(p.Player), SeatNo: p.Seat, StartingStack: p.Stack + p.Contributed, HoleCardsEnc: enc,
		})
	}

	prevHandID, prevCommitment := a.handID, a.commitment
	a.handID, a.commitment = handID, commitHex
	drafts := translate(handID, commitHex, evs, false)
	if a.tour != nil {
		info := a.tour.info(time.Now())
		for i := range drafts {
			if p, ok := drafts[i].public.(handStartedPayload); ok {
				p.Tournament = &info
				drafts[i].public = p
			}
		}
	}
	var endBuild func(ctx context.Context, tx pgx.Tx) ([]draft, error)
	if hand.IsComplete() {
		// Everyone was all-in from the blinds: the hand settles immediately.
		endBuild, err = a.handEnd(next, evs)
		if err != nil {
			a.handID, a.commitment = prevHandID, prevCommitment
			a.log.Error("hand_end_failed", slog.String("error", err.Error()))
			return
		}
	} else if t := a.turnDraft(next); t != nil {
		drafts = append(drafts, *t)
	}
	_, err = a.commitTx(next, func(ctx context.Context, tx pgx.Tx) ([]draft, error) {
		if err := store.InsertHand(ctx, tx, newHand); err != nil {
			return nil, err
		}
		if endBuild == nil {
			return drafts, nil
		}
		extra, err := endBuild(ctx, tx)
		if err != nil {
			return nil, err
		}
		return append(append([]draft(nil), drafts...), extra...), nil
	})
	if err != nil {
		a.handID, a.commitment = prevHandID, prevCommitment
		a.log.Warn("start_hand_persist_failed", slog.String("error", err.Error()))
		return
	}
	a.deps.Metrics.HandsStarted.Inc()
	a.log.Info("hand_started", slog.String("hand_id", handID), slog.Int64("hand_no", hand.HandNo()), slog.Int("players", len(hand.Players())))
	if hand.IsComplete() {
		a.onHandFinished()
	}
}

// prepareHandEnd computes everything that must commit atomically with the
// final action of a hand: the HAND_SETTLEMENT ledger posting (net result
// per player between table-stack accounts), hand/participant results,
// departures of players who asked to leave or busted, seat projections and
// a final ledger-vs-table consistency assertion. It mutates next (standing
// players up) and returns extra events plus the transactional work.
func (a *Actor) prepareHandEnd(next *poker.Table, evs []poker.Event) ([]draft, func(ctx context.Context, tx pgx.Tx) error, error) {
	hand := next.Hand()
	results := hand.Results()
	handID := a.handID
	players, board, resultHash := handRecord(handID, hand, evs)

	// Post-hand departures.
	next.FinishHand()
	var extra []draft
	type departure struct {
		user  string
		stack int64
	}
	var leavers []departure
	for _, s := range next.Seats() {
		user := string(s.Player)
		switch {
		case a.leaving[user]:
			if _, err := next.StandUp(s.Seat); err != nil {
				return nil, nil, fromEngine(err)
			}
			leavers = append(leavers, departure{user: user, stack: s.Stack})
			extra = append(extra, draft{kind: KindPlayerLeft, public: playerLeftPayload{
				Kind: KindPlayerLeft, Seat: s.Seat, UserID: user, Reason: "LEFT", CashOut: s.Stack,
			}})
		case s.Stack == 0:
			if _, err := next.StandUp(s.Seat); err != nil {
				return nil, nil, fromEngine(err)
			}
			leavers = append(leavers, departure{user: user})
			extra = append(extra, draft{kind: KindPlayerLeft, public: playerLeftPayload{
				Kind: KindPlayerLeft, Seat: s.Seat, UserID: user, Reason: "BUSTED",
			}})
		}
	}
	remaining := seatStacks(next)

	work := func(ctx context.Context, tx pgx.Tx) error {
		var entries []ledger.Entry
		for _, r := range results {
			if r.Net == 0 {
				continue
			}
			acct, err := ledger.EnsureAccount(ctx, tx, a.cfg.ClubID, ledger.AccountTableStack, string(r.Player), a.cfg.ID)
			if err != nil {
				return err
			}
			entries = append(entries, ledger.Entry{AccountID: acct, Amount: r.Net, Reason: "HAND_RESULT", HandID: handID})
		}
		if len(entries) >= 2 {
			res, err := ledger.Post(ctx, tx, ledger.Posting{
				ExternalRef: "hand:" + handID, Kind: ledger.KindHandSettlement, ClubID: a.cfg.ClubID,
				ReferenceType: "hand", ReferenceID: handID,
				Metadata: map[string]any{"tableId": a.cfg.ID, "handNo": hand.HandNo(), "resultHash": resultHash},
				Entries:  entries,
			})
			if err != nil {
				return err
			}
			if !res.Created {
				return fmt.Errorf("hand %s was already settled", handID)
			}
		}
		if err := store.CompleteHand(ctx, tx, handID, board, resultHash, players); err != nil {
			return err
		}
		for _, d := range leavers {
			if err := a.cashOut(ctx, tx, d.user, d.stack, "cashout:"+a.cfg.ID+":"+d.user+":"+handID); err != nil {
				return err
			}
			if err := store.DeleteSeat(ctx, tx, a.cfg.ID, d.user); err != nil {
				return err
			}
		}
		if err := store.UpdateSeatStacks(ctx, tx, a.cfg.ID, remaining); err != nil {
			return err
		}
		return store.VerifyTableStacks(ctx, tx, a.cfg.ID, remaining)
	}
	return extra, work, nil
}

// handRecord derives the persisted results of a completed hand: per-player
// outcomes (with the cards shown at showdown), the board and a result hash.
func handRecord(handID string, hand *poker.Hand, evs []poker.Event) ([]store.PlayerResult, []string, string) {
	results := hand.Results()
	shown := map[int][]string{}
	for _, e := range evs {
		if cr, ok := e.(poker.CardsRevealed); ok {
			shown[cr.Seat] = cardStrings(cr.Cards)
		}
	}
	if hand.ShowdownReached() {
		for _, p := range hand.Players() {
			if !p.Folded {
				shown[p.Seat] = cardStrings(p.HoleCards)
			}
		}
	}
	players := make([]store.PlayerResult, len(results))
	for i, r := range results {
		players[i] = store.PlayerResult{
			UserID: string(r.Player), EndingStack: r.EndingStack, Contributed: r.Contributed,
			Won: r.Won, Net: r.Net, Folded: r.Folded, ShownCards: shown[r.Seat],
		}
	}
	board := make([]string, 0, 5)
	for _, c := range hand.Board() {
		board = append(board, c.String())
	}
	return players, board, hashResults(handID, board, players)
}

// handEnd returns the work that completes a hand inside the fenced
// transaction, together with the events it adds (departures, tournament
// eliminations). It mutates next (standing players up).
func (a *Actor) handEnd(next *poker.Table, evs []poker.Event) (func(ctx context.Context, tx pgx.Tx) ([]draft, error), error) {
	if a.tour != nil {
		return a.tournamentHandEnd(next, evs), nil
	}
	extra, work, err := a.prepareHandEnd(next, evs)
	if err != nil {
		return nil, err
	}
	return func(ctx context.Context, tx pgx.Tx) ([]draft, error) {
		if err := work(ctx, tx); err != nil {
			return nil, err
		}
		return extra, nil
	}, nil
}

// onHandFinished updates in-memory bookkeeping after a hand was settled.
func (a *Actor) onHandFinished() {
	a.deps.Metrics.HandsCompleted.Inc()
	a.recordHandOutcome()
	for user := range a.leaving {
		if a.table.SeatOf(poker.PlayerID(user)) == 0 {
			delete(a.leaving, user)
		}
	}
	a.log.Info("hand_completed", slog.String("hand_id", a.handID))
	if err := a.closeIfIdle(); err != nil {
		a.log.Warn("table_close_failed", slog.String("error", err.Error()))
	}
	a.stopIfIdleDrained()
}

func hashResults(handID string, board []string, players []store.PlayerResult) string {
	b, _ := json.Marshal(struct {
		HandID  string               `json:"handId"`
		Board   []string             `json:"board"`
		Players []store.PlayerResult `json:"players"`
	}{handID, board, players})
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func cardBytes(cards []poker.Card) []byte {
	out := make([]byte, len(cards))
	for i, c := range cards {
		out[i] = byte(c)
	}
	return out
}

func cardStrings(cards []poker.Card) []string {
	out := make([]string, len(cards))
	for i, c := range cards {
		out[i] = c.String()
	}
	return out
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

// recover rebuilds the actor from durable state. An unfinished hand is
// restored by deterministic replay of its persisted actions against the
// decrypted deck; if that fails for any reason the hand is voided (no chips
// move, stacks return to their start-of-hand values) instead of guessing.
func (a *Actor) recover(ctx context.Context) error {
	rt, err := a.deps.Store.LoadRuntime(ctx, a.cfg.ID)
	if err != nil {
		return err
	}
	seats, err := a.deps.Store.LoadSeats(ctx, a.cfg.ID)
	if err != nil {
		return err
	}
	states := make([]poker.SeatState, len(seats))
	for i, s := range seats {
		states[i] = poker.SeatState{Seat: s.SeatNo, Player: poker.PlayerID(s.UserID), Stack: s.Stack, SittingOut: s.SittingOut}
		a.usernames[s.UserID] = s.Username
	}
	table, err := poker.RestoreTable(poker.TableConfig{Game: poker.GameType(a.cfg.GameType), MaxSeats: a.cfg.MaxSeats,
		SmallBlind: a.cfg.SmallBlind, BigBlind: a.cfg.BigBlind, DealSittingOut: a.tour != nil},
		states, rt.ButtonSeat, rt.LastHandNo)
	if err != nil {
		return fmt.Errorf("restore table: %w", err)
	}
	a.table = table
	a.seq = rt.LastSeq

	cmds, err := a.deps.Store.LoadRecentCommands(ctx, a.cfg.ID, 4096)
	if err != nil {
		return err
	}
	for i := len(cmds) - 1; i >= 0; i-- {
		c := cmds[i]
		a.processed.put(c.CommandID, CommandResult{CommandID: c.CommandID, UserID: c.UserID, Accepted: true, Seq: c.Seq})
	}

	hr, err := a.deps.Store.LoadInProgressHand(ctx, a.cfg.ID)
	if err != nil || hr == nil {
		return err
	}
	hand, commitment, rerr := a.rebuildHand(hr)
	if rerr == nil {
		next := a.table.Clone()
		if rerr = next.ResumeHand(hand); rerr == nil {
			a.handID, a.commitment = hr.ID, commitment
			drafts := []draft{}
			if t := a.turnDraft(next); t != nil {
				drafts = append(drafts, *t)
			}
			if _, err := a.commit(next, drafts, nil); err != nil {
				return err
			}
			a.deps.Metrics.HandsResumed.Inc()
			a.log.Info("hand_resumed", slog.String("hand_id", hr.ID), slog.Int("actions_replayed", len(hr.Actions)))
			return nil
		}
	}
	a.log.Error("hand_replay_failed_voiding", slog.String("hand_id", hr.ID), slog.String("error", rerr.Error()))
	return a.voidHand(hr.ID, hr.HandNo, "RECOVERY_REPLAY_FAILED")
}

// rebuildHand decrypts the deck and replays the persisted actions,
// verifying that every replayed action reproduces the persisted event.
func (a *Actor) rebuildHand(hr *store.HandRecord) (*poker.Hand, string, error) {
	plain, err := a.deps.Sealer.Open(hr.DeckEnc, "deck:"+hr.ID)
	if err != nil {
		return nil, "", fmt.Errorf("decrypt deck: %w", err)
	}
	if len(plain) != saltSize+poker.DeckSize {
		return nil, "", errors.New("corrupt deck payload")
	}
	deck := make([]poker.Card, poker.DeckSize)
	for i, b := range plain[saltSize:] {
		deck[i] = poker.Card(b)
	}
	commitment := poker.DeckCommitment(deck, plain[:saltSize])
	seats := make([]poker.SeatSetup, len(hr.Players))
	for i, p := range hr.Players {
		seats[i] = poker.SeatSetup{Seat: p.SeatNo, Player: poker.PlayerID(p.UserID), Stack: p.StartingStack}
	}
	hand, _, err := poker.NewHand(poker.HandConfig{
		Game: poker.GameType(hr.GameType), HandNo: hr.HandNo, SmallBlind: hr.SmallBlind, BigBlind: hr.BigBlind, ButtonSeat: hr.ButtonSeat, Seats: seats, Deck: deck,
	})
	if err != nil {
		return nil, "", err
	}
	for i, raw := range hr.Actions {
		var p playerActedPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil, "", err
		}
		evs, err := hand.Act(poker.Action{Seat: p.Seat, Kind: poker.ActionKind(p.Action), Amount: p.StreetBet})
		if err != nil {
			return nil, "", fmt.Errorf("replay action %d: %w", i, err)
		}
		var got *poker.PlayerActed
		for _, e := range evs {
			if pa, ok := e.(poker.PlayerActed); ok {
				got = &pa
			}
		}
		if got == nil || got.Seat != p.Seat || string(got.Kind) != p.Action || got.Added != p.Added ||
			got.StreetBet != p.StreetBet || got.Stack != p.Stack || got.Pot != p.Pot || got.AllIn != p.AllIn {
			return nil, "", fmt.Errorf("replay action %d diverged from the persisted event", i)
		}
	}
	if hand.IsComplete() {
		return nil, "", errors.New("replayed hand is complete but was never settled")
	}
	return hand, hex.EncodeToString(commitment[:]), nil
}

// voidHand cancels an unfinished hand: nothing was settled, so stacks are
// the persisted start-of-hand values and no chips move.
func (a *Actor) voidHand(handID string, handNo int64, reason string) error {
	next := a.table.Clone()
	next.AbortHand()
	d := draft{kind: KindHandVoided, handID: handID, public: handVoidedPayload{Kind: KindHandVoided, HandID: handID, HandNo: handNo, Reason: reason}}
	_, err := a.commit(next, []draft{d}, func(ctx context.Context, tx pgx.Tx) error {
		if err := store.VoidHand(ctx, tx, handID, reason); err != nil {
			return err
		}
		return a.verifyChips(ctx, tx, next)
	})
	if err != nil {
		return err
	}
	a.handID = ""
	a.deps.Metrics.HandsVoided.WithLabelValues(reason).Inc()
	return nil
}
