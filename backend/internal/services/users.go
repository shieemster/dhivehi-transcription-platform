package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"transcript_app/backend/internal/models"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

var ErrUserNotFound = errors.New("user not found")
var ErrEmailTaken = errors.New("email already registered")
var ErrInvalidCredentials = errors.New("invalid email or password")
var ErrWeakPassword = errors.New("password must be at least 8 characters")
var ErrInvalidRole = errors.New("invalid role")

const minPasswordLength = 8

// validatePasswordPolicy is deliberately just a length floor rather than
// forced complexity rules (uppercase/digit/symbol requirements) — those are
// well-documented to push users toward predictable substitutions (e.g.
// "Password1!") without meaningfully raising guess resistance, whereas
// length is the single strongest lever against brute force.
func validatePasswordPolicy(password string) error {
	if len(password) < minPasswordLength {
		return ErrWeakPassword
	}
	return nil
}

// CreateUser hashes the password with bcrypt and inserts a new user under
// the given role name (must be one of the four seeded roles). It never
// stores or returns the plaintext password.
func CreateUser(ctx context.Context, email, displayName, plainPassword, roleName string) (*models.User, error) {
	if err := validatePasswordPolicy(plainPassword); err != nil {
		return nil, err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	row := DB.QueryRow(ctx, `
		INSERT INTO users (email, display_name, password_hash, role_id)
		SELECT $1, $2, $3, roles.id FROM roles WHERE roles.name = $4
		RETURNING id, email, display_name, role_id, mfa_enabled, email_verified, is_active, created_at
	`, email, displayName, string(hash), roleName)

	var u models.User
	if err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &u.RoleID, &u.MFAEnabled, &u.EmailVerified, &u.IsActive, &u.CreatedAt); err != nil {
		if isUniqueViolation(err) {
			return nil, ErrEmailTaken
		}
		if errors.Is(err, pgx.ErrNoRows) {
			// The INSERT...SELECT matched zero role rows, so RETURNING has
			// nothing to scan — this is what an unrecognized roleName looks
			// like, not a real DB failure.
			return nil, ErrInvalidRole
		}
		return nil, fmt.Errorf("failed to create user: %w", err)
	}
	u.RoleName = roleName
	return &u, nil
}

// GetUserByID returns the safe (non-secret) fields for a single user by ID
// — used by the admin user-management screen, which never needs the
// password hash or MFA secret.
func GetUserByID(ctx context.Context, userID string) (*models.User, error) {
	row := DB.QueryRow(ctx, `
		SELECT u.id, u.email, u.display_name, u.role_id, r.name, u.mfa_enabled, u.email_verified, u.is_active, u.created_at
		FROM users u
		JOIN roles r ON r.id = u.role_id
		WHERE u.id = $1
	`, userID)

	var u models.User
	if err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &u.RoleID, &u.RoleName, &u.MFAEnabled, &u.EmailVerified, &u.IsActive, &u.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to fetch user: %w", err)
	}
	return &u, nil
}

// ListUsers returns every account (active and deactivated) for the admin
// user-management screen, oldest first.
func ListUsers(ctx context.Context) ([]models.User, error) {
	rows, err := DB.Query(ctx, `
		SELECT u.id, u.email, u.display_name, u.role_id, r.name, u.mfa_enabled, u.email_verified, u.is_active, u.created_at
		FROM users u
		JOIN roles r ON r.id = u.role_id
		ORDER BY u.created_at
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to list users: %w", err)
	}
	defer rows.Close()

	users := []models.User{}
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.RoleID, &u.RoleName, &u.MFAEnabled, &u.EmailVerified, &u.IsActive, &u.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan user: %w", err)
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// UpdateUser applies a partial update — any nil field is left unchanged.
// Changing the role or deactivating the account immediately invalidates
// every session for that user (same InvalidateAllSessions used by
// ChangePassword), so the change takes effect right away rather than
// waiting for the JWT — which already embeds the old role/active state —
// to expire on its own.
func UpdateUser(ctx context.Context, userID string, displayName *string, roleName *string, isActive *bool) (*models.User, error) {
	var roleID *int16
	if roleName != nil {
		var rid int16
		if err := DB.QueryRow(ctx, `SELECT id FROM roles WHERE name = $1`, *roleName).Scan(&rid); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrInvalidRole
			}
			return nil, fmt.Errorf("failed to resolve role: %w", err)
		}
		roleID = &rid
	}

	tag, err := DB.Exec(ctx, `
		UPDATE users SET
			display_name = COALESCE($1, display_name),
			role_id      = COALESCE($2, role_id),
			is_active    = COALESCE($3, is_active),
			updated_at   = now()
		WHERE id = $4
	`, displayName, roleID, isActive, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to update user: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrUserNotFound
	}

	if roleName != nil || (isActive != nil && !*isActive) {
		if err := InvalidateAllSessions(ctx, userID); err != nil {
			return nil, fmt.Errorf("updated user but failed to invalidate sessions: %w", err)
		}
	}

	return GetUserByID(ctx, userID)
}

// GetUserByEmail returns the full user record including password_hash —
// intended for the login handler only. Everywhere else, use the
// JSON-serializable fields on models.User (PasswordHash is tagged "-").
func GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	row := DB.QueryRow(ctx, `
		SELECT u.id, u.email, u.display_name, u.password_hash, u.role_id, r.name,
		       COALESCE(u.mfa_secret, ''), u.mfa_enabled, u.email_verified, u.is_active, u.created_at
		FROM users u
		JOIN roles r ON r.id = u.role_id
		WHERE u.email = $1
	`, email)

	var u models.User
	if err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &u.PasswordHash, &u.RoleID, &u.RoleName,
		&u.MFASecret, &u.MFAEnabled, &u.EmailVerified, &u.IsActive, &u.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to fetch user: %w", err)
	}
	return &u, nil
}

// VerifyPassword checks a plaintext password against the stored bcrypt hash.
// Returns ErrInvalidCredentials on mismatch — deliberately the same error
// as "user not found" callers should use, to avoid leaking which emails exist.
func VerifyPassword(u *models.User, plainPassword string) error {
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(plainPassword)); err != nil {
		return ErrInvalidCredentials
	}
	return nil
}

// ChangePassword verifies the caller's current password, enforces the
// password policy on the new one, and — since a leaked/stolen token is
// exactly the scenario a password change is meant to recover from —
// invalidates every existing session for this account via
// InvalidateAllSessions, including the one making this request. The caller
// (handler) should treat a successful response like a forced logout.
func ChangePassword(ctx context.Context, userID, currentPassword, newPassword string) error {
	var passwordHash string
	if err := DB.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&passwordHash); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUserNotFound
		}
		return fmt.Errorf("failed to fetch user: %w", err)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(currentPassword)); err != nil {
		return ErrInvalidCredentials
	}

	if err := validatePasswordPolicy(newPassword); err != nil {
		return err
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash new password: %w", err)
	}

	if _, err := DB.Exec(ctx, `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, string(newHash), userID); err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	return InvalidateAllSessions(ctx, userID)
}

// IssuePasswordResetCode generates and emails a password-reset code for the
// given (already-known-to-exist) user. Callers should still return the same
// generic response to the HTTP caller regardless of whether the account
// exists — see handlers.ForgotPassword — this function is only reached once
// that check has already happened server-side.
func IssuePasswordResetCode(ctx context.Context, userID, email string) error {
	code, err := issueVerificationCode(ctx, purposePasswordReset, userID)
	if err != nil {
		return err
	}
	body := fmt.Sprintf(
		"Your Dhivehi Transcription Platform password reset code is: %s\n\n"+
			"This code expires in 15 minutes. If you didn't request this, you can safely ignore this email — your password will not be changed.",
		code,
	)
	return SendEmail(email, "Reset your password", body)
}

// ResetPasswordWithCode verifies a password-reset code and, only on
// success, sets the new password and invalidates every existing session for
// the account — the same treatment as ChangePassword, since a reset is
// exactly the scenario (forgotten or compromised credential) that warrants it.
func ResetPasswordWithCode(ctx context.Context, userID, code, newPassword string) error {
	if err := consumeVerificationCode(ctx, purposePasswordReset, userID, code); err != nil {
		return err
	}

	if err := validatePasswordPolicy(newPassword); err != nil {
		return err
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash new password: %w", err)
	}

	if _, err := DB.Exec(ctx, `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, string(newHash), userID); err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	return InvalidateAllSessions(ctx, userID)
}

// GetSessionsValidAfter returns the timestamp before which any JWT issued
// to this user is treated as revoked — see InvalidateAllSessions.
func GetSessionsValidAfter(ctx context.Context, userID string) (time.Time, error) {
	var t time.Time
	if err := DB.QueryRow(ctx, `SELECT sessions_valid_after FROM users WHERE id = $1`, userID).Scan(&t); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return time.Time{}, ErrUserNotFound
		}
		return time.Time{}, fmt.Errorf("failed to fetch session epoch: %w", err)
	}
	return t, nil
}

// InvalidateAllSessions immediately revokes every JWT previously issued to
// this user — used by ChangePassword and the self-service "log out
// everywhere" endpoint. Unlike RevokeJWT (which blocklists one specific
// token by its JTI in Redis), this doesn't need to know which tokens
// exist: moving the epoch forward means ParseJWT rejects anything whose
// iat predates this call, covering every session at once.
func InvalidateAllSessions(ctx context.Context, userID string) error {
	if _, err := DB.Exec(ctx, `UPDATE users SET sessions_valid_after = now() WHERE id = $1`, userID); err != nil {
		return fmt.Errorf("failed to invalidate sessions: %w", err)
	}
	return nil
}

// GetUserPermissions returns the permission codes granted to a user's role,
// e.g. "transcript:upload", "audit_log:view_team". This is what RBAC
// middleware (added in the next step) will check against each route.
func GetUserPermissions(ctx context.Context, roleID int16) ([]string, error) {
	rows, err := DB.Query(ctx, `
		SELECT p.code FROM role_permissions rp
		JOIN permissions p ON p.id = rp.permission_id
		WHERE rp.role_id = $1
	`, roleID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch permissions: %w", err)
	}
	defer rows.Close()

	var perms []string
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		perms = append(perms, code)
	}
	return perms, rows.Err()
}

func GetPermissionsByRoleName(ctx context.Context, roleName string) ([]string, error) {
	rows, err := DB.Query(ctx, `
		SELECT p.code FROM role_permissions rp
		JOIN permissions p ON p.id = rp.permission_id
		JOIN roles r ON r.id = rp.role_id
		WHERE r.name = $1
	`, roleName)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch permissions for role %s: %w", roleName, err)
	}
	defer rows.Close()

	var perms []string
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		perms = append(perms, code)
	}
	return perms, rows.Err()
}

type RoleUserCount struct {
	RoleName  string `json:"role_name"`
	UserCount int64  `json:"user_count"`
}

// GetRoleUserCounts returns how many active users are assigned to each of
// the four seeded roles — the RBAC breakdown shown on the security
// dashboard. Roles with zero users still appear (LEFT JOIN), so an admin
// can see at a glance that, say, no one has the "supervisor" role yet.
func GetRoleUserCounts(ctx context.Context) ([]RoleUserCount, error) {
	rows, err := DB.Query(ctx, `
		SELECT r.name, count(u.id) FILTER (WHERE u.is_active)
		FROM roles r
		LEFT JOIN users u ON u.role_id = r.id
		GROUP BY r.name
		ORDER BY r.name
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch role user counts: %w", err)
	}
	defer rows.Close()

	var counts []RoleUserCount
	for rows.Next() {
		var rc RoleUserCount
		if err := rows.Scan(&rc.RoleName, &rc.UserCount); err != nil {
			return nil, err
		}
		counts = append(counts, rc)
	}
	return counts, rows.Err()
}

func isUniqueViolation(err error) bool {
	// pgx wraps *pgconn.PgError; code 23505 = unique_violation.
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23505"
	}
	return false
}
