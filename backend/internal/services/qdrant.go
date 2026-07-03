package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
)

func InsertFileMetadata(id string, metadata map[string]interface{}) error {
	qdrantHost := os.Getenv("QDRANT_HOST")
	if qdrantHost == "" {
		qdrantHost = "http://qdrant:6333"
	}

	collection := "file_metadata"
	url := fmt.Sprintf("%s/collections/%s/points?wait=true", qdrantHost, collection)

	// Convert string ID to uint64 for Qdrant
	pointID, err := strconv.ParseUint(id, 10, 64)
	if err != nil {
		// If ID is not numeric, hash it to create a numeric ID
		pointID = hashStringToUint64(id)
	}

	fmt.Printf("🔍 Inserting point with file_id: %s, numeric_id: %d\n", id, pointID)

	// Use 512-dimensional zero vector to match collection config
	vector := make([]float32, 512)

	payload := map[string]interface{}{
		"points": []map[string]interface{}{
			{
				"id":      pointID,
				"vector":  vector,
				"payload": metadata,
			},
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal metadata: %v", err)
	}

	req, err := http.NewRequest("PUT", url, bytes.NewBuffer(data))
	if err != nil {
		return fmt.Errorf("failed to create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to reach Qdrant API: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("qdrant API error: %s — Response: %s", resp.Status, string(bodyBytes))
	}

	// Log success response too
	bodyBytes, _ := io.ReadAll(resp.Body)
	fmt.Printf("✅ Qdrant insert response: %s\n", string(bodyBytes))

	return nil
}

// Helper function to convert string ID to numeric ID
func hashStringToUint64(s string) uint64 {
	hash := uint64(5381)
	for _, c := range s {
		hash = ((hash << 5) + hash) + uint64(c)
	}
	return hash
}
