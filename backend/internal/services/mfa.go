package services

import (
	"context"
	"fmt"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

const mfaIssuer = "Dhivehi Transcription Platform"

// GenerateMFASecret creates a new TOTP secret for a user and returns both
// the raw secret (store it, but only after the user confirms enrollment —
// see VerifyAndEnableMFA) and a provisioning URI that can be rendered as a
// QR code for authenticator apps (Google Authenticator, Authy, etc).
func GenerateMFASecret(email string) (secret string, provisioningURI string, err error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      mfaIssuer,
		AccountName: email,
	})
	if err != nil {
		return "", "", fmt.Errorf("failed to generate TOTP secret: %w", err)
	}
	return key.Secret(), key.URL(), nil
}

// ValidateTOTPCode checks a 6-digit code against a secret, allowing the
// standard +/-1 time-step skew for clock drift between server and phone.
func ValidateTOTPCode(secret, code string) bool {
	valid, _ := totp.ValidateCustom(code, secret, time.Now(), totp.ValidateOpts{
		Period:    30,
		Skew:      1,
		Digits:    otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	})
	return valid
}

// VerifyAndEnableMFA is called once, during enrollment: the user scans the
// QR code, enters the code their app shows, and only if that code is
// correct do we persist the secret and flip mfa_enabled to true. This
// proves the user actually has a working authenticator before we start
// requiring it on every login.
func VerifyAndEnableMFA(ctx context.Context, userID, secret, code string) error {
	if !ValidateTOTPCode(secret, code) {
		return fmt.Errorf("invalid verification code")
	}

	_, err := DB.Exec(ctx, `
		UPDATE users SET mfa_secret = $1, mfa_enabled = true, updated_at = now()
		WHERE id = $2
	`, secret, userID)
	if err != nil {
		return fmt.Errorf("failed to enable MFA: %w", err)
	}
	return nil
}
