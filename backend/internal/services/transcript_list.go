package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

// TranscriptListItem represents a transcript in the list
type TranscriptListItem struct {
	ID              string  `json:"id"`
	Filename        string  `json:"filename"`
	Category        string  `json:"category"`
	ReferenceNumber string  `json:"reference_number"`
	Status          string  `json:"status"`
	Timestamp       string  `json:"timestamp"`
	Duration        float64 `json:"duration"`
	Speakers        int     `json:"speakers"`
	Segments        int     `json:"segments"`
	Notes           string  `json:"notes"`
	MinioURL        string  `json:"minio_url"`
}

// GetAllTranscripts fetches all parent transcripts from Qdrant
// GetAllTranscripts fetches all parent transcripts from Qdrant
func GetAllTranscripts() ([]TranscriptListItem, error) {
	qdrantHost := os.Getenv("QDRANT_HOST")
	if qdrantHost == "" {
		qdrantHost = "http://transcript_qdrant:6333"
	}

	collection := "file_metadata"

	// Use scroll API to get all points
	url := fmt.Sprintf("%s/collections/%s/points/scroll", qdrantHost, collection)

	requestBody := map[string]interface{}{
		"filter": map[string]interface{}{
			"must": []map[string]interface{}{
				{
					"key": "type",
					"match": map[string]string{
						"value": "parent",
					},
				},
			},
		},
		"limit":        100,
		"with_payload": true,
		"with_vector":  false,
	}

	data, err := json.Marshal(requestBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %v", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(data))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to reach Qdrant API: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("qdrant API error: %s — Response: %s", resp.Status, string(bodyBytes))
	}

	bodyBytes, _ := io.ReadAll(resp.Body)

	var qdrantResponse struct {
		Result struct {
			Points []struct {
				ID      interface{}            `json:"id"`
				Payload map[string]interface{} `json:"payload"`
			} `json:"points"`
		} `json:"result"`
	}

	if err := json.Unmarshal(bodyBytes, &qdrantResponse); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %v", err)
	}

	var transcripts []TranscriptListItem

	for _, point := range qdrantResponse.Result.Points {
		payload := point.Payload

		// Helper function to safely get string values
		getString := func(key string) string {
			if val, ok := payload[key]; ok {
				if str, ok := val.(string); ok {
					return str
				}
			}
			return ""
		}

		// Helper function to safely get float values
		getFloat := func(key string) float64 {
			if val, ok := payload[key]; ok {
				if f, ok := val.(float64); ok {
					return f
				}
			}
			return 0
		}

		// Helper function to safely get int values
		getInt := func(key string) int {
			if val, ok := payload[key]; ok {
				if f, ok := val.(float64); ok {
					return int(f)
				}
			}
			return 0
		}

		transcript := TranscriptListItem{
			ID:              getString("job_id"), // Use job_id from payload
			Filename:        getString("filename"),
			Category:        getString("category"),
			ReferenceNumber: getString("reference_number"),
			Status:          getString("status"),
			Timestamp:       getString("timestamp"),
			Duration:        getFloat("duration"),
			Speakers:        getInt("speakers"),
			Segments:        getInt("segments"),
			Notes:           getString("notes"),
			MinioURL:        getString("minio_url"),
		}

		transcripts = append(transcripts, transcript)
	}

	fmt.Printf("✅ Retrieved %d transcripts from Qdrant\n", len(transcripts))

	return transcripts, nil
}

// GetTranscriptsByStatus filters transcripts by status
func GetTranscriptsByStatus(status string) ([]TranscriptListItem, error) {
	transcripts, err := GetAllTranscripts()
	if err != nil {
		return nil, err
	}

	if status == "" || status == "all" {
		return transcripts, nil
	}

	var filtered []TranscriptListItem
	for _, t := range transcripts {
		if t.Status == status {
			filtered = append(filtered, t)
		}
	}

	return filtered, nil
}

// GetTranscriptStats returns statistics about transcripts
func GetTranscriptStats() (map[string]interface{}, error) {
	transcripts, err := GetAllTranscripts()
	if err != nil {
		return nil, err
	}

	stats := map[string]interface{}{
		"total":       len(transcripts),
		"completed":   0,
		"processing":  0,
		"uploaded":    0,
		"error":       0,
		"total_hours": 0.0,
	}

	totalDuration := 0.0

	for _, t := range transcripts {
		totalDuration += t.Duration

		switch t.Status {
		case "completed":
			stats["completed"] = stats["completed"].(int) + 1
		case "processing":
			stats["processing"] = stats["processing"].(int) + 1
		case "uploaded":
			stats["uploaded"] = stats["uploaded"].(int) + 1
		case "error":
			stats["error"] = stats["error"].(int) + 1
		}
	}

	stats["total_hours"] = totalDuration / 3600 // Convert seconds to hours

	return stats, nil

}
