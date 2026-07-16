-- 003_session_epoch.sql
-- Adds a per-user "session epoch": any JWT issued before this timestamp is
-- treated as revoked. This is what powers both "log out everywhere" and
-- forcing every existing session to end when a password changes — without
-- it, the only way to invalidate a token early was the single-token Redis
-- blocklist (services.RevokeJWT), which can't revoke tokens it was never
-- handed (i.e. every OTHER session for the same account).

ALTER TABLE users ADD COLUMN sessions_valid_after TIMESTAMPTZ NOT NULL DEFAULT now();

-- NOTE: the DEFAULT now() above means running this migration on an existing
-- deployment immediately invalidates every currently-issued token (every
-- token's iat predates this ALTER running) — everyone gets logged out once,
-- the same one-time effect as rotating JWT_SECRET.
