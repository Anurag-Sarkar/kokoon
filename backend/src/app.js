import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import authRoutes from './routes/auth.js';
import deviceRoutes from './routes/devices.js';
import projectRoutes from './routes/projects.js';
import provisionRoutes from './routes/provision.js';
import mqttAuthRoutes from './routes/mqttAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false })); // mosquitto-go-auth posts form-encoded

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);
  app.use('/api/devices', deviceRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/provision', provisionRoutes); // device-facing, no student auth
  app.use('/mqtt', mqttAuthRoutes);       // broker-facing (docker network)

  // Dashboard static bundle: baked into the image at /app/public in Docker,
  // ../frontend/dist when running from the repo.
  const staticDir = [
    path.resolve(__dirname, '../public'),
    path.resolve(__dirname, '../../frontend/dist'),
  ].find((p) => fs.existsSync(path.join(p, 'index.html')));
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('*', (req, res, next) => {
      if (/^\/(api|mqtt|provision|socket\.io)\b/.test(req.path)) return next();
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ error: err.message || 'server error' });
  });

  return app;
}
