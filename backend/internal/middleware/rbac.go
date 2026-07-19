package middleware

import (
	"log"
	"net/http"

	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

// RequirePermission enforces that the authenticated user's role has at
// least one of the given permission codes. Must run AFTER RequireAuth,
// since it reads "claims" from context — that's why routes chain both:
//
//	group.Use(middleware.RequireAuth(), middleware.RequirePermission("transcript:upload"))
//
// Multiple codes are OR'd together — e.g. RequirePermission("transcript:view_own",
// "transcript:view_team", "transcript:view_all") lets in any role that has
// ANY of those three, appropriate for a route that internally scopes results
// per-role rather than being all-or-nothing.
func RequirePermission(codes ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		claimsVal, ok := c.Get("claims")
		if !ok {
			// Should never happen if RequireAuth ran first — fail closed regardless.
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
			return
		}
		claims := claimsVal.(*services.Claims)

		granted, err := services.GetPermissionsByRoleName(c.Request.Context(), claims.RoleName)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve permissions"})
			return
		}

		grantedSet := make(map[string]bool, len(granted))
		for _, p := range granted {
			grantedSet[p] = true
		}
		c.Set("permissions", grantedSet)

		for _, required := range codes {
			if grantedSet[required] {
				c.Next()
				return
			}
		}

		// Every RBAC-level denial is worth a record — this is a role that
		// flatly lacks any of the required permissions, as opposed to
		// handlers.logAccessDenied's narrower case (some access, just not to
		// this specific resource). Best-effort: a logging failure shouldn't
		// change the response the caller gets.
		if err := services.LogAudit(c.Request.Context(), &claims.UserID, claims.Email, "access_denied", "route", c.FullPath(), c.ClientIP(),
			map[string]interface{}{"method": c.Request.Method, "required_permissions": codes}); err != nil {
			log.Printf("⚠️ failed to write audit log: %v", err)
		}

		// Deliberately vague — confirms "not allowed" without revealing which
		// permission codes exist or which one(s) would have worked, which
		// would hand an attacker a map of the permission model for free.
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "you do not have permission to perform this action"})
	}
}
