package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// genesisHash is the prev_hash the very first audit log entry chains from —
// same length as a real sha256 hex digest (64 hex chars) so the chain has a
// well-defined starting point. Must match the value inserted by
// 002_audit_log.sql (repeat('0', 64)).
var genesisHash = strings.Repeat("0", 64)

type AuditEntry struct {
	ID           int64                  `json:"id"`
	OccurredAt   time.Time              `json:"occurred_at"`
	UserID       *string                `json:"user_id"`
	UserEmail    string                 `json:"user_email"`
	Action       string                 `json:"action"`
	ResourceType string                 `json:"resource_type"`
	ResourceID   string                 `json:"resource_id"`
	IPAddress    string                 `json:"ip_address"`
	Details      map[string]interface{} `json:"details"`
	PrevHash     string                 `json:"prev_hash"`
	EntryHash    string                 `json:"entry_hash"`
}

// computeAuditHash is the one place that defines what an entry "commits to"
// — VerifyAuditChain must build this identically or every entry would spuriously fail.
func computeAuditHash(prevHash string, occurredAt time.Time, userID *string, userEmail, action, resourceType, resourceID, ipAddress string, detailsJSON []byte) string {
	uid := ""
	if userID != nil {
		uid = *userID
	}
	// '|'-joined with the raw JSON appended — not a formal canonicalization
	// (a field containing '|' could in theory shift the boundary), but none
	// of these fields are attacker-controlled free text that would collide
	// in practice, and the goal here is tamper-evidence (any change flips
	// the hash), not cryptographic non-repudiation of field boundaries.
	parts := strings.Join([]string{
		prevHash,
		occurredAt.UTC().Format(time.RFC3339Nano),
		uid,
		userEmail,
		action,
		resourceType,
		resourceID,
		ipAddress,
	}, "|")

	h := sha256.New()
	h.Write([]byte(parts))
	h.Write(detailsJSON)
	return hex.EncodeToString(h.Sum(nil))
}

// LogAudit appends one tamper-evident entry to the audit log. Concurrent
// calls are serialized by row-locking the single audit_log_chain_tip row
// inside the same transaction as the insert (see 002_audit_log.sql), so
// entries always chain in the strict order they committed.
func LogAudit(ctx context.Context, userID *string, userEmail, action, resourceType, resourceID, ipAddress string, details map[string]interface{}) error {
	if details == nil {
		details = map[string]interface{}{}
	}
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("failed to marshal audit details: %w", err)
	}

	tx, err := DB.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin audit tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var prevHash string
	if err := tx.QueryRow(ctx, `SELECT tip_hash FROM audit_log_chain_tip WHERE id = 1 FOR UPDATE`).Scan(&prevHash); err != nil {
		return fmt.Errorf("failed to lock audit chain tip: %w", err)
	}

	// Truncated to microseconds — TIMESTAMPTZ only stores that much
	// precision, so hashing the untruncated nanosecond value here would
	// never match what VerifyAuditChain recomputes after reading the
	// (already-truncated) timestamp back out of Postgres.
	occurredAt := time.Now().UTC().Truncate(time.Microsecond)
	entryHash := computeAuditHash(prevHash, occurredAt, userID, userEmail, action, resourceType, resourceID, ipAddress, detailsJSON)

	_, err = tx.Exec(ctx, `
		INSERT INTO audit_log (occurred_at, user_id, user_email, action, resource_type, resource_id, ip_address, details, prev_hash, entry_hash)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
		occurredAt, userID, userEmail, action, resourceType, resourceID, ipAddress, detailsJSON, prevHash, entryHash,
	)
	if err != nil {
		return fmt.Errorf("failed to insert audit log entry: %w", err)
	}

	if _, err := tx.Exec(ctx, `UPDATE audit_log_chain_tip SET tip_hash = $1 WHERE id = 1`, entryHash); err != nil {
		return fmt.Errorf("failed to update audit chain tip: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit audit tx: %w", err)
	}

	return nil
}

// ListAuditLogs returns the most recent entries, newest first.
func ListAuditLogs(ctx context.Context, limit int) ([]AuditEntry, error) {
	rows, err := DB.Query(ctx, `
		SELECT id, occurred_at, user_id, user_email, action, resource_type, resource_id, ip_address, details, prev_hash, entry_hash
		FROM audit_log
		ORDER BY id DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query audit log: %w", err)
	}
	defer rows.Close()

	var entries []AuditEntry
	for rows.Next() {
		var e AuditEntry
		var detailsJSON []byte
		if err := rows.Scan(&e.ID, &e.OccurredAt, &e.UserID, &e.UserEmail, &e.Action, &e.ResourceType, &e.ResourceID, &e.IPAddress, &detailsJSON, &e.PrevHash, &e.EntryHash); err != nil {
			return nil, fmt.Errorf("failed to scan audit log row: %w", err)
		}
		if err := json.Unmarshal(detailsJSON, &e.Details); err != nil {
			e.Details = map[string]interface{}{}
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// VerifyAuditChain recomputes every entry's hash in order and confirms it
// both matches its stored entry_hash and correctly chains from the previous
// entry. Returns (true, nil, nil) if the whole chain is intact, or
// (false, &id, nil) with the id of the first entry that doesn't check out —
// anything from that point forward has been tampered with, backdated, or
// deleted-and-reinserted out of order.
func VerifyAuditChain(ctx context.Context) (bool, *int64, error) {
	rows, err := DB.Query(ctx, `
		SELECT id, occurred_at, user_id, user_email, action, resource_type, resource_id, ip_address, details, prev_hash, entry_hash
		FROM audit_log
		ORDER BY id ASC`)
	if err != nil {
		return false, nil, fmt.Errorf("failed to query audit log: %w", err)
	}
	defer rows.Close()

	expectedPrev := genesisHash
	for rows.Next() {
		var e AuditEntry
		var detailsJSON []byte
		if err := rows.Scan(&e.ID, &e.OccurredAt, &e.UserID, &e.UserEmail, &e.Action, &e.ResourceType, &e.ResourceID, &e.IPAddress, &detailsJSON, &e.PrevHash, &e.EntryHash); err != nil {
			return false, nil, fmt.Errorf("failed to scan audit log row: %w", err)
		}

		if e.PrevHash != expectedPrev {
			id := e.ID
			return false, &id, nil
		}

		// Postgres's jsonb type reformats JSON on storage (e.g. adds a space
		// after ':'), so the bytes read back here are NOT byte-identical to
		// what LogAudit originally hashed even though the content is the
		// same. Round-trip through Go's own json.Marshal (which — for
		// map[string]interface{} — always sorts keys and always produces
		// the same compact form) to get back to what was actually hashed at
		// write time.
		var details map[string]interface{}
		if err := json.Unmarshal(detailsJSON, &details); err != nil {
			return false, nil, fmt.Errorf("failed to unmarshal details for entry %d: %w", e.ID, err)
		}
		canonicalDetailsJSON, err := json.Marshal(details)
		if err != nil {
			return false, nil, fmt.Errorf("failed to re-marshal details for entry %d: %w", e.ID, err)
		}

		recomputed := computeAuditHash(e.PrevHash, e.OccurredAt, e.UserID, e.UserEmail, e.Action, e.ResourceType, e.ResourceID, e.IPAddress, canonicalDetailsJSON)
		if recomputed != e.EntryHash {
			id := e.ID
			return false, &id, nil
		}

		expectedPrev = e.EntryHash
	}
	if err := rows.Err(); err != nil {
		return false, nil, err
	}

	// Confirm the chain's tip actually matches the last entry's hash — a
	// tampered tip row (or one manually reset) would otherwise go unnoticed
	// since new entries would just start a fresh valid-looking sub-chain.
	var storedTip string
	if err := DB.QueryRow(ctx, `SELECT tip_hash FROM audit_log_chain_tip WHERE id = 1`).Scan(&storedTip); err != nil {
		return false, nil, fmt.Errorf("failed to read chain tip: %w", err)
	}
	if storedTip != expectedPrev {
		return false, nil, nil
	}

	return true, nil, nil
}

type AuditSummary struct {
	TotalEntries        int64  `json:"total_entries"`
	EntriesLast24h      int64  `json:"entries_last_24h"`
	FailedLoginsLast24h int64  `json:"failed_logins_last_24h"`
	AccessDeniedLast24h int64  `json:"access_denied_last_24h"`
	ChainValid          bool   `json:"chain_valid"`
	BrokenAtID          *int64 `json:"broken_at_id"`
}

// GetAuditSummary computes the counts the security dashboard needs plus a
// full chain-integrity check. Counts are done in SQL rather than by summing
// ListAuditLogs' page (which is capped at auditLogPageSize) so they stay
// correct regardless of how large the log has grown.
func GetAuditSummary(ctx context.Context) (AuditSummary, error) {
	var s AuditSummary

	err := DB.QueryRow(ctx, `
		SELECT
			count(*),
			count(*) FILTER (WHERE occurred_at > now() - interval '24 hours'),
			count(*) FILTER (WHERE action = 'login_failed' AND occurred_at > now() - interval '24 hours'),
			count(*) FILTER (WHERE action = 'access_denied' AND occurred_at > now() - interval '24 hours')
		FROM audit_log`,
	).Scan(&s.TotalEntries, &s.EntriesLast24h, &s.FailedLoginsLast24h, &s.AccessDeniedLast24h)
	if err != nil {
		return s, fmt.Errorf("failed to compute audit summary: %w", err)
	}

	valid, brokenAtID, err := VerifyAuditChain(ctx)
	if err != nil {
		return s, fmt.Errorf("failed to verify audit chain: %w", err)
	}
	s.ChainValid = valid
	s.BrokenAtID = brokenAtID

	return s, nil
}
