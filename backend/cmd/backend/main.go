package main

import (
	"log"
	"transcript_app/backend/internal/handlers"
	"transcript_app/backend/internal/middleware"
	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

func main() {
	// Initialize all services (PostgreSQL, MinIO, Qdrant, Redis) with auto-creation
	if err := services.InitializeServices(); err != nil {
		log.Fatalf("❌ Failed to initialize services: %v", err)
	}

	r := gin.Default()

	// Enable CORS for frontend
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, PATCH, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// --- Data routes — now require a valid session AND the matching permission ---
	protected := r.Group("/")
	protected.Use(middleware.RequireAuth())
	{
		protected.POST("/upload",
			middleware.RequirePermission("transcript:upload"),
			handlers.UploadFile)

		protected.POST("/transcripts/:job_id/analyse",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.AnalyseTranscript)

		protected.GET("/transcripts",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.ListTranscripts)

		protected.GET("/transcripts/stats",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.TranscriptStats)

		protected.GET("/files/:job_id",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.GetFileURL)

		protected.GET("/transcripts/:job_id",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.GetTranscriptDetail)

		protected.GET("/transcripts/:job_id/segments",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.GetSegments)

		protected.PATCH("/transcripts/:job_id/segments/:segment_index",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.UpdateSegment)

		protected.GET("/transcripts/:job_id/segments/:segment_index/audio-url",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.GetSegmentAudioURL)

		protected.DELETE("/transcripts/:job_id",
			middleware.RequirePermission("transcript:delete"),
			handlers.DeleteTranscriptHandler)
	}

	// --- Auth routes ---
	r.POST("/auth/login", handlers.Login)

	authorized := r.Group("/auth")
	authorized.Use(middleware.RequireAuth())
	{
		authorized.POST("/logout", handlers.Logout)
		authorized.POST("/mfa/enroll/start", handlers.MFAEnrollStart)
		authorized.POST("/mfa/enroll/confirm", handlers.MFAEnrollConfirm)
	}

	log.Println("🚀 Backend server starting on :8000")
	if err := r.Run(":8000"); err != nil {
		log.Fatalf("❌ Failed to start server: %v", err)
	}
}
