package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"transcript_app/backend/internal/handlers"
	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

func main() {
	// Initialize all services (MinIO, Qdrant, Redis) with auto-creation
	if err := services.InitializeServices(); err != nil {
		log.Fatalf("❌ Failed to initialize services: %v", err)
	}

	r := gin.Default()

	// Enable CORS for frontend
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Origin, Content-Type, Accept")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	r.POST("/upload", handlers.UploadFile)
	r.POST("/transcripts/:job_id/analyse", handlers.AnalyseTranscript)

	log.Println("🚀 Backend server starting on :8000")
	if err := r.Run(":8000"); err != nil {
		log.Fatalf("❌ Failed to start server: %v", err)
	}

	http.HandleFunc("/transcripts", handleListTranscripts)
	http.HandleFunc("/transcripts/stats", handleTranscriptStats)

}

// Handler for listing all transcripts
func handleListTranscripts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Enable CORS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Get query parameter for status filter
	status := r.URL.Query().Get("status")

	var transcripts []services.TranscriptListItem
	var err error

	if status != "" {
		transcripts, err = services.GetTranscriptsByStatus(status)
	} else {
		transcripts, err = services.GetAllTranscripts()
	}

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to fetch transcripts: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(transcripts)
}

// Handler for transcript statistics
func handleTranscriptStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Enable CORS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	stats, err := services.GetTranscriptStats()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to fetch stats: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(stats)
}

// Register routes in your main function
