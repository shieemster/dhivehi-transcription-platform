package main

import (
	"log"
	"os"
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

	// Only the actual frontend origin is allowed to call this API from a
	// browser — "*" previously meant any website could carry an
	// authenticated user's browser into calling this API cross-origin.
	// Auth is a Bearer token (not a cookie), so the practical exposure was
	// lower than with cookie-based auth, but there's no reason to leave it
	// wide open now that the origin is fixed (Caddy on :3443).
	frontendOrigin := os.Getenv("FRONTEND_ORIGIN")
	if frontendOrigin == "" {
		frontendOrigin = "https://localhost:3443"
	}

	// Gin only trusts X-Forwarded-For from these addresses when resolving
	// c.ClientIP() (used throughout for audit log entries) — without this,
	// gin defaults to trusting ALL proxies, meaning any caller could forge
	// their apparent IP in the audit log just by sending their own
	// X-Forwarded-For header. Caddy (the only thing that should ever be
	// setting that header here) lives on this same Docker bridge network,
	// so trusting the network's private range is enough — the backend has
	// no host port mapping, so nothing outside this Docker network can
	// reach it directly to spoof the header in the first place.
	if err := r.SetTrustedProxies([]string{"172.16.0.0/12"}); err != nil {
		log.Fatalf("❌ Failed to set trusted proxies: %v", err)
	}

	// Enable CORS for frontend. Allow-Credentials is required for the
	// browser to send/accept the httpOnly session cookie cross-port — it
	// only takes effect together with a non-wildcard Allow-Origin, which is
	// already the case here.
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", frontendOrigin)
		c.Writer.Header().Set("Vary", "Origin")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, PATCH, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// --- Data routes — now require a valid session AND the matching permission ---
	// RequireFullSession additionally blocks a restricted MFA-enrollment
	// token (see services.IssueMFAEnrollmentToken) from every route here —
	// an administrator/supervisor who hasn't enrolled MFA yet can't touch
	// any actual data until they do.
	protected := r.Group("/")
	protected.Use(middleware.RequireAuth(), middleware.RequireFullSession())
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

		protected.GET("/transcripts/search",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.SearchTranscriptsHandler)

		protected.GET("/files/:job_id",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.GetFile)

		protected.GET("/transcripts/:job_id",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.GetTranscriptDetail)

		protected.GET("/transcripts/:job_id/segments",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.GetSegments)

		protected.GET("/transcripts/:job_id/related",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.GetRelatedTranscriptsHandler)

		protected.PATCH("/transcripts/:job_id/segments/:segment_index",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.UpdateSegment)

		protected.PATCH("/transcripts/:job_id/speakers/:speaker_label",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.RenameSpeakerHandler)

		protected.GET("/transcripts/:job_id/segments/:segment_index/audio",
			middleware.RequirePermission("transcript:view_own", "transcript:view_team", "transcript:view_all"),
			handlers.GetSegmentAudio)

		protected.DELETE("/transcripts/:job_id",
			middleware.RequirePermission("transcript:delete"),
			handlers.DeleteTranscriptHandler)

		protected.GET("/audit-logs",
			middleware.RequirePermission("audit_log:view_team", "audit_log:view_all"),
			handlers.GetAuditLogs)

		protected.GET("/audit-logs/verify",
			middleware.RequirePermission("audit_log:view_all"),
			handlers.VerifyAuditLog)

		protected.GET("/security/dashboard",
			middleware.RequirePermission("security_dashboard:view"),
			handlers.GetSecurityDashboard)

		protected.GET("/system/health",
			middleware.RequirePermission("security_dashboard:view"),
			handlers.GetSystemHealth)

		protected.GET("/users",
			middleware.RequirePermission("user:manage"),
			handlers.ListUsers)

		protected.POST("/users",
			middleware.RequirePermission("user:manage"),
			handlers.CreateUserHandler)

		protected.PATCH("/users/:user_id",
			middleware.RequirePermission("user:manage"),
			handlers.UpdateUserHandler)

		protected.DELETE("/users/:user_id",
			middleware.RequirePermission("user:manage"),
			handlers.DeactivateUserHandler)
	}

	// --- Auth routes ---
	r.POST("/auth/login", handlers.Login)

	// Password recovery for a caller who is, by definition, not currently
	// logged in — these two have no session requirement at all.
	r.POST("/auth/forgot-password", handlers.ForgotPassword)
	r.POST("/auth/reset-password", handlers.ResetPassword)

	authorized := r.Group("/auth")
	authorized.Use(middleware.RequireAuth())
	{
		// Always reachable, even on a restricted MFA-enrollment token — a
		// user mid-mandatory-enrollment must still be able to back out, and
		// enrolling (or verifying email in that same window) is the entire
		// point of that token.
		authorized.POST("/logout", handlers.Logout)
		authorized.GET("/me", handlers.Me)
		authorized.POST("/mfa/enroll/start", handlers.MFAEnrollStart)
		authorized.POST("/mfa/enroll/confirm", handlers.MFAEnrollConfirm)
		authorized.POST("/verify-email", handlers.VerifyEmail)
		authorized.POST("/verify-email/resend", handlers.ResendVerificationEmail)

		// Everything else needs a real, fully-authenticated session.
		authorized.POST("/logout-all", middleware.RequireFullSession(), handlers.LogoutAllSessions)
		authorized.POST("/change-password", middleware.RequireFullSession(), handlers.ChangePassword)
	}

	log.Println("🚀 Backend server starting on :8000")
	if err := r.Run(":8000"); err != nil {
		log.Fatalf("❌ Failed to start server: %v", err)
	}
}
