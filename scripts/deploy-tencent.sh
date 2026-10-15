#!/usr/bin/env bash
# Pull CI artifacts without removing named volumes or ignored secrets.
set -euo pipefail

cd "$(dirname "$0")/.."

export IMAGE_PREFIX="${1:?Usage: deploy-tencent.sh IMAGE_PREFIX COMMIT_SHA [REGISTRY_USER]}"
export IMAGE_TAG="${2:?An exact commit SHA is required}"
[[ "$IMAGE_TAG" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid commit SHA" >&2; exit 1; }
compose=(docker compose -f docker-compose.yml -f docker-compose.deploy.yml)
# Validate before logging in or changing any services (including Compose tag support).
"${compose[@]}" config --quiet
if [ -n "${3:-}" ]; then
  # GitHub's short-lived token arrives via stdin, never command arguments or git.
  export DOCKER_CONFIG
  DOCKER_CONFIG="$(mktemp -d)"
  trap 'rm -rf "$DOCKER_CONFIG"' EXIT
  docker login ghcr.io --username "$3" --password-stdin
fi

# Pull registry images before changing running services. Limit simultaneous pulls
# and retry transient registry/CDN failures without suppressing the final error.
export COMPOSE_PARALLEL_LIMIT=1
pull_ready=false
for attempt in 1 2 3 4; do
  if "${compose[@]}" pull; then
    pull_ready=true
    break
  fi
  if [ "$attempt" -lt 4 ]; then
    delay=$((attempt * 10))
    echo "Image pull failed (attempt $attempt/4); retrying in ${delay}s." >&2
    sleep "$delay"
  fi
done
if [ "$pull_ready" != true ]; then
  echo "Image pull failed after 4 attempts; deployment stopped before updating services." >&2
  exit 1
fi

# Run migrations once with the same image that will serve requests.
"${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 180 postgres redis elasticsearch minio
"${compose[@]}" run --rm --no-deps api alembic upgrade head
"${compose[@]}" up -d --no-build --pull never --remove-orphans --wait --wait-timeout 180

curl --fail --silent --show-error \
  --retry 12 --retry-delay 5 --retry-connrefused \
  http://127.0.0.1:8000/healthz
echo
