import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth, requireDeviceOwnership } from '../services/auth.js';
import { httpError, ah } from '../util.js';
import {
  listChannels,
  getDeviceState,
  createChannel,
  softDeleteChannel,
  getHistory,
  controlChannel,
} from '../services/channels.js';

const r = Router();
r.use(requireAuth);

r.get('/', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT d.device_id, d.name, d.claimed_at, d.provisioned_at, d.last_seen_at, p.id AS project_id
       FROM devices d
       LEFT JOIN LATERAL (
         SELECT id FROM projects
          WHERE device_id = d.device_id AND student_id = d.student_id
          ORDER BY created_at LIMIT 1
       ) p ON true
      WHERE d.student_id = $1
      ORDER BY d.claimed_at DESC`,
    [req.studentId]
  );
  res.json({ devices: rows });
}));

// Claim links a manufactured device_id (from the QR code) to the student.
r.post('/claim', ah(async (req, res) => {
  const deviceId = String(req.body?.device_id || '').trim();
  if (!deviceId) throw httpError(400, 'device_id is required');

  const found = await query(`SELECT device_id, student_id FROM devices WHERE device_id = $1`, [deviceId]);
  if (!found.rowCount) throw httpError(404, 'device not found — check the ID on your Brain Board');
  const owner = found.rows[0].student_id;
  if (owner && owner !== req.studentId) throw httpError(409, 'this device is already claimed by another student');

  const name = String(req.body?.name || '').trim() || `My Brain Board`;
  const { rows } = await query(
    `UPDATE devices
        SET student_id = $2, claimed_at = COALESCE(claimed_at, now()), name = $3
      WHERE device_id = $1
      RETURNING device_id, name, claimed_at`,
    [deviceId, req.studentId, name]
  );

  // Every claimed device gets a default project — this is the id CodeLab
  // uses for its block dropdowns.
  await query(
    `INSERT INTO projects (student_id, device_id, name)
     SELECT $1, $2, $3
      WHERE NOT EXISTS (SELECT 1 FROM projects WHERE student_id = $1 AND device_id = $2)`,
    [req.studentId, deviceId, `${name} project`]
  );
  const project = await query(
    `SELECT id, name FROM projects WHERE student_id = $1 AND device_id = $2 ORDER BY created_at LIMIT 1`,
    [req.studentId, deviceId]
  );

  res.json({ device: rows[0], project: project.rows[0] });
}));

r.get('/:deviceId/channels', requireDeviceOwnership, ah(async (req, res) => {
  res.json({ channels: await listChannels(req.params.deviceId) });
}));

r.post('/:deviceId/channels', requireDeviceOwnership, ah(async (req, res) => {
  const { name, widget_type } = req.body || {};
  const channel = await createChannel(req.params.deviceId, String(name || '').trim(), widget_type);
  res.status(201).json({ channel });
}));

r.delete('/:deviceId/channels/:name', requireDeviceOwnership, ah(async (req, res) => {
  await softDeleteChannel(req.params.deviceId, req.params.name);
  res.json({ ok: true });
}));

r.get('/:deviceId/state', requireDeviceOwnership, ah(async (req, res) => {
  res.json({
    device: req.device,
    channels: await getDeviceState(req.params.deviceId),
  });
}));

r.get('/:deviceId/channels/:name/history', requireDeviceOwnership, ah(async (req, res) => {
  res.json({ points: await getHistory(req.params.deviceId, req.params.name, req.query.hours) });
}));

r.post('/:deviceId/channels/:name/value', requireDeviceOwnership, ah(async (req, res) => {
  await controlChannel(req.params.deviceId, req.params.name, req.body?.value);
  res.json({ ok: true });
}));

export default r;
