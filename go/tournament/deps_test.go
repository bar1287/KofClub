package tournament

import (
	"go/build"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Like go/poker, the tournament rules are a pure domain package: no
// network, database, environment or clock (time is used for durations
// only; callers pass elapsed time in).
var allowedImports = map[string]bool{"errors": true, "sort": true, "time": true}

func TestTournamentHasNoInfrastructureDependencies(t *testing.T) {
	pkg, err := build.ImportDir(".", 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, imp := range pkg.Imports {
		if !allowedImports[imp] {
			t.Errorf("go/tournament must not import %q", imp)
		}
	}
	files, _ := filepath.Glob("*.go")
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, _ := os.ReadFile(f)
		for _, banned := range []string{"time.Now", "time.Since", "time.Until", "time.Sleep"} {
			if strings.Contains(string(src), banned) {
				t.Errorf("%s uses %s: the clock must be passed in", f, banned)
			}
		}
	}
}
