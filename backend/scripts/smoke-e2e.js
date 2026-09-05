// End-to-end smoke test against a running stack. Exercises the full loop:
// student signup → device self-provisions (no factory secret, just like a
// real board using its own machine.unique_id()) → claim → device publish
// over MQTT/TLS → state API → widget creation → control write → retained
// /sub snapshot back at the device.
//
// Run from the host (defaults target the compose stack):
//   node scripts/smoke-e2e.js
// Env: API_URL (http://localhost:8080), MQTT_HOST (localhost), MQTT_PORT (8883)

import crypto from 'node:crypto';
import mqtt from 'mqtt';

const API_URL = process.env.API_URL || 'http://localhost:8080';
const MQTT_HOST = process.env.MQTT_HOST || 'localhost';
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '8883', 10);

let token = null;
async function api(path, { method = 'GET', body, auth = true } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json.error || 'error'}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(label, fn, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${label}`);
    await sleep(500);
  }
}
const step = (msg) => console.log(`✔ ${msg}`);

// 1. Student signs up.
const email = `smoke-${crypto.randomBytes(4).toString('hex')}@example.com`;
({ token } = await api('/api/auth/register', {
  method: 'POST',
  auth: false,
  body: { name: 'Smoke Test', email, password: 'smoke-pass' },
}));
step(`student registered (${email})`);

// 2. Device self-generates an ID (like a real board would from its own
// machine.unique_id()) and provisions itself — no pre-existing DB row, no
// factory secret. This is the server's first-ever contact with this device.
const deviceId = process.env.DEVICE_ID || `kokoon-${crypto.randomBytes(6).toString('hex')}`;
const creds = await api('/provision', {
  method: 'POST',
  auth: false,
  body: { device_id: deviceId },
});
step(`device self-provisioned (${deviceId}) — got scoped MQTT credentials`);

// 3. Student claims it (this is when the device row first gets an owner).
const { project } = await api('/api/devices/claim', {
  method: 'POST',
  body: { device_id: deviceId, name: 'Smoke Board' },
});
step(`device claimed, project ${project.id}`);

// 5. Device connects over MQTT/TLS.
const device = mqtt.connect({
  host: MQTT_HOST,
  port: MQTT_PORT,
  protocol: 'mqtts',
  rejectUnauthorized: false,
  username: creds.mqtt_username,
  password: creds.mqtt_password,
});
await new Promise((resolve, reject) => {
  device.once('connect', resolve);
  device.once('error', reject);
  setTimeout(() => reject(new Error('MQTT connect timeout')), 10000);
});
step('device connected over MQTT/TLS :8883');

// 5b. ACL: publishing to another device's topic must fail silently (no crash,
// no data). We verify our OWN data flows; foreign topic write is dropped.
device.publish('kokoon/other-device/pub', JSON.stringify({ hacked: 1 }));

// 6. Device publishes an UNKNOWN channel — must be auto-registered as a gauge.
device.publish(`kokoon/${deviceId}/pub`, JSON.stringify({ sensor1: 42 }));
const sensorRow = await waitFor('sensor1 saved + auto-registered', async () => {
  const { channels } = await api(`/api/devices/${deviceId}/state`);
  return channels.find((c) => c.name === 'sensor1' && c.value === 42);
});
if (sensorRow.direction !== 'publish' || sensorRow.widget_type !== 'gauge') {
  throw new Error('auto-registration did not default to publish/gauge');
}
step('unknown channel auto-registered as gauge, value saved unconditionally');

// 7. History was written too.
await waitFor('history row', async () => {
  const { points } = await api(`/api/devices/${deviceId}/channels/sensor1/history?hours=1`);
  return points.some((p) => p.value === 42);
});
step('history row recorded');

// 8. Dashboard-defined listen channel + control write → retained full snapshot.
await api(`/api/devices/${deviceId}/channels`, {
  method: 'POST',
  body: { name: 'led1', widget_type: 'toggle' },
});
step('toggle widget "led1" created (listen direction)');

const snapshots = [];
device.subscribe(`kokoon/${deviceId}/sub`);
device.on('message', (topic, payload) => {
  if (topic === `kokoon/${deviceId}/sub`) {
    try { snapshots.push(JSON.parse(payload.toString())); } catch {}
  }
});

await api(`/api/devices/${deviceId}/channels/led1/value`, { method: 'POST', body: { value: 1 } });
await waitFor('live snapshot with led1=1', async () => snapshots.some((s) => s.led1 === 1));
step('control write delivered to connected device (full snapshot)');

// 9. Retained-message catch-up: a FRESH connection must get the snapshot
// immediately (this is the offline-reconnect path).
const device2 = mqtt.connect({
  host: MQTT_HOST,
  port: MQTT_PORT,
  protocol: 'mqtts',
  rejectUnauthorized: false,
  username: creds.mqtt_username,
  password: creds.mqtt_password,
});
const retained = await new Promise((resolve, reject) => {
  device2.on('connect', () => device2.subscribe(`kokoon/${deviceId}/sub`));
  device2.on('message', (topic, payload) => resolve(JSON.parse(payload.toString())));
  device2.on('error', reject);
  setTimeout(() => reject(new Error('no retained message on reconnect')), 10000);
});
if (retained.led1 !== 1) throw new Error(`retained snapshot wrong: ${JSON.stringify(retained)}`);
step('reconnecting device caught up from retained snapshot');

// 10. CodeLab dropdown endpoint, filtered by direction.
const sendChans = await api(`/api/projects/${project.id}/channels?direction=publish`);
const listenChans = await api(`/api/projects/${project.id}/channels?direction=listen`);
if (!sendChans.channels.some((c) => c.name === 'sensor1')) throw new Error('publish filter broken');
if (!listenChans.channels.some((c) => c.name === 'led1')) throw new Error('listen filter broken');
if (sendChans.channels.some((c) => c.name === 'led1')) throw new Error('direction filter leaked');
step('CodeLab channel dropdown endpoint filters by direction');

// 11. Soft delete removes the channel from the snapshot but keeps history.
await api(`/api/devices/${deviceId}/channels/sensor1`, { method: 'DELETE' });
const { points } = await api(`/api/devices/${deviceId}/channels/sensor1/history?hours=1`);
if (!points.length) throw new Error('soft delete lost history');
step('soft delete keeps history');

console.log('\nSMOKE TEST PASSED');
device.end(true);
device2.end(true);
process.exit(0);
