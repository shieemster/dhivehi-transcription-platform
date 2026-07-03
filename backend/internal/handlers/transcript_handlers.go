package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"transcript_app/backend/internal/services" // Replace with your actual module path
)

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
