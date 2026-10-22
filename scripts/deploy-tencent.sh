#!/usr/bin/env bash
set -Eeuo pipefail

IMAGE_PREFIX="${1:?image prefix required}"
COMMIT_SHA="${2:?commit SHA required}"
REGISTRY_USER="${3:?registry username required}"

cd "$(dirname "$0")/.."
COMPOSE_FILE="docker-compose.deploy.yml"
ENV_FILE=".env"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: Missing $COMPOSE_FILE" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Missing production .env" >&2
  exit 1
fi

export BACKEND_IMAGE="${IMAGE_PREFIX}-backend:${COMMIT_SHA}"
export FRONTEND_IMAGE="${IMAGE_PREFIX}-frontend:${COMMIT_SHA}"

echo "Deploying backend: $BACKEND_IMAGE"
echo "Deploying frontend: $FRONTEND_IMAGE"

# Receives GITHUB_TOKEN on stdin from the CI runner via a temporary file.
docker login ghcr.io -u "$REGISTRY_USER" --password-stdin

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

compose config --quiet
# Pull only application images to avoid forcing unnecessary infrastructure
# pulls (notably MinIO, where a local image may already be available).
compose pull api text-worker image-worker video-worker editor-worker frontend

# Other infrastructure images must already exist locally on first install.
# The existing service definitions and named volumes are preserved.
compose up -d --no-build --pull never

compose ps
printf 'Deployment completed for commit %s\n' "$COMMIT_SHA"
