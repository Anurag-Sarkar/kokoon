import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth } from '../services/auth.js';
import { httpError, ah } from '../util.js';

const r = Router();
r.use(requireAuth);

r.get('/', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT id, device_id, name, created_at FROM projects WHERE student_id = $1 ORDER BY created_at`,
    [req.studentId]
  );
  res.json({ projects: rows });
}));

// CodeLab's dropdown source. Send blocks pass ?direction=publish,
// Listen blocks pass ?direction=listen. Never free text on the CodeLab side.
r.get('/:projectId/channels', ah(async (req, res) => {
  const project = await query(
    `SELECT device_id FROM projects WHERE id = $1 AND student_id = $2`,
    [req.params.projectId, req.studentId]
  );
  if (!project.rowCount) throw httpError(404, 'project not found');

  const { direction } = req.query;
  if (direction && !['publish', 'listen'].includes(direction)) {
    throw httpError(400, 'direction must be publish or listen');
  }
  const { rows } = await query(
    `SELECT name, direction, widget_type
       FROM channels
      WHERE device_id = $1 AND deleted_at IS NULL
        AND ($2::text IS NULL OR direction = $2)
      ORDER BY created_at`,
    [project.rows[0].device_id, direction || null]
  );
  res.json({ channels: rows });
}));

export default r;
