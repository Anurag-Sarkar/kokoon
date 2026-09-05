import mqtt from 'mqtt';
import { config } from './config/config.js';
import { query } from './config/db.js';

let client = null;

// Backend-side MQTT connection (superuser credentials). Used by ws workers to
// publish retained /sub snapshots — never by the browser.
export function getMqtt() {
  if (!client) {
    client = mqtt.connect(config.mqttUrl, {
      username: config.mqttBackendUser,
      password: config.mqttBackendPass,
      reconnectPeriod: 2000,
    });
    client.on('error', (err) => console.error('[mqtt]', err.message));
  }
  return client;
}

// Publish the FULL current snapshot of all listen-direction channels for a
// device to kokoon/{id}/sub, retained. Never a partial delta — the retained
// message is what a device catches up from after reconnecting, and a topic
// only ever retains its single most recent message.
export async function publishListenSnapshot(deviceId) {
  const { rows } = await query(
    `SELECT cs.channel_name, cs.value
       FROM channel_state cs
       JOIN channels c
         ON c.device_id = cs.device_id AND c.name = cs.channel_name
      WHERE cs.device_id = $1
        AND c.direction = 'listen'
        AND c.deleted_at IS NULL`,
    [deviceId]
  );
  const snapshot = {};
  for (const row of rows) snapshot[row.channel_name] = row.value;
  await getMqtt().publishAsync(
    `kokoon/${deviceId}/sub`,
    JSON.stringify(snapshot),
    { retain: true, qos: 1 }
  );
}
