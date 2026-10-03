// Package sealer encrypts card data at rest (ADR-008) with AES-256-GCM from
// the standard library. Ciphertexts are bound to a context string (the hand
// id) via additional authenticated data, so a ciphertext cannot be moved to
// another hand.
package sealer

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
)

// Sealer encrypts and decrypts small payloads.
type Sealer struct {
	aead cipher.AEAD
}

// New builds a Sealer from a base64-encoded 32-byte key.
func New(keyB64 string) (*Sealer, error) {
	key, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil {
		return nil, fmt.Errorf("sealer: key must be base64: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("sealer: key must be 32 bytes, got %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Sealer{aead: aead}, nil
}

// Seal returns nonce || ciphertext.
func (s *Sealer) Seal(plaintext []byte, context string) ([]byte, error) {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return s.aead.Seal(nonce, nonce, plaintext, []byte(context)), nil
}

// Open reverses Seal; it fails if the data or context were tampered with.
func (s *Sealer) Open(sealed []byte, context string) ([]byte, error) {
	n := s.aead.NonceSize()
	if len(sealed) < n {
		return nil, errors.New("sealer: ciphertext too short")
	}
	return s.aead.Open(nil, sealed[:n], sealed[n:], []byte(context))
}
