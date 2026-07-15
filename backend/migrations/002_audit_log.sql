-- 002_audit_log.sql
-- Tamper-evident audit log: a hash chain over every security-relevant
-- action, so any modification or deletion of a past entry is detectable by
-- recomputing the chain (see services.VerifyAuditChain) even though the
-- rows themselves live in an ordinary, editable Postgres table.

CREATE TABLE audit_log (
    id            BIGSERIAL PRIMARY KEY,
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id       UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL when the actor couldn't be resolved (e.g. login with an unknown email)
    user_email    TEXT NOT NULL,                                -- snapshot at the time of the action; survives user deletion/renaming
    action        TEXT NOT NULL,                                -- e.g. 'login_success', 'file_download', 'transcript_delete'
    resource_type TEXT NOT NULL DEFAULT '',                      -- e.g. 'transcript', 'user'
    resource_id   TEXT NOT NULL DEFAULT '',
    ip_address    TEXT NOT NULL DEFAULT '',
    details       JSONB NOT NULL DEFAULT '{}'::jsonb,
    prev_hash     TEXT NOT NULL,       -- entry_hash of the previous row (or the genesis value for the first row)
    entry_hash    TEXT NOT NULL UNIQUE -- sha256 over prev_hash + this row's fields
);

CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_occurred_at ON audit_log(occurred_at DESC);

-- Single-row table whose row lock serializes concurrent audit writes.
-- Without this, two simultaneous requests could both read the same
-- "current tip" hash and compute two entries chained to the same parent,
-- silently forking/corrupting the chain instead of producing a strict
-- sequence. LogAudit does `SELECT ... FOR UPDATE` on this row inside the
-- same transaction as the insert, so the second writer blocks until the
-- first commits and sees the updated tip.
CREATE TABLE audit_log_chain_tip (
    id       SMALLINT PRIMARY KEY DEFAULT 1,
    tip_hash TEXT NOT NULL,
    CONSTRAINT single_row CHECK (id = 1)
);

-- Genesis hash: 64 '0' chars (same length as a real sha256 hex digest) so
-- the first real entry's prev_hash has something well-defined to point to.
INSERT INTO audit_log_chain_tip (id, tip_hash) VALUES (1, repeat('0', 64));
