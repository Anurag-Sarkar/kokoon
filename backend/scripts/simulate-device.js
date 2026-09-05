// Pretends to be a Brain Board for demos/testing — self-generates a device_id
// (like a real board would from machine.unique_id()), provisions itself, then
// publishes a sine-wave sensor1 every 2s and logs everything it receives on
// its /sub topic.
//
//   node scripts/simulate-device.js [device_id]
//
// Env: API_URL (default http://localhost:8080), MQTT_HOST (default localhost),
//      MQTT_PORT (default 8883).

import crypto from 'node:crypto';
import mqtt from 'mqtt';

const API_URL = process.env.API_URL || 'http://localhost:8080';
const MQTT_HOST = process.env.MQTT_HOST || 'localhost';
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '8883', 10);
const deviceId = process.argv[2] || `kokoon-${crypto.randomBytes(6).toString('hex')}`;

const res = await fetch(`${API_URL}/provision`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ device_id: deviceId }),
});
if (!res.ok) {
  console.error('Provisioning failed:', res.status, await res.text());
  process.exit(1);
}
const creds = await res.json();
console.log(`[sim] provisioned as ${creds.mqtt_username} — claim this device_id on the dashboard to see it`);

const client = mqtt.connect({
  host: MQTT_HOST,
  port: MQTT_PORT,
  protocol: 'mqtts',
  rejectUnauthorized: false, // self-signed Phase 1 broker cert
  username: creds.mqtt_username,
  password: creds.mqtt_password,
});

client.on('connect', () => {
  console.log('[sim] connected over TLS');
  client.subscribe(`kokoon/${deviceId}/sub`);
  let t = 0;
  setInterval(() => {
    const value = Math.round(50 + 45 * Math.sin(t / 5) + Math.random() * 5);
    client.publish(`kokoon/${deviceId}/pub`, JSON.stringify({ sensor1: value }));
    console.log(`[sim] sent sensor1=${value}`);
    t++;
  }, 2000);
});

client.on('message', (topic, payload) => {
  console.log(`[sim] snapshot from server: ${payload.toString()}`);
});
client.on('error', (err) => console.error('[sim] mqtt:', err.message));
