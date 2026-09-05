import { io } from 'socket.io-client';
import { getToken } from './api.js';

// websocket transport only — one TCP connection per session keeps routing
// simple across the clustered ws workers.
export function connectSocket() {
  return io('/', { transports: ['websocket'], auth: { token: getToken() } });
}
