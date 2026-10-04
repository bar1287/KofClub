package tournament

import (
	"testing"
	"time"
)

func TestBlindScheduleProgression(t *testing.T) {
	s := Structure{SmallBlind: 10, BigBlind: 20, LevelDuration: 5 * time.Minute}
	if err := s.Validate(); err != nil {
		t.Fatal(err)
	}
	want := []Level{{1, 10, 20}, {2, 15, 30}, {3, 20, 40}, {4, 30, 60}, {5, 40, 80}, {10, 150, 300}, {20, 2000, 4000}, {21, 4000, 8000}, {22, 8000, 16000}}
	for _, w := range want {
		if got := s.Level(w.Number); got != w {
			t.Errorf("level %d = %+v, want %+v", w.Number, got, w)
		}
	}
	prev := s.Level(1)
	for n := 2; n <= 80; n++ {
		l := s.Level(n)
		if l.SmallBlind > l.BigBlind || l.SmallBlind <= 0 {
			t.Fatalf("level %d invalid: %+v", n, l)
		}
		if l.BigBlind <= prev.BigBlind && prev.BigBlind < MaxBlind {
			t.Fatalf("big blind must increase until the cap: %+v -> %+v", prev, l)
		}
		if l.BigBlind > MaxBlind {
			t.Fatalf("level %d exceeds the cap: %+v", n, l)
		}
		prev = l
	}
	if s.Level(80).BigBlind != MaxBlind {
		t.Fatalf("blinds stop at the cap: %+v", s.Level(80))
	}
	// Odd and minimal level-1 blinds still increase strictly.
	small := Structure{SmallBlind: 1, BigBlind: 2, LevelDuration: time.Second}
	for n := 2; n <= 20; n++ {
		if small.Level(n).BigBlind <= small.Level(n-1).BigBlind {
			t.Fatalf("level %d does not increase: %+v", n, small.Levels(n))
		}
	}
	huge := Structure{SmallBlind: MaxBlind / 2, BigBlind: MaxBlind, LevelDuration: time.Second}
	if huge.Level(5).BigBlind != MaxBlind {
		t.Fatal("cap must hold without overflow")
	}
}

func TestLevelAtUsesElapsedTime(t *testing.T) {
	s := Structure{SmallBlind: 25, BigBlind: 50, LevelDuration: time.Minute}
	cases := []struct {
		elapsed time.Duration
		level   int
		left    time.Duration
	}{
		{-time.Second, 1, time.Minute},
		{0, 1, time.Minute},
		{59 * time.Second, 1, time.Second},
		{time.Minute, 2, time.Minute},
		{150 * time.Second, 3, 30 * time.Second},
	}
	for _, c := range cases {
		l, left := s.LevelAt(c.elapsed)
		if l.Number != c.level || left != c.left {
			t.Errorf("elapsed %v: level %d left %v, want %d %v", c.elapsed, l.Number, left, c.level, c.left)
		}
	}
	if len(s.Levels(3)) != 3 || s.Levels(3)[2].Number != 3 {
		t.Fatal("Levels")
	}
}

func TestStructureValidation(t *testing.T) {
	bad := []Structure{
		{SmallBlind: 0, BigBlind: 20, LevelDuration: time.Minute},
		{SmallBlind: 30, BigBlind: 20, LevelDuration: time.Minute},
		{SmallBlind: 1, BigBlind: 1, LevelDuration: time.Minute},
		{SmallBlind: 10, BigBlind: 20, LevelDuration: 0},
		{SmallBlind: 10, BigBlind: MaxBlind + 1, LevelDuration: time.Minute},
	}
	for _, s := range bad {
		if s.Validate() == nil {
			t.Errorf("%+v accepted", s)
		}
	}
}
