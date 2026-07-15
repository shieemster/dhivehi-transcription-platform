package services

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/encrypt"
)

// SSE returns the server-side-encryption-with-customer-key (SSE-C) config
// used for every object read/write against MinIO. AES-256 at rest works
// like this: the key never leaves the backend (never sent to the browser,
// never stored anywhere but this env var + MinIO's in-memory use of it per
// request) — MinIO does the actual AES-256-GCM encrypt/decrypt using this
// key on every PutObject/GetObject call we make.
//
// This is why file access changed from "hand the browser a presigned link"
// to "the backend fetches+decrypts and streams the bytes itself": SSE-C's
// key must be sent as an HTTP header, and a presigned URL only carries
// query-string auth — there's no way for a plain browser GET (or an
// <audio src>) to attach that header. The backend is now the only thing
// that ever talks to MinIO directly.
func SSE() (encrypt.ServerSide, error) {
	keyB64 := os.Getenv("SSE_C_KEY")
	if keyB64 == "" {
		return nil, fmt.Errorf("SSE_C_KEY is not set")
	}
	key, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil {
		return nil, fmt.Errorf("SSE_C_KEY is not valid base64: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("SSE_C_KEY must decode to exactly 32 bytes (AES-256), got %d", len(key))
	}
	return encrypt.NewSSEC(key)
}

// StreamObject fetches and decrypts an object from MinIO, returning a
// reader the caller can copy directly to an HTTP response, plus its
// content type and size for setting response headers.
func StreamObject(ctx context.Context, bucket, objectName string) (io.ReadCloser, minio.ObjectInfo, error) {
	sse, err := SSE()
	if err != nil {
		return nil, minio.ObjectInfo{}, err
	}

	obj, err := MinioClient.GetObject(ctx, bucket, objectName, minio.GetObjectOptions{
		ServerSideEncryption: sse,
	})
	if err != nil {
		return nil, minio.ObjectInfo{}, fmt.Errorf("failed to get object: %w", err)
	}

	info, err := obj.Stat()
	if err != nil {
		obj.Close()
		return nil, minio.ObjectInfo{}, fmt.Errorf("failed to stat object (check SSE_C_KEY matches what it was uploaded with): %w", err)
	}

	return obj, info, nil
}
