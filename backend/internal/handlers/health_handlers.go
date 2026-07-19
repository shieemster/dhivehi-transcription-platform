package handlers

import (
	"log"
	"net/http"

	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

// GetSystemHealth handles GET /system/health — administrator-only. Combines
// live infra connectivity checks (Postgres, Redis, MinIO, Qdrant), pipeline
// worker liveness (via Redis heartbeat, see services.RunHealthChecks), and
// pipeline job queue stats into one view.
func GetSystemHealth(c *gin.Context) {
	checks := services.RunHealthChecks(c.Request.Context())

	overall := "healthy"
	for _, check := range checks {
		if check.Status != "up" {
			overall = "degraded"
			break
		}
	}

	pipeline, err := services.GetPipelineStats()
	if err != nil {
		log.Printf("⚠️ failed to compute pipeline stats: %v", err)
		c.JSON(http.StatusOK, gin.H{
			"overall_status": overall,
			"checks":         checks,
			"pipeline_error": "failed to load pipeline job stats",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"overall_status": overall,
		"checks":         checks,
		"pipeline":       pipeline,
	})
}
