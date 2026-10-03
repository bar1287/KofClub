package poker

import (
	"go/build"
	"strings"
	"testing"
)

// The pure engine must have zero dependencies on HTTP, WebSocket,
// PostgreSQL, Redis, UI code, the clock or the environment (spec §5).
// Only this allowlist of standard-library packages may be imported.
var allowedImports = map[string]bool{
	"crypto/sha256":   true,
	"encoding/binary": true,
	"encoding/json":   true,
	"errors":          true,
	"fmt":             true,
	"io":              true,
	"math/bits":       true,
	"sort":            true,
	"strings":         true,
}

func TestEngineHasNoInfrastructureDependencies(t *testing.T) {
	pkg, err := build.ImportDir(".", 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, imp := range pkg.Imports {
		if !allowedImports[imp] {
			t.Errorf("go/poker must not import %q (pure domain package)", imp)
		}
		if strings.Contains(imp, ".") {
			t.Errorf("go/poker must not import third-party package %q", imp)
		}
	}
}
