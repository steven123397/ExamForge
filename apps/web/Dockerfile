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

COPY apps/web apps/web
COPY packages/shared packages/shared
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN npm run build --workspace @examforge/shared \
    && npm run build --workspace @examforge/web

FROM node:22.22.2-bookworm-slim AS runtime
ARG SOURCE_REVISION=unknown
ARG SOURCE_URL=unknown
ARG SOURCE_CREATED_AT=1970-01-01T00:00:00Z
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
COPY scripts/release/upgrade-debian.sh /tmp/upgrade-debian.sh
RUN sh /tmp/upgrade-debian.sh \
    && rm -f /tmp/upgrade-debian.sh \
    && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
LABEL org.opencontainers.image.title="ExamForge Web" \
    org.opencontainers.image.source="${SOURCE_URL}" \
    org.opencontainers.image.revision="${SOURCE_REVISION}" \
    org.opencontainers.image.created="${SOURCE_CREATED_AT}" \
    io.examforge.public-origin="${NEXT_PUBLIC_API_BASE_URL}"

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static /app/apps/web/.next/static

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
