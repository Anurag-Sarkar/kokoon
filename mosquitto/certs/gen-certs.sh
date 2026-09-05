#!/usr/bin/env bash
# Generates a self-signed CA + server cert for the broker's TLS listener (8883).
# Usage: ./gen-certs.sh [common-name]   (default: localhost)
set -euo pipefail
cd "$(dirname "$0")"
CN="${1:-localhost}"

openssl req -new -x509 -days 3650 -nodes \
  -subj "/O=Kokoon Labs/CN=Kokoon CA" \
  -keyout ca.key -out ca.crt

openssl req -new -nodes \
  -subj "/O=Kokoon Labs/CN=${CN}" \
  -keyout server.key -out server.csr

openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 3650 -out server.crt

rm -f server.csr
# Readable by the mosquitto process inside the container.
chmod 644 ca.crt server.crt server.key ca.key

echo "Wrote ca.crt / server.crt / server.key (CN=${CN})"
