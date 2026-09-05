#!/usr/bin/env bash
# Run on the EC2 instance by the GitHub Action (or by hand).
set -euo pipefail
cd "$(dirname "$0")"

git pull --ff-only

if [ ! -f .env ]; then
  cp .env.example .env
  echo "!! Created .env from .env.example — edit the change-me values, then re-run." >&2
  exit 1
fi

# Self-signed broker certs on first deploy (set MQTT_DOMAIN for a real hostname).
if [ ! -f mosquitto/certs/server.crt ]; then
  bash mosquitto/certs/gen-certs.sh "${MQTT_DOMAIN:-localhost}"
fi

docker compose up -d --build
docker image prune -f
