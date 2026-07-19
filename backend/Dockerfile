# Use Go 1.25 — go.mod requires this (pulled in transitively by the pgx
# v5.9.2 security upgrade, see govulncheck GO-2026-5004). No bullseye
# variant is published for 1.25 (Debian bullseye is being phased out of
# the official image), so this also moves to bookworm.
FROM golang:1.25-bookworm

# Set working directory inside container
WORKDIR /app

# Copy go.mod and go.sum first for dependency caching
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy the rest of the backend source code
COPY . .

# Build the binary
RUN go build -o backend ./cmd/backend

# Expose the port your server runs on
EXPOSE 8000

# Run the backend
CMD ["./backend"]