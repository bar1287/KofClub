package table

import "testing"

func TestEventRingSince(t *testing.T) {
	r := newEventRing(3)
	for seq := int64(1); seq <= 5; seq++ {
		r.push(Event{Seq: seq})
	}
	if evs, ok := r.since(2, 5); !ok || len(evs) != 3 || evs[0].Seq != 3 {
		t.Fatalf("since(2): %v %v", evs, ok)
	}
	if _, ok := r.since(1, 5); ok {
		t.Fatal("event 2 was evicted: resync required")
	}
	if evs, ok := r.since(5, 5); !ok || len(evs) != 0 {
		t.Fatal("up to date client gets nothing")
	}
}

func TestCommandCacheEvictsOldest(t *testing.T) {
	c := newCommandCache(2)
	c.put("a", CommandResult{Seq: 1})
	c.put("b", CommandResult{Seq: 2})
	c.get("a")
	c.put("c", CommandResult{Seq: 3})
	if _, ok := c.get("b"); ok {
		t.Fatal("least recently used entry should be evicted")
	}
	if r, ok := c.get("a"); !ok || r.Seq != 1 {
		t.Fatal("recently used entry must survive")
	}
}
