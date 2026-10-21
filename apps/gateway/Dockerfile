# Build a partir da raiz do repositório (contexto "."), por causa do workspace pnpm.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/gateway/package.json apps/gateway/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter @bolsa/gateway...
COPY packages/contracts packages/contracts
COPY apps/gateway apps/gateway
RUN pnpm --filter @bolsa/gateway build \
 && pnpm --filter @bolsa/gateway deploy --legacy --prod /app

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /src/apps/gateway/dist dist
USER node
CMD ["node", "dist/main.js"]
