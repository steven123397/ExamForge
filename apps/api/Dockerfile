FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY apps/api apps/api
COPY packages/db packages/db
COPY packages/shared packages/shared
RUN npm run build --workspace @examforge/shared \
    && npm run build --workspace @examforge/db \
    && npm run build --workspace @examforge/api \
    && npm prune --omit=dev --workspaces

FROM node:22-bookworm-slim AS runtime
RUN groupadd --gid 10001 examforge \
    && useradd --uid 10001 --gid 10001 --create-home examforge

WORKDIR /app/apps/api
ENV NODE_ENV=production

COPY --from=build --chown=10001:10001 /app/node_modules /app/node_modules
COPY --from=build --chown=10001:10001 /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build --chown=10001:10001 /app/apps/api/dist /app/apps/api/dist
COPY --from=build --chown=10001:10001 /app/packages/db/package.json /app/packages/db/package.json
COPY --from=build --chown=10001:10001 /app/packages/db/dist /app/packages/db/dist
COPY --from=build --chown=10001:10001 /app/packages/db/drizzle /app/packages/db/drizzle
COPY --from=build --chown=10001:10001 /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build --chown=10001:10001 /app/packages/shared/dist /app/packages/shared/dist

USER 10001:10001
EXPOSE 4000
CMD ["node", "dist/src/server.js"]
