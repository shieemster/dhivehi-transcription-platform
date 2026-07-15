package handlers

import (
	"log"
	"net/http"
	"time"

	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

const fileURLExpiry = 15 * time.Minute

// GetFileURL handles GET /files/:job_id — issues a short-lived signed URL
// for the underlying MinIO object, after checking the caller is actually
// allowed to see this specific transcript (not just "some" transcripts).
//
// This is what replaced the public-read bucket policy: instead of a
// permanent, unauthenticated URL anyone could reuse forever, every file
// access now goes through RBAC + ownership checks and expires quickly.
func GetFileURL(c *gin.Context) {
	jobID := c.Param("job_id")
	claims := c.MustGet("claims").(*services.Claims)
	grantedSet := c.MustGet("permissions").(map[string]bool)

	transcript, err := services.GetTranscriptByID(jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transcript not found"})
		return
	}

	// view_all / view_team: any transcript. view_own only: must be the uploader.
	if !canAccessTranscript(claims, grantedSet, transcript.UploadedBy) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not have permission to access this file"})
		return
	}

	if transcript.MinioBucket == "" || transcript.MinioObject == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "file location missing for this transcript"})
		return
	}

	url, err := services.GeneratePresignedURL(c.Request.Context(), transcript.MinioBucket, transcript.MinioObject, fileURLExpiry)
	if err != nil {
		log.Printf("⚠️ presign failed for %s/%s: %v", transcript.MinioBucket, transcript.MinioObject, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate file URL"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url":        url,
		"expires_in": int(fileURLExpiry.Seconds()),
	})
}
