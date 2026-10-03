package table

import "container/list"

// eventRing retains the most recent events for missed-event replay (ADR-004).
type eventRing struct {
	buf   []Event
	start int
	size  int
}

func newEventRing(capacity int) *eventRing { return &eventRing{buf: make([]Event, capacity)} }

func (r *eventRing) push(e Event) {
	if r.size < len(r.buf) {
		r.buf[(r.start+r.size)%len(r.buf)] = e
		r.size++
		return
	}
	r.buf[r.start] = e
	r.start = (r.start + 1) % len(r.buf)
}

// since returns events with seq > after, or ok=false when some of them were
// already evicted.
func (r *eventRing) since(after, current int64) ([]Event, bool) {
	if after >= current {
		return nil, true
	}
	if r.size == 0 || r.buf[r.start].Seq > after+1 {
		return nil, false
	}
	var out []Event
	for i := 0; i < r.size; i++ {
		e := r.buf[(r.start+i)%len(r.buf)]
		if e.Seq > after {
			out = append(out, e)
		}
	}
	return out, true
}

// commandCache remembers recent command results (bounded LRU) so retries of
// the same command id return the original outcome instead of re-applying.
type commandCache struct {
	cap   int
	order *list.List
	items map[string]*list.Element
}

type cacheEntry struct {
	key    string
	result CommandResult
}

func newCommandCache(capacity int) *commandCache {
	return &commandCache{cap: capacity, order: list.New(), items: map[string]*list.Element{}}
}

func (c *commandCache) get(key string) (CommandResult, bool) {
	el, ok := c.items[key]
	if !ok {
		return CommandResult{}, false
	}
	c.order.MoveToFront(el)
	return el.Value.(*cacheEntry).result, true
}

func (c *commandCache) put(key string, r CommandResult) {
	if el, ok := c.items[key]; ok {
		el.Value.(*cacheEntry).result = r
		c.order.MoveToFront(el)
		return
	}
	c.items[key] = c.order.PushFront(&cacheEntry{key: key, result: r})
	if c.order.Len() > c.cap {
		last := c.order.Back()
		c.order.Remove(last)
		delete(c.items, last.Value.(*cacheEntry).key)
	}
}
