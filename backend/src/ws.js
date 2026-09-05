// WebSocket cluster — Node `cluster` module, one worker per CPU core.
// Socket.IO + @socket.io/redis-adapter (Redis is also how ingestion updates
// reach the workers). Workers never connect to MQTT for ingestion; they only
// publish retained /sub snapshots on control writes.
//
// The primary distributes RAW, paused TCP connections round-robin to the
// workers before reading a single byte, so every connection (HTTP keep-alive
// and websocket alike) lives wholly inside one worker — no session-affinity
// bookkeeping needed. The dashboard client connects with websocket transport
// only, so connection stickiness == session stickiness.

import cluster from 'node:cluster';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { config } from './config/config.js';
import { ensureSchemaWithRetry } from './config/db.js';
import { createApp } from './app.js';
import { createRedis } from './config/redis.js';
import { setupSocket, bridgeRedisToSockets } from './config/socket.js';

const useTls = config.tlsCertFile && config.tlsKeyFile;

if (cluster.isPrimary) {
  await ensureSchemaWithRetry();

  const workers = [];
  for (let i = 0; i < config.wsWorkers; i++) workers.push(cluster.fork());
  cluster.on('exit', (dead, code) => {
    console.warn(`[ws] worker ${dead.process.pid} exited (${code}) — respawning`);
    const idx = workers.findIndex((w) => w.id === dead.id);
    const fresh = cluster.fork();
    if (idx >= 0) workers[idx] = fresh;
    else workers.push(fresh);
  });

  let next = 0;
  const pickWorker = () => {
    for (let i = 0; i < workers.length; i++) {
      const w = workers[(next + i) % workers.length];
      if (w && !w.isDead()) {
        next = (next + i + 1) % workers.length;
        return w;
      }
    }
    return null;
  };

  // The primary never parses requests (or TLS) — it hands the untouched
  // socket handle to a worker, which owns it for the connection's lifetime.
  const balancer = net.createServer({ pauseOnConnect: true }, (socket) => {
    const worker = pickWorker();
    if (!worker) return socket.destroy();
    worker.send('kokoon:connection', socket, (err) => {
      if (err) socket.destroy();
    });
  });
  balancer.listen(config.port, () => {
    console.log(
      `[ws] primary listening on :${config.port} (${useTls ? 'https/wss' : 'http/ws'}), ${config.wsWorkers} workers`
    );
  });
} else {
  const app = createApp();
  const server = useTls
    ? https.createServer(
        { cert: fs.readFileSync(config.tlsCertFile), key: fs.readFileSync(config.tlsKeyFile) },
        app
      )
    : http.createServer(app);

  // Connections are injected by the primary — this server never listens.
  process.on('message', (msg, socket) => {
    if (msg === 'kokoon:connection' && socket) {
      server.emit('connection', socket);
      socket.resume();
    }
  });

  const io = new Server(server);
  const pubClient = await createRedis();
  const subClient = pubClient.duplicate();
  await subClient.connect();
  io.adapter(createAdapter(pubClient, subClient));

  setupSocket(io);
  await bridgeRedisToSockets(io);

  console.log(`[ws] worker ${process.pid} ready`);
}
