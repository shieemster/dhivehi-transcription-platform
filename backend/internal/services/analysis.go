package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

type SegmentPoint struct {
	ID      json.Number    `json:"id"`
	Payload SegmentPayload `json:"payload"`
}

type SegmentPayload struct {
	Type           string `json:"type"`
	ParentJobID    string `json:"parent_job_id"`
	SegmentIndex   int    `json:"segment_index"`
	Speaker        string `json:"speaker"`
	TranscriptText string `json:"transcript_text"`
	Status         string `json:"status"`
}

func ScrollSegmentsByParent(jobID string) ([]SegmentPoint, error) {
	qdrantHost := os.Getenv("QDRANT_HOST")
	if qdrantHost == "" {
		qdrantHost = "http://qdrant:6333"
	}

	collection := "file_metadata"
	url := fmt.Sprintf("%s/collections/%s/points/scroll", qdrantHost, collection)

	requestBody := map[string]interface{}{
		"filter": map[string]interface{}{
			"must": []map[string]interface{}{
				{"key": "type", "match": map[string]string{"value": "segment"}},
				{"key": "parent_job_id", "match": map[string]string{"value": jobID}},
			},
		},
		"limit":        1000,
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
		return nil, fmt.Errorf("qdrant API error: %s — %s", resp.Status, string(bodyBytes))
	}

	bodyBytes, _ := io.ReadAll(resp.Body)

	var qdrantResponse struct {
		Result struct {
			Points []SegmentPoint `json:"points"`
		} `json:"result"`
	}

	if err := json.Unmarshal(bodyBytes, &qdrantResponse); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %v", err)
	}

	return qdrantResponse.Result.Points, nil
}

func UpdateParentPayload(jobID string, payload map[string]interface{}) error {
	qdrantHost := os.Getenv("QDRANT_HOST")
	if qdrantHost == "" {
		qdrantHost = "http://qdrant:6333"
	}

	collection := "file_metadata"
	url := fmt.Sprintf("%s/collections/%s/points/payload?wait=true", qdrantHost, collection)

	requestBody := map[string]interface{}{
		"filter": map[string]interface{}{
			"must": []map[string]interface{}{
				{"key": "type", "match": map[string]string{"value": "parent"}},
				{"key": "job_id", "match": map[string]string{"value": jobID}},
			},
		},
		"payload": payload,
	}

	data, err := json.Marshal(requestBody)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %v", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(data))
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
		return fmt.Errorf("qdrant API error: %s — %s", resp.Status, string(bodyBytes))
	}

	return nil
}
