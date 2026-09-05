import os from 'node:os';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://kokoon:kokoon-dev-password@localhost:5432/kokoon',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  mqttUrl: process.env.MQTT_URL || 'mqtt://localhost:1883',
  mqttBackendUser: process.env.MQTT_BACKEND_USER || 'kokoon-backend',
  mqttBackendPass: process.env.MQTT_BACKEND_PASS || 'change-me-backend-mqtt',
  jwtSecret: process.env.JWT_SECRET || 'change-me-jwt-secret',
  wsWorkers: parseInt(process.env.WS_WORKERS || '0', 10) || os.cpus().length,
  historyRetentionDays: parseInt(process.env.HISTORY_RETENTION_DAYS || '30', 10),
  tlsCertFile: process.env.TLS_CERT_FILE || '',
  tlsKeyFile: process.env.TLS_KEY_FILE || '',
  // Redis pub/sub channel between ingestion and the ws workers.
  updatesChannel: 'device-updates',
};
