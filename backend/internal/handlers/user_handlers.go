package handlers

import (
	"errors"
	"log"
	"net/http"

	"transcript_app/backend/internal/services"

	"github.com/gin-gonic/gin"
)

// ListUsers handles GET /users — administrator-only (see main.go's
// user:manage permission gate). Returns every account, active and
// deactivated, for the admin user-management screen.
func ListUsers(c *gin.Context) {
	users, err := services.ListUsers(c.Request.Context())
	if err != nil {
		log.Printf("⚠️ failed to list users: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list users"})
		return
	}
	c.JSON(http.StatusOK, users)
}

type createUserRequest struct {
	Email       string `json:"email" binding:"required"`
	DisplayName string `json:"display_name" binding:"required"`
	Password    string `json:"password" binding:"required"`
	RoleName    string `json:"role_name" binding:"required"`
}

// CreateUserHandler handles POST /users.
func CreateUserHandler(c *gin.Context) {
	claims := c.MustGet("claims").(*services.Claims)

	var req createUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email, display_name, password, and role_name are required"})
		return
	}

	user, err := services.CreateUser(c.Request.Context(), req.Email, req.DisplayName, req.Password, req.RoleName)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrEmailTaken):
			c.JSON(http.StatusConflict, gin.H{"error": "a user with that email already exists"})
		case errors.Is(err, services.ErrWeakPassword):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, services.ErrInvalidRole):
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role"})
		default:
			log.Printf("⚠️ failed to create user: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create user"})
		}
		return
	}

	if err := services.LogAudit(c.Request.Context(), &claims.UserID, claims.Email, "user_created", "user", user.ID, c.ClientIP(),
		map[string]interface{}{"created_email": user.Email, "role": user.RoleName}); err != nil {
		log.Printf("⚠️ failed to write audit log: %v", err)
	}

	c.JSON(http.StatusCreated, user)
}

type updateUserRequest struct {
	DisplayName *string `json:"display_name"`
	RoleName    *string `json:"role_name"`
	IsActive    *bool   `json:"is_active"`
}

// UpdateUserHandler handles PATCH /users/:user_id — partial update of
// display name, role, and/or active status.
func UpdateUserHandler(c *gin.Context) {
	claims := c.MustGet("claims").(*services.Claims)
	targetID := c.Param("user_id")

	if targetID == claims.UserID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot modify your own account from this screen — use Account settings instead"})
		return
	}

	var req updateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	demotingOrDeactivating := req.RoleName != nil || (req.IsActive != nil && !*req.IsActive)
	if demotingOrDeactivating {
		if err := guardLastAdministrator(c, targetID); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	user, err := services.UpdateUser(c.Request.Context(), targetID, req.DisplayName, req.RoleName, req.IsActive)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrUserNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		case errors.Is(err, services.ErrInvalidRole):
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role"})
		default:
			log.Printf("⚠️ failed to update user: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update user"})
		}
		return
	}

	if err := services.LogAudit(c.Request.Context(), &claims.UserID, claims.Email, "user_updated", "user", targetID, c.ClientIP(),
		map[string]interface{}{"display_name": req.DisplayName, "role_name": req.RoleName, "is_active": req.IsActive}); err != nil {
		log.Printf("⚠️ failed to write audit log: %v", err)
	}

	c.JSON(http.StatusOK, user)
}

// DeactivateUserHandler handles DELETE /users/:user_id. This is a soft
// delete (is_active=false), never a permanent erasure: audit_log.user_id
// references this row with ON DELETE SET NULL, so a hard delete would work
// but would orphan that user's attribution out of the tamper-evident audit
// trail. Deactivating preserves it, and PATCH can re-activate the account
// later if needed.
func DeactivateUserHandler(c *gin.Context) {
	claims := c.MustGet("claims").(*services.Claims)
	targetID := c.Param("user_id")

	if targetID == claims.UserID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot deactivate your own account"})
		return
	}

	if err := guardLastAdministrator(c, targetID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	inactive := false
	user, err := services.UpdateUser(c.Request.Context(), targetID, nil, nil, &inactive)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrUserNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		default:
			log.Printf("⚠️ failed to deactivate user: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to deactivate user"})
		}
		return
	}

	if err := services.LogAudit(c.Request.Context(), &claims.UserID, claims.Email, "user_deactivated", "user", targetID, c.ClientIP(), nil); err != nil {
		log.Printf("⚠️ failed to write audit log: %v", err)
	}

	c.JSON(http.StatusOK, user)
}

// guardLastAdministrator blocks demoting/deactivating the sole remaining
// active administrator, which would otherwise lock every admin out of user
// management (and the security dashboard) with no way back in short of a
// direct database edit. A no-op update to an already-non-admin or already
// -inactive target is always allowed through.
func guardLastAdministrator(c *gin.Context, targetID string) error {
	target, err := services.GetUserByID(c.Request.Context(), targetID)
	if err != nil {
		// Let the caller's own lookup inside services.UpdateUser surface the
		// real not-found error instead of duplicating it here.
		return nil
	}
	if target.RoleName != "administrator" || !target.IsActive {
		return nil
	}

	counts, err := services.GetRoleUserCounts(c.Request.Context())
	if err != nil {
		return errors.New("failed to verify administrator count")
	}
	for _, rc := range counts {
		if rc.RoleName == "administrator" && rc.UserCount <= 1 {
			return errors.New("cannot remove the last remaining administrator")
		}
	}
	return nil
}
