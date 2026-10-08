package table

import "testing"

func TestFitPartsKeepsTheEarliestWithinRoom(t *testing.T) {
	parts := []topUpPart{{ref: "a", amount: 300}, {ref: "b", amount: 200}}
	if got := fitParts(parts, 1000); partsTotal(got) != 500 || len(got) != 2 {
		t.Fatalf("all fit: %+v", got)
	}
	if got := fitParts(parts, 400); partsTotal(got) != 400 || len(got) != 2 || got[1].amount != 100 {
		t.Fatalf("trimmed: %+v", got)
	}
	if got := fitParts(parts, 0); len(got) != 0 {
		t.Fatalf("no room: %+v", got)
	}
}
