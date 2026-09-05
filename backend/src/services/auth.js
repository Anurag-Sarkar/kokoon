import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { query } from '../config/db.js';
import { httpError, ah } from '../util.js';

export function signToken(student) {
  return jwt.sign({ sub: student.id, name: student.name, email: student.email }, config.jwtSecret, {
    expiresIn: '30d',
  });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(httpError(401, 'sign in to continue'));
  try {
    const payload = verifyToken(token);
    req.studentId = payload.sub;
    next();
  } catch {
    next(httpError(401, 'session expired — sign in again'));
  }
}

// Guards /devices/:deviceId/* — the device must be claimed by this student.
export const requireDeviceOwnership = ah(async (req, res, next) => {
  const { rows } = await query(
    `SELECT device_id, name, last_seen_at FROM devices
      WHERE device_id = $1 AND student_id = $2`,
    [req.params.deviceId, req.studentId]
  );
  if (!rows.length) throw httpError(404, 'device not found on your account');
  req.device = rows[0];
  next();
});
