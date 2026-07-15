package handlers

import (
	"log"
	"net/http"
	"time"

	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

const accessTokenTTL = 8 * time.Hour

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

	user, err := services.GetUserByEmail(c.Request.Context(), req.Email)
	if err != nil {
		if err != services.ErrUserNotFound {
			log.Printf("⚠️ login lookup error for %s: %v", req.Email, err)
		}
		// Same response for "no such user" and "wrong password" — don't leak
		// which emails are registered.
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	if !user.IsActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "account is disabled"})
		return
	}

	if err := services.VerifyPassword(user, req.Password); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	if user.MFAEnabled {
		if req.MFACode == "" {
			c.JSON(http.StatusOK, gin.H{"mfa_required": true})
			return
		}
		if !services.ValidateTOTPCode(user.MFASecret, req.MFACode) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid MFA code"})
			return
		}
	}

	token, err := services.IssueJWT(user.ID, user.Email, user.RoleName, accessTokenTTL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue token"})
		return
	}

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

	if err := services.RevokeJWT(c.Request.Context(), claims.(*services.Claims)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke token"})
		return
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
		"secret":          secret,
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

	c.JSON(http.StatusOK, gin.H{"message": "MFA enabled"})
}
