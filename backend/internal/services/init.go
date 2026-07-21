package services

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
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

// minioTLSTransport builds an http.RoundTripper that trusts MinIO's
// self-signed certificate specifically (loaded from a file both this
// backend and the minio container have mounted), instead of either
// requiring a real CA-signed cert (overkill for local dev) or disabling
// certificate verification entirely (which would defeat the point of
// using TLS at all).
func minioTLSTransport() (http.RoundTripper, error) {
	certPath := os.Getenv("MINIO_CERT_PATH")
	if certPath == "" {
		certPath = "/app/certs/public.crt"
	}

	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read MinIO cert at %s: %w", certPath, err)
	}

	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(certPEM) {
		return nil, fmt.Errorf("failed to parse MinIO cert at %s", certPath)
	}

	return &http.Transport{
		TLSClientConfig: &tls.Config{
			RootCAs: pool,
		},
	}, nil
}

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

	// SMTP (email verification, password reset) — never fatal, see initEmail.
	initEmail()

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

	// MinIO now runs with TLS (required for SSE-C — customer encryption
	// keys must never travel over plain HTTP). It's a self-signed cert for
	// this local dev environment, so rather than blanket-disabling cert
	// verification (InsecureSkipVerify), we load and trust this specific
	// certificate — still verifies we're actually talking to the real
	// MinIO and not something else, just without a public CA behind it.
	transport, err := minioTLSTransport()
	if err != nil {
		return fmt.Errorf("failed to set up MinIO TLS transport: %w", err)
	}

	MinioClient, err = minio.New(endpoint, &minio.Options{
		Creds:     credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure:    true,
		Transport: transport,
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
		// Objects are also encrypted at rest with SSE-C (see services.SSE),
		// so even bucket policy alone wouldn't matter — decrypting a read
		// requires the SSE-C key, which only the backend holds. Files are
		// served exclusively through GET /files/:job_id and the segment
		// audio endpoint, which check permissions/ownership and stream the
		// decrypted bytes directly rather than handing out a URL.
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
