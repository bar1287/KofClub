package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func keys(t *testing.T) (ed25519.PrivateKey, string) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	der, _ := x509.MarshalPKIXPublicKey(pub)
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
	return priv, base64.StdEncoding.EncodeToString(pemBytes)
}

func sign(t *testing.T, key ed25519.PrivateKey, typ, iss, aud string, exp time.Time) string {
	tok := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwt.MapClaims{
		"sub": "user-1", "sid": "sess-1", "prole": "USER", "iss": iss, "aud": aud, "exp": exp.Unix(), "iat": time.Now().Unix(),
	})
	tok.Header["typ"] = typ
	s, err := tok.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestVerifier(t *testing.T) {
	priv, pubB64 := keys(t)
	v, err := NewVerifier(pubB64, "iss", "aud")
	if err != nil {
		t.Fatal(err)
	}
	c, err := v.Verify(sign(t, priv, "at+jwt", "iss", "aud", time.Now().Add(time.Minute)))
	if err != nil || c.UserID != "user-1" || c.SessionID != "sess-1" {
		t.Fatalf("valid token: %+v %v", c, err)
	}
	if _, err := v.Verify(sign(t, priv, "at+jwt", "iss", "aud", time.Now().Add(-time.Minute))); !errors.Is(err, ErrTokenExpired) {
		t.Fatalf("expired: %v", err)
	}
	for name, tok := range map[string]string{
		"wrong typ":      sign(t, priv, "JWT", "iss", "aud", time.Now().Add(time.Minute)),
		"wrong issuer":   sign(t, priv, "at+jwt", "evil", "aud", time.Now().Add(time.Minute)),
		"wrong audience": sign(t, priv, "at+jwt", "iss", "other", time.Now().Add(time.Minute)),
		"garbage":        "a.b.c",
	} {
		if _, err := v.Verify(tok); !errors.Is(err, ErrTokenInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
	otherPriv, _ := keys(t)
	if _, err := v.Verify(sign(t, otherPriv, "at+jwt", "iss", "aud", time.Now().Add(time.Minute))); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("foreign signature accepted: %v", err)
	}
	// alg=none / HS256 tokens are rejected by the method allowlist.
	hs := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": "x", "sid": "y", "iss": "iss", "aud": "aud", "exp": time.Now().Add(time.Minute).Unix()})
	hs.Header["typ"] = "at+jwt"
	hsTok, _ := hs.SignedString([]byte("secret"))
	if _, err := v.Verify(hsTok); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("HS256 accepted: %v", err)
	}
}
