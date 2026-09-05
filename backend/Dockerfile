# One image for BOTH the ingestion process and the ws cluster —
# docker-compose picks the entry point via `command:`.
# Build context is the repo root (see docker-compose.yml) so the dashboard
# build can be baked into the image the ws workers serve from.

FROM node:20-alpine AS frontend
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./
COPY --from=frontend /frontend/dist ./public
EXPOSE 3000
CMD ["node", "src/ws.js"]
