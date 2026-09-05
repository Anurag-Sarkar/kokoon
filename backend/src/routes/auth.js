import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { signToken, requireAuth } from '../services/auth.js';
import { httpError, ah } from '../util.js';

const r = Router();

r.post('/register', ah(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) throw httpError(400, 'name, email and password are required');
  if (String(password).length < 6) throw httpError(400, 'password must be at least 6 characters');
  const hash = await bcrypt.hash(String(password), 10);
  const { rows } = await query(
    `INSERT INTO students (name, email, password_hash)
     VALUES ($1, lower($2), $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, name, email`,
    [String(name).trim(), String(email).trim(), hash]
  );
  if (!rows.length) throw httpError(409, 'an account with that email already exists');
  res.json({ token: signToken(rows[0]), student: rows[0] });
}));

r.post('/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await query(
    `SELECT id, name, email, password_hash FROM students WHERE email = lower($1)`,
    [String(email || '').trim()]
  );
  const ok = rows.length && (await bcrypt.compare(String(password || ''), rows[0].password_hash));
  if (!ok) throw httpError(401, 'wrong email or password');
  const { password_hash, ...student } = rows[0];
  res.json({ token: signToken(student), student });
}));

r.get('/me', requireAuth, ah(async (req, res) => {
  const { rows } = await query(`SELECT id, name, email FROM students WHERE id = $1`, [req.studentId]);
  if (!rows.length) throw httpError(401, 'account not found');
  res.json({ student: rows[0] });
}));

export default r;
