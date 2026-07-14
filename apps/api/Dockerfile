FROM node:22.22.2-bookworm-slim AS build

ARG NPM_VERSION=12.0.1
ENV PATH="/opt/npm12/bin:${PATH}"

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/scheduling-application/package.json packages/scheduling-application/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install --global --prefix /opt/npm12 --ignore-scripts --no-fund --no-audit "npm@${NPM_VERSION}" \
    && /opt/npm12/bin/npm ci

COPY apps/api apps/api
COPY packages/db packages/db
COPY packages/scheduling-application packages/scheduling-application
COPY packages/shared packages/shared
RUN npm run build --workspace @examforge/shared \
    && npm run build --workspace @examforge/scheduling-application \
    && npm run build --workspace @examforge/db \
    && npm run build --workspace @examforge/api

FROM build AS production-dependencies
RUN npm ci --omit=dev --workspace @examforge/api --include-workspace-root=false --no-fund --no-audit

FROM node:22.22.2-bookworm-slim AS runtime
ARG SOURCE_REVISION=unknown
ARG SOURCE_URL=unknown
ARG SOURCE_CREATED_AT=1970-01-01T00:00:00Z
RUN apt-get update \
    && apt-get upgrade --yes \
    && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && groupadd --gid 10001 examforge \
    && useradd --uid 10001 --gid 10001 --create-home examforge

WORKDIR /app/apps/api
ENV NODE_ENV=production
LABEL org.opencontainers.image.title="ExamForge API" \
    org.opencontainers.image.source="${SOURCE_URL}" \
    org.opencontainers.image.revision="${SOURCE_REVISION}" \
    org.opencontainers.image.created="${SOURCE_CREATED_AT}"

COPY --from=production-dependencies --chown=10001:10001 /app/node_modules /app/node_modules
COPY --from=build --chown=10001:10001 /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build --chown=10001:10001 /app/apps/api/dist /app/apps/api/dist
COPY --from=build --chown=10001:10001 /app/packages/db/package.json /app/packages/db/package.json
COPY --from=build --chown=10001:10001 /app/packages/db/dist /app/packages/db/dist
COPY --from=build --chown=10001:10001 /app/packages/db/drizzle /app/packages/db/drizzle
COPY --from=build --chown=10001:10001 /app/packages/scheduling-application/package.json /app/packages/scheduling-application/package.json
COPY --from=build --chown=10001:10001 /app/packages/scheduling-application/dist /app/packages/scheduling-application/dist
COPY --from=build --chown=10001:10001 /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build --chown=10001:10001 /app/packages/shared/dist /app/packages/shared/dist

USER 10001:10001
EXPOSE 4000
CMD ["node", "dist/src/server.js"]
