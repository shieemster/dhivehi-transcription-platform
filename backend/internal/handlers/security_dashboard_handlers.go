package handlers

import (
	"net/http"

	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

// GetSecurityDashboard handles GET /security/dashboard — a single endpoint
// combining the pieces an administrator needs to see the state of the
// deployed security controls at a glance: audit log volume + tamper-chain
// integrity, RBAC role/user distribution, and whether encryption at rest is
// actually configured (not just "should be").
func GetSecurityDashboard(c *gin.Context) {
	auditSummary, err := services.GetAuditSummary(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to compute audit summary"})
		return
	}

	roleCounts, err := services.GetRoleUserCounts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch role counts"})
		return
	}

	// A real (not assumed) signal: SSE() fails if SSE_C_KEY isn't set, so
	// this reflects whether encryption-at-rest is actually configured in
	// this deployment right now, rather than a hardcoded "true".
	_, sseErr := services.SSE()

	c.JSON(http.StatusOK, gin.H{
		"audit":                         auditSummary,
		"roles":                         roleCounts,
		"encryption_at_rest_configured": sseErr == nil,
	})
}
