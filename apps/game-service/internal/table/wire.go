package table

import (
	"encoding/json"
	"time"

	"github.com/bar1287/kofclub/go/poker"
)

// Event is one ordered table event. Public is what every subscriber sees;
// Private holds the richer per-user view (e.g. the user's own hole cards or
// legal actions). Private payloads are never persisted in plaintext and are
// never sent to anyone else (ADR-008).
type Event struct {
	Seq     int64
	HandID  string
	Kind    string
	Public  json.RawMessage
	Private map[string]json.RawMessage
	Time    time.Time
}

// For returns the payload a given viewer is entitled to see.
func (e Event) For(userID string) json.RawMessage {
	if p, ok := e.Private[userID]; ok {
		return p
	}
	return e.Public
}

// Wire payloads (camelCase JSON; documented in docs/realtime-protocol.md and
// packages/contracts/openapi/realtime.yaml).

type playerSeatedPayload struct {
	Kind     string `json:"kind"`
	Seat     int    `json:"seat"`
	UserID   string `json:"userId"`
	Username string `json:"username"`
	Stack    int64  `json:"stack"`
}

type playerLeftPayload struct {
	Kind    string `json:"kind"`
	Seat    int    `json:"seat"`
	UserID  string `json:"userId"`
	Reason  string `json:"reason"` // LEFT | BUSTED | TABLE_CLOSED | MOVED | ELIMINATED | FINISHED
	CashOut int64  `json:"cashOut"`
	// Tournaments: the table a moved player goes to, the finishing place of
	// an eliminated player or of the winner.
	ToTableID string `json:"toTableId,omitempty"`
	Place     int    `json:"place,omitempty"`
}

type sittingOutPayload struct {
	Kind       string `json:"kind"`
	Seat       int    `json:"seat"`
	UserID     string `json:"userId"`
	SittingOut bool   `json:"sittingOut"`
	Reason     string `json:"reason,omitempty"` // TIMEOUTS | REQUEST | LEAVING | BUSTED | TOP_UP
	// Until is set with BUSTED: the seat is released then unless the player re-buys.
	Until *time.Time `json:"until,omitempty"`
}

// playerToppedUpPayload: chips added from the club wallet to a stack.
type playerToppedUpPayload struct {
	Kind   string `json:"kind"`
	Seat   int    `json:"seat"`
	UserID string `json:"userId"`
	Amount int64  `json:"amount"`
	Stack  int64  `json:"stack"`
}

type handPlayer struct {
	Seat       int    `json:"seat"`
	UserID     string `json:"userId"`
	Stack      int64  `json:"stack"`
	TimeBankMs int64  `json:"timeBankMs"` // after this hand's refill
}

type handStartedPayload struct {
	Kind           string       `json:"kind"`
	HandID         string       `json:"handId"`
	GameType       string       `json:"gameType"`
	HandNo         int64        `json:"handNo"`
	ButtonSeat     int          `json:"buttonSeat"`
	SmallBlindSeat int          `json:"smallBlindSeat"`
	BigBlindSeat   int          `json:"bigBlindSeat"`
	SmallBlind     int64        `json:"smallBlind"`
	BigBlind       int64        `json:"bigBlind"`
	DeckCommitment string       `json:"deckCommitment"`
	Players        []handPlayer `json:"players"`
	// Tournament is set at tournament tables (level and blinds of the hand).
	Tournament *tournamentInfo `json:"tournament,omitempty"`
}

type blindPostedPayload struct {
	Kind   string `json:"kind"`
	Seat   int    `json:"seat"`
	Blind  string `json:"blind"`
	Amount int64  `json:"amount"`
	AllIn  bool   `json:"allIn"`
	Stack  int64  `json:"stack"`
	Pot    int64  `json:"pot"`
}

type holeCardsPayload struct {
	Kind  string       `json:"kind"`
	Seats []int        `json:"seats"`
	Cards []poker.Card `json:"cards,omitempty"` // private: the viewer's own cards
}

type playerActedPayload struct {
	Kind      string `json:"kind"`
	Seat      int    `json:"seat"`
	Action    string `json:"action"`
	Added     int64  `json:"added"`
	StreetBet int64  `json:"streetBet"`
	Stack     int64  `json:"stack"`
	AllIn     bool   `json:"allIn"`
	Pot       int64  `json:"pot"`
	Timeout   bool   `json:"timeout"`
	// TimeBankMs is the actor's time bank left after the action.
	TimeBankMs *int64 `json:"timeBankMs,omitempty"`
}

type turnStartedPayload struct {
	Kind         string              `json:"kind"`
	Seat         int                 `json:"seat"`
	Street       string              `json:"street"`
	CurrentBet   int64               `json:"currentBet"`
	MinRaise     int64               `json:"minRaise"`
	Pot          int64               `json:"pot"`
	Deadline     time.Time           `json:"deadline"`
	TimeoutMs    int64               `json:"timeoutMs"`
	TimeBankMs   int64               `json:"timeBankMs"`             // used if the turn timer runs out
	LegalActions []poker.LegalAction `json:"legalActions,omitempty"` // private: only for the actor
}

// timeBankStartedPayload: the actor's turn timer ran out and their time
// bank is running until Deadline.
type timeBankStartedPayload struct {
	Kind      string    `json:"kind"`
	Seat      int       `json:"seat"`
	Deadline  time.Time `json:"deadline"`
	TimeoutMs int64     `json:"timeoutMs"`
}

type uncalledPayload struct {
	Kind   string `json:"kind"`
	Seat   int    `json:"seat"`
	Amount int64  `json:"amount"`
	Stack  int64  `json:"stack"`
	Pot    int64  `json:"pot"`
}

type streetDealtPayload struct {
	Kind   string       `json:"kind"`
	Street string       `json:"street"`
	Cards  []poker.Card `json:"cards"`
	Board  []poker.Card `json:"board"`
}

type cardsRevealedPayload struct {
	Kind        string       `json:"kind"`
	Seat        int          `json:"seat"`
	Cards       []poker.Card `json:"cards"`
	Description string       `json:"description"`
	BestFive    []poker.Card `json:"bestFive"`
}

type cardsMuckedPayload struct {
	Kind string `json:"kind"`
	Seat int    `json:"seat"`
}

type cardsShownPayload struct {
	Kind   string       `json:"kind"`
	Seat   int          `json:"seat"`
	UserID string       `json:"userId"`
	Cards  []poker.Card `json:"cards"`
}

type potAwardedPayload struct {
	Kind          string              `json:"kind"`
	PotIndex      int                 `json:"potIndex"`
	Amount        int64               `json:"amount"`
	EligibleSeats []int               `json:"eligibleSeats"`
	Winners       []poker.WinnerShare `json:"winners"`
	Description   string              `json:"description"`
}

type handResult struct {
	Seat        int    `json:"seat"`
	UserID      string `json:"userId"`
	Stack       int64  `json:"stack"`
	Net         int64  `json:"net"`
	Won         int64  `json:"won"`
	Contributed int64  `json:"contributed"`
	Folded      bool   `json:"folded"`
}

type handCompletedPayload struct {
	Kind     string       `json:"kind"`
	HandID   string       `json:"handId"`
	HandNo   int64        `json:"handNo"`
	Board    []poker.Card `json:"board"`
	Showdown bool         `json:"showdown"`
	Results  []handResult `json:"results"`
}

type handVoidedPayload struct {
	Kind   string `json:"kind"`
	HandID string `json:"handId"`
	HandNo int64  `json:"handNo"`
	Reason string `json:"reason"`
}

// Event kinds.
const (
	KindPlayerSeated    = "PLAYER_SEATED"
	KindPlayerLeft      = "PLAYER_LEFT"
	KindSittingOut      = "PLAYER_SITTING_OUT"
	KindPlayerToppedUp  = "PLAYER_TOPPED_UP"
	KindHandStarted     = "HAND_STARTED"
	KindBlindPosted     = "BLIND_POSTED"
	KindHoleCards       = "HOLE_CARDS_DEALT"
	KindPlayerActed     = "PLAYER_ACTED"
	KindTurnStarted     = "TURN_STARTED"
	KindTimeBankStarted = "TIME_BANK_STARTED"
	KindUncalled        = "UNCALLED_BET_RETURNED"
	KindStreetDealt     = "STREET_DEALT"
	KindCardsRevealed   = "CARDS_REVEALED"
	KindCardsMucked     = "CARDS_MUCKED"
	KindCardsShown      = "CARDS_SHOWN"
	KindPotAwarded      = "POT_AWARDED"
	KindHandCompleted   = "HAND_COMPLETED"
	KindHandVoided      = "HAND_VOIDED"
)

// draft is an event before it receives a sequence number.
type draft struct {
	kind    string
	handID  string
	public  any
	private map[string]any
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err) // payloads are plain structs; failure is a programming error
	}
	return b
}

// translate converts engine events to wire drafts. Hole cards are
// aggregated into one HOLE_CARDS_DEALT event with a private payload per
// player.
func translate(handID, deckCommitment string, events []poker.Event, timeout bool) []draft {
	var out []draft
	var hole *draft
	var holeSeats []int
	holePrivate := map[string]any{}
	flushHole := func() {
		if hole == nil {
			return
		}
		hole.public = holeCardsPayload{Kind: KindHoleCards, Seats: holeSeats}
		for user, cards := range holePrivate {
			hole.private[user] = holeCardsPayload{Kind: KindHoleCards, Seats: holeSeats, Cards: cards.([]poker.Card)}
		}
		out = append(out, *hole)
		hole = nil
	}
	for _, e := range events {
		if _, ok := e.(poker.HoleCardsDealt); !ok {
			flushHole()
		}
		switch ev := e.(type) {
		case poker.HandStarted:
			players := make([]handPlayer, len(ev.Players))
			for i, p := range ev.Players {
				players[i] = handPlayer{Seat: p.Seat, UserID: string(p.Player), Stack: p.Stack}
			}
			out = append(out, draft{kind: KindHandStarted, handID: handID, public: handStartedPayload{
				Kind: KindHandStarted, HandID: handID, GameType: string(ev.Game), HandNo: ev.HandNo, ButtonSeat: ev.ButtonSeat,
				SmallBlindSeat: ev.SmallBlindSeat, BigBlindSeat: ev.BigBlindSeat, SmallBlind: ev.SmallBlind,
				BigBlind: ev.BigBlind, DeckCommitment: deckCommitment, Players: players,
			}})
		case poker.BlindPosted:
			out = append(out, draft{kind: KindBlindPosted, handID: handID, public: blindPostedPayload{
				Kind: KindBlindPosted, Seat: ev.Seat, Blind: ev.Blind, Amount: ev.Amount, AllIn: ev.AllIn, Stack: ev.Stack, Pot: ev.Pot,
			}})
		case poker.HoleCardsDealt:
			if hole == nil {
				hole = &draft{kind: KindHoleCards, handID: handID, private: map[string]any{}}
			}
			holeSeats = append(holeSeats, ev.Seat)
			holePrivate[string(ev.Player)] = append([]poker.Card(nil), ev.Cards...)
		case poker.PlayerActed:
			out = append(out, draft{kind: KindPlayerActed, handID: handID, public: playerActedPayload{
				Kind: KindPlayerActed, Seat: ev.Seat, Action: string(ev.Kind), Added: ev.Added, StreetBet: ev.StreetBet,
				Stack: ev.Stack, AllIn: ev.AllIn, Pot: ev.Pot, Timeout: timeout,
			}})
		case poker.UncalledBetReturned:
			out = append(out, draft{kind: KindUncalled, handID: handID, public: uncalledPayload{
				Kind: KindUncalled, Seat: ev.Seat, Amount: ev.Amount, Stack: ev.Stack, Pot: ev.Pot,
			}})
		case poker.StreetDealt:
			out = append(out, draft{kind: KindStreetDealt, handID: handID, public: streetDealtPayload{
				Kind: KindStreetDealt, Street: string(ev.Street), Cards: ev.Cards, Board: ev.Board,
			}})
		case poker.CardsRevealed:
			out = append(out, draft{kind: KindCardsRevealed, handID: handID, public: cardsRevealedPayload{
				Kind: KindCardsRevealed, Seat: ev.Seat, Cards: ev.Cards,
				Description: ev.Description, BestFive: ev.BestFive,
			}})
		case poker.CardsMucked:
			out = append(out, draft{kind: KindCardsMucked, handID: handID, public: cardsMuckedPayload{Kind: KindCardsMucked, Seat: ev.Seat}})
		case poker.PotAwarded:
			out = append(out, draft{kind: KindPotAwarded, handID: handID, public: potAwardedPayload{
				Kind: KindPotAwarded, PotIndex: ev.PotIndex, Amount: ev.Amount, EligibleSeats: ev.Eligible,
				Winners: ev.Winners, Description: ev.Description,
			}})
		case poker.HandCompleted:
			results := make([]handResult, len(ev.Results))
			for i, r := range ev.Results {
				results[i] = handResult{
					Seat: r.Seat, UserID: string(r.Player), Stack: r.EndingStack, Net: r.Net,
					Won: r.Won, Contributed: r.Contributed, Folded: r.Folded,
				}
			}
			board := ev.Board
			if board == nil {
				board = []poker.Card{}
			}
			out = append(out, draft{kind: KindHandCompleted, handID: handID, public: handCompletedPayload{
				Kind: KindHandCompleted, HandID: handID, HandNo: ev.HandNo, Board: board,
				Showdown: ev.ShowdownReached, Results: results,
			}})
		}
	}
	flushHole()
	return out
}
