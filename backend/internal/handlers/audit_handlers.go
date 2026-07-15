package handlers

import (
	"net/http"

	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

const auditLogPageSize = 200

// GetAuditLogs handles GET /audit-logs.
//
// TODO: audit_log:view_team should scope results to the caller's team, same
// gap as ListTranscripts — there's no team field on users yet, so for now
// both view_team and view_all see every entry.
func GetAuditLogs(c *gin.Context) {
	entries, err := services.ListAuditLogs(c.Request.Context(), auditLogPageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch audit logs"})
		return
	}
	c.JSON(http.StatusOK, entries)
}

// VerifyAuditLog handles GET /audit-logs/verify — recomputes the hash chain
// over every audit log entry and reports whether it's still intact. A
// false result means some entry (at or after broken_at_id) was modified,
// deleted, or reinserted out of order since it was written.
func VerifyAuditLog(c *gin.Context) {
	valid, brokenAtID, err := services.VerifyAuditChain(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify audit chain"})
		return
	}

	resp := gin.H{"valid": valid}
	if !valid && brokenAtID != nil {
		resp["broken_at_id"] = *brokenAtID
	}
	c.JSON(http.StatusOK, resp)
}
