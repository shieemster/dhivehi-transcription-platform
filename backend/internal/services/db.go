package services

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var DB *pgxpool.Pool

// initDB opens the PostgreSQL connection pool used for users, roles,
// permissions, and (in a later step) the audit log.
func initDB(ctx context.Context) error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fmt.Errorf("DATABASE_URL is not set")
	}

	poolCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(poolCtx, dsn)
	if err != nil {
		return fmt.Errorf("unable to create connection pool: %w", err)
	}

	if err := pool.Ping(poolCtx); err != nil {
		return fmt.Errorf("unable to reach postgres: %w", err)
	}

	DB = pool
	log.Println("✅ PostgreSQL connection established")
	return nil
}
