# Kokoon IoT Dashboard

Blynk-style dashboard for Kokoon Labs students. A student adds a widget on the
web dashboard (which defines a named data channel), then wires a matching
"Send to server" / "Listen from server" block in Kokoon CodeLab. Their ESP32-S3
Brain Board syncs those channels over MQTT — no MQTT concepts ever reach the
student.

## Architecture (Phase 1 — single EC2 instance)

```
ESP32 device ──MQTT/TLS:8883──▶ Mosquitto ──▶ Ingestion process ──▶ Postgres
                                                       │
                                                       ▼
                                                     Redis (pub/sub)
                                                       │
                                                       ▼
Browser ──HTTPS+WSS──▶ WebSocket cluster (Socket.IO, Node cluster module)
```

Five services in one Docker Compose stack:

| Service     | Role |
|-------------|------|
| `mosquitto` | MQTT broker (mosquitto-go-auth plugin; auth/ACL delegated over HTTP to the ws API, backed by the `devices` table). Pure forwarding — no app logic. |
| `ingestion` | **One instance.** Single persistent subscription to `kokoon/+/pub`. Every message: save to Postgres (unconditional), then publish to Redis. Also runs the nightly 30-day history prune. |
| `redis`     | Pub/sub between ingestion and ws workers + Socket.IO redis-adapter store. |
| `ws`        | Node `cluster` — one worker per core. Socket.IO + REST API + serves the dashboard bundle. Never subscribes to MQTT; publishes only retained `/sub` snapshots on control writes. |
| `postgres`  | `channels` (the channel registry), `channel_state` (current values, overwritten in place), `channel_history` (30-day TTL), plus students/devices/projects. |

`ingestion` and `ws` are **one codebase, one image, two entry points**
([backend/src/ingestion.js](backend/src/ingestion.js), [backend/src/ws.js](backend/src/ws.js)).

### MQTT topics — fixed, two per device, forever

```
kokoon/{device_id}/pub   device → server     {"sensor1": 100}   (may batch keys)
kokoon/{device_id}/sub   server → device     retained FULL snapshot of all
                                             listen-direction channels
```

Channels are payload keys, never topics. Every `/sub` publish is retained and
carries the complete listen-direction state, so a device that was offline
catches up from the single retained message on reconnect.

### Widget type ⇒ direction (permanent)

- **Gauge / Chart** → `publish` (device → dashboard, read-only widget)
- **Toggle / Slider** → `listen` (dashboard → device, writable widget)

If a device publishes a channel name that isn't registered yet, ingestion
auto-creates it as a `publish`/gauge channel — students who code first lose
nothing.

## Run it

```bash
cp .env.example .env            # then edit the change-me values
bash mosquitto/certs/gen-certs.sh localhost
docker compose up -d --build
```

Dashboard: http://localhost:8080 (set `WS_PORT` to change). MQTT/TLS: `:8883`.

### Try the full loop without hardware

```bash
# 1. Simulate a board — self-generates a device_id, provisions itself, streams
#    sensor1, prints /sub snapshots (prints the device_id it picked):
cd backend && npm install
node scripts/simulate-device.js

# 2. Sign up in the dashboard, claim that printed device_id, add widgets.
```

Automated end-to-end check of the whole pipeline (student → claim → provision
→ TLS publish → state/history → control write → retained snapshot → CodeLab
endpoint → soft delete):

```bash
cd backend && node scripts/smoke-e2e.js
```

### Local development (no Docker for the app code)

```bash
docker compose up -d postgres redis mosquitto   # infra only
cd backend  && npm install && npm run ws        # + npm run ingestion in a 2nd shell
cd frontend && npm install && npm run dev       # Vite on :5175, proxies to :3000
```

## Device lifecycle

No factory pre-provisioning step — every board ships with identical firmware.

1. **First boot** — the board derives its own `device_id` from its chip's
   built-in silicon ID (`machine.unique_id()`), never generated or written by
   us. No WiFi stored yet → opens a `Kokoon-XXXX` SoftAP with a tiny setup
   page showing that `device_id`. Once WiFi is entered, it POSTs just its
   `device_id` to `/provision` — the server creates the device's row right
   there, on this first contact, and hands back scoped MQTT credentials
   (stored in NVS, alongside the WiFi credentials).
2. **Claim** — student enters/scans the `device_id` (shown on the SoftAP setup
   page) in the dashboard, linking the already-existing row to their account
   (creates a default project for CodeLab).
3. **Forever after** — connects straight to `:8883`. Broker ACL confines each
   device to exactly its own two topics.

## CodeLab integration

Block dropdowns are populated from
`GET /api/projects/{id}/channels?direction=publish|listen` (Send blocks =
`publish`, Listen blocks = `listen`) — never free text. The device library is
[device/kokoon.py](device/kokoon.py): `kokoon.send(name, value)` batches into
`/pub`; `kokoon.get(name)` reads the local snapshot dict and never blocks.

## Deploying

Push to `main` → GitHub Action SSHes into EC2 and runs [deploy.sh](deploy.sh)
(`git pull && docker compose up -d --build`). One-time EC2 setup:

```bash
sudo git clone <repo> /opt/kokoon && cd /opt/kokoon
cp .env.example .env && $EDITOR .env         # strong secrets!
MQTT_DOMAIN=your.host bash mosquitto/certs/gen-certs.sh your.host
./deploy.sh
```

GitHub secrets: `EC2_HOST`, `EC2_USER`, `EC2_DEPLOY_KEY` — a **dedicated
deploy-only SSH key** (generate a fresh keypair, add the public half to the EC2
user's `authorized_keys`), not a personal key.

TLS for the dashboard: either set `TLS_CERT_FILE`/`TLS_KEY_FILE` (terminated in
the ws workers) or put the instance behind a TLS-terminating proxy/ALB on 443.

## Phase 1 notes / known trade-offs

- Broker cert is self-signed; `kokoon.py` skips CA verification until a real
  cert or pinned CA ships. `/provision` and `/mqtt/*` are unauthenticated
  endpoints by design (secrets are verified inside them, bcrypt-hashed at rest);
  brute-force exposure equals the MQTT port itself. Add rate limiting when public.
- Explicitly **out of scope** (deliberate, don't add): managed brokers/AWS IoT,
  broker clustering, queues between Mosquitto and ingestion, non-Node backends,
  per-channel topics, scaling beyond the single-VM cluster.
