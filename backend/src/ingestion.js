// Ingestion process — exactly ONE instance, never clustered or scaled.
//
// Holds a single persistent MQTT subscription to kokoon/+/pub (wildcard —
// covers every device automatically, present and future; no per-device
// setup). On every message: save to Postgres, then publish to Redis.
// The save is unconditional — it happens whether or not any dashboard is
// open. Broadcast is best-effort; save is not.

import mqtt from 'mqtt';
import { config } from './config/config.js';
import { ensureSchemaWithRetry, query, pool } from './config/db.js';
import { createRedis } from './config/redis.js';
import { recordPublish, NAME_RE } from './services/channels.js';

const PUB_TOPIC_RE = /^kokoon\/([^/]+)\/pub$/;

await ensureSchemaWithRetry();
const redisPub = await createRedis();

const client = mqtt.connect(config.mqttUrl, {
  username: config.mqttBackendUser,
  password: config.mqttBackendPass,
  reconnectPeriod: 2000,
  clientId: 'kokoon-ingestion',
});

client.on('connect', () => {
  client.subscribe('kokoon/+/pub', { qos: 1 }, (err) => {
    if (err) console.error('[ingestion] subscribe failed:', err.message);
    else console.log('[ingestion] subscribed to kokoon/+/pub');
  });
});
client.on('error', (err) => console.error('[ingestion] mqtt:', err.message));

client.on('message', async (topic, payload) => {
  const match = topic.match(PUB_TOPIC_RE);
  if (!match) return;
  const deviceId = match[1];

  let data;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    console.warn(`[ingestion] ${deviceId}: dropped non-JSON payload`);
    return;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    console.warn(`[ingestion] ${deviceId}: dropped non-object payload`);
    return;
  }

  try {
    // One publish may batch several channel updates in a single payload.
    for (const [name, value] of Object.entries(data)) {
      if (!NAME_RE.test(name)) {
        console.warn(`[ingestion] ${deviceId}: skipped invalid channel name "${name}"`);
        continue;
      }
      await recordPublish(deviceId, name, value);
      await redisPub.publish(
        config.updatesChannel,
        JSON.stringify({ deviceId, name, value, ts: Date.now() })
      );
    }
    query(`UPDATE devices SET last_seen_at = now() WHERE device_id = $1`, [deviceId]).catch(() => {});
  } catch (err) {
    console.error(`[ingestion] ${deviceId}: save failed:`, err.message);
  }
});

// Nightly history TTL (runs at boot, then every 24h).
async function pruneHistory() {
  try {
    const { rowCount } = await query(
      `DELETE FROM channel_history WHERE recorded_at < now() - make_interval(days => $1)`,
      [config.historyRetentionDays]
    );
    if (rowCount) console.log(`[ingestion] pruned ${rowCount} history rows older than ${config.historyRetentionDays}d`);
  } catch (err) {
    console.error('[ingestion] history prune failed:', err.message);
  }
}
pruneHistory();
setInterval(pruneHistory, 24 * 60 * 60 * 1000);

async function shutdown() {
  console.log('[ingestion] shutting down');
  try { client.end(true); } catch {}
  try { await redisPub.quit(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
