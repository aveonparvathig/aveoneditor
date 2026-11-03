# Aveon collaboration server.
#   docker build -f deploy/docker/collab-server.Dockerfile -t aveon/collab-server:0.1.0 .
#   docker run -p 1234:1234 -e AVEON_COLLAB_WORKERS=4 -e AVEON_COLLAB_POSTGRES=postgres://… aveon/collab-server:0.1.0
# Storage comes from the environment: AVEON_COLLAB_POSTGRES, AVEON_COLLAB_MSSQL, AVEON_COLLAB_MYSQL,
# or AVEON_COLLAB_DATA (a mounted folder; one container only). Nothing set = memory only.
FROM node:22-alpine AS build
WORKDIR /app
COPY packages/collab-server/package.json ./
# Database drivers for the shared-storage options; DRIVERS="" builds a smaller image without them.
ARG DRIVERS="pg mssql mysql2"
RUN npm install --omit=dev --no-audit --no-fund && if [ -n "$DRIVERS" ]; then npm install --omit=dev --no-save --no-audit --no-fund $DRIVERS; fi
COPY packages/collab-server/src ./src
COPY packages/collab-server/bin ./bin

FROM node:22-alpine
ENV NODE_ENV=production PORT=1234 AVEON_COLLAB_WORKERS=1
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 1234
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
# SIGTERM makes every process save its open documents before exiting.
STOPSIGNAL SIGTERM
CMD ["node", "bin/aveon-collab.js"]
