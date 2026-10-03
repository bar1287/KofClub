package sealer

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"testing"
)

func newSealer(t *testing.T) *Sealer {
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	s, err := New(base64.StdEncoding.EncodeToString(key))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSealRoundTripAndContextBinding(t *testing.T) {
	s := newSealer(t)
	msg := []byte("As Kd")
	sealed, err := s.Seal(msg, "hand-1")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, msg) {
		t.Fatal("plaintext visible in ciphertext")
	}
	got, err := s.Open(sealed, "hand-1")
	if err != nil || !bytes.Equal(got, msg) {
		t.Fatalf("round trip failed: %q %v", got, err)
	}
	if _, err := s.Open(sealed, "hand-2"); err == nil {
		t.Fatal("ciphertext must be bound to its context")
	}
	sealed[len(sealed)-1] ^= 1
	if _, err := s.Open(sealed, "hand-1"); err == nil {
		t.Fatal("tampering must be detected")
	}
	again, _ := s.Seal(msg, "hand-1")
	if bytes.Equal(again[:12], sealed[:12]) {
		t.Fatal("nonces must not repeat")
	}
}

func TestRejectsBadKeys(t *testing.T) {
	for _, k := range []string{"", "not-base64!", base64.StdEncoding.EncodeToString([]byte("short"))} {
		if _, err := New(k); err == nil {
			t.Errorf("key %q should be rejected", k)
		}
	}
}
