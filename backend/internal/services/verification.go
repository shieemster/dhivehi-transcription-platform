package services

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	purposeEmailVerify   = "email_verify"
	purposePasswordReset = "password_reset"

	// A wrong guess against a 6-digit (1-in-a-million) code doesn't need many
	// tries to become brute-forceable without a cap — 5 matches the same
	// threshold used for login lockout.
	maxCodeAttempts = 5

	resendCooldown = 60 * time.Second
)

var codeTTLs = map[string]time.Duration{
	purposeEmailVerify:   24 * time.Hour,
	purposePasswordReset: 15 * time.Minute,
}

var (
	ErrInvalidVerificationCode     = errors.New("invalid or expired code")
	ErrTooManyVerificationAttempts = errors.New("too many incorrect attempts — request a new code")
	ErrResendTooSoon               = errors.New("a code was already sent recently — please wait before requesting another")
)

func generateNumericCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("failed to generate verification code: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func hashCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

func codeKey(purpose, userID string) string     { return fmt.Sprintf("verify_code:%s:%s", purpose, userID) }
func attemptsKey(purpose, userID string) string { return fmt.Sprintf("verify_attempts:%s:%s", purpose, userID) }
func cooldownKey(purpose, userID string) string { return fmt.Sprintf("verify_cooldown:%s:%s", purpose, userID) }

// issueVerificationCode generates a fresh 6-digit code, stores only its
// SHA-256 hash (so Redis access alone can't leak a usable code) under a
// purpose-specific TTL, and resets any prior attempt counter — the previous
// code, if any, is implicitly invalidated since only the latest hash is
// kept. A short cooldown key prevents a caller from re-triggering sends
// (and re-spamming the recipient's inbox) faster than resendCooldown.
func issueVerificationCode(ctx context.Context, purpose, userID string) (string, error) {
	cKey := cooldownKey(purpose, userID)
	if ttl, err := RedisClient.TTL(ctx, cKey).Result(); err == nil && ttl > 0 {
		return "", ErrResendTooSoon
	}

	code, err := generateNumericCode()
	if err != nil {
		return "", err
	}

	ttl := codeTTLs[purpose]
	if err := RedisClient.Set(ctx, codeKey(purpose, userID), hashCode(code), ttl).Err(); err != nil {
		return "", fmt.Errorf("failed to store verification code: %w", err)
	}
	RedisClient.Del(ctx, attemptsKey(purpose, userID))
	RedisClient.Set(ctx, cKey, "1", resendCooldown)

	return code, nil
}

// consumeVerificationCode checks a supplied code against the stored hash.
// Success deletes it (single-use). Failure increments an attempt counter
// scoped to the same TTL as the code itself, locking out further guesses
// once maxCodeAttempts is hit — the caller has to request a fresh code
// rather than brute-force this one.
func consumeVerificationCode(ctx context.Context, purpose, userID, code string) error {
	aKey := attemptsKey(purpose, userID)

	attempts, err := RedisClient.Get(ctx, aKey).Int()
	if err != nil && !errors.Is(err, redis.Nil) {
		return fmt.Errorf("failed to check verification attempts: %w", err)
	}
	if attempts >= maxCodeAttempts {
		return ErrTooManyVerificationAttempts
	}

	storedHash, err := RedisClient.Get(ctx, codeKey(purpose, userID)).Result()
	if errors.Is(err, redis.Nil) {
		return ErrInvalidVerificationCode
	}
	if err != nil {
		return fmt.Errorf("failed to check verification code: %w", err)
	}

	if hashCode(code) != storedHash {
		pipe := RedisClient.TxPipeline()
		pipe.Incr(ctx, aKey)
		pipe.Expire(ctx, aKey, codeTTLs[purpose])
		if _, err := pipe.Exec(ctx); err != nil {
			return fmt.Errorf("failed to record verification attempt: %w", err)
		}
		return ErrInvalidVerificationCode
	}

	RedisClient.Del(ctx, codeKey(purpose, userID), aKey)
	return nil
}

// IssueEmailVerificationCode generates and emails a fresh verification code
// to the given (already-known-to-exist) user's address.
func IssueEmailVerificationCode(ctx context.Context, userID, email string) error {
	code, err := issueVerificationCode(ctx, purposeEmailVerify, userID)
	if err != nil {
		return err
	}
	body := fmt.Sprintf(
		"Your Dhivehi Transcription Platform verification code is: %s\n\n"+
			"This code expires in 24 hours. If you didn't request this, you can safely ignore this email.",
		code,
	)
	return SendEmail(email, "Verify your email address", body)
}

// VerifyEmailCode checks the code and, on success, marks the account
// verified.
func VerifyEmailCode(ctx context.Context, userID, code string) error {
	if err := consumeVerificationCode(ctx, purposeEmailVerify, userID, code); err != nil {
		return err
	}
	if _, err := DB.Exec(ctx, `UPDATE users SET email_verified = true, updated_at = now() WHERE id = $1`, userID); err != nil {
		return fmt.Errorf("failed to mark email verified: %w", err)
	}
	return nil
}
