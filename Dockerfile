FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
# Keep production modules and the official CLI; remove build-only packages.
RUN pnpm install --prod --frozen-lockfile

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git bash ripgrep libstdc++6 libgcc-s1 tar tzdata locales \
  && sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen \
  && locale-gen \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 polar \
  && useradd --uid 10001 --gid polar --create-home --home-dir /home/polar --shell /bin/bash polar \
  && mkdir -p /data /workspaces /claude-config/.claude /claude-config/home /home/polar \
  && chmod 0700 /data /workspaces /claude-config /claude-config/.claude /claude-config/home /home/polar \
  && chown -R 10001:10001 /data /workspaces /claude-config /home/polar

WORKDIR /app
COPY --from=build --chown=10001:10001 /app/package.json ./package.json
COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --from=build --chown=10001:10001 /app/dist-server ./dist-server
COPY --chown=10001:10001 scripts/backup-data.mjs ./scripts/backup-data.mjs

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    API_PORT=3000 \
    WEB_ROOT=/app/dist \
    DATA_DIR=/data \
    DB_PATH=/data/claude-workspace.sqlite \
    WORKSPACES_DIR=/workspaces \
    CLAUDE_CONFIG_DIR=/claude-config/.claude \
    CLAUDE_HOME=/claude-config/home \
    CLAUDE_BIN=/app/node_modules/.bin/claude \
    DISABLE_AUTOUPDATER=1 \
    SESSION_COOKIE_SECURE=1 \
    PATH=/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

USER 10001:10001
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/_app/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist-server/server/index.js"]
