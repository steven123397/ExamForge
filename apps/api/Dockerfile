FROM node:22-bookworm-slim AS node-toolchain

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build
COPY --from=node-toolchain /usr/local/bin/node /usr/local/bin/node
COPY --from=node-toolchain /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY apps/api apps/api
COPY apps/scheduler apps/scheduler
COPY packages/db packages/db
COPY packages/shared packages/shared
RUN npm run build --workspace @examforge/shared \
    && npm run build --workspace @examforge/db \
    && npm run build --workspace @examforge/api \
    && uv sync --project apps/scheduler --python 3.12 --extra dev --frozen \
    && npm prune --omit=dev --workspaces

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS runtime
COPY --from=node-toolchain /usr/local/bin/node /usr/local/bin/node
RUN groupadd --gid 10001 examforge \
    && useradd --uid 10001 --gid 10001 --create-home examforge

WORKDIR /app/apps/api
ENV NODE_ENV=production \
    UV_NO_SYNC=1 \
    UV_OFFLINE=1 \
    UV_CACHE_DIR=/tmp/uv-cache

COPY --from=build --chown=10001:10001 /app/node_modules /app/node_modules
COPY --from=build --chown=10001:10001 /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build --chown=10001:10001 /app/apps/api/dist /app/apps/api/dist
COPY --from=build --chown=10001:10001 /app/apps/scheduler /app/apps/scheduler
COPY --from=build --chown=10001:10001 /app/packages/db/package.json /app/packages/db/package.json
COPY --from=build --chown=10001:10001 /app/packages/db/dist /app/packages/db/dist
COPY --from=build --chown=10001:10001 /app/packages/db/drizzle /app/packages/db/drizzle
COPY --from=build --chown=10001:10001 /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build --chown=10001:10001 /app/packages/shared/dist /app/packages/shared/dist

USER 10001:10001
EXPOSE 4000
CMD ["node", "dist/src/server.js"]
