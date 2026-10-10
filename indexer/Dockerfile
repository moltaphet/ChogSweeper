# syntax=docker/dockerfile:1
# Build context is the repository root:  docker build -f indexer/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app/indexer
COPY indexer/package*.json ./
RUN npm ci
COPY indexer/tsconfig*.json ./
COPY indexer/src ./src
RUN npx tsc -p tsconfig.build.json && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production MIGRATIONS_DIR=/app/db/migrations
WORKDIR /app/indexer
COPY --from=build /app/indexer/node_modules ./node_modules
COPY --from=build /app/indexer/dist ./dist
COPY indexer/package.json ./
COPY db /app/db
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
# SIGTERM is handled for graceful shutdown; node runs as PID 1 via exec form.
CMD ["node", "dist/main.js"]
