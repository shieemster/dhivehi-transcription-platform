package handlers

import (
	"fmt"
	"io"
	"log"
	"net/http"

	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

// GetFile handles GET /files/:job_id — streams the decrypted file directly
// in the response, after checking the caller is actually allowed to see
// this specific transcript (not just "some" transcripts).
//
// This used to return a presigned URL the browser could fetch on its own.
// Now that objects are encrypted at rest with SSE-C, that's no longer
// possible — the decryption key has to be sent as a request header, which
// a presigned/query-string-auth URL can't carry. So the backend is now the
// only thing that ever talks to MinIO directly: it fetches + decrypts,
// then streams the plaintext bytes straight into this response.
func GetFile(c *gin.Context) {
	jobID := c.Param("job_id")
	claims := c.MustGet("claims").(*services.Claims)
	grantedSet := c.MustGet("permissions").(map[string]bool)

	transcript, err := services.GetTranscriptByID(jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transcript not found"})
		return
	}

	if !canAccessTranscript(claims, grantedSet, transcript.UploadedBy) {
		logAccessDenied(c, claims, "transcript", jobID, "GetFile")
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not have permission to access this file"})
		return
	}

	if transcript.MinioBucket == "" || transcript.MinioObject == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "file location missing for this transcript"})
		return
	}

	obj, info, err := services.StreamObject(c.Request.Context(), transcript.MinioBucket, transcript.MinioObject)
	if err != nil {
		log.Printf("⚠️ stream failed for %s/%s: %v", transcript.MinioBucket, transcript.MinioObject, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to retrieve file"})
		return
	}
	defer obj.Close()

	if err := services.LogAudit(c.Request.Context(), &claims.UserID, claims.Email, "file_download", "transcript", jobID, c.ClientIP(), map[string]interface{}{"filename": transcript.Filename}); err != nil {
		log.Printf("⚠️ failed to write audit log: %v", err)
	}

	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, transcript.Filename))
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Length", fmt.Sprintf("%d", info.Size))
	c.Status(http.StatusOK)

	if _, err := io.Copy(c.Writer, obj); err != nil {
		log.Printf("⚠️ error streaming file to client: %v", err)
	}
}
