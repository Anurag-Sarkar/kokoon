import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { httpError, ah } from '../util.js';

const DEVICE_ID_RE = /^[a-zA-Z0-9_-]{4,64}$/;

const r = Router();

// Called by the device itself on first boot: device_id is self-generated from
// the board's own silicon unique ID (machine.unique_id()), no factory secret
// involved. The row is created here, on first contact, if it doesn't exist
// yet — the same "auto-register unknown things" pattern used for unknown
// publish channels. Re-callable — rotates the MQTT password every time.
r.post('/', ah(async (req, res) => {
  const deviceId = String(req.body?.device_id || '').trim();
  if (!DEVICE_ID_RE.test(deviceId)) throw httpError(400, 'device_id must be 4-64 chars, letters/numbers/_/-');

  const mqttPassword = crypto.randomBytes(24).toString('base64url');
  await query(
    `INSERT INTO devices (device_id, mqtt_password_hash, provisioned_at)
     VALUES ($1, $2, now())
     ON CONFLICT (device_id)
     DO UPDATE SET mqtt_password_hash = EXCLUDED.mqtt_password_hash, provisioned_at = now()`,
    [deviceId, await bcrypt.hash(mqttPassword, 10)]
  );

  res.json({
    mqtt_username: deviceId,
    mqtt_password: mqttPassword,
    mqtt_port: 8883,
    topics: { pub: `kokoon/${deviceId}/pub`, sub: `kokoon/${deviceId}/sub` },
  });
}));

export default r;
