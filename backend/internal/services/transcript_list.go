package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
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
	MinioBucket     string  `json:"-"`
	MinioObject     string  `json:"-"`
	UploadedBy      string  `json:"uploaded_by,omitempty"`
}

// DeleteTranscript removes both the parent record and all its segment
// records from Qdrant. This used to be done directly from the browser
// against Qdrant's own delete API (no auth at all) — now it's gated
// behind RBAC like everything else, via the transcript:delete permission.
func DeleteTranscript(jobID string) error {
	qdrantHost := os.Getenv("QDRANT_HOST")
	if qdrantHost == "" {
		qdrantHost = "http://qdrant:6333"
	}
	collection := os.Getenv("QDRANT_COLLECTION")
	if collection == "" {
		collection = "file_metadata"
	}

	deletePoints := func(filter map[string]interface{}) error {
		url := fmt.Sprintf("%s/collections/%s/points/delete", qdrantHost, collection)
		body, err := json.Marshal(map[string]interface{}{"filter": filter})
		if err != nil {
			return err
		}
		req, err := http.NewRequest("POST", url, bytes.NewBuffer(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := (&http.Client{}).Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()

		if resp.StatusCode >= 300 {
			respBody, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("qdrant delete failed: %s - %s", resp.Status, string(respBody))
		}
		return nil
	}

	// Step 1: delete all segments belonging to this transcript
	if err := deletePoints(map[string]interface{}{
		"must": []map[string]interface{}{
			{"key": "type", "match": map[string]string{"value": "segment"}},
			{"key": "parent_job_id", "match": map[string]string{"value": jobID}},
		},
	}); err != nil {
		return fmt.Errorf("failed to delete segments: %w", err)
	}

	// Step 2: delete the parent record itself
	if err := deletePoints(map[string]interface{}{
		"must": []map[string]interface{}{
			{"key": "type", "match": map[string]string{"value": "parent"}},
			{"key": "job_id", "match": map[string]string{"value": jobID}},
		},
	}); err != nil {
		return fmt.Errorf("failed to delete parent record: %w", err)
	}

	return nil
}

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

	segmentDurations, err := getSegmentDurations(qdrantHost, collection)
	if err != nil {
		// Non-fatal — fall back to whatever "duration" the parent payload
		// itself has (likely 0), rather than failing the whole list.
		segmentDurations = map[string]float64{}
	}

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

		jobID := getString("job_id")
		duration := getFloat("duration")
		if computed, ok := segmentDurations[jobID]; ok && computed > duration {
			duration = computed
		}

		transcript := TranscriptListItem{
			ID:              jobID,
			Filename:        getString("filename"),
			Category:        getString("category"),
			ReferenceNumber: getString("reference_number"),
			Status:          getString("status"),
			Timestamp:       getString("timestamp"),
			Duration:        duration,
			Speakers:        getInt("speakers"),
			Segments:        getInt("segments"),
			Notes:           getString("notes"),
			MinioURL:        getString("minio_url"),
			MinioBucket:     getString("minio_bucket"),
			MinioObject:     getString("minio_object"),
			UploadedBy:      getString("uploaded_by"),
		}

		transcripts = append(transcripts, transcript)
	}

	fmt.Printf("✅ Retrieved %d transcripts from Qdrant\n", len(transcripts))

	return transcripts, nil
}

// Segment represents one diarized/transcribed segment belonging to a parent transcript.
type Segment struct {
	ID                 string  `json:"id"`
	SegmentIndex       int     `json:"segment_index"`
	Speaker            string  `json:"speaker"`
	StartTime          float64 `json:"start_time"`
	EndTime            float64 `json:"end_time"`
	TranscriptText     string  `json:"transcript_text"`
	EmbeddingGenerated bool    `json:"embedding_generated"`
	Timestamp          string  `json:"timestamp"`
	Status             string  `json:"status"`
	MinioBucket        string  `json:"-"`
	MinioObject        string  `json:"-"`
}

// GetSegmentsForTranscript fetches all segments for a given parent job_id,
// sorted by segment_index. Paginates through Qdrant's scroll API the same
// way the frontend used to do directly — capped at 50 pages as a safety
// bound against a runaway loop, matching the original frontend logic.
func GetSegmentsForTranscript(jobID string) ([]Segment, error) {
	qdrantHost := os.Getenv("QDRANT_HOST")
	if qdrantHost == "" {
		qdrantHost = "http://qdrant:6333"
	}
	collection := os.Getenv("QDRANT_COLLECTION")
	if collection == "" {
		collection = "file_metadata"
	}

	var allPoints []struct {
		Payload map[string]interface{} `json:"payload"`
	}
	var offset interface{}
	const maxIterations = 50

	for i := 0; i < maxIterations; i++ {
		reqBody := map[string]interface{}{
			"filter": map[string]interface{}{
				"must": []map[string]interface{}{
					{"key": "type", "match": map[string]string{"value": "segment"}},
					{"key": "parent_job_id", "match": map[string]string{"value": jobID}},
				},
			},
			"limit":        100,
			"with_payload": true,
			"with_vector":  false,
		}
		if offset != nil {
			reqBody["offset"] = offset
		}

		data, err := json.Marshal(reqBody)
		if err != nil {
			return nil, err
		}
		url := fmt.Sprintf("%s/collections/%s/points/scroll", qdrantHost, collection)
		req, err := http.NewRequest("POST", url, bytes.NewBuffer(data))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := (&http.Client{}).Do(req)
		if err != nil {
			return nil, err
		}
		bodyBytes, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode >= 300 {
			return nil, fmt.Errorf("qdrant segment query failed: %s - %s", resp.Status, string(bodyBytes))
		}

		var parsed struct {
			Result struct {
				Points []struct {
					Payload map[string]interface{} `json:"payload"`
				} `json:"points"`
				NextPageOffset interface{} `json:"next_page_offset"`
			} `json:"result"`
		}
		if err := json.Unmarshal(bodyBytes, &parsed); err != nil {
			return nil, err
		}

		if len(parsed.Result.Points) == 0 {
			break
		}
		allPoints = append(allPoints, parsed.Result.Points...)

		if parsed.Result.NextPageOffset == nil {
			break
		}
		if offset != nil && parsed.Result.NextPageOffset == offset {
			break // guard against a non-advancing offset looping forever
		}
		offset = parsed.Result.NextPageOffset
	}

	segments := make([]Segment, 0, len(allPoints))
	for _, point := range allPoints {
		p := point.Payload
		getStr := func(k string) string {
			if v, ok := p[k].(string); ok {
				return v
			}
			return ""
		}
		getFloat := func(k string) float64 {
			if v, ok := p[k].(float64); ok {
				return v
			}
			return 0
		}
		getInt := func(k string) int {
			if v, ok := p[k].(float64); ok {
				return int(v)
			}
			return 0
		}
		getBool := func(k string) bool {
			if v, ok := p[k].(bool); ok {
				return v
			}
			return false
		}

		text := getStr("transcript_text")
		if text == "" {
			text = "Transcription pending..."
		}

		minioURL := getStr("minio_url")
		var bucket, object string
		if minioURL != "" {
			if parts := splitBucketObject(minioURL); parts != nil {
				bucket, object = parts[0], parts[1]
			}
		}

		segments = append(segments, Segment{
			ID:                 fmt.Sprintf("segment-%d", getInt("segment_index")),
			SegmentIndex:       getInt("segment_index"),
			Speaker:            getStr("speaker"),
			StartTime:          getFloat("start_time"),
			EndTime:            getFloat("end_time"),
			TranscriptText:     text,
			EmbeddingGenerated: getBool("embedding_generated"),
			Timestamp:          getStr("timestamp"),
			Status:             getStr("status"),
			MinioBucket:        bucket,
			MinioObject:        object,
		})
	}

	sort.Slice(segments, func(i, j int) bool {
		return segments[i].SegmentIndex < segments[j].SegmentIndex
	})

	return segments, nil
}

// splitBucketObject parses "http://minio:9000/<bucket>/<object>" into
// [bucket, object]. Returns nil if the URL doesn't look like that shape.
func splitBucketObject(minioURL string) []string {
	const marker = "9000/"
	idx := indexOf(minioURL, marker)
	if idx == -1 {
		return nil
	}
	rest := minioURL[idx+len(marker):]
	for i := 0; i < len(rest); i++ {
		if rest[i] == '/' {
			return []string{rest[:i], rest[i+1:]}
		}
	}
	return nil
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

// UpdateSegmentText edits a segment's transcript_text in place, matching
// on parent_job_id + segment_index (filter-based update, same approach
// the frontend used directly against Qdrant, to avoid point-ID precision
// issues mentioned in the original code).
func UpdateSegmentText(jobID string, segmentIndex int, newText string) error {
	qdrantHost := os.Getenv("QDRANT_HOST")
	if qdrantHost == "" {
		qdrantHost = "http://qdrant:6333"
	}
	collection := os.Getenv("QDRANT_COLLECTION")
	if collection == "" {
		collection = "file_metadata"
	}

	url := fmt.Sprintf("%s/collections/%s/points/payload?wait=true", qdrantHost, collection)
	reqBody := map[string]interface{}{
		"filter": map[string]interface{}{
			"must": []map[string]interface{}{
				{"key": "type", "match": map[string]string{"value": "segment"}},
				{"key": "parent_job_id", "match": map[string]string{"value": jobID}},
				{"key": "segment_index", "match": map[string]int{"value": segmentIndex}},
			},
		},
		"payload": map[string]string{
			"transcript_text": newText,
		},
	}
	data, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("qdrant update failed: %s - %s", resp.Status, string(body))
	}
	return nil
}

// GetTranscriptByID finds one transcript by job_id — needed to check
// bucket/object and ownership before issuing a presigned URL.
func GetTranscriptByID(jobID string) (*TranscriptListItem, error) {
	transcripts, err := GetAllTranscripts()
	if err != nil {
		return nil, err
	}
	for _, t := range transcripts {
		if t.ID == jobID {
			return &t, nil
		}
	}
	return nil, fmt.Errorf("transcript not found: %s", jobID)
}

// getSegmentDurations queries all "segment" points and returns, per
// parent_job_id, the max end_time seen — used as that transcript's total
// duration. Parent points themselves don't carry a real duration value,
// so this is the only accurate source for it.
func getSegmentDurations(qdrantHost, collection string) (map[string]float64, error) {
	url := fmt.Sprintf("%s/collections/%s/points/scroll", qdrantHost, collection)

	requestBody := map[string]interface{}{
		"filter": map[string]interface{}{
			"must": []map[string]interface{}{
				{
					"key": "type",
					"match": map[string]string{
						"value": "segment",
					},
				},
			},
		},
		"limit":        10000,
		"with_payload": true,
		"with_vector":  false,
	}

	data, err := json.Marshal(requestBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("qdrant segment query failed: %s", resp.Status)
	}

	bodyBytes, _ := io.ReadAll(resp.Body)

	var qdrantResponse struct {
		Result struct {
			Points []struct {
				Payload map[string]interface{} `json:"payload"`
			} `json:"points"`
		} `json:"result"`
	}
	if err := json.Unmarshal(bodyBytes, &qdrantResponse); err != nil {
		return nil, err
	}

	durations := make(map[string]float64)
	for _, point := range qdrantResponse.Result.Points {
		parentID, _ := point.Payload["parent_job_id"].(string)
		endTime, _ := point.Payload["end_time"].(float64)
		if endTime > durations[parentID] {
			durations[parentID] = endTime
		}
	}
	return durations, nil
}

// GetTranscriptsForUser returns only transcripts uploaded by the given user —
// used to enforce "view_own" scoping for roles that don't also have
// view_team/view_all.
func GetTranscriptsForUser(userID string) ([]TranscriptListItem, error) {
	transcripts, err := GetAllTranscripts()
	if err != nil {
		return nil, err
	}

	var filtered []TranscriptListItem
	for _, t := range transcripts {
		if t.UploadedBy == userID {
			filtered = append(filtered, t)
		}
	}
	return filtered, nil
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
