import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { config } from '../config/config.js';
import { ah } from '../util.js';

// Broker ACL backend. mosquitto-go-auth (http backend, form params, status
// response mode) POSTs here for every connect / publish / subscribe.
// 2xx = allow, anything else = deny.
//
// Mosquitto access-intent codes sent in `acc`:
const ACC_READ = 1;
const ACC_WRITE = 2;
const ACC_SUBSCRIBE = 4;

const r = Router();

r.post('/user', ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).end();

  if (username === config.mqttBackendUser) {
    if (password === config.mqttBackendPass) return res.status(200).end();
    console.warn(`[mqtt-auth] rejected backend account "${username}": wrong password`);
    return res.status(401).end();
  }

  // Devices authenticate as their device_id with provisioned credentials.
  const { rows } = await query(
    `SELECT mqtt_password_hash FROM devices WHERE device_id = $1`,
    [username]
  );
  if (!rows.length) {
    console.warn(`[mqtt-auth] rejected "${username}": no such device_id in devices table`);
    return res.status(401).end();
  }
  if (!rows[0].mqtt_password_hash) {
    console.warn(`[mqtt-auth] rejected "${username}": device has never called /provision`);
    return res.status(401).end();
  }
  const ok = await bcrypt.compare(String(password), rows[0].mqtt_password_hash);
  if (!ok) console.warn(`[mqtt-auth] rejected "${username}": password does not match (stale/re-provisioned?)`);
  res.status(ok ? 200 : 401).end();
}));

r.post('/superuser', ah(async (req, res) => {
  // Backend services bypass topic ACLs; devices never do.
  res.status(req.body?.username === config.mqttBackendUser ? 200 : 401).end();
}));

r.post('/acl', ah(async (req, res) => {
  const { username, topic } = req.body || {};
  const acc = parseInt(req.body?.acc, 10);
  if (!username || !topic) return res.status(400).end();

  // A device may only: write its own /pub, read+subscribe its own /sub.
  // One device can never see another's traffic.
  const canPublish = topic === `kokoon/${username}/pub` && acc === ACC_WRITE;
  const canListen =
    topic === `kokoon/${username}/sub` && (acc === ACC_READ || acc === ACC_SUBSCRIBE);
  res.status(canPublish || canListen ? 200 : 403).end();
}));

export default r;
