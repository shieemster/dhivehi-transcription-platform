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

// SessionCookieName is the httpOnly cookie the session JWT travels in.
// Cookies are scoped by host, not port, so this one cookie is valid for
// both the API (:8000) and frontend (:3443) since they're both on
// "localhost" behind Caddy.
const SessionCookieName = "transcript_session"

// Claims carried inside the JWT. RoleName is embedded directly so the RBAC
// middleware (step 3) can check permissions without a DB round trip on
// every request — GetUserPermissions is still the source of truth and gets
// re-checked on login/refresh, not trusted blindly forever.
//
// MFAPending marks a deliberately restricted token: issued when a role that
// requires MFA (administrator/supervisor) logs in correctly but hasn't
// enrolled yet. It carries just enough trust to call the MFA enrollment
// endpoints and nothing else — see middleware.RequireFullSession, which
// every other route (including plain logout) is gated behind.
type Claims struct {
	UserID     string `json:"user_id"`
	Email      string `json:"email"`
	RoleName   string `json:"role_name"`
	MFAPending bool   `json:"mfa_pending,omitempty"`
	jwt.RegisteredClaims
}

func jwtSecret() ([]byte, error) {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return nil, fmt.Errorf("JWT_SECRET is not set")
	}
	return []byte(secret), nil
}

// IssueJWT creates a signed, full-access token valid for the given duration.
func IssueJWT(userID, email, roleName string, ttl time.Duration) (string, error) {
	return issueJWT(userID, email, roleName, ttl, false)
}

// MFAEnrollmentTokenTTL is deliberately short — this token only exists to
// bridge "password verified" to "MFA enrolled," not to be a normal session.
const MFAEnrollmentTokenTTL = 15 * time.Minute

// IssueMFAEnrollmentToken creates a restricted token for a user whose role
// requires MFA but hasn't enrolled yet. It authenticates them (so the
// enrollment endpoints know who they are) without granting access to
// anything else — middleware.RequireFullSession rejects it everywhere
// except MFA enrollment.
func IssueMFAEnrollmentToken(userID, email, roleName string) (string, error) {
	return issueJWT(userID, email, roleName, MFAEnrollmentTokenTTL, true)
}

func issueJWT(userID, email, roleName string, ttl time.Duration, mfaPending bool) (string, error) {
	secret, err := jwtSecret()
	if err != nil {
		return "", err
	}

	now := time.Now()
	claims := Claims{
		UserID:     userID,
		Email:      email,
		RoleName:   roleName,
		MFAPending: mfaPending,
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
