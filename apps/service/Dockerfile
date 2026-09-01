FROM node:24.19.0-bookworm-slim AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/service/package.json apps/service/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --filter @memoryos/service... --filter @memoryos/web... --frozen-lockfile

COPY apps/service apps/service
COPY apps/web apps/web
RUN pnpm --filter @memoryos/web build && pnpm --filter @memoryos/service build
RUN pnpm --filter @memoryos/service deploy --prod --legacy /prod/service

FROM node:24.19.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /prod/service/dist ./dist
COPY --from=build /prod/service/package.json ./package.json
COPY --from=build /prod/service/node_modules ./node_modules
COPY --from=build /workspace/apps/web/dist ./public

USER node
EXPOSE 7310
CMD ["node", "dist/main.js"]
