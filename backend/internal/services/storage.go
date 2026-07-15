package services

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// presignClient is a SEPARATE MinIO client used only to generate presigned
// URLs, configured with a browser-reachable endpoint (MINIO_PUBLIC_ENDPOINT,
// e.g. "localhost:9000") instead of the internal Docker network hostname
// ("minio:9000") that MinioClient itself uses.
//
// Why two clients: MinioClient talks to MinIO over the internal Docker
// network for actual uploads/downloads done BY the backend — "minio:9000"
// is correct and required there. But a presigned URL is handed to the
// BROWSER, which has no idea what "minio" is (that hostname only resolves
// inside the Docker network) — every presigned URL generated with the
// internal client would fail to load with a generic, confusing error.
// Presigning is a pure client-side signing operation (no network call), so
// this second client doesn't need to actually be reachable from inside the
// backend container at all — it only needs the correct public-facing
// endpoint baked into the URLs it produces.
var presignClient *minio.Client

func initPresignClient() error {
	publicEndpoint := os.Getenv("MINIO_PUBLIC_ENDPOINT")
	if publicEndpoint == "" {
		publicEndpoint = "localhost:9000"
	}
	accessKey := os.Getenv("MINIO_ACCESS_KEY")
	if accessKey == "" {
		accessKey = "minio"
	}
	secretKey := os.Getenv("MINIO_SECRET_KEY")
	if secretKey == "" {
		secretKey = "minio123"
	}

	var err error
	presignClient, err = minio.New(publicEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: false,
		// Without an explicit region, minio-go tries to auto-detect it by
		// calling GetBucketLocation — a real network request made using
		// THIS client's own endpoint (localhost:9000). Since this code runs
		// inside the backend container, "localhost" means the container
		// itself, which has nothing listening on 9000 — that lookup then
		// fails with "connection refused" before presigning ever happens.
		// Setting the region explicitly (matches MinIO's default) skips
		// that lookup entirely, since presigning itself is pure local
		// signing and needs no network access at all.
		Region: "us-east-1",
	})
	return err
}

// GeneratePresignedURL returns a time-limited, signed URL for a private
// MinIO object. This replaces the old public-read bucket policy — instead
// of anyone being able to guess/reuse a permanent object URL, callers must
// go through GET /files/:job_id (which checks RBAC + ownership) to obtain
// one of these, and it stops working after expiry.
func GeneratePresignedURL(ctx context.Context, bucket, objectName string, expiry time.Duration) (string, error) {
	if presignClient == nil {
		if err := initPresignClient(); err != nil {
			return "", fmt.Errorf("failed to initialize presign client: %w", err)
		}
	}

	reqParams := url.Values{}
	presignedURL, err := presignClient.PresignedGetObject(ctx, bucket, objectName, expiry, reqParams)
	if err != nil {
		return "", fmt.Errorf("failed to generate presigned URL: %w", err)
	}
	return presignedURL.String(), nil
}
