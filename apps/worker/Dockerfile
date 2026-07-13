FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/scheduling-application/package.json packages/scheduling-application/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY apps/worker apps/worker
COPY packages/db packages/db
COPY packages/scheduling-application packages/scheduling-application
COPY packages/shared packages/shared
RUN npm run build --workspace @examforge/shared \
    && npm run build --workspace @examforge/scheduling-application \
    && npm run build --workspace @examforge/db \
    && npm run build --workspace @examforge/worker \
    && npm prune --omit=dev --workspaces

FROM node:22-bookworm-slim AS runtime
RUN groupadd --gid 10003 worker \
    && useradd --uid 10003 --gid 10003 --create-home worker

WORKDIR /app/apps/worker
ENV NODE_ENV=production

COPY --from=build --chown=10003:10003 /app/node_modules /app/node_modules
COPY --from=build --chown=10003:10003 /app/apps/worker/package.json /app/apps/worker/package.json
COPY --from=build --chown=10003:10003 /app/apps/worker/dist /app/apps/worker/dist
COPY --from=build --chown=10003:10003 /app/packages/db/package.json /app/packages/db/package.json
COPY --from=build --chown=10003:10003 /app/packages/db/dist /app/packages/db/dist
COPY --from=build --chown=10003:10003 /app/packages/scheduling-application/package.json /app/packages/scheduling-application/package.json
COPY --from=build --chown=10003:10003 /app/packages/scheduling-application/dist /app/packages/scheduling-application/dist
COPY --from=build --chown=10003:10003 /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build --chown=10003:10003 /app/packages/shared/dist /app/packages/shared/dist

USER 10003:10003
EXPOSE 4010
CMD ["node", "dist/main.js"]
