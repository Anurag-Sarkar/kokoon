import { query } from '../config/db.js';
import { getRedisPub } from '../config/redis.js';
import { publishListenSnapshot } from '../mqttClient.js';
import { config } from '../config/config.js';
import { httpError } from '../util.js';

// Widget type determines direction, permanently.
export const WIDGET_DIRECTION = {
  gauge: 'publish',
  chart: 'publish',
  toggle: 'listen',
  slider: 'listen',
};

// Channel names double as CodeLab identifiers.
export const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/;

export async function listChannels(deviceId) {
  const { rows } = await query(
    `SELECT name, direction, widget_type, created_at
       FROM channels
      WHERE device_id = $1 AND deleted_at IS NULL
      ORDER BY created_at`,
    [deviceId]
  );
  return rows;
}

// Active channels joined with their current value — the dashboard's page-load snapshot.
export async function getDeviceState(deviceId) {
  const { rows } = await query(
    `SELECT c.name, c.direction, c.widget_type, cs.value, cs.updated_at
       FROM channels c
       LEFT JOIN channel_state cs
         ON cs.device_id = c.device_id AND cs.channel_name = c.name
      WHERE c.device_id = $1 AND c.deleted_at IS NULL
      ORDER BY c.created_at`,
    [deviceId]
  );
  return rows;
}

export async function createChannel(deviceId, name, widgetType) {
  const direction = WIDGET_DIRECTION[widgetType];
  if (!direction) throw httpError(400, `widget_type must be one of: ${Object.keys(WIDGET_DIRECTION).join(', ')}`);
  if (!NAME_RE.test(name || '')) {
    throw httpError(400, 'channel name must start with a letter and use only letters, numbers and _ (max 32 chars)');
  }

  const existing = await query(
    `SELECT deleted_at FROM channels WHERE device_id = $1 AND name = $2`,
    [deviceId, name]
  );
  if (existing.rowCount && existing.rows[0].deleted_at === null) {
    throw httpError(409, `a widget named "${name}" already exists on this device`);
  }

  // New channel, or revival of a soft-deleted one (history is preserved).
  const { rows } = await query(
    `INSERT INTO channels (device_id, name, direction, widget_type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (device_id, name)
     DO UPDATE SET direction = EXCLUDED.direction,
                   widget_type = EXCLUDED.widget_type,
                   deleted_at = NULL
     RETURNING name, direction, widget_type, created_at`,
    [deviceId, name, direction, widgetType]
  );

  if (direction === 'listen') {
    // Seed a value so the retained snapshot always covers every listen channel.
    await query(
      `INSERT INTO channel_state (device_id, channel_name, value)
       VALUES ($1, $2, '0'::jsonb)
       ON CONFLICT (device_id, channel_name) DO NOTHING`,
      [deviceId, name]
    );
    await publishListenSnapshot(deviceId);
  }
  return rows[0];
}

export async function softDeleteChannel(deviceId, name) {
  const { rows } = await query(
    `UPDATE channels SET deleted_at = now()
      WHERE device_id = $1 AND name = $2 AND deleted_at IS NULL
      RETURNING direction`,
    [deviceId, name]
  );
  if (!rows.length) throw httpError(404, 'channel not found');
  // Removing a listen channel changes the device's full snapshot.
  if (rows[0].direction === 'listen') await publishListenSnapshot(deviceId);
}

export async function getHistory(deviceId, name, hours = 24) {
  const h = Math.min(Math.max(parseInt(hours, 10) || 24, 1), 24 * 30);
  const { rows } = await query(
    `SELECT value, (extract(epoch FROM recorded_at) * 1000)::bigint AS ts
       FROM channel_history
      WHERE device_id = $1 AND channel_name = $2
        AND recorded_at > now() - make_interval(hours => $3)
      ORDER BY recorded_at DESC
      LIMIT 2000`,
    [deviceId, name, h]
  );
  return rows.reverse();
}

// Dashboard → device. Verifies direction, persists state, publishes the full
// retained snapshot to MQTT, and fans the update out to open dashboards.
export async function controlChannel(deviceId, name, value) {
  if (!['number', 'boolean', 'string'].includes(typeof value)) {
    throw httpError(400, 'value must be a number, boolean or string');
  }
  const { rows } = await query(
    `SELECT direction FROM channels
      WHERE device_id = $1 AND name = $2 AND deleted_at IS NULL`,
    [deviceId, name]
  );
  if (!rows.length) throw httpError(404, 'channel not found');
  if (rows[0].direction !== 'listen') throw httpError(400, 'this channel is device → dashboard (read-only)');

  await query(
    `INSERT INTO channel_state (device_id, channel_name, value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (device_id, channel_name)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [deviceId, name, JSON.stringify(value)]
  );
  await publishListenSnapshot(deviceId);

  // Keep every open dashboard for this device in sync (same path as sensor data).
  const pub = await getRedisPub();
  await pub.publish(
    config.updatesChannel,
    JSON.stringify({ deviceId, name, value, ts: Date.now() })
  );
}

// Device → server, called by the ingestion process for every channel in a
// payload. Unconditional save; auto-registers unknown publish channels as a
// gauge so a student who codes before opening the dashboard loses nothing.
export async function recordPublish(deviceId, name, value) {
  const json = JSON.stringify(value);
  await query(
    `INSERT INTO channels (device_id, name, direction, widget_type)
     VALUES ($1, $2, 'publish', 'gauge')
     ON CONFLICT (device_id, name) DO NOTHING`,
    [deviceId, name]
  );
  await query(
    `INSERT INTO channel_state (device_id, channel_name, value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (device_id, channel_name)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [deviceId, name, json]
  );
  await query(
    `INSERT INTO channel_history (device_id, channel_name, value)
     VALUES ($1, $2, $3::jsonb)`,
    [deviceId, name, json]
  );
}
