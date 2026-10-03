// Command tracecheck verifies end-to-end tracing (spec §14) against a
// Jaeger query API after traffic was generated (scripts/trace-check.sh):
// a player action must form one trace from WebSocket ingress through the
// game command, its persistence and ledger posting, to the broadcast.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"time"
)

type span struct {
	SpanID        string `json:"spanID"`
	OperationName string `json:"operationName"`
	ProcessID     string `json:"processID"`
	References    []struct {
		RefType string `json:"refType"`
		SpanID  string `json:"spanID"`
	} `json:"references"`
}

type traceData struct {
	TraceID   string                     `json:"traceID"`
	Spans     []span                     `json:"spans"`
	Processes map[string]json.RawMessage `json:"processes"`
}

func main() {
	jaeger := flag.String("jaeger", "http://127.0.0.1:16686", "Jaeger query base URL")
	flag.Parse()
	var lastErr error
	for range 20 { // spans are exported in batches
		if lastErr = check(*jaeger); lastErr == nil {
			fmt.Println("tracecheck: OK")
			return
		}
		time.Sleep(time.Second)
	}
	fmt.Fprintln(os.Stderr, "tracecheck: FAIL:", lastErr)
	os.Exit(1)
}

func fetch(base, service, operation string) ([]traceData, error) {
	q := url.Values{"service": {service}, "limit": {"500"}}
	if operation != "" {
		q.Set("operation", operation)
	}
	res, err := http.Get(base + "/api/traces?" + q.Encode())
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var body struct {
		Data []traceData `json:"data"`
	}
	return body.Data, json.NewDecoder(res.Body).Decode(&body)
}

func serviceOf(t traceData, s span) string {
	var p struct {
		ServiceName string `json:"serviceName"`
	}
	_ = json.Unmarshal(t.Processes[s.ProcessID], &p)
	return p.ServiceName
}

func parentOf(s span) string {
	for _, r := range s.References {
		if r.RefType == "CHILD_OF" {
			return r.SpanID
		}
	}
	return ""
}

func check(base string) error {
	traces, err := fetch(base, "realtime-gateway", "ws.command")
	if err != nil {
		return err
	}
	if len(traces) == 0 {
		return fmt.Errorf("no ws.command traces")
	}
	for _, t := range traces {
		byOp := map[string]span{}
		for _, s := range t.Spans {
			byOp[serviceOf(t, s)+"/"+s.OperationName] = s
		}
		root, ok1 := byOp["realtime-gateway/ws.command"]
		cmd, ok2 := byOp["game-service/table.command"]
		persist, ok3 := byOp["game-service/table.persist"]
		ledgerPost, ok4 := byOp["game-service/ledger.post"]
		broadcast, ok5 := byOp["game-service/table.broadcast"]
		if !(ok1 && ok2 && ok3 && ok4 && ok5) {
			continue // not a hand-ending action
		}
		server := byOp["game-service/POST /internal/v1/tables/{tableId}/commands"]
		if parentOf(server) != root.SpanID || parentOf(cmd) != server.SpanID ||
			parentOf(persist) != cmd.SpanID || parentOf(broadcast) != cmd.SpanID || parentOf(ledgerPost) != persist.SpanID {
			return fmt.Errorf("trace %s has the right spans but the wrong shape", t.TraceID)
		}
		fmt.Printf("trace %s: ws.command -> commands API -> table.command -> table.persist -> ledger.post, table.broadcast\n", t.TraceID)
		return nil
	}
	return fmt.Errorf("no hand-ending action traced across gateway and game service (%d candidate traces)", len(traces))
}
