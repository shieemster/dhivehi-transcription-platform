package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const loginLockoutWindow = 15 * time.Minute

// Email lockout stays tight — it protects one specific (possibly targeted)
// account. The IP threshold is deliberately much higher: it exists to
// catch credential stuffing (many different accounts guessed from one
// source), not to punish a handful of typos from a shared office/NAT IP,
// which would otherwise lock out everyone behind that IP at once —
// including correct-password attempts, since this check runs before
// password verification.
var loginLockoutThresholds = map[string]int64{
	"email": 5,
	"ip":    20,
}

func loginAttemptKey(kind, value string) string {
	return fmt.Sprintf("login_attempts:%s:%s", kind, value)
}

// CheckLoginLockout reports whether either the attempted email or the
// caller's IP has hit its threshold within the current window. Checking
// both independently means an attacker can't dodge the lockout by
// spreading guesses across many source IPs (email-keyed) or by hammering
// many different accounts from one IP (IP-keyed).
func CheckLoginLockout(ctx context.Context, email, ip string) (locked bool, retryAfter time.Duration, err error) {
	for kind, value := range map[string]string{"email": email, "ip": ip} {
		key := loginAttemptKey(kind, value)

		ttl, err := RedisClient.TTL(ctx, key).Result()
		if err != nil {
			return false, 0, fmt.Errorf("failed to check login lockout: %w", err)
		}
		if ttl <= 0 {
			continue // key doesn't exist (or has no TTL, which shouldn't happen) — not locked
		}

		count, err := RedisClient.Get(ctx, key).Int64()
		if err != nil && !errors.Is(err, redis.Nil) {
			return false, 0, fmt.Errorf("failed to check login lockout: %w", err)
		}

		if count >= loginLockoutThresholds[kind] {
			locked = true
			if ttl > retryAfter {
				retryAfter = ttl
			}
		}
	}
	return locked, retryAfter, nil
}

// RecordFailedLogin increments both counters, starting a fresh
// loginLockoutWindow the first time either is touched.
func RecordFailedLogin(ctx context.Context, email, ip string) error {
	for _, key := range []string{loginAttemptKey("email", email), loginAttemptKey("ip", ip)} {
		count, err := RedisClient.Incr(ctx, key).Result()
		if err != nil {
			return fmt.Errorf("failed to record failed login: %w", err)
		}
		if count == 1 {
			if err := RedisClient.Expire(ctx, key, loginLockoutWindow).Err(); err != nil {
				return fmt.Errorf("failed to set login attempt TTL: %w", err)
			}
		}
	}
	return nil
}

// ResetLoginAttempts clears both counters on a successful login, so an
// account that had a few mistyped-password attempts isn't left sitting
// close to the lockout threshold indefinitely.
func ResetLoginAttempts(ctx context.Context, email, ip string) {
	RedisClient.Del(ctx, loginAttemptKey("email", email), loginAttemptKey("ip", ip))
}
