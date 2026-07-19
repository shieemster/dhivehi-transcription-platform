package handlers

import (
	"errors"
	"log"
	"net/http"
	"time"

	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

const accessTokenTTL = 8 * time.Hour

// setSessionCookie writes the session JWT as an httpOnly, Secure,
// SameSite=Strict cookie — never readable from JS, and Strict is sufficient
// CSRF protection here since the frontend and API are different ports of
// the same host rather than different sites. maxAgeSeconds mirrors the
// JWT's own TTL so the cookie doesn't outlive the token it carries.
func setSessionCookie(c *gin.Context, token string, maxAgeSeconds int) {
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(services.SessionCookieName, token, maxAgeSeconds, "/", "", true, true)
}

// clearSessionCookie expires the session cookie immediately (logout).
func clearSessionCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(services.SessionCookieName, "", -1, "/", "", true, true)
}

// rolesRequiringMFA — administrator and supervisor hold the most sensitive
// permissions (audit log access, user/role data, deleting transcripts), so
// MFA isn't optional for them the way it is for everyone else.
var rolesRequiringMFA = map[string]bool{
	"administrator": true,
	"supervisor":    true,
}

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
	} else if rolesRequiringMFA[user.RoleName] {
		// Correct password, but this role can't get a real session without
		// MFA enrolled first. Issue a short-lived, restricted token that
		// only grants access to the enrollment endpoints (see
		// middleware.RequireFullSession) — enough to let the client walk
		// straight into enrollment without a second login afterward.
		enrollToken, err := services.IssueMFAEnrollmentToken(user.ID, user.Email, user.RoleName)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue enrollment token"})
			return
		}
		if err := services.LogAudit(c.Request.Context(), &user.ID, user.Email, "login_mfa_enrollment_required", "user", user.ID, c.ClientIP(), nil); err != nil {
			log.Printf("⚠️ failed to write audit log: %v", err)
		}
		services.ResetLoginAttempts(c.Request.Context(), req.Email, c.ClientIP())
		setSessionCookie(c, enrollToken, int(services.MFAEnrollmentTokenTTL.Seconds()))
		c.JSON(http.StatusOK, gin.H{
			"mfa_enrollment_required": true,
			"expires_in":              int(services.MFAEnrollmentTokenTTL.Seconds()),
			"user": gin.H{
				"id":           user.ID,
				"email":        user.Email,
				"display_name": user.DisplayName,
				"role":         user.RoleName,
				"mfa_enabled":  false,
			},
		})
		return
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

	setSessionCookie(c, token, int(accessTokenTTL.Seconds()))
	c.JSON(http.StatusOK, gin.H{
		"expires_in": int(accessTokenTTL.Seconds()),
		"user": gin.H{
			"id":           user.ID,
			"email":        user.Email,
			"display_name": user.DisplayName,
			"role":         user.RoleName,
			"mfa_enabled":  user.MFAEnabled,
		},
	})
}

// Me handles GET /auth/me. The frontend calls this on load/navigation to
// positively confirm the httpOnly session cookie is still valid, rather
// than trusting its locally-cached profile alone — that cache has no way
// to know the cookie expired naturally, was revoked by a password change,
// or was invalidated by an admin deactivating/changing the account from
// somewhere else entirely.
func Me(c *gin.Context) {
	claims := c.MustGet("claims").(*services.Claims)

	user, err := services.GetUserByID(c.Request.Context(), claims.UserID)
	if err != nil {
		if errors.Is(err, services.ErrUserNotFound) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "session no longer valid"})
			return
		}
		log.Printf("⚠️ failed to fetch current user: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load session"})
		return
	}
	if !user.IsActive {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "account is disabled"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":           user.ID,
			"email":        user.Email,
			"display_name": user.DisplayName,
			"role":         user.RoleName,
			"mfa_enabled":  user.MFAEnabled,
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
	clearSessionCookie(c)
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

	// Always issue a fresh full-access token here, not just for the
	// mandatory-enrollment flow — the caller might currently be holding a
	// restricted MFAPending token (see middleware.RequireFullSession) and
	// would otherwise be stuck unable to reach anything else after
	// enrolling. A voluntary enrollment (already on a full session) simply
	// gets an equivalent replacement token, which is harmless to ignore.
	token, err := services.IssueJWT(claims.UserID, claims.Email, claims.RoleName, accessTokenTTL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "MFA enabled, but failed to issue a new session token — please log in again"})
		return
	}

	setSessionCookie(c, token, int(accessTokenTTL.Seconds()))
	c.JSON(http.StatusOK, gin.H{
		"message":    "MFA enabled",
		"expires_in": int(accessTokenTTL.Seconds()),
	})
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required"`
}

// ChangePassword handles POST /auth/change-password. On success, every
// session for this account is invalidated — including the one making this
// request — since a compromised token is exactly the scenario a password
// change is meant to recover from. The client should treat a successful
// response like a forced logout and redirect to the login page.
func ChangePassword(c *gin.Context) {
	claims := c.MustGet("claims").(*services.Claims)

	var req changePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "current_password and new_password are required"})
		return
	}

	if err := services.ChangePassword(c.Request.Context(), claims.UserID, req.CurrentPassword, req.NewPassword); err != nil {
		switch {
		case errors.Is(err, services.ErrInvalidCredentials):
			c.JSON(http.StatusUnauthorized, gin.H{"error": "current password is incorrect"})
		case errors.Is(err, services.ErrWeakPassword):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		default:
			log.Printf("⚠️ change password error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to change password"})
		}
		return
	}

	if err := services.LogAudit(c.Request.Context(), &claims.UserID, claims.Email, "password_changed", "user", claims.UserID, c.ClientIP(), nil); err != nil {
		log.Printf("⚠️ failed to write audit log: %v", err)
	}

	c.JSON(http.StatusOK, gin.H{"message": "password changed — please log in again"})
}

// LogoutAllSessions handles POST /auth/logout-all — a self-service "log out
// everywhere" for when a device is lost or a token is suspected leaked,
// invalidating every session for the account rather than just the current one.
func LogoutAllSessions(c *gin.Context) {
	claims := c.MustGet("claims").(*services.Claims)

	if err := services.InvalidateAllSessions(c.Request.Context(), claims.UserID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to log out all sessions"})
		return
	}

	if err := services.LogAudit(c.Request.Context(), &claims.UserID, claims.Email, "logout_all_sessions", "user", claims.UserID, c.ClientIP(), nil); err != nil {
		log.Printf("⚠️ failed to write audit log: %v", err)
	}

	c.JSON(http.StatusOK, gin.H{"message": "logged out of all sessions"})
}
