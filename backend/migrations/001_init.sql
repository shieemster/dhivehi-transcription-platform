-- 001_init.sql
-- Foundation schema for the security module: users, roles, permissions.
-- Auto-applied by the postgres container on first boot (docker-entrypoint-initdb.d).
-- To re-apply by hand: psql "$DATABASE_URL" -f backend/migrations/001_init.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Roles: the four roles defined in the Investigation Report deliverables
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
    id          SMALLSERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL
);

INSERT INTO roles (name, description) VALUES
    ('dispatcher',    'Uploads audio and assigns transcription jobs. No access to completed transcripts beyond own uploads.'),
    ('analyst',       'Reviews and works with transcripts. Cannot manage users or view unredacted PII by default.'),
    ('supervisor',    'Oversees a team''s transcripts and audit history. Can view audit logs for their team.'),
    ('administrator', 'Full access: user management, role assignment, security dashboard, unredacted data access.');

-- ---------------------------------------------------------------------------
-- Permissions: fine-grained actions, checked by the RBAC middleware
-- ---------------------------------------------------------------------------
CREATE TABLE permissions (
    id   SMALLSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE  -- e.g. 'transcript:upload', 'transcript:view_redacted'
);

INSERT INTO permissions (code) VALUES
    ('transcript:upload'),
    ('transcript:view_own'),
    ('transcript:view_team'),
    ('transcript:view_all'),
    ('transcript:view_unredacted'),
    ('transcript:delete'),
    ('audit_log:view_team'),
    ('audit_log:view_all'),
    ('user:manage'),
    ('security_dashboard:view');

-- ---------------------------------------------------------------------------
-- Role <-> Permission mapping (principle of least privilege, per role)
-- ---------------------------------------------------------------------------
CREATE TABLE role_permissions (
    role_id       SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id SMALLINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE
    (r.name = 'dispatcher'    AND p.code IN ('transcript:upload', 'transcript:view_own'))
 OR (r.name = 'analyst'       AND p.code IN ('transcript:view_own', 'transcript:view_team'))
 OR (r.name = 'supervisor'    AND p.code IN ('transcript:view_own', 'transcript:view_team', 'audit_log:view_team'))
 OR (r.name = 'administrator' AND p.code IN (
        'transcript:upload', 'transcript:view_own', 'transcript:view_team', 'transcript:view_all',
        'transcript:view_unredacted', 'transcript:delete', 'audit_log:view_team', 'audit_log:view_all',
        'user:manage', 'security_dashboard:view'
    ));

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    password_hash   TEXT NOT NULL,        -- bcrypt/argon2 hash, never plaintext
    role_id         SMALLINT NOT NULL REFERENCES roles(id),
    mfa_secret      TEXT,                 -- TOTP secret, set once MFA is enrolled (step 2)
    mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role_id ON users(role_id);

-- Bootstrap administrator account.
-- Password below is the bcrypt hash of "ChangeMe123!" — log in once and rotate it immediately.
INSERT INTO users (email, display_name, password_hash, role_id)
SELECT 'admin@transcript.local', 'Default Admin',
       '$2b$10$.tJoFwyPdvHxqE4TLB4fZe1mDmbPIY25lmexNVSSU.n.rFOWFJ9zi',
       r.id
FROM roles r WHERE r.name = 'administrator';
