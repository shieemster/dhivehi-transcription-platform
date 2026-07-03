# Use Go 1.24
FROM golang:1.24-bullseye

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