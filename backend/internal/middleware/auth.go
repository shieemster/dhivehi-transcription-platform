package middleware

import (
	"net/http"

	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

// RequireAuth validates the session JWT carried in the httpOnly
// transcript_session cookie and stores the parsed claims in gin's context
// under "claims" for handlers to read.
//
// This only establishes identity (who is making the request). It does NOT
// enforce role-based permissions — that's the RBAC middleware in step 3,
// which will sit on top of this and check claims.RoleName against each
// route's required permission.
func RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString, err := c.Cookie(services.SessionCookieName)
		if err != nil || tokenString == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing or invalid session"})
			return
		}

		claims, err := services.ParseJWT(c.Request.Context(), tokenString)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired session"})
			return
		}

		c.Set("claims", claims)
		c.Next()
	}
}

// RequireFullSession blocks a restricted MFA-enrollment token (see
// services.IssueMFAEnrollmentToken) from every route it's applied to. Must
// run after RequireAuth. Deliberately NOT applied to plain /auth/logout or
// the MFA enroll endpoints themselves — a user mid-mandatory-enrollment
// still needs to be able to walk away or finish enrolling.
func RequireFullSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		claims := c.MustGet("claims").(*services.Claims)
		if claims.MFAPending {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "MFA enrollment required before this account can be used", "mfa_enrollment_required": true})
			return
		}
		c.Next()
	}
}
