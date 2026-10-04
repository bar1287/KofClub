package tournament

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"
)

// golden.json pins the blind schedule and payout table. The control-api
// computes the same values in TypeScript for display (levels, projected
// payouts) and checks itself against this file, so the two can never
// drift silently. Regenerate with UPDATE_GOLDEN=1 go test ./go/tournament.
type golden struct {
	Structures []goldenStructure `json:"structures"`
	Prizes     []goldenPrizes    `json:"prizes"`
}

type goldenStructure struct {
	SmallBlind int64      `json:"smallBlind"`
	BigBlind   int64      `json:"bigBlind"`
	Levels     [][2]int64 `json:"levels"`
}

type goldenPrizes struct {
	Entrants int     `json:"entrants"`
	Pool     int64   `json:"pool"`
	Prizes   []int64 `json:"prizes"`
}

func buildGolden() golden {
	var g golden
	for _, b := range [][2]int64{{10, 20}, {25, 50}, {1, 2}, {5, 10}, {50, 100}, {7, 15}} {
		s := Structure{SmallBlind: b[0], BigBlind: b[1], LevelDuration: time.Minute}
		gs := goldenStructure{SmallBlind: b[0], BigBlind: b[1]}
		for _, l := range s.Levels(40) {
			gs.Levels = append(gs.Levels, [2]int64{l.SmallBlind, l.BigBlind})
		}
		g.Structures = append(g.Structures, gs)
	}
	for n := 2; n <= 100; n++ {
		pool := int64(n)*1000 + 7
		g.Prizes = append(g.Prizes, goldenPrizes{Entrants: n, Pool: pool, Prizes: Prizes(n, pool)})
	}
	return g
}

func TestGoldenStructureAndPayouts(t *testing.T) {
	const path = "testdata/golden.json"
	want := buildGolden()
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		b, _ := json.MarshalIndent(want, "", " ")
		if err := os.WriteFile(path, append(b, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var got golden
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatal("testdata/golden.json is out of date: run UPDATE_GOLDEN=1 go test ./go/tournament and update the TypeScript copy")
	}
}
