#!/usr/bin/env bash
# Pull CI artifacts without removing named volumes or ignored secrets.
set -euo pipefail

cd "$(dirname "$0")/.."

export IMAGE_PREFIX="${1:?Usage: deploy-tencent.sh IMAGE_PREFIX COMMIT_SHA [REGISTRY_USER]}"
export IMAGE_TAG="${2:?An exact commit SHA is required}"
[[ "$IMAGE_TAG" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid commit SHA" >&2; exit 1; }
ENV_FILE=".env.prod"
for required in "$ENV_FILE" docker-compose.deploy.yml; do
  [[ -f "$required" ]] || { echo "ERROR: Missing $required" >&2; exit 1; }
done
export BACKEND_IMAGE="${IMAGE_PREFIX}-backend:${IMAGE_TAG}"
export FRONTEND_IMAGE="${IMAGE_PREFIX}-frontend:${IMAGE_TAG}"
compose=(docker compose --env-file "$ENV_FILE" -f docker-compose.deploy.yml)
# Validate before logging in or changing any services (including Compose tag support).
"${compose[@]}" config --quiet
if [ -n "${3:-}" ]; then
  # GitHub's short-lived token arrives via stdin, never command arguments or git.
  export DOCKER_CONFIG
  DOCKER_CONFIG="$(mktemp -d)"
  trap 'rm -rf "$DOCKER_CONFIG"' EXIT
  docker login ghcr.io --username "$3" --password-stdin
fi

# Public Docker Hub images are pulled through the Tencent Cloud mirror. Images
# already stored on the server are not contacted again. Only the two CI images
# change every release; a stalled ghcr.io pull is killed instead of left open.
TENCENT_MIRROR="${TENCENT_MIRROR:-mirror.ccs.tencentyun.com}"
pull_with_deadline() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 900 docker pull "$1"
  else
    docker pull "$1"
  fi
}
pull_missing() {
  local target="$1"
  local mirror="${2:-}"
  if docker image inspect "$target" >/dev/null 2>&1; then
    echo "already present: $target"
    return 0
  fi
  if [ -n "$mirror" ] && pull_with_deadline "$mirror"; then
    docker tag "$mirror" "$target"
    return 0
  fi
  pull_with_deadline "$target" || return 1
}
pull_release() {
  pull_missing postgres:16 "$TENCENT_MIRROR/library/postgres:16" || return 1
  pull_missing redis:7 "$TENCENT_MIRROR/library/redis:7" || return 1
  pull_missing docker.elastic.co/elasticsearch/elasticsearch:8.15.3 || return 1
  pull_missing ghcr.io/coollabsio/minio:latest || return 1
  pull_with_deadline "${IMAGE_PREFIX}-backend:${IMAGE_TAG}" || return 1
  pull_with_deadline "${IMAGE_PREFIX}-frontend:${IMAGE_TAG}" || return 1
}
pull_ready=false
for attempt in 1 2 3 4; do
  if pull_release; then
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
