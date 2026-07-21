package models

import "time"

// Role mirrors a row in the `roles` table.
type Role struct {
	ID          int16  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// User mirrors a row in the `users` table.
// PasswordHash is deliberately excluded from JSON output — it must never
// be serialized back to a client, even by accident.
type User struct {
	ID            string    `json:"id"`
	Email         string    `json:"email"`
	DisplayName   string    `json:"display_name"`
	RoleID        int16     `json:"role_id"`
	RoleName      string    `json:"role_name,omitempty"`
	MFAEnabled    bool      `json:"mfa_enabled"`
	EmailVerified bool      `json:"email_verified"`
	IsActive      bool      `json:"is_active"`
	CreatedAt     time.Time `json:"created_at"`

	PasswordHash string `json:"-"`
	MFASecret    string `json:"-"`
}

