// Package auth verifies access tokens issued by control-api and tracks
// session revocations published through Redis.
package auth

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims are the verified access-token claims.
type Claims struct {
	UserID       string
	SessionID    string
	PlatformRole string
	ExpiresAt    time.Time
}

// Verification errors (mapped to AUTH_TOKEN_* codes).
var (
	ErrTokenExpired = errors.New("auth: token expired")
	ErrTokenInvalid = errors.New("auth: token invalid")
)

// Verifier checks EdDSA (Ed25519) access tokens. The gateway holds only the
// public key: it can verify but never mint tokens.
type Verifier struct {
	key      ed25519.PublicKey
	issuer   string
	audience string
}

// NewVerifier parses a base64-encoded SPKI PEM public key.
func NewVerifier(publicKeyB64, issuer, audience string) (*Verifier, error) {
	pemBytes, err := base64.StdEncoding.DecodeString(publicKeyB64)
	if err != nil {
		return nil, fmt.Errorf("auth: public key must be base64: %w", err)
	}
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("auth: public key is not PEM")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("auth: public key is not Ed25519")
	}
	return &Verifier{key: key, issuer: issuer, audience: audience}, nil
}

type accessClaims struct {
	SID   string `json:"sid"`
	PRole string `json:"prole"`
	jwt.RegisteredClaims
}

// Verify validates signature, algorithm, type, issuer, audience and expiry.
func (v *Verifier) Verify(token string) (Claims, error) {
	var c accessClaims
	parsed, err := jwt.ParseWithClaims(token, &c, func(t *jwt.Token) (any, error) {
		if typ, _ := t.Header["typ"].(string); typ != "at+jwt" {
			return nil, ErrTokenInvalid
		}
		return v.key, nil
	},
		jwt.WithValidMethods([]string{"EdDSA"}),
		jwt.WithIssuer(v.issuer),
		jwt.WithAudience(v.audience),
		jwt.WithExpirationRequired(),
	)
	if errors.Is(err, jwt.ErrTokenExpired) {
		return Claims{}, ErrTokenExpired
	}
	if err != nil || !parsed.Valid || c.Subject == "" || c.SID == "" {
		return Claims{}, ErrTokenInvalid
	}
	return Claims{UserID: c.Subject, SessionID: c.SID, PlatformRole: c.PRole, ExpiresAt: c.ExpiresAt.Time}, nil
}
