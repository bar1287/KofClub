package table

import "context"

// RebalanceNow runs one tournament balancing step on the actor goroutine
// and reports whether players moved. Tests use it to reach states that
// otherwise need a race (a transfer arriving after the claim of a tick).
func (a *Actor) RebalanceNow(ctx context.Context) (bool, error) {
	return call(ctx, a, func() (bool, error) { return a.tourRebalance(), nil })
}
