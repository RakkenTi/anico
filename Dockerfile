# Build the client bundle and the server, then ship both from one small image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
# --ignore-scripts skips better-sqlite3's node-gyp step. The package has a
# binding.gyp with no install script, so npm compiles it by default even
# though a prebuilt binary ships in the tarball; node-gyp then needs Python
# just to configure a build that has nothing to do. Nothing in the client
# build loads the binding, so skipping is free here.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
# Same skip, for the runtime dependency tree. better-sqlite3 loads
# prebuilds/<platform>.node at require time, and ships binaries for linux
# x64 and arm64 on both glibc and musl, so no toolchain is needed at all.
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    CLIENT_DIR=/app/dist/client
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/auth/me').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/server/index.js"]
