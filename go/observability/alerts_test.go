package observability

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// Every alert must name a severity and a runbook that exists, so on-call
// always has a procedure (docs/runbooks). PromQL itself is checked with
// promtool (`make observability-check`).
func TestEveryAlertHasAnExistingRunbook(t *testing.T) {
	root := filepath.Join("..", "..")
	raw, err := os.ReadFile(filepath.Join(root, "infra", "observability", "alerts.yml"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Groups []struct {
			Name  string `yaml:"name"`
			Rules []struct {
				Alert       string            `yaml:"alert"`
				Expr        string            `yaml:"expr"`
				Labels      map[string]string `yaml:"labels"`
				Annotations map[string]string `yaml:"annotations"`
			} `yaml:"rules"`
		} `yaml:"groups"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, g := range doc.Groups {
		for _, r := range g.Rules {
			if r.Alert == "" || strings.TrimSpace(r.Expr) == "" {
				t.Errorf("group %s: rule without alert name or expression", g.Name)
				continue
			}
			if seen[r.Alert] {
				t.Errorf("duplicate alert %s", r.Alert)
			}
			seen[r.Alert] = true
			if s := r.Labels["severity"]; s != "page" && s != "ticket" {
				t.Errorf("%s: severity must be page or ticket, got %q", r.Alert, s)
			}
			book := r.Annotations["runbook"]
			if !strings.HasPrefix(book, "docs/runbooks/") {
				t.Errorf("%s: runbook annotation %q must point into docs/runbooks", r.Alert, book)
				continue
			}
			if _, err := os.Stat(filepath.Join(root, book)); err != nil {
				t.Errorf("%s: runbook %s: %v", r.Alert, book, err)
			}
			index, _ := os.ReadFile(filepath.Join(root, "docs", "runbooks", "README.md"))
			if !strings.Contains(string(index), r.Alert) {
				t.Errorf("%s is not listed in docs/runbooks/README.md", r.Alert)
			}
		}
	}
	if len(seen) == 0 {
		t.Fatal("no alerts found")
	}
}
