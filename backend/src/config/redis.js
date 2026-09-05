import { createClient } from 'redis';
import { config } from './config.js';

export async function createRedis() {
  const client = createClient({ url: config.redisUrl });
  client.on('error', (err) => console.error('[redis]', err.message));
  await client.connect();
  return client;
}

let pub = null;
// Shared publisher for one-off publishes (e.g. control writes fanning out to dashboards).
export async function getRedisPub() {
  if (!pub) pub = await createRedis();
  return pub;
}
