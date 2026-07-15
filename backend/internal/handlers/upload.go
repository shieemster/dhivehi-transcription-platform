package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
)

// UploadFile handles file uploads, saves to MinIO, and records metadata in Qdrant
func UploadFile(c *gin.Context) {
	// Get uploaded file
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file not provided"})
		return
	}

	// Capture extra form fields
	category := c.PostForm("category")
	referenceNumber := c.PostForm("reference_number")
	notes := c.PostForm("notes")
	speakers := c.PostForm("speakers") // comma-separated string for now

	// Who's uploading — needed for row-level "view_own" scoping in ListTranscripts.
	// RequireAuth guarantees "claims" is set before this handler runs.
	claims := c.MustGet("claims").(*services.Claims)

	// Generate unique file ID
	fileID := uuid.NewString()
	localPath := fmt.Sprintf("/tmp/%s_%s", fileID, file.Filename)

	// Save file locally
	if err := c.SaveUploadedFile(file, localPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	// Upload to MinIO
	bucket := "uploads"
	ctx := context.Background()
	objectName := fmt.Sprintf("%s_%s", fileID, file.Filename)

	_, err = services.MinioClient.FPutObject(ctx, bucket, objectName, localPath, minio.PutObjectOptions{
		ContentType: "application/octet-stream",
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to upload to MinIO: %v", err)})
		return
	}

	// Build file URL (based on environment variable)
	minioEndpoint := os.Getenv("MINIO_ENDPOINT")
	if minioEndpoint == "" {
		minioEndpoint = "minio:9000" // default fallback for internal Docker network
	}
	fileURL := fmt.Sprintf("http://%s/%s/%s", minioEndpoint, bucket, objectName)

	// Prepare metadata payload for Qdrant
	metadata := map[string]interface{}{
		"type":             "parent",
		"job_id":           fileID,
		"filename":         file.Filename,
		"minio_url":        fileURL,
		"minio_bucket":     bucket,
		"minio_object":     objectName,
		"local_path":       localPath,
		"status":           "uploaded",
		"category":         category,
		"reference_number": referenceNumber,
		"notes":            notes,
		"speakers":         speakers,
		"timestamp":        time.Now().UTC().Format(time.RFC3339),
		"uploaded_by":      claims.UserID,
	}

	// Insert metadata into Qdrant
	if err := services.InsertFileMetadata(fileID, metadata); err != nil {
		log.Printf("⚠️ Failed to insert metadata into Qdrant: %v", err)
	} else {
		log.Printf("✅ Successfully inserted metadata for file %s", fileID)
	}

	// Push job to conversion queue (which handles both video and audio)
	if services.RedisClient == nil {
		log.Printf("⚠️ RedisClient is nil - cannot push to queue")
	} else {
		job := map[string]string{
			"file_id":   fileID,
			"minio_url": fileURL,
			"filename":  file.Filename,
		}
		jobJSON, err := json.Marshal(job)
		if err != nil {
			log.Printf("⚠️ Failed to marshal Redis job: %v", err)
		} else {
			log.Printf("📤 Attempting to push job to conversion queue...")
			err = services.RedisClient.LPush(ctx, "conversion_queue", jobJSON).Err()
			if err != nil {
				log.Printf("⚠️ Failed to push job to Redis: %v", err)
			} else {
				log.Printf("✅ Pushed conversion job to Redis for file %s", fileID)
			}
		}
	}

	// Return response
	c.JSON(http.StatusOK, gin.H{
		"file_id":          fileID,
		"filename":         file.Filename,
		"minio_url":        fileURL,
		"local_path":       localPath,
		"status":           "uploaded",
		"category":         category,
		"reference_number": referenceNumber,
		"notes":            notes,
		"speakers":         speakers,
	})
}
