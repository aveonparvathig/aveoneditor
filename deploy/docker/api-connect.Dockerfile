# Aveon API Connect, serving the editor files of this version as well.
#   docker build -f deploy/docker/api-connect.Dockerfile -t aveon/api-connect:0.1.1 .
#   docker run -p 8080:8080 -v ./api-connect.config.json:/config/api-connect.config.json:ro \
#     -v aveon-api-data:/data -e ACME_JWT_SECRET=… aveon/api-connect:0.1.1
# In the config, use "dataDir": "/data" and "editorDir": "/app/editor".

# 1. The editor's standalone build, from source.
FROM node:22-alpine AS editor
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/aveon-editor/package.json packages/aveon-editor/
COPY packages/collab-server/package.json packages/collab-server/
COPY packages/api-connect/package.json packages/api-connect/
COPY apps/demo/package.json apps/demo/
RUN npm ci -w @aveon/editor --include-workspace-root=false --no-audit --no-fund
COPY packages/aveon-editor packages/aveon-editor
RUN npm run build -w @aveon/editor \
 && VERSION=$(node -p "require('./packages/aveon-editor/package.json').version") \
 && mkdir -p /editor/v$VERSION \
 && cp -r packages/aveon-editor/dist/standalone/. /editor/v$VERSION/ \
 && find /editor -name '*.map' -delete

# 2. API Connect with its one Aveon dependency (the collaboration server) copied in.
FROM node:22-alpine AS api
WORKDIR /src
COPY packages/collab-server ./collab-server
COPY packages/api-connect/package.json ./api-connect/
RUN rm -rf collab-server/node_modules collab-server/test \
 && cd api-connect && npm install --omit=dev --install-links --no-audit --no-fund ../collab-server
COPY packages/api-connect/src ./api-connect/src
COPY packages/api-connect/bin ./api-connect/bin

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=api /src/api-connect /app
COPY --from=editor /editor /app/editor
RUN mkdir -p /data /config && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "bin/aveon-api-connect.js", "--config", "/config/api-connect.config.json"]
