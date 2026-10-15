#!/usr/bin/env bash
# Update the existing Compose stack without removing named volumes or ignored secrets.
set -euo pipefail

cd "$(dirname "$0")/.."

if docker compose up --help | grep -q -- '--wait'; then
  docker compose up -d --build --remove-orphans --wait --wait-timeout 180
else
  docker compose up -d --build --remove-orphans
fi

curl --fail --silent --show-error \
  --retry 12 --retry-delay 5 --retry-connrefused \
  http://127.0.0.1:8000/healthz
echo
