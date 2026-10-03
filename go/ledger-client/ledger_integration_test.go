//go:build integration

package ledgerclient_test

import (
	"context"
	"errors"
	"fmt"
	mrand "math/rand/v2"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	ledger "github.com/bar1287/kofclub/go/ledger-client"
	"github.com/bar1287/kofclub/go/pgtest"
)

type fixture struct {
	t      *testing.T
	pool   *pgxpool.Pool
	ctx    context.Context
	clubID string
}

func newFixture(t *testing.T) *fixture {
	pool, _ := pgtest.NewPool(t)
	f := &fixture{t: t, pool: pool, ctx: context.Background()}
	f.clubID = f.club(f.user("owner"))
	return f
}

func (f *fixture) user(name string) string {
	f.t.Helper()
	id := uuid.NewString()
	_, err := f.pool.Exec(f.ctx, `INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, 'x')`,
		id, name+"-"+id[:8]+"@example.test", fmt.Sprintf("%s_%s", name, id[:8]))
	if err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f *fixture) club(owner string) string {
	f.t.Helper()
	id := uuid.NewString()
	_, err := f.pool.Exec(f.ctx, `INSERT INTO clubs (id, owner_user_id, name, join_code) VALUES ($1, $2, 'Club', $3)`,
		id, owner, id[:8])
	if err != nil {
		f.t.Fatal(err)
	}
	return id
}

// table inserts a table row (TABLE_STACK accounts reference tables).
func (f *fixture) table() string {
	f.t.Helper()
	id := uuid.NewString()
	var owner string
	if err := f.pool.QueryRow(f.ctx, `SELECT owner_user_id FROM clubs WHERE id = $1`, f.clubID).Scan(&owner); err != nil {
		f.t.Fatal(err)
	}
	_, err := f.pool.Exec(f.ctx, `INSERT INTO tables (id, club_id, name, max_seats, small_blind, big_blind, buyin_min, buyin_max, created_by)
		VALUES ($1, $2, 'Test table', 6, 5, 10, 100, 10000, $3)`, id, f.clubID, owner)
	if err != nil {
		f.t.Fatal(err)
	}
	return id
}

// hand inserts a hand row (ledger entries reference hands).
func (f *fixture) hand(table string) string {
	f.t.Helper()
	id := uuid.NewString()
	_, err := f.pool.Exec(f.ctx, `INSERT INTO hands (id, table_id, club_id, hand_no, status, button_seat, small_blind, big_blind, deck_commitment, deck_enc, lease_epoch)
		VALUES ($1, $2, $3, (SELECT coalesce(max(hand_no), 0) + 1 FROM hands WHERE table_id = $2), 'IN_PROGRESS', 1, 5, 10, 'x', '\x00', 1)`, id, table, f.clubID)
	if err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f *fixture) account(kind ledger.AccountKind, owner, table string) string {
	f.t.Helper()
	id, err := ledger.EnsureAccount(f.ctx, f.pool, f.clubID, kind, owner, table)
	if err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f *fixture) balance(account string) int64 {
	f.t.Helper()
	b, err := ledger.Balance(f.ctx, f.pool, account)
	if err != nil {
		f.t.Fatal(err)
	}
	return b
}

func (f *fixture) post(p ledger.Posting) (ledger.Result, error) {
	if p.ClubID == "" {
		p.ClubID = f.clubID
	}
	if p.ExternalRef == "" {
		p.ExternalRef = "test:" + uuid.NewString()
	}
	return ledger.Post(f.ctx, f.pool, p)
}

func (f *fixture) mustPost(p ledger.Posting) ledger.Result {
	f.t.Helper()
	r, err := f.post(p)
	if err != nil {
		f.t.Fatalf("post %s: %v", p.Kind, err)
	}
	return r
}

func (f *fixture) grant(wallet string, amount int64) {
	f.t.Helper()
	treasury := f.account(ledger.AccountClubTreasury, f.clubID, "")
	f.mustPost(ledger.Posting{Kind: ledger.KindClubGrant, ActorType: "SYSTEM", Entries: []ledger.Entry{
		{AccountID: treasury, Amount: -amount}, {AccountID: wallet, Amount: amount},
	}})
}

func (f *fixture) assertNoViolations() {
	f.t.Helper()
	v, err := ledger.Violations(f.ctx, f.pool)
	if err != nil {
		f.t.Fatal(err)
	}
	if len(v) != 0 {
		f.t.Fatalf("ledger invariant violations: %+v", v)
	}
}

func TestChipLifecycle(t *testing.T) {
	f := newFixture(t)
	alice, bob := f.user("alice"), f.user("bob")
	table := f.table()
	wa, wb := f.account(ledger.AccountMemberWallet, alice, ""), f.account(ledger.AccountMemberWallet, bob, "")
	sa, sb := f.account(ledger.AccountTableStack, alice, table), f.account(ledger.AccountTableStack, bob, table)
	treasury := f.account(ledger.AccountClubTreasury, f.clubID, "")

	f.grant(wa, 1000)
	f.grant(wb, 1000)
	f.mustPost(ledger.Posting{Kind: ledger.KindTableBuyIn, Entries: []ledger.Entry{{AccountID: wa, Amount: -500}, {AccountID: sa, Amount: 500}}})
	f.mustPost(ledger.Posting{Kind: ledger.KindTableBuyIn, Entries: []ledger.Entry{{AccountID: wb, Amount: -400}, {AccountID: sb, Amount: 400}}})
	hand := f.hand(table)
	f.mustPost(ledger.Posting{Kind: ledger.KindHandSettlement, ExternalRef: "hand:" + hand, ReferenceType: "hand", ReferenceID: hand,
		Entries: []ledger.Entry{{AccountID: sa, Amount: 150, HandID: hand}, {AccountID: sb, Amount: -150, HandID: hand}}})
	f.mustPost(ledger.Posting{Kind: ledger.KindTableCashOut, Entries: []ledger.Entry{{AccountID: sa, Amount: -650}, {AccountID: wa, Amount: 650}}})

	want := map[string]int64{wa: 1150, wb: 600, sa: 0, sb: 250, treasury: -2000}
	for acct, bal := range want {
		if got := f.balance(acct); got != bal {
			t.Errorf("account %s balance %d want %d", acct, got, bal)
		}
	}
	var entries int
	_ = f.pool.QueryRow(f.ctx, `SELECT count(*) FROM ledger_entries WHERE hand_id = $1`, hand).Scan(&entries)
	if entries != 2 {
		t.Fatalf("hand entries = %d", entries)
	}
	var beforeAfterOK bool
	_ = f.pool.QueryRow(f.ctx, `SELECT bool_and(balance_after = balance_before + amount_signed) FROM ledger_entries`).Scan(&beforeAfterOK)
	if !beforeAfterOK {
		t.Fatal("balance before/after inconsistent")
	}
	f.assertNoViolations()
}

func TestZeroSumAndAmountValidation(t *testing.T) {
	f := newFixture(t)
	w := f.account(ledger.AccountMemberWallet, f.user("u"), "")
	treasury := f.account(ledger.AccountClubTreasury, f.clubID, "")
	cases := [][]ledger.Entry{
		{{AccountID: treasury, Amount: -100}, {AccountID: w, Amount: 90}},
		{{AccountID: w, Amount: 100}},
		{{AccountID: treasury, Amount: 0}, {AccountID: w, Amount: 0}},
		{{AccountID: treasury, Amount: -2_000_000_000_000_000}, {AccountID: w, Amount: 2_000_000_000_000_000}},
		{{AccountID: w, Amount: -5}, {AccountID: w, Amount: 5}},
	}
	for i, entries := range cases {
		if _, err := f.post(ledger.Posting{Kind: ledger.KindClubGrant, ActorType: "SYSTEM", Entries: entries}); !errors.Is(err, ledger.ErrInvariant) {
			t.Errorf("case %d: expected invariant violation, got %v", i, err)
		}
	}
	if f.balance(w) != 0 || f.balance(treasury) != 0 {
		t.Fatal("rejected postings must not move chips")
	}
}

func TestIdempotentPostings(t *testing.T) {
	f := newFixture(t)
	w := f.account(ledger.AccountMemberWallet, f.user("u"), "")
	treasury := f.account(ledger.AccountClubTreasury, f.clubID, "")
	p := ledger.Posting{ExternalRef: "grant:once", Kind: ledger.KindClubGrant, ActorType: "SYSTEM",
		Entries: []ledger.Entry{{AccountID: treasury, Amount: -300}, {AccountID: w, Amount: 300}}}
	first := f.mustPost(p)
	second := f.mustPost(p)
	if !first.Created || second.Created || first.TxID != second.TxID {
		t.Fatalf("replay must return the original transaction: %+v %+v", first, second)
	}
	if f.balance(w) != 300 {
		t.Fatalf("balance %d: retry moved chips twice", f.balance(w))
	}
	p.Entries = []ledger.Entry{{AccountID: treasury, Amount: -301}, {AccountID: w, Amount: 301}}
	if _, err := f.post(p); !errors.Is(err, ledger.ErrIdempotencyConflict) {
		t.Fatalf("different content under the same ref: %v", err)
	}
}

func TestInsufficientChipsAndNonNegativeBalances(t *testing.T) {
	f := newFixture(t)
	u := f.user("u")
	w := f.account(ledger.AccountMemberWallet, u, "")
	s := f.account(ledger.AccountTableStack, u, f.table())
	f.grant(w, 100)
	_, err := f.post(ledger.Posting{Kind: ledger.KindTableBuyIn, Entries: []ledger.Entry{{AccountID: w, Amount: -101}, {AccountID: s, Amount: 101}}})
	if !errors.Is(err, ledger.ErrInsufficientChips) {
		t.Fatalf("overdraft: %v", err)
	}
	if f.balance(w) != 100 || f.balance(s) != 0 {
		t.Fatal("failed posting must not change balances")
	}
}

func TestFlowRulesPerKind(t *testing.T) {
	f := newFixture(t)
	alice, bob := f.user("alice"), f.user("bob")
	t1, t2 := f.table(), f.table()
	wa, wb := f.account(ledger.AccountMemberWallet, alice, ""), f.account(ledger.AccountMemberWallet, bob, "")
	sa1, sb1 := f.account(ledger.AccountTableStack, alice, t1), f.account(ledger.AccountTableStack, bob, t1)
	sb2 := f.account(ledger.AccountTableStack, bob, t2)
	treasury := f.account(ledger.AccountClubTreasury, f.clubID, "")
	f.grant(wa, 1000)
	f.grant(wb, 1000)
	f.mustPost(ledger.Posting{Kind: ledger.KindTableBuyIn, Entries: []ledger.Entry{{AccountID: wa, Amount: -100}, {AccountID: sa1, Amount: 100}}})

	bad := []struct {
		name string
		p    ledger.Posting
		want error
	}{
		{"buy-in into someone else's stack", ledger.Posting{Kind: ledger.KindTableBuyIn, Entries: []ledger.Entry{{AccountID: wa, Amount: -10}, {AccountID: sb1, Amount: 10}}}, ledger.ErrInvariant},
		{"buy-in in reverse", ledger.Posting{Kind: ledger.KindTableBuyIn, Entries: []ledger.Entry{{AccountID: wa, Amount: 10}, {AccountID: sa1, Amount: -10}}}, ledger.ErrInvariant},
		{"settlement touching a wallet", ledger.Posting{Kind: ledger.KindHandSettlement, Entries: []ledger.Entry{{AccountID: sa1, Amount: -10}, {AccountID: wb, Amount: 10}}}, ledger.ErrInvariant},
		{"settlement across tables", ledger.Posting{Kind: ledger.KindHandSettlement, Entries: []ledger.Entry{{AccountID: sa1, Amount: -10}, {AccountID: sb2, Amount: 10}}}, ledger.ErrInvariant},
		{"grant burning chips", ledger.Posting{Kind: ledger.KindClubGrant, ActorType: "SYSTEM", Entries: []ledger.Entry{{AccountID: treasury, Amount: 10}, {AccountID: wa, Amount: -10}}}, ledger.ErrInvariant},
		{"wallet to wallet transfer", ledger.Posting{Kind: ledger.KindClubGrant, ActorType: "SYSTEM", Entries: []ledger.Entry{{AccountID: wb, Amount: -10}, {AccountID: wa, Amount: 10}}}, ledger.ErrInvariant},
		{"unknown kind", ledger.Posting{Kind: "CASH_WITHDRAWAL", Entries: []ledger.Entry{{AccountID: treasury, Amount: -10}, {AccountID: wa, Amount: 10}}}, nil},
		{"unknown account", ledger.Posting{Kind: ledger.KindTableBuyIn, Entries: []ledger.Entry{{AccountID: wa, Amount: -10}, {AccountID: uuid.NewString(), Amount: 10}}}, ledger.ErrAccountUnusable},
	}
	for _, tc := range bad {
		_, err := f.post(tc.p)
		if err == nil || (tc.want != nil && !errors.Is(err, tc.want)) {
			t.Errorf("%s: got %v want %v", tc.name, err, tc.want)
		}
	}

	// Accounts of another club cannot be mixed in.
	other := newFixtureClub(f)
	otherWallet, _ := ledger.EnsureAccount(f.ctx, f.pool, other, ledger.AccountMemberWallet, alice, "")
	if _, err := f.post(ledger.Posting{Kind: ledger.KindClubGrant, ActorType: "SYSTEM", Entries: []ledger.Entry{{AccountID: treasury, Amount: -5}, {AccountID: otherWallet, Amount: 5}}}); !errors.Is(err, ledger.ErrAccountUnusable) {
		t.Fatalf("cross-club posting: %v", err)
	}
	f.assertNoViolations()
}

func newFixtureClub(f *fixture) string { return f.club(f.user("other_owner")) }

func TestLedgerHistoryIsImmutable(t *testing.T) {
	f := newFixture(t)
	w := f.account(ledger.AccountMemberWallet, f.user("u"), "")
	f.grant(w, 50)
	stmts := []string{
		`UPDATE ledger_accounts SET balance = balance + 1000000`,
		`UPDATE ledger_entries SET amount_signed = 1`,
		`DELETE FROM ledger_entries`,
		`UPDATE ledger_transactions SET kind = 'CLUB_GRANT'`,
		`DELETE FROM ledger_transactions`,
		`DELETE FROM ledger_accounts`,
		`UPDATE ledger_accounts SET owner_id = gen_random_uuid() WHERE kind = 'MEMBER_WALLET'`,
		fmt.Sprintf(`INSERT INTO ledger_accounts (club_id, kind, owner_type, owner_id, balance) VALUES ('%s', 'MEMBER_WALLET', 'USER', gen_random_uuid(), 500)`, f.clubID),
	}
	for _, s := range stmts {
		if _, err := f.pool.Exec(f.ctx, s); err == nil {
			t.Errorf("statement should be rejected: %s", s)
		}
	}
	if f.balance(w) != 50 {
		t.Fatal("balance changed")
	}
	f.assertNoViolations()
}

func TestConcurrentSpendingNeverOverdraws(t *testing.T) {
	f := newFixture(t)
	u := f.user("u")
	w := f.account(ledger.AccountMemberWallet, u, "")
	s := f.account(ledger.AccountTableStack, u, f.table())
	f.grant(w, 1000)

	var wg sync.WaitGroup
	var mu sync.Mutex
	ok, insufficient := 0, 0
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := f.post(ledger.Posting{Kind: ledger.KindTableBuyIn, Entries: []ledger.Entry{{AccountID: w, Amount: -100}, {AccountID: s, Amount: 100}}})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				ok++
			case errors.Is(err, ledger.ErrInsufficientChips):
				insufficient++
			default:
				t.Errorf("unexpected error: %v", err)
			}
		}()
	}
	wg.Wait()
	if ok != 10 || insufficient != 30 || f.balance(w) != 0 || f.balance(s) != 1000 {
		t.Fatalf("ok=%d insufficient=%d wallet=%d stack=%d", ok, insufficient, f.balance(w), f.balance(s))
	}
	f.assertNoViolations()
}

func TestConcurrentDuplicatePostingsApplyOnce(t *testing.T) {
	f := newFixture(t)
	w := f.account(ledger.AccountMemberWallet, f.user("u"), "")
	treasury := f.account(ledger.AccountClubTreasury, f.clubID, "")
	p := ledger.Posting{ExternalRef: "grant:race", Kind: ledger.KindClubGrant, ActorType: "SYSTEM",
		Entries: []ledger.Entry{{AccountID: treasury, Amount: -250}, {AccountID: w, Amount: 250}}}
	var wg sync.WaitGroup
	results := make(chan ledger.Result, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, err := f.post(p)
			if err != nil {
				t.Errorf("duplicate posting failed: %v", err)
				return
			}
			results <- r
		}()
	}
	wg.Wait()
	close(results)
	created, ids := 0, map[string]bool{}
	for r := range results {
		ids[r.TxID] = true
		if r.Created {
			created++
		}
	}
	if created != 1 || len(ids) != 1 || f.balance(w) != 250 {
		t.Fatalf("created=%d ids=%d balance=%d", created, len(ids), f.balance(w))
	}
}

func TestReversals(t *testing.T) {
	f := newFixture(t)
	w := f.account(ledger.AccountMemberWallet, f.user("u"), "")
	treasury := f.account(ledger.AccountClubTreasury, f.clubID, "")
	grant := f.mustPost(ledger.Posting{Kind: ledger.KindClubGrant, ActorType: "SYSTEM",
		Entries: []ledger.Entry{{AccountID: treasury, Amount: -70}, {AccountID: w, Amount: 70}}})

	reverse := func(ref string) error {
		var id string
		var created bool
		err := f.pool.QueryRow(f.ctx, `SELECT tx_id::text, created FROM ledger_reverse($1, $2, $3, 'SYSTEM', NULL, '{}')`,
			uuid.NewString(), grant.TxID, ref).Scan(&id, &created)
		return ledger.MapError(err)
	}
	if err := reverse("rev:1"); err != nil {
		t.Fatal(err)
	}
	if f.balance(w) != 0 || f.balance(treasury) != 0 {
		t.Fatal("reversal must restore balances")
	}
	if err := reverse("rev:1"); err != nil {
		t.Fatalf("same reversal ref must be idempotent: %v", err)
	}
	if err := reverse("rev:2"); !errors.Is(err, ledger.ErrAlreadyReversed) {
		t.Fatalf("double reversal: %v", err)
	}
	// A hand-crafted REVERSAL that does not negate the original is rejected.
	other := f.mustPost(ledger.Posting{Kind: ledger.KindClubGrant, ActorType: "SYSTEM",
		Entries: []ledger.Entry{{AccountID: treasury, Amount: -10}, {AccountID: w, Amount: 10}}})
	var id string
	var created bool
	err := f.pool.QueryRow(f.ctx, `SELECT tx_id::text, created FROM ledger_post($1, 'forged', 'REVERSAL', $2, 'SYSTEM', NULL, NULL, NULL, '{}', $3, $4)`,
		uuid.NewString(), f.clubID, fmt.Sprintf(`[{"accountId":"%s","amount":-1000},{"accountId":"%s","amount":1000}]`, w, treasury), other.TxID).Scan(&id, &created)
	if !errors.Is(ledger.MapError(err), ledger.ErrInvariant) {
		t.Fatalf("forged reversal: %v", err)
	}
	f.assertNoViolations()
}

// Random sequences of valid and invalid operations never create or destroy
// chips: every club always sums to zero and projections match entries.
func TestRandomOperationsConserveChips(t *testing.T) {
	f := newFixture(t)
	r := mrand.New(mrand.NewPCG(1, 2))
	treasury := f.account(ledger.AccountClubTreasury, f.clubID, "")
	tables := []string{f.table(), f.table()}
	type player struct {
		wallet string
		stacks map[string]string
	}
	var players []player
	for i := 0; i < 5; i++ {
		u := f.user(fmt.Sprintf("p%d", i))
		p := player{wallet: f.account(ledger.AccountMemberWallet, u, ""), stacks: map[string]string{}}
		for _, tb := range tables {
			p.stacks[tb] = f.account(ledger.AccountTableStack, u, tb)
		}
		players = append(players, p)
	}
	for i := 0; i < 400; i++ {
		p := players[r.IntN(len(players))]
		q := players[r.IntN(len(players))]
		tb := tables[r.IntN(len(tables))]
		amt := 1 + r.Int64N(300)
		var posting ledger.Posting
		switch r.IntN(5) {
		case 0:
			posting = ledger.Posting{Kind: ledger.KindClubGrant, ActorType: "SYSTEM", Entries: []ledger.Entry{{AccountID: treasury, Amount: -amt}, {AccountID: p.wallet, Amount: amt}}}
		case 1:
			posting = ledger.Posting{Kind: "CLUB_DEDUCTION", ActorType: "SYSTEM", Entries: []ledger.Entry{{AccountID: p.wallet, Amount: -amt}, {AccountID: treasury, Amount: amt}}}
		case 2:
			posting = ledger.Posting{Kind: ledger.KindTableBuyIn, Entries: []ledger.Entry{{AccountID: p.wallet, Amount: -amt}, {AccountID: p.stacks[tb], Amount: amt}}}
		case 3:
			posting = ledger.Posting{Kind: ledger.KindTableCashOut, Entries: []ledger.Entry{{AccountID: p.stacks[tb], Amount: -amt}, {AccountID: p.wallet, Amount: amt}}}
		default:
			if p.wallet == q.wallet {
				continue
			}
			posting = ledger.Posting{Kind: ledger.KindHandSettlement, Entries: []ledger.Entry{{AccountID: p.stacks[tb], Amount: -amt}, {AccountID: q.stacks[tb], Amount: amt}}}
		}
		if _, err := f.post(posting); err != nil && !errors.Is(err, ledger.ErrInsufficientChips) {
			t.Fatalf("op %d (%s): %v", i, posting.Kind, err)
		}
		if i%50 == 0 {
			f.assertNoViolations()
		}
	}
	var sum int64
	_ = f.pool.QueryRow(f.ctx, `SELECT coalesce(sum(balance), 0)::bigint FROM ledger_accounts WHERE club_id = $1`, f.clubID).Scan(&sum)
	if sum != 0 {
		t.Fatalf("club does not sum to zero: %d", sum)
	}
	f.assertNoViolations()
}
