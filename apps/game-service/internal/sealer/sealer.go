// Package sealer encrypts card data at rest (ADR-008) with AES-256-GCM from
// the standard library. Ciphertexts are bound to a context string (the hand
// id) via additional authenticated data, so a ciphertext cannot be moved to
// another hand.
//
// Keys rotate through a keyring: data is sealed with the active key and the
// caller stores that key's id next to it (hands.seal_key_id); any key of the
// ring opens data sealed with its id. Data sealed before key ids existed
// used the original key, id 1.
package sealer

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
)

// ErrUnknownKey means data was sealed with a key id the keyring lacks
// (a retired key was removed before its data was re-sealed).
var ErrUnknownKey = errors.New("sealer: key id not configured")

// Sealer encrypts with the active key and decrypts with any key of its
// keyring.
type Sealer struct {
	active int
	keys   map[int]cipher.AEAD
}

// New builds a single-key Sealer (key id 1) from a base64-encoded 32-byte key.
func New(keyB64 string) (*Sealer, error) {
	return NewKeyring("1:" + keyB64)
}

// NewKeyring parses "id:base64key[,id:base64key...]" (ids 1..2^31-1,
// 32-byte keys). The first key is the active one; the others only open data
// sealed with them.
func NewKeyring(spec string) (*Sealer, error) {
	s := &Sealer{keys: map[int]cipher.AEAD{}}
	for i, entry := range strings.Split(spec, ",") {
		idText, keyB64, ok := strings.Cut(strings.TrimSpace(entry), ":")
		if !ok {
			return nil, fmt.Errorf("sealer: keyring entry %d must be id:base64key", i+1)
		}
		id, err := strconv.Atoi(idText)
		if err != nil || id < 1 || id > math.MaxInt32 {
			return nil, fmt.Errorf("sealer: keyring entry %d: key id must be an integer between 1 and %d", i+1, math.MaxInt32)
		}
		if _, dup := s.keys[id]; dup {
			return nil, fmt.Errorf("sealer: key id %d appears twice", id)
		}
		aead, err := newAEAD(keyB64)
		if err != nil {
			return nil, fmt.Errorf("sealer: key %d: %w", id, err)
		}
		s.keys[id] = aead
		if i == 0 {
			s.active = id
		}
	}
	return s, nil
}

func newAEAD(keyB64 string) (cipher.AEAD, error) {
	key, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil {
		return nil, fmt.Errorf("key must be base64: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("key must be 32 bytes, got %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// KeyID is the id of the key Seal uses; it is fixed for the Sealer's
// lifetime. Callers store it with the sealed data.
func (s *Sealer) KeyID() int { return s.active }

// KeyIDs lists the configured key ids in ascending order.
func (s *Sealer) KeyIDs() []int {
	ids := make([]int, 0, len(s.keys))
	for id := range s.keys {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	return ids
}

// Seal encrypts with the active key and returns nonce || ciphertext.
func (s *Sealer) Seal(plaintext []byte, context string) ([]byte, error) {
	aead := s.keys[s.active]
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return aead.Seal(nonce, nonce, plaintext, []byte(context)), nil
}

// Open reverses Seal for data sealed with key keyID; it fails if the data or
// context were tampered with, and with ErrUnknownKey if the key is missing.
func (s *Sealer) Open(keyID int, sealed []byte, context string) ([]byte, error) {
	aead, ok := s.keys[keyID]
	if !ok {
		return nil, fmt.Errorf("%w: %d", ErrUnknownKey, keyID)
	}
	n := aead.NonceSize()
	if len(sealed) < n {
		return nil, errors.New("sealer: ciphertext too short")
	}
	return aead.Open(nil, sealed[:n], sealed[n:], []byte(context))
}
