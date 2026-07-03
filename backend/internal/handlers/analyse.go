package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"

	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

type AnalysisRequest struct {
	Data []string `json:"data"`
}

type AnalysisResponse struct {
	Data []string `json:"data"`
}

type AnalysisResult struct {
	Keywords          []string          `json:"keywords"`
	Entities          map[string]interface{} `json:"entities"`
	Summary           string            `json:"summary"`
	Classification    string            `json:"classification"`
	EnglishTranslation string           `json:"english_translation"`
}

func AnalyseTranscript(c *gin.Context) {
	jobID := c.Param("job_id")
	if jobID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job_id is required"})
		return
	}

	segments, err := services.ScrollSegmentsByParent(jobID)
	if err != nil {
		log.Printf("Failed to fetch segments for %s: %v", jobID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to fetch segments: %v", err)})
		return
	}

	if len(segments) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "no segments found for this transcript"})
		return
	}

	sort.Slice(segments, func(i, j int) bool {
		return segments[i].Payload.SegmentIndex < segments[j].Payload.SegmentIndex
	})

	var transcriptLines []string
	for _, seg := range segments {
		text := strings.TrimSpace(seg.Payload.TranscriptText)
		if text == "" || text == "Transcription pending..." {
			continue
		}
		transcriptLines = append(transcriptLines, fmt.Sprintf("%s: %s", seg.Payload.Speaker, text))
	}

	if len(transcriptLines) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no transcribed text found in segments"})
		return
	}

	fullTranscript := strings.Join(transcriptLines, "\n")

	analysisReq := AnalysisRequest{
		Data: []string{fullTranscript},
	}
	reqBody, _ := json.Marshal(analysisReq)

	log.Printf("Sending transcript to analysis service for job %s (%d chars)", jobID, len(fullTranscript))

	resp, err := http.Post("http://analysis:7861/run/predict", "application/json", bytes.NewBuffer(reqBody))
	if err != nil {
		log.Printf("Failed to call analysis service for %s: %v", jobID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("analysis service unavailable: %v", err)})
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Failed to read analysis response for %s: %v", jobID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read analysis response"})
		return
	}

	if resp.StatusCode >= 300 {
		log.Printf("Analysis service returned error %d for %s: %s", resp.StatusCode, jobID, string(respBody))
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("analysis service error: %s", string(respBody))})
		return
	}

	var analysisResp AnalysisResponse
	if err := json.Unmarshal(respBody, &analysisResp); err != nil {
		log.Printf("Failed to parse analysis response for %s: %v", jobID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid response from analysis service"})
		return
	}

	if len(analysisResp.Data) == 0 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "empty response from analysis service"})
		return
	}

	var result AnalysisResult
	if err := json.Unmarshal([]byte(analysisResp.Data[0]), &result); err != nil {
		log.Printf("Failed to parse analysis JSON result for %s: %v — raw: %s", jobID, err, analysisResp.Data[0])
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse analysis result"})
		return
	}

	go func() {
		parentPayload := map[string]interface{}{
			"analysis_keywords":             result.Keywords,
			"analysis_entities":             result.Entities,
			"analysis_summary":              result.Summary,
			"analysis_classification":       result.Classification,
			"analysis_english_translation":  result.EnglishTranslation,
			"analysis_status":               "complete",
		}
		if err := services.UpdateParentPayload(jobID, parentPayload); err != nil {
			log.Printf("Warning: failed to update parent payload with analysis for %s: %v", jobID, err)
		} else {
			log.Printf("Saved analysis results to Qdrant for job %s", jobID)
		}
	}()

	c.JSON(http.StatusOK, gin.H{
		"keywords":            result.Keywords,
		"entities":            result.Entities,
		"summary":             result.Summary,
		"classification":      result.Classification,
		"english_translation": result.EnglishTranslation,
	})
}
