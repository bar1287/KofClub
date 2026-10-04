// Package ledgerclient is the Go client for the chip ledger (ADR-003).
//
// The ledger's business rules (zero-sum, idempotency, non-negative balances,
// allowed flows per transaction kind) live in the ledger_post() SQL function
// so that TypeScript and Go callers share one implementation. This package
// only builds requests and maps errors. Callers pass their own transaction
// so that chip movements commit atomically with related state (e.g. hand
// completion).
package ledgerclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/bar1287/kofclub/go/observability"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Querier is satisfied by pgx.Tx, *pgxpool.Pool and *pgx.Conn.
type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Kind is a ledger transaction kind.
type Kind string

// Transaction kinds used by the game service.
const (
	KindTableBuyIn     Kind = "TABLE_BUY_IN"
	KindTableCashOut   Kind = "TABLE_CASH_OUT"
	KindHandSettlement Kind = "HAND_SETTLEMENT"
	KindClubGrant      Kind = "CLUB_GRANT"
	// Tournament buy-ins/refunds move chips between a wallet and the
	// tournament's prize pool; payouts move the pool to winners' wallets.
	KindTournamentBuyIn  Kind = "TOURNAMENT_BUY_IN"
	KindTournamentRefund Kind = "TOURNAMENT_REFUND"
	KindTournamentPayout Kind = "TOURNAMENT_PAYOUT"
)

// AccountKind is a ledger account kind.
type AccountKind string

// Account kinds.
const (
	AccountClubTreasury AccountKind = "CLUB_TREASURY"
	AccountMemberWallet AccountKind = "MEMBER_WALLET"
	AccountTableStack   AccountKind = "TABLE_STACK"
	// AccountTournamentPool is a tournament's prize pool (owner = tournament id).
	AccountTournamentPool AccountKind = "TOURNAMENT_POOL"
)

// ActorGameService marks postings made by the game service.
const ActorGameService = "GAME_SERVICE"

// Entry is one signed movement on an account.
type Entry struct {
	AccountID string `json:"accountId"`
	Amount    int64  `json:"amount"`
	Reason    string `json:"reason,omitempty"`
	HandID    string `json:"handId,omitempty"`
}

// Posting is a balanced ledger transaction request.
type Posting struct {
	TxID          string // optional; a UUIDv7 is generated when empty
	ExternalRef   string // idempotency key, e.g. "hand:<id>"
	Kind          Kind
	ClubID        string
	ActorType     string // defaults to GAME_SERVICE
	ActorUserID   string // optional
	ReferenceType string
	ReferenceID   string
	Metadata      map[string]any
	Entries       []Entry
}

// Result reports the transaction id and whether this call created it
// (false = idempotent replay of an earlier identical posting).
type Result struct {
	TxID    string
	Created bool
}

// Errors mapped from the ledger's SQLSTATE codes.
var (
	ErrInsufficientChips   = errors.New("ledger: insufficient chips")
	ErrIdempotencyConflict = errors.New("ledger: external ref reused with different content")
	ErrInvariant           = errors.New("ledger: invariant violation")
	ErrAccountUnusable     = errors.New("ledger: account not usable")
	ErrAlreadyReversed     = errors.New("ledger: transaction already reversed")
)

var sqlStateErrors = map[string]error{
	"KL001": ErrInsufficientChips,
	"KL002": ErrIdempotencyConflict,
	"KL003": ErrInvariant,
	"KL004": ErrAccountUnusable,
	"KL005": ErrAlreadyReversed,
}

// MapError converts ledger SQLSTATEs into sentinel errors (wrapping the
// original for context); other errors are returned unchanged.
func MapError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		if sentinel, ok := sqlStateErrors[pgErr.Code]; ok {
			return fmt.Errorf("%w: %s", sentinel, pgErr.Message)
		}
	}
	return err
}

// Post records a balanced transaction inside the caller's transaction.
func Post(ctx context.Context, q Querier, p Posting) (res Result, err error) {
	ctx, span := observability.Tracer().Start(ctx, "ledger.post", trace.WithAttributes(
		attribute.String("ledger.kind", string(p.Kind)), attribute.Int("ledger.entries", len(p.Entries))))
	defer func() {
		if err != nil {
			span.SetStatus(codes.Error, "ledger post failed")
		}
		span.SetAttributes(attribute.Bool("ledger.created", res.Created))
		span.End()
	}()
	if p.TxID == "" {
		id, err := uuid.NewV7()
		if err != nil {
			return Result{}, err
		}
		p.TxID = id.String()
	}
	if p.ActorType == "" {
		p.ActorType = ActorGameService
	}
	entries, err := json.Marshal(p.Entries)
	if err != nil {
		return Result{}, err
	}
	meta, err := json.Marshal(p.Metadata)
	if err != nil {
		return Result{}, err
	}
	if p.Metadata == nil {
		meta = []byte("{}")
	}
	err = q.QueryRow(ctx,
		`SELECT tx_id::text, created FROM ledger_post($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		p.TxID, p.ExternalRef, string(p.Kind), p.ClubID, p.ActorType, nullable(p.ActorUserID),
		nullable(p.ReferenceType), nullable(p.ReferenceID), meta, entries,
	).Scan(&res.TxID, &res.Created)
	if err != nil {
		return Result{}, MapError(err)
	}
	return res, nil
}

// EnsureAccount returns the account id for (club, kind, owner, table),
// creating a zero-balance account when it does not exist yet.
func EnsureAccount(ctx context.Context, q Querier, clubID string, kind AccountKind, ownerID, tableID string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT ledger_ensure_account($1, $2, $3, $4)::text`,
		clubID, string(kind), ownerID, nullable(tableID)).Scan(&id)
	return id, MapError(err)
}

// Balance returns an account's projected balance.
func Balance(ctx context.Context, q Querier, accountID string) (int64, error) {
	var b int64
	err := q.QueryRow(ctx, `SELECT balance FROM ledger_accounts WHERE id = $1`, accountID).Scan(&b)
	return b, err
}

// Violation is a row of the ledger_invariant_violations view.
type Violation struct {
	Kind    string
	Subject string
	Amount  int64
}

// Violations returns ledger invariant violations (expected: none).
func Violations(ctx context.Context, q Querier) ([]Violation, error) {
	rows, err := q.Query(ctx, `SELECT violation, subject, amount::bigint FROM ledger_invariant_violations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Violation
	for rows.Next() {
		var v Violation
		if err := rows.Scan(&v.Kind, &v.Subject, &v.Amount); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
