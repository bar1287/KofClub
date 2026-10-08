package table

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	"github.com/bar1287/kofclub/go/poker"
)

// Showdown choices (roadmap W1.5): each seat chooses whether its losing
// hands are mucked at showdown (the engine decides when the rules allow
// it), and after a hand players may show some or all of their cards until
// the next hand starts.

// SetMuckLosing stores the viewer's choice; it applies from the next hand.
func (a *Actor) SetMuckLosing(ctx context.Context, userID string, on bool) (bool, error) {
	return call(ctx, a, func() (bool, error) { return a.handleMuckLosing(userID, on) })
}

func (a *Actor) handleMuckLosing(userID string, on bool) (bool, error) {
	seat := a.table.SeatOf(poker.PlayerID(userID))
	if seat == 0 {
		return false, newError("PLAYER_NOT_SEATED", "not seated at this table")
	}
	next := a.table.Clone()
	if err := next.SetMuckLosing(seat, on); err != nil {
		return false, fromEngine(err)
	}
	if _, err := a.commit(next, nil, func(ctx context.Context, tx pgx.Tx) error {
		return store.SetMuckLosing(ctx, tx, a.cfg.ID, userID, on)
	}); err != nil {
		return false, err
	}
	return on, nil
}

// handleShowCards applies a SHOW_CARDS command: the cards become public
// (CARDS_SHOWN, recorded with the hand).
func (a *Actor) handleShowCards(req CommandRequest) (int64, error) {
	seat := a.table.SeatOf(poker.PlayerID(req.UserID))
	if seat == 0 {
		return 0, newError("PLAYER_NOT_SEATED", "not seated at this table")
	}
	hand := a.table.Hand()
	if hand == nil || !hand.IsComplete() {
		return 0, newError("ILLEGAL_ACTION", "cards can be shown when the hand is over")
	}
	if len(req.Cards) == 0 || len(req.Cards) > a.table.Config().Game.HoleCardCount() {
		return 0, newError("ILLEGAL_ACTION", "choose the cards to show")
	}
	cards := make([]poker.Card, len(req.Cards))
	for i, s := range req.Cards {
		c, err := poker.ParseCard(s)
		if err != nil {
			return 0, newError("VALIDATION_FAILED", "cards must be like \"Ah\" or \"Td\"")
		}
		cards[i] = c
	}
	next := a.table.Clone()
	ev, err := next.ShowCards(seat, cards)
	if err != nil {
		var pe *poker.Error
		if errors.As(err, &pe) && pe.Code == poker.CodePlayerNotInHand {
			return 0, newError("ILLEGAL_ACTION", "you were not dealt into the last hand")
		}
		return 0, fromEngine(err)
	}
	drafts := []draft{{kind: KindCardsShown, handID: a.handID, public: cardsShownPayload{
		Kind: KindCardsShown, Seat: ev.Seat, UserID: req.UserID, Cards: ev.Cards,
	}}}
	evs, err := a.commit(next, drafts, nil)
	if err != nil {
		return 0, err
	}
	a.deps.Metrics.CardsShown.Inc()
	return evs[0].Seq, nil
}
