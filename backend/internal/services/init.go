package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	redis "github.com/redis/go-redis/v9"
)

var (
	MinioClient *minio.Client
	RedisClient *redis.Client
)

// InitializeServices initializes PostgreSQL, MinIO, Qdrant, and Redis with auto-creation
func InitializeServices() error {
	ctx := context.Background()

	// Initialize PostgreSQL (users, roles, permissions)
	if err := initDB(ctx); err != nil {
		return fmt.Errorf("failed to initialize PostgreSQL: %v", err)
	}

	// Initialize MinIO
	if err := initMinIO(ctx); err != nil {
		return fmt.Errorf("failed to initialize MinIO: %v", err)
	}

	// Initialize Qdrant collection
	if err := initQdrant(); err != nil {
		return fmt.Errorf("failed to initialize Qdrant: %v", err)
	}

	// Initialize Redis
	if err := initRedis(ctx); err != nil {
		return fmt.Errorf("failed to initialize Redis: %v", err)
	}

	log.Println("✅ All services initialized successfully")
	return nil
}

func initMinIO(ctx context.Context) error {
	endpoint := os.Getenv("MINIO_ENDPOINT")
	accessKey := os.Getenv("MINIO_ACCESS_KEY")
	secretKey := os.Getenv("MINIO_SECRET_KEY")

	if endpoint == "" {
		endpoint = "minio:9000"
	}
	if accessKey == "" {
		accessKey = "minio"
	}
	if secretKey == "" {
		secretKey = "minio123"
	}

	var err error
	MinioClient, err = minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: false,
	})
	if err != nil {
		return err
	}

	// Create required buckets if they don't exist
	buckets := []string{"uploads", "audio"}
	for _, bucketName := range buckets {
		exists, err := MinioClient.BucketExists(ctx, bucketName)
		if err != nil {
			return err
		}

		if !exists {
			err = MinioClient.MakeBucket(ctx, bucketName, minio.MakeBucketOptions{})
			if err != nil {
				return err
			}
			log.Printf("✅ Created MinIO bucket: %s", bucketName)
		} else {
			log.Printf("✅ MinIO bucket already exists: %s", bucketName)
		}

		// NOTE: buckets are intentionally left PRIVATE (no public-read policy).
		// A previous version of this code set Principal: {"AWS": ["*"]} on
		// every bucket, meaning anyone with an object URL could download it
		// directly from MinIO — completely bypassing JWT auth and RBAC.
		// Files are now served exclusively through GET /files/:job_id, which
		// checks the caller's permissions/ownership and issues a short-lived
		// presigned URL — see handlers.GetFileURL.
		//
		// IMPORTANT: MinIO bucket policies persist in its own storage across
		// restarts. If this bucket previously had the public-read policy
		// applied (from before this fix), it stays applied even after we
		// stop setting it — simply not calling SetBucketPolicy is not enough.
		// We have to explicitly clear it with an empty policy string.
		if err := MinioClient.SetBucketPolicy(ctx, bucketName, ""); err != nil {
			log.Printf("⚠️ Warning: could not clear bucket policy for %s: %v", bucketName, err)
		}
	}

	return nil
}

func initQdrant() error {
	qdrantHost := os.Getenv("QDRANT_HOST")
	if qdrantHost == "" {
		qdrantHost = "http://qdrant:6333"
	}

	collectionName := "file_metadata"

	// Check if collection exists
	checkURL := fmt.Sprintf("%s/collections/%s", qdrantHost, collectionName)
	resp, err := http.Get(checkURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// If collection doesn't exist (404), create it
	if resp.StatusCode == 404 {
		createURL := fmt.Sprintf("%s/collections/%s", qdrantHost, collectionName)
		payload := map[string]interface{}{
			"vectors": map[string]interface{}{
				"size":     512,
				"distance": "Cosine",
			},
		}

		data, err := json.Marshal(payload)
		if err != nil {
			return err
		}

		req, err := http.NewRequest("PUT", createURL, bytes.NewBuffer(data))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")

		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()

		if resp.StatusCode >= 300 {
			return fmt.Errorf("failed to create Qdrant collection: %s", resp.Status)
		}

		log.Printf("✅ Created Qdrant collection: %s", collectionName)
	} else {
		log.Printf("✅ Qdrant collection already exists: %s", collectionName)
	}

	return nil
}

func initRedis(ctx context.Context) error {
	redisHost := os.Getenv("REDIS_HOST")
	redisPort := os.Getenv("REDIS_PORT")

	if redisHost == "" {
		redisHost = "redis"
	}
	if redisPort == "" {
		redisPort = "6379"
	}

	RedisClient = redis.NewClient(&redis.Options{
		Addr: fmt.Sprintf("%s:%s", redisHost, redisPort),
		DB:   0,
	})

	// Test connection
	_, err := RedisClient.Ping(ctx).Result()
	if err != nil {
		return err
	}

	log.Println("✅ Redis connection established")
	return nil
}
