import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_LOCK = 727272001;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

export function query(text, params) {
  return pool.query(text, params);
}

export async function ensureSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    // Serialize schema application across processes/workers booting at once.
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
    await client.query(sql);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]).catch(() => {});
    client.release();
  }
}

// Containers race on boot even with depends_on — retry until Postgres is up.
export async function ensureSchemaWithRetry(attempts = 30, delayMs = 2000) {
  for (let i = 1; ; i++) {
    try {
      await ensureSchema();
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      console.warn(`[db] schema apply failed (attempt ${i}/${attempts}): ${err.message} — retrying`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
