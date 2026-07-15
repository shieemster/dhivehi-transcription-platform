package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"transcript_app/backend/internal/services" // Replace with your actual module path

	"github.com/gin-gonic/gin"
)

// canAccessTranscript centralizes the "does this caller have permission
// to touch this specific transcript" check, so GetFileURL, delete,
// segment reads, and segment edits all use identical logic instead of
// four separately-maintained copies that could quietly drift apart.
func canAccessTranscript(claims *services.Claims, grantedSet map[string]bool, uploadedBy string) bool {
	if grantedSet["transcript:view_all"] || grantedSet["transcript:view_team"] {
		return true
	}
	if grantedSet["transcript:view_own"] {
		return uploadedBy == claims.UserID
	}
	return false
}

// ListTranscripts handles GET /transcripts and GET /transcripts?status=completed
// (gin-native — this is what main.go actually registers).
//
// Row-level scoping: a caller whose role only grants transcript:view_own
// (and not view_team/view_all) only sees transcripts they personally
// uploaded. Roles with view_team or view_all currently see everything —
// see the TODO below, "team" isn't modeled in the schema yet so view_team
// can't be scoped tighter than view_all for now.
func ListTranscripts(c *gin.Context) {
	status := c.Query("status")
	claims := c.MustGet("claims").(*services.Claims)

	// RequirePermission middleware already resolved and cached this.
	grantedSet := c.MustGet("permissions").(map[string]bool)

	var transcripts []services.TranscriptListItem
	var err error

	switch {
	case grantedSet["transcript:view_all"], grantedSet["transcript:view_team"]:
		// TODO: once users have a `team` field, view_team should filter to
		// teammates' transcripts instead of falling through to "everything".
		if status != "" {
			transcripts, err = services.GetTranscriptsByStatus(status)
		} else {
			transcripts, err = services.GetAllTranscripts()
		}

	case grantedSet["transcript:view_own"]:
		transcripts, err = services.GetTranscriptsForUser(claims.UserID)
		if err == nil && status != "" {
			var filtered []services.TranscriptListItem
			for _, t := range transcripts {
				if t.Status == status {
					filtered = append(filtered, t)
				}
			}
			transcripts = filtered
		}

	default:
		// RequirePermission on this route already requires one of the three
		// view_* codes, so reaching here would mean a permission was granted
		// that this handler doesn't know how to scope — fail closed rather
		// than accidentally return everything.
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not have permission to view transcripts"})
		return
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to fetch transcripts: %v", err)})
		return
	}
	c.JSON(http.StatusOK, transcripts)
}

// TranscriptStats handles GET /transcripts/stats
// (gin-native — this is what main.go actually registers).
func TranscriptStats(c *gin.Context) {
	stats, err := services.GetTranscriptStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to fetch stats: %v", err)})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// DeleteTranscriptHandler handles DELETE /transcripts/:job_id.
// Requires transcript:delete (currently administrator-only per the seeded
// role permissions). Still checks ownership the same way GetFileURL does,
// so if a future role gets delete without view_all, it stays scoped to
// their own records rather than silently deleting everything.
func DeleteTranscriptHandler(c *gin.Context) {
	jobID := c.Param("job_id")
	claims := c.MustGet("claims").(*services.Claims)
	grantedSet := c.MustGet("permissions").(map[string]bool)

	transcript, err := services.GetTranscriptByID(jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transcript not found"})
		return
	}

	if !canAccessTranscript(claims, grantedSet, transcript.UploadedBy) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not have permission to delete this transcript"})
		return
	}

	if err := services.DeleteTranscript(jobID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to delete transcript: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "transcript deleted"})
}

// GetTranscriptDetail handles GET /transcripts/:job_id — a single
// transcript's parent record, with the same ownership check as the list.
func GetTranscriptDetail(c *gin.Context) {
	jobID := c.Param("job_id")
	claims := c.MustGet("claims").(*services.Claims)
	grantedSet := c.MustGet("permissions").(map[string]bool)

	transcript, err := services.GetTranscriptByID(jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transcript not found"})
		return
	}

	if !canAccessTranscript(claims, grantedSet, transcript.UploadedBy) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not have permission to view this transcript"})
		return
	}

	c.JSON(http.StatusOK, transcript)
}

// GetSegments handles GET /transcripts/:job_id/segments.
func GetSegments(c *gin.Context) {
	jobID := c.Param("job_id")
	claims := c.MustGet("claims").(*services.Claims)
	grantedSet := c.MustGet("permissions").(map[string]bool)

	transcript, err := services.GetTranscriptByID(jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transcript not found"})
		return
	}
	if !canAccessTranscript(claims, grantedSet, transcript.UploadedBy) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not have permission to view this transcript"})
		return
	}

	segments, err := services.GetSegmentsForTranscript(jobID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to fetch segments: %v", err)})
		return
	}
	c.JSON(http.StatusOK, segments)
}

type updateSegmentRequest struct {
	Text string `json:"transcript_text" binding:"required"`
}

// UpdateSegment handles PATCH /transcripts/:job_id/segments/:segment_index.
// Editing requires the same view access as reading — anyone who can see a
// transcript can currently edit it (matching the previous unauthenticated
// behavior, just now gated behind login + ownership instead of wide open).
func UpdateSegment(c *gin.Context) {
	jobID := c.Param("job_id")
	claims := c.MustGet("claims").(*services.Claims)
	grantedSet := c.MustGet("permissions").(map[string]bool)

	segmentIndex, err := strconv.Atoi(c.Param("segment_index"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "segment_index must be a number"})
		return
	}

	transcript, err := services.GetTranscriptByID(jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transcript not found"})
		return
	}
	if !canAccessTranscript(claims, grantedSet, transcript.UploadedBy) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not have permission to edit this transcript"})
		return
	}

	var req updateSegmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "transcript_text is required"})
		return
	}

	if err := services.UpdateSegmentText(jobID, segmentIndex, req.Text); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to update segment: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "segment updated"})
}

// GetSegmentAudioURL handles GET /transcripts/:job_id/segments/:segment_index/audio-url
// — same presigned-URL pattern as GetFileURL, but for an individual
// segment's audio clip rather than the parent recording.
func GetSegmentAudioURL(c *gin.Context) {
	jobID := c.Param("job_id")
	claims := c.MustGet("claims").(*services.Claims)
	grantedSet := c.MustGet("permissions").(map[string]bool)

	segmentIndex, err := strconv.Atoi(c.Param("segment_index"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "segment_index must be a number"})
		return
	}

	transcript, err := services.GetTranscriptByID(jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "transcript not found"})
		return
	}
	if !canAccessTranscript(claims, grantedSet, transcript.UploadedBy) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not have permission to access this transcript"})
		return
	}

	segments, err := services.GetSegmentsForTranscript(jobID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to fetch segments: %v", err)})
		return
	}

	var target *services.Segment
	for i := range segments {
		if segments[i].SegmentIndex == segmentIndex {
			target = &segments[i]
			break
		}
	}
	if target == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "segment not found"})
		return
	}
	if target.MinioBucket == "" || target.MinioObject == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "audio location missing for this segment"})
		return
	}

	url, err := services.GeneratePresignedURL(c.Request.Context(), target.MinioBucket, target.MinioObject, fileURLExpiry)
	if err != nil {
		log.Printf("⚠️ presign failed for segment %s/%s: %v", target.MinioBucket, target.MinioObject, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate audio URL"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"url": url, "expires_in": int(fileURLExpiry.Seconds())})
}

// GetStatsHandler handles GET /api/stats
func GetStatsHandler(w http.ResponseWriter, r *http.Request) {
	stats, err := services.GetTranscriptStats()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get stats: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// GetAllTranscriptsHandler handles GET /api/transcripts
func GetAllTranscriptsHandler(w http.ResponseWriter, r *http.Request) {
	transcripts, err := services.GetAllTranscripts()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get transcripts: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(transcripts)
}

// GetTranscriptsByStatusHandler handles GET /api/transcripts?status=completed
func GetTranscriptsByStatusHandler(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")

	transcripts, err := services.GetTranscriptsByStatus(status)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get transcripts: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(transcripts)
}
