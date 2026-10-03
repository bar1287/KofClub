// Package access asks control-api whether a user may see/play a table.
// Authorization rules (club membership, bans, suspensions) live only in
// control-api; the gateway caches decisions briefly.
package access

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// Decision is an authorization outcome.
type Decision struct {
	Allowed bool   `json:"allowed"`
	ClubID  string `json:"clubId,omitempty"`
	Code    string `json:"code,omitempty"` // error code when denied
}

// Checker decides table access.
type Checker interface {
	CheckTable(ctx context.Context, userID, tableID string) (Decision, error)
}

// HTTPChecker calls control-api's internal access endpoint.
type HTTPChecker struct {
	baseURL string
	token   string
	client  *http.Client
	ttl     time.Duration

	mu    sync.Mutex
	cache map[string]cached
}

type cached struct {
	d       Decision
	expires time.Time
}

// NewHTTPChecker creates a checker with a decision cache of ttl.
func NewHTTPChecker(baseURL, token string, ttl time.Duration) *HTTPChecker {
	return &HTTPChecker{baseURL: baseURL, token: token, ttl: ttl, client: &http.Client{Timeout: 3 * time.Second}, cache: map[string]cached{}}
}

// CheckTable returns a (possibly cached) decision.
func (c *HTTPChecker) CheckTable(ctx context.Context, userID, tableID string) (Decision, error) {
	key := userID + "|" + tableID
	c.mu.Lock()
	if e, ok := c.cache[key]; ok && time.Now().Before(e.expires) {
		c.mu.Unlock()
		return e.d, nil
	}
	c.mu.Unlock()

	u := fmt.Sprintf("%s/internal/v1/tables/%s/access?userId=%s", c.baseURL, url.PathEscape(tableID), url.QueryEscape(userID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return Decision{}, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	res, err := c.client.Do(req)
	if err != nil {
		return Decision{}, err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return Decision{}, fmt.Errorf("access: control-api returned %d", res.StatusCode)
	}
	var d Decision
	if err := json.NewDecoder(res.Body).Decode(&d); err != nil {
		return Decision{}, err
	}
	c.mu.Lock()
	if len(c.cache) > 100_000 {
		c.cache = map[string]cached{} // bounded memory
	}
	c.cache[key] = cached{d: d, expires: time.Now().Add(c.ttl)}
	c.mu.Unlock()
	return d, nil
}

// Invalidate drops cached decisions for a user (e.g. after revocation).
func (c *HTTPChecker) Invalidate(userID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for k := range c.cache {
		if len(k) > len(userID) && k[:len(userID)] == userID {
			delete(c.cache, k)
		}
	}
}
