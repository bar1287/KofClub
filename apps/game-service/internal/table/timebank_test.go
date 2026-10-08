package table

import (
	"testing"
	"time"
)

func TestTimeBanksSeatRefillAndSpend(t *testing.T) {
	b := newTimeBanks(30*time.Second, 2*time.Second)
	b.seat("a")
	if got := b.get("a"); got != 30*time.Second {
		t.Fatalf("new seat: %v", got)
	}
	if got := b.get("nobody"); got != 0 {
		t.Fatalf("unknown user: %v", got)
	}

	// Spending is computed, then applied once committed; it never goes negative.
	left := b.afterSpending("a", 12*time.Second)
	if left != 18*time.Second || b.get("a") != 30*time.Second {
		t.Fatalf("afterSpending must not apply: left=%v bank=%v", left, b.get("a"))
	}
	b.set(map[string]time.Duration{"a": left})
	if got := b.afterSpending("a", time.Minute); got != 0 {
		t.Fatalf("overspent bank: %v", got)
	}

	// Refills add per hand up to the cap; unknown players start from zero.
	got := b.refilled([]string{"a", "new"})
	if got["a"] != 20*time.Second || got["new"] != 2*time.Second {
		t.Fatalf("refill: %v", got)
	}
	b.set(map[string]time.Duration{"a": 29 * time.Second})
	if got := b.refilled([]string{"a"}); got["a"] != 30*time.Second {
		t.Fatalf("refill above the cap: %v", got)
	}
}

func TestTimeBanksLoadCapsAndOffTables(t *testing.T) {
	b := newTimeBanks(10*time.Second, time.Second)
	b.load("a", time.Minute)
	b.load("b", -time.Second)
	if b.get("a") != 10*time.Second || b.get("b") != 0 {
		t.Fatalf("load: a=%v b=%v", b.get("a"), b.get("b"))
	}

	off := newTimeBanks(0, 5*time.Second)
	off.seat("a")
	if off.get("a") != 0 || off.refilled([]string{"a"})["a"] != 0 {
		t.Fatal("a table without a time bank must never grant one")
	}
}
