// Package reseal re-encrypts stored card data (decks and hole cards) with
// the active key of the keyring, so a retired or compromised key can be
// removed from the configuration (key rotation, ADR-008). Plaintext cards
// exist only in memory for the duration of one hand's re-encryption and are
// never logged.
package reseal

import (
	"context"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bar1287/kofclub/apps/game-service/internal/sealer"
)

// Result counts re-sealed rows.
type Result struct {
	Hands   int
	Players int
}

// Run re-seals every finished hand sealed with a key other than the active
// one, batch hands per transaction. Hands still in progress are skipped: they
// finish under the key that sealed them, and a later run picks them up.
func Run(ctx context.Context, pool *pgxpool.Pool, s *sealer.Sealer, batch int) (Result, error) {
	var total Result
	after := "00000000-0000-0000-0000-000000000000"
	for {
		res, last, err := runBatch(ctx, pool, s, after, batch)
		total.Hands += res.Hands
		total.Players += res.Players
		if err != nil || last == "" {
			return total, err
		}
		after = last
	}
}

type sealedHand struct {
	id   string
	key  int
	deck []byte
}

// runBatch re-seals up to batch hands after the id `after` and returns the
// last id it looked at ("" when there are none left).
func runBatch(ctx context.Context, pool *pgxpool.Pool, s *sealer.Sealer, after string, batch int) (Result, string, error) {
	var res Result
	last := ""
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id::text, seal_key_id, deck_enc FROM hands
			 WHERE id > $1 AND seal_key_id <> $2 AND status <> 'IN_PROGRESS'
			 ORDER BY id LIMIT $3 FOR UPDATE SKIP LOCKED`, after, s.KeyID(), batch)
		if err != nil {
			return err
		}
		hands, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (sealedHand, error) {
			var h sealedHand
			err := r.Scan(&h.id, &h.key, &h.deck)
			return h, err
		})
		if err != nil {
			return err
		}
		for _, h := range hands {
			players, err := resealHand(ctx, tx, s, h)
			if err != nil {
				return fmt.Errorf("hand %s (key %d): %w", h.id, h.key, err)
			}
			res.Hands++
			res.Players += players
			last = h.id
		}
		return nil
	})
	if err != nil {
		return Result{}, "", err
	}
	return res, last, nil
}

func resealHand(ctx context.Context, tx pgx.Tx, s *sealer.Sealer, h sealedHand) (int, error) {
	deck, err := reseal(s, h.key, h.deck, "deck:"+h.id)
	if err != nil {
		return 0, fmt.Errorf("deck: %w", err)
	}
	rows, err := tx.Query(ctx, `SELECT user_id::text, hole_cards_enc FROM hand_players WHERE hand_id = $1 FOR UPDATE`, h.id)
	if err != nil {
		return 0, err
	}
	type holeCards struct {
		user string
		enc  []byte
	}
	players, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (holeCards, error) {
		var p holeCards
		err := r.Scan(&p.user, &p.enc)
		return p, err
	})
	if err != nil {
		return 0, err
	}
	for _, p := range players {
		enc, err := reseal(s, h.key, p.enc, "hole:"+h.id+":"+p.user)
		if err != nil {
			return 0, fmt.Errorf("hole cards of %s: %w", p.user, err)
		}
		if _, err := tx.Exec(ctx, `UPDATE hand_players SET hole_cards_enc = $3 WHERE hand_id = $1 AND user_id = $2`, h.id, p.user, enc); err != nil {
			return 0, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE hands SET deck_enc = $2, seal_key_id = $3 WHERE id = $1`, h.id, deck, s.KeyID()); err != nil {
		return 0, err
	}
	return len(players), nil
}

// reseal opens data sealed with key `from` and seals it with the active key
// under the same context, wiping the plaintext afterwards.
func reseal(s *sealer.Sealer, from int, sealed []byte, context string) ([]byte, error) {
	plain, err := s.Open(from, sealed, context)
	if err != nil {
		return nil, err
	}
	defer clear(plain)
	return s.Seal(plain, context)
}

// MissingKeys returns the key ids that seal hands still in progress but are
// not configured: such hands could not be resumed after a failover. Cheap
// (partial index on in-progress hands); checked at startup.
func MissingKeys(ctx context.Context, pool *pgxpool.Pool, s *sealer.Sealer) ([]int, error) {
	rows, err := pool.Query(ctx, `SELECT DISTINCT seal_key_id FROM hands WHERE status = 'IN_PROGRESS' ORDER BY 1`)
	if err != nil {
		return nil, err
	}
	used, err := pgx.CollectRows(rows, pgx.RowTo[int])
	if err != nil {
		return nil, err
	}
	var missing []int
	for _, id := range used {
		if !slices.Contains(s.KeyIDs(), id) {
			missing = append(missing, id)
		}
	}
	return missing, nil
}

// KeyUsage counts hands per sealing key: a key can be removed from the
// configuration once no hand uses it.
func KeyUsage(ctx context.Context, pool *pgxpool.Pool) (map[int]int64, error) {
	rows, err := pool.Query(ctx, `SELECT seal_key_id, count(*) FROM hands GROUP BY seal_key_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	usage := map[int]int64{}
	for rows.Next() {
		var id int
		var n int64
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		usage[id] = n
	}
	return usage, rows.Err()
}
