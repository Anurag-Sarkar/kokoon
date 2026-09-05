import { verifyToken } from '../services/auth.js';
import { query } from './db.js';
import { createRedis } from './redis.js';
import { config } from './config.js';
import { controlChannel } from '../services/channels.js';

const room = (deviceId) => `device:${deviceId}`;

async function ownsDevice(studentId, deviceId) {
  const { rowCount } = await query(
    `SELECT 1 FROM devices WHERE device_id = $1 AND student_id = $2`,
    [deviceId, studentId]
  );
  return rowCount > 0;
}

export function setupSocket(io) {
  io.use((socket, next) => {
    try {
      const payload = verifyToken(socket.handshake.auth?.token);
      socket.data.studentId = payload.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    // Dashboard joins a room keyed by device_id after page-load snapshot;
    // from here on it only listens — it never polls.
    socket.on('join', async (deviceId, ack) => {
      try {
        if (!(await ownsDevice(socket.data.studentId, deviceId))) {
          return ack?.({ error: 'device not found on your account' });
        }
        await socket.join(room(deviceId));
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ error: err.message });
      }
    });

    // Control writes may also arrive over the open socket (same handler as HTTP).
    socket.on('control', async ({ deviceId, name, value } = {}, ack) => {
      try {
        if (!(await ownsDevice(socket.data.studentId, deviceId))) {
          return ack?.({ error: 'device not found on your account' });
        }
        await controlChannel(deviceId, name, value);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ error: err.message });
      }
    });
    // Disconnects: Socket.IO removes the socket from its rooms automatically.
  });
}

// Every worker subscribes to the ingestion fan-out channel. Each worker
// independently checks its own local room membership for the device — if it
// holds a socket in that room it emits, otherwise no-op. No coordinator.
export async function bridgeRedisToSockets(io) {
  const sub = await createRedis();
  await sub.subscribe(config.updatesChannel, (message) => {
    let update;
    try {
      update = JSON.parse(message);
    } catch {
      return;
    }
    const target = room(update.deviceId);
    if (io.sockets.adapter.rooms.has(target)) {
      // .local — this worker emits only to its own sockets; other workers
      // received the same Redis message and handle their own.
      io.local.to(target).emit('channel:update', update);
    }
  });
}
