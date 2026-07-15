package handlers

import (
	"log"
	"net/http"
	"time"

	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

const accessTokenTTL = 8 * time.Hour

// logLoginFailure records a failed login attempt with no resolved user_id
// (the attempt may be against an email that doesn't even exist), so these
// show up in the audit log without a foreign-key user reference. It also
// counts the attempt toward the email+IP lockout thresholds, so every
// failure path (bad email, wrong password, disabled account, wrong MFA
// code) contributes to rate limiting without each call site needing to
// remember to do so separately.
func logLoginFailure(c *gin.Context, attemptedEmail, reason string) {
	if err := services.LogAudit(c.Request.Context(), nil, attemptedEmail, "login_failed", "user", "", c.ClientIP(), map[string]interface{}{"reason": reason}); err != nil {
		log.Printf("⚠️ failed to write audit log: %v", err)
	}
	if err := services.RecordFailedLogin(c.Request.Context(), attemptedEmail, c.ClientIP()); err != nil {
		log.Printf("⚠️ failed to record login attempt: %v", err)
	}
}

type loginRequest struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
	MFACode  string `json:"mfa_code"` // omitted on first attempt; required if account has MFA enabled
}

// Login authenticates email+password. If the account has MFA enabled and no
// mfa_code was supplied, it responds with mfa_required:true instead of a
// token — the client re-submits the same request with mfa_code filled in.
func Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email and password are required"})
		return
	}

	locked, retryAfter, err := services.CheckLoginLockout(c.Request.Context(), req.Email, c.ClientIP())
	if err != nil {
		log.Printf("⚠️ login lockout check failed: %v", err)
		// Fail open — a Redis hiccup shouldn't lock legitimate users out of
		// the app entirely, and the failure is logged for visibility.
	} else if locked {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error":       "too many failed login attempts, please try again later",
			"retry_after": int(retryAfter.Seconds()),
		})
		return
	}

	user, err := services.GetUserByEmail(c.Request.Context(), req.Email)
	if err != nil {
		if err != services.ErrUserNotFound {
			log.Printf("⚠️ login lookup error for %s: %v", req.Email, err)
		}
		logLoginFailure(c, req.Email, "no_such_user")
		// Same response for "no such user" and "wrong password" — don't leak
		// which emails are registered.
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	if !user.IsActive {
		logLoginFailure(c, req.Email, "account_disabled")
		c.JSON(http.StatusForbidden, gin.H{"error": "account is disabled"})
		return
	}

	if err := services.VerifyPassword(user, req.Password); err != nil {
		logLoginFailure(c, req.Email, "wrong_password")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	if user.MFAEnabled {
		if req.MFACode == "" {
			c.JSON(http.StatusOK, gin.H{"mfa_required": true})
			return
		}
		if !services.ValidateTOTPCode(user.MFASecret, req.MFACode) {
			logLoginFailure(c, req.Email, "wrong_mfa_code")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid MFA code"})
			return
		}
	}

	token, err := services.IssueJWT(user.ID, user.Email, user.RoleName, accessTokenTTL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue token"})
		return
	}

	if err := services.LogAudit(c.Request.Context(), &user.ID, user.Email, "login_success", "user", user.ID, c.ClientIP(), nil); err != nil {
		log.Printf("⚠️ failed to write audit log: %v", err)
	}
	services.ResetLoginAttempts(c.Request.Context(), req.Email, c.ClientIP())

	c.JSON(http.StatusOK, gin.H{
		"token":      token,
		"expires_in": int(accessTokenTTL.Seconds()),
		"user": gin.H{
			"id":           user.ID,
			"email":        user.Email,
			"display_name": user.DisplayName,
			"role":         user.RoleName,
		},
	})
}

// Logout revokes the presented token so it can't be reused even though
// it hasn't expired yet.
func Logout(c *gin.Context) {
	claims, ok := c.Get("claims")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}

	claimsTyped := claims.(*services.Claims)
	if err := services.RevokeJWT(c.Request.Context(), claimsTyped); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke token"})
		return
	}
	if err := services.LogAudit(c.Request.Context(), &claimsTyped.UserID, claimsTyped.Email, "logout", "user", claimsTyped.UserID, c.ClientIP(), nil); err != nil {
		log.Printf("⚠️ failed to write audit log: %v", err)
	}
	c.JSON(http.StatusOK, gin.H{"message": "logged out"})
}

// MFAEnrollStart generates a new TOTP secret + QR provisioning URI for the
// authenticated user. The secret is NOT saved yet — it's only persisted
// once the user proves they scanned it correctly, via MFAEnrollConfirm.
func MFAEnrollStart(c *gin.Context) {
	claims := c.MustGet("claims").(*services.Claims)

	secret, uri, err := services.GenerateMFASecret(claims.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate MFA secret"})
		return
	}

	// Returned to the client so it can render a QR code (e.g. via a
	// qrcode.js library) from provisioning_uri, and so it can be echoed
	// back in the confirm step below.
	c.JSON(http.StatusOK, gin.H{
		"secret":           secret,
		"provisioning_uri": uri,
	})
}

type mfaConfirmRequest struct {
	Secret string `json:"secret" binding:"required"`
	Code   string `json:"code" binding:"required"`
}

// MFAEnrollConfirm verifies the first code from the authenticator app and,
// only on success, permanently enables MFA for the account.
func MFAEnrollConfirm(c *gin.Context) {
	claims := c.MustGet("claims").(*services.Claims)

	var req mfaConfirmRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "secret and code are required"})
		return
	}

	if err := services.VerifyAndEnableMFA(c.Request.Context(), claims.UserID, req.Secret, req.Code); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := services.LogAudit(c.Request.Context(), &claims.UserID, claims.Email, "mfa_enabled", "user", claims.UserID, c.ClientIP(), nil); err != nil {
		log.Printf("⚠️ failed to write audit log: %v", err)
	}

	c.JSON(http.StatusOK, gin.H{"message": "MFA enabled"})
}
