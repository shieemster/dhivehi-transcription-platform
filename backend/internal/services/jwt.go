package services

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var ErrInvalidToken = errors.New("invalid or expired token")
var ErrTokenRevoked = errors.New("token has been revoked")

// Claims carried inside the JWT. RoleName is embedded directly so the RBAC
// middleware (step 3) can check permissions without a DB round trip on
// every request — GetUserPermissions is still the source of truth and gets
// re-checked on login/refresh, not trusted blindly forever.
type Claims struct {
	UserID   string `json:"user_id"`
	Email    string `json:"email"`
	RoleName string `json:"role_name"`
	jwt.RegisteredClaims
}

func jwtSecret() ([]byte, error) {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return nil, fmt.Errorf("JWT_SECRET is not set")
	}
	return []byte(secret), nil
}

// IssueJWT creates a signed token valid for the given duration.
func IssueJWT(userID, email, roleName string, ttl time.Duration) (string, error) {
	secret, err := jwtSecret()
	if err != nil {
		return "", err
	}

	now := time.Now()
	claims := Claims{
		UserID:   userID,
		Email:    email,
		RoleName: roleName,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			ID:        fmt.Sprintf("%s-%d", userID, now.UnixNano()), // unique per token, used for revocation
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secret)
}

// ParseJWT validates signature + expiry and checks the Redis revocation
// list. Every authenticated request should call this, not just decode
// the token blindly.
func ParseJWT(ctx context.Context, tokenString string) (*Claims, error) {
	secret, err := jwtSecret()
	if err != nil {
		return nil, err
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return secret, nil
	})
	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}

	revoked, err := RedisClient.Exists(ctx, revokedKey(claims.ID)).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to check revocation status: %w", err)
	}
	if revoked > 0 {
		return nil, ErrTokenRevoked
	}

	// Session-epoch check: catches every OTHER session for this account at
	// once (password change, "log out everywhere"), which the single-token
	// Redis blocklist above can't do since it only knows about tokens it
	// was explicitly handed.
	validAfter, err := GetSessionsValidAfter(ctx, claims.UserID)
	if err != nil {
		return nil, fmt.Errorf("failed to check session epoch: %w", err)
	}
	if claims.IssuedAt != nil && claims.IssuedAt.Time.Before(validAfter) {
		return nil, ErrTokenRevoked
	}

	return claims, nil
}

// RevokeJWT blocklists a token's unique ID in Redis until its natural
// expiry (logout, or an administrator forcing a session out).
func RevokeJWT(ctx context.Context, claims *Claims) error {
	ttl := time.Until(claims.ExpiresAt.Time)
	if ttl <= 0 {
		return nil // already expired, nothing to do
	}
	return RedisClient.Set(ctx, revokedKey(claims.ID), "1", ttl).Err()
}

func revokedKey(jti string) string {
	return "revoked_jwt:" + jti
}
