package table

import (
	"context"
	"time"

	"github.com/bar1287/kofclub/go/poker"
)

// TableInfo is the static table configuration in snapshots.
type TableInfo struct {
	ClubID           string `json:"clubId"`
	Name             string `json:"name"`
	GameType         string `json:"gameType"`
	MaxSeats         int    `json:"maxSeats"`
	SmallBlind       int64  `json:"smallBlind"`
	BigBlind         int64  `json:"bigBlind"`
	BuyInMin         int64  `json:"buyInMin"`
	BuyInMax         int64  `json:"buyInMax"`
	ActionTimeoutMs  int64  `json:"actionTimeoutMs"`
	TimeBankMs       int64  `json:"timeBankMs"`
	TimeBankRefillMs int64  `json:"timeBankRefillMs"`
	Status           string `json:"status"`
	// Tournament is set at tournament tables; the blinds above are then the
	// current level's.
	Tournament *tournamentInfo `json:"tournament,omitempty"`
}

// SeatView is one seat as visible to every subscriber.
type SeatView struct {
	Seat       int    `json:"seat"`
	UserID     string `json:"userId"`
	Username   string `json:"username"`
	Stack      int64  `json:"stack"`
	SittingOut bool   `json:"sittingOut"`
	Leaving    bool   `json:"leaving"`
	InHand     bool   `json:"inHand"`
	Folded     bool   `json:"folded"`
	AllIn      bool   `json:"allIn"`
	StreetBet  int64  `json:"streetBet"`
	TimeBankMs int64  `json:"timeBankMs"`
	// BustedUntil is set while the player is out of chips (seat kept to re-buy).
	BustedUntil *time.Time   `json:"bustedUntil,omitempty"`
	ShownCards  []poker.Card `json:"shownCards,omitempty"`
}

// HandView is the public state of the current (or just completed) hand.
type HandView struct {
	HandID         string       `json:"handId"`
	HandNo         int64        `json:"handNo"`
	Street         string       `json:"street"`
	Board          []poker.Card `json:"board"`
	Pot            int64        `json:"pot"`
	CurrentBet     int64        `json:"currentBet"`
	MinRaise       int64        `json:"minRaise"`
	ButtonSeat     int          `json:"buttonSeat"`
	SmallBlindSeat int          `json:"smallBlindSeat"`
	BigBlindSeat   int          `json:"bigBlindSeat"`
	ToActSeat      int          `json:"toActSeat"`
	ActionDeadline *time.Time   `json:"actionDeadline"`
	UsingTimeBank  bool         `json:"usingTimeBank"`
	TurnSeq        int64        `json:"turnSeq"`
	DeckCommitment string       `json:"deckCommitment"`
}

// YouView is the viewer's private state.
type YouView struct {
	UserID       string              `json:"userId"`
	Seat         int                 `json:"seat"`
	HoleCards    []poker.Card        `json:"holeCards"`
	LegalActions []poker.LegalAction `json:"legalActions"`
	PendingTopUp int64               `json:"pendingTopUp"`
	AutoTopUpTo  int64               `json:"autoTopUpTo"`
}

// Snapshot is a complete, viewer-sanitized table state. A client must
// replace (never merge) its state with a snapshot (ADR-004).
type Snapshot struct {
	TableID    string     `json:"tableId"`
	Seq        int64      `json:"seq"`
	ServerTime time.Time  `json:"serverTime"`
	Table      TableInfo  `json:"table"`
	Phase      string     `json:"phase"`
	Seats      []SeatView `json:"seats"`
	Hand       *HandView  `json:"hand,omitempty"`
	You        *YouView   `json:"you,omitempty"`
}

// Snapshot returns the authoritative state sanitized for viewer (empty
// viewer = spectator without private data).
func (a *Actor) Snapshot(ctx context.Context, viewer string) (Snapshot, error) {
	return call(ctx, a, func() (Snapshot, error) { return a.snapshot(viewer), nil })
}

func (a *Actor) snapshot(viewer string) Snapshot {
	s := Snapshot{
		TableID: a.cfg.ID, Seq: a.seq, ServerTime: time.Now().UTC(), Phase: string(a.table.Phase()),
		Table: TableInfo{
			ClubID: a.cfg.ClubID, Name: a.cfg.Name, GameType: string(a.table.Config().Game), MaxSeats: a.cfg.MaxSeats, SmallBlind: a.cfg.SmallBlind,
			BigBlind: a.cfg.BigBlind, BuyInMin: a.cfg.BuyInMin, BuyInMax: a.cfg.BuyInMax,
			ActionTimeoutMs: a.cfg.ActionTimeout.Milliseconds(), Status: a.cfg.Status,
			TimeBankMs: a.cfg.TimeBank.Milliseconds(), TimeBankRefillMs: a.cfg.TimeBankRefill.Milliseconds(),
		},
		Seats: []SeatView{},
	}
	if a.tour != nil {
		info := a.tour.info(time.Now())
		s.Table.Tournament = &info
		s.Table.SmallBlind, s.Table.BigBlind = info.SmallBlind, info.BigBlind
	}
	hand := a.table.Hand()
	inHand := map[int]poker.PlayerView{}
	if hand != nil {
		for _, p := range hand.Players() {
			inHand[p.Seat] = p
		}
	}
	revealed := hand != nil && hand.IsComplete() && hand.ShowdownReached()
	for _, st := range a.table.Seats() {
		user := string(st.Player)
		v := SeatView{Seat: st.Seat, UserID: user, Username: a.usernames[user], Stack: st.Stack,
			SittingOut: st.SittingOut, Leaving: a.leaving[user], TimeBankMs: a.banks.get(user).Milliseconds()}
		if until, ok := a.busted[user]; ok {
			v.BustedUntil = &until
		}
		if p, ok := inHand[st.Seat]; ok && p.Player == st.Player {
			v.InHand, v.Folded, v.AllIn, v.StreetBet = true, p.Folded, p.AllIn, p.StreetBet
			if revealed && !p.Folded {
				v.ShownCards = p.HoleCards
			}
		}
		s.Seats = append(s.Seats, v)
	}
	if hand != nil {
		hv := &HandView{
			HandID: a.handID, HandNo: hand.HandNo(), Street: string(hand.Street()), Board: hand.Board(),
			Pot: hand.Pot(), CurrentBet: hand.CurrentBet(), MinRaise: hand.MinRaise(),
			ButtonSeat: hand.ButtonSeat(), SmallBlindSeat: hand.SmallBlindSeat(), BigBlindSeat: hand.BigBlindSeat(),
			TurnSeq: a.turnSeq, DeckCommitment: a.commitment,
		}
		if hv.Board == nil {
			hv.Board = []poker.Card{}
		}
		if seat, ok := hand.CurrentActor(); ok {
			hv.ToActSeat = seat
			d := a.deadline.UTC()
			hv.ActionDeadline = &d
			hv.UsingTimeBank = a.inTimeBank()
		}
		s.Hand = hv
	}
	if viewer != "" {
		you := &YouView{UserID: viewer, HoleCards: []poker.Card{}, LegalActions: []poker.LegalAction{},
			PendingTopUp: partsTotal(a.pendingTopUps[viewer]), AutoTopUpTo: a.autoTopUp[viewer]}
		if seat := a.table.SeatOf(poker.PlayerID(viewer)); seat != 0 {
			you.Seat = seat
			if p, ok := inHand[seat]; ok && p.Player == poker.PlayerID(viewer) {
				you.HoleCards = p.HoleCards
				if actor, ok := hand.CurrentActor(); ok && actor == seat {
					you.LegalActions = hand.LegalActions()
				}
			}
		}
		s.You = you
	}
	return s
}

// EventsSince returns events after seq for viewer, or ErrResyncRequired
// when they are no longer retained in memory.
func (a *Actor) EventsSince(ctx context.Context, after int64) ([]Event, int64, error) {
	type out struct {
		events []Event
		seq    int64
	}
	r, err := call(ctx, a, func() (out, error) {
		if after > a.seq {
			return out{}, ErrResyncRequired
		}
		evs, ok := a.recent.since(after, a.seq)
		if !ok {
			return out{}, ErrResyncRequired
		}
		return out{evs, a.seq}, nil
	})
	return r.events, r.seq, err
}

// Subscription streams events to one consumer (the realtime gateway's
// per-table feed). A consumer that falls behind is disconnected and must
// resubscribe/resync rather than silently missing events.
type Subscription struct {
	ID int64
	C  chan Event
}

func (s *Subscription) close() { close(s.C) }

// Subscribe returns a live subscription plus the retained backlog after
// `after` (ErrResyncRequired when the backlog is gone). Pass after = -1 to
// receive only new events.
func (a *Actor) Subscribe(ctx context.Context, after int64, buffer int) (*Subscription, []Event, int64, error) {
	type out struct {
		sub     *Subscription
		backlog []Event
		seq     int64
	}
	r, err := call(ctx, a, func() (out, error) {
		var backlog []Event
		if after >= 0 {
			evs, ok := a.recent.since(after, a.seq)
			if !ok || after > a.seq {
				return out{}, ErrResyncRequired
			}
			backlog = evs
		}
		a.nextSubID++
		sub := &Subscription{ID: a.nextSubID, C: make(chan Event, buffer)}
		a.subs[sub.ID] = sub
		return out{sub, backlog, a.seq}, nil
	})
	return r.sub, r.backlog, r.seq, err
}

// Unsubscribe removes a subscription.
func (a *Actor) Unsubscribe(sub *Subscription) {
	a.post(func() {
		if _, ok := a.subs[sub.ID]; ok {
			delete(a.subs, sub.ID)
			sub.close()
		}
	})
}

func (a *Actor) publish(events []Event) {
	for id, sub := range a.subs {
		for _, ev := range events {
			select {
			case sub.C <- ev:
			default:
				a.log.Warn("subscriber_too_slow_disconnected", "subscription", id)
				delete(a.subs, id)
				sub.close()
			}
			if _, ok := a.subs[id]; !ok {
				break
			}
		}
	}
}
