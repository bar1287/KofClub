package sealer

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"testing"
)

func randomKey() string {
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	return base64.StdEncoding.EncodeToString(key)
}

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
	got, err := s.Open(1, sealed, "hand-1")
	if err != nil || !bytes.Equal(got, msg) {
		t.Fatalf("round trip failed: %q %v", got, err)
	}
	if _, err := s.Open(1, sealed, "hand-2"); err == nil {
		t.Fatal("ciphertext must be bound to its context")
	}
	sealed[len(sealed)-1] ^= 1
	if _, err := s.Open(1, sealed, "hand-1"); err == nil {
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

// Rotation: the first key of the ring seals; every key opens what it sealed.
func TestKeyringRotation(t *testing.T) {
	k1, k2 := randomKey(), randomKey()
	old, err := New(k1)
	if err != nil || old.KeyID() != 1 {
		t.Fatalf("single key is id 1: %v %v", old, err)
	}
	before, _ := old.Seal([]byte("As Kd"), "hole:h1:u1")

	// Phase 1: the new key is known to every node but not used yet.
	staged, err := NewKeyring(fmt.Sprintf("1:%s, 2:%s", k1, k2))
	if err != nil || staged.KeyID() != 1 || fmt.Sprint(staged.KeyIDs()) != "[1 2]" {
		t.Fatalf("staged keyring: %v %v", staged, err)
	}
	// Phase 2: the new key seals; the old one still opens older data.
	rotated, err := NewKeyring(fmt.Sprintf("2:%s,1:%s", k2, k1))
	if err != nil || rotated.KeyID() != 2 {
		t.Fatalf("rotated keyring: %v %v", rotated, err)
	}
	after, _ := rotated.Seal([]byte("Qh Qc"), "hole:h2:u1")
	if got, err := rotated.Open(1, before, "hole:h1:u1"); err != nil || string(got) != "As Kd" {
		t.Fatalf("old data after rotation: %q %v", got, err)
	}
	if got, err := staged.Open(2, after, "hole:h2:u1"); err != nil || string(got) != "Qh Qc" {
		t.Fatalf("a staged node opens new data: %q %v", got, err)
	}
	// A key id names one key: data does not open under another id.
	if _, err := rotated.Open(1, after, "hole:h2:u1"); err == nil {
		t.Fatal("data sealed with key 2 opened as key 1")
	}
	// Retired too early: the error says which key is missing.
	if _, err := old.Open(2, after, "hole:h2:u1"); !errors.Is(err, ErrUnknownKey) {
		t.Fatalf("missing key: %v", err)
	}
}

func TestRejectsBadKeyrings(t *testing.T) {
	k := randomKey()
	for _, spec := range []string{
		"", k, "0:" + k, "-1:" + k, "x:" + k, "2147483648:" + k,
		"1:" + k + ",1:" + randomKey(), "1:" + k + ",2:short", "1:" + k + ",",
	} {
		if _, err := NewKeyring(spec); err == nil {
			t.Errorf("keyring %q should be rejected", spec)
		}
	}
}
