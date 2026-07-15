package middleware

import (
	"net/http"
	"strings"

	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

// RequireAuth validates the Bearer token on incoming requests and stores
// the parsed claims in gin's context under "claims" for handlers to read.
//
// This only establishes identity (who is making the request). It does NOT
// enforce role-based permissions — that's the RBAC middleware in step 3,
// which will sit on top of this and check claims.RoleName against each
// route's required permission.
func RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing or malformed Authorization header"})
			return
		}
		tokenString := strings.TrimPrefix(header, "Bearer ")

		claims, err := services.ParseJWT(c.Request.Context(), tokenString)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired session"})
			return
		}

		c.Set("claims", claims)
		c.Next()
	}
}
