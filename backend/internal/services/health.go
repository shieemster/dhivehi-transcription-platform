package services

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"
)

// HealthCheck is one infra/worker liveness result on the system health page.
type HealthCheck struct {
	Name      string `json:"name"`
	Status    string `json:"status"` // "up" | "down"
	LatencyMS int64  `json:"latency_ms,omitempty"`
	Detail    string `json:"detail,omitempty"`
}

const healthCheckTimeout = 3 * time.Second

func checkPostgres(ctx context.Context) HealthCheck {
	ctx, cancel := context.WithTimeout(ctx, healthCheckTimeout)
	defer cancel()
	start := time.Now()
	if err := DB.Ping(ctx); err != nil {
		return HealthCheck{Name: "postgres", Status: "down", Detail: err.Error()}
	}
	return HealthCheck{Name: "postgres", Status: "up", LatencyMS: time.Since(start).Milliseconds()}
}

func checkRedis(ctx context.Context) HealthCheck {
	ctx, cancel := context.WithTimeout(ctx, healthCheckTimeout)
	defer cancel()
	start := time.Now()
	if err := RedisClient.Ping(ctx).Err(); err != nil {
		return HealthCheck{Name: "redis", Status: "down", Detail: err.Error()}
	}
	return HealthCheck{Name: "redis", Status: "up", LatencyMS: time.Since(start).Milliseconds()}
}

func checkMinIO(ctx context.Context) HealthCheck {
	ctx, cancel := context.WithTimeout(ctx, healthCheckTimeout)
	defer cancel()
	start := time.Now()
	if _, err := MinioClient.BucketExists(ctx, "uploads"); err != nil {
		return HealthCheck{Name: "minio", Status: "down", Detail: err.Error()}
	}
	return HealthCheck{Name: "minio", Status: "up", LatencyMS: time.Since(start).Milliseconds()}
}

func checkQdrant(ctx context.Context) HealthCheck {
	qdrantHost := os.Getenv("QDRANT_HOST")
	if qdrantHost == "" {
		qdrantHost = "http://qdrant:6333"
	}

	ctx, cancel := context.WithTimeout(ctx, healthCheckTimeout)
	defer cancel()
	start := time.Now()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, qdrantHost+"/collections", nil)
	if err != nil {
		return HealthCheck{Name: "qdrant", Status: "down", Detail: err.Error()}
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return HealthCheck{Name: "qdrant", Status: "down", Detail: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return HealthCheck{Name: "qdrant", Status: "down", Detail: fmt.Sprintf("HTTP %d", resp.StatusCode)}
	}
	return HealthCheck{Name: "qdrant", Status: "up", LatencyMS: time.Since(start).Milliseconds()}
}

// pipelineWorkers are the Redis heartbeat keys each Python worker writes on
// its own timer, independent of its blpop job loop (see the
// _heartbeat_loop daemon thread in gradio/convert/diarization/transcription
// .py) — decoupled like this so a worker mid-way through a long transcription
// job still reports "up" instead of falsely going stale.
var pipelineWorkers = []string{"convert", "diarization", "transcription"}

// checkWorkerHeartbeat reports "down" if the key is missing — which,
// because the Python side sets it with a short TTL and keeps refreshing it,
// only happens once the worker process has actually stopped writing (crash,
// hang, or container down), not just because it hasn't been checked in a
// while.
func checkWorkerHeartbeat(ctx context.Context, name string) HealthCheck {
	val, err := RedisClient.Get(ctx, "worker_heartbeat:"+name).Result()
	if err != nil {
		return HealthCheck{Name: name, Status: "down", Detail: "no recent heartbeat"}
	}
	unixSeconds, parseErr := strconv.ParseInt(val, 10, 64)
	if parseErr != nil {
		return HealthCheck{Name: name, Status: "down", Detail: "invalid heartbeat value"}
	}
	age := time.Since(time.Unix(unixSeconds, 0))
	return HealthCheck{Name: name, Status: "up", Detail: fmt.Sprintf("last heartbeat %ds ago", int(age.Seconds()))}
}

// RunHealthChecks runs every infra + worker check concurrently and returns
// them in a stable, fixed order (not goroutine completion order).
func RunHealthChecks(ctx context.Context) []HealthCheck {
	names := []string{"postgres", "redis", "minio", "qdrant"}
	results := make(map[string]HealthCheck, len(names)+len(pipelineWorkers))
	resultCh := make(chan HealthCheck)

	go func() { resultCh <- checkPostgres(ctx) }()
	go func() { resultCh <- checkRedis(ctx) }()
	go func() { resultCh <- checkMinIO(ctx) }()
	go func() { resultCh <- checkQdrant(ctx) }()
	for _, w := range pipelineWorkers {
		w := w
		go func() { resultCh <- checkWorkerHeartbeat(ctx, w) }()
	}

	total := len(names) + len(pipelineWorkers)
	for i := 0; i < total; i++ {
		r := <-resultCh
		results[r.Name] = r
	}

	ordered := make([]HealthCheck, 0, total)
	for _, n := range names {
		ordered = append(ordered, results[n])
	}
	for _, w := range pipelineWorkers {
		ordered = append(ordered, results[w])
	}
	return ordered
}

// PipelineStats summarizes every transcription job system-wide (not scoped
// to one user/role — this is an admin-only infra view, unlike the
// permission-scoped /transcripts/stats endpoint).
type PipelineStats struct {
	Total                  int                  `json:"total"`
	ByStatus               map[string]int       `json:"by_status"`
	OldestActiveAgeSeconds *int64               `json:"oldest_active_age_seconds,omitempty"`
	Jobs                   []PipelineJobSummary `json:"jobs"`
}

// PipelineJobSummary is the minimal per-job detail the health page needs to
// let an admin see WHICH jobs sit behind a given status count, not just how
// many — clicking a status badge filters this list client-side rather than
// requiring a second request.
type PipelineJobSummary struct {
	ID              string `json:"id"`
	Filename        string `json:"filename"`
	Category        string `json:"category"`
	ReferenceNumber string `json:"reference_number"`
	Status          string `json:"status"`
	Timestamp       string `json:"timestamp"`
	UploadedBy      string `json:"uploaded_by,omitempty"`
}

// terminalJobStatuses mirrors the frontend's TERMINAL_STATUSES list
// (Transcripts/List/page.tsx) — anything else is still moving through the
// convert -> diarize -> transcribe pipeline.
var terminalJobStatuses = map[string]bool{
	"transcribed": true,
	"completed":   true,
	"error":       true,
	"failed":      true,
}

// GetPipelineStats aggregates job counts by status and flags how long the
// oldest still-in-progress job has been sitting there — a long-running
// active job doesn't necessarily mean the pipeline is stuck, but a very old
// one is worth an admin's attention.
func GetPipelineStats() (PipelineStats, error) {
	transcripts, err := GetAllTranscripts()
	if err != nil {
		return PipelineStats{}, err
	}

	stats := PipelineStats{Total: len(transcripts), ByStatus: map[string]int{}, Jobs: make([]PipelineJobSummary, 0, len(transcripts))}
	var oldestActive *time.Time

	for _, t := range transcripts {
		stats.ByStatus[t.Status]++
		stats.Jobs = append(stats.Jobs, PipelineJobSummary{
			ID:              t.ID,
			Filename:        t.Filename,
			Category:        t.Category,
			ReferenceNumber: t.ReferenceNumber,
			Status:          t.Status,
			Timestamp:       t.Timestamp,
			UploadedBy:      t.UploadedBy,
		})
		if terminalJobStatuses[t.Status] {
			continue
		}
		ts, err := time.Parse(time.RFC3339, t.Timestamp)
		if err != nil {
			continue // best-effort — a job with an unparseable timestamp just doesn't count toward staleness
		}
		if oldestActive == nil || ts.Before(*oldestActive) {
			oldestActive = &ts
		}
	}

	if oldestActive != nil {
		age := int64(time.Since(*oldestActive).Seconds())
		stats.OldestActiveAgeSeconds = &age
	}

	return stats, nil
}
