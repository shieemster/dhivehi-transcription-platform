-- 004_email_verification.sql
-- Adds email verification. Not primarily to gate login (unverified accounts
-- can still sign in) but because a mistyped or attacker-supplied email at
-- account-creation time would otherwise be silently trusted forever — and
-- forgot-password is only safe to be email-based if the platform has some
-- confidence the address actually belongs to the account holder.

ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Every account that already exists at the time this migration runs
-- (including the bootstrap administrator seeded in 001_init.sql) is
-- grandfathered in as verified — only accounts created going forward via
-- CreateUser start unverified and get a real verification email.
UPDATE users SET email_verified = TRUE;
