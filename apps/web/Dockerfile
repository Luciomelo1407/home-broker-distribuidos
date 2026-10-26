# Build a partir da raiz do repositório (contexto "."), por causa do workspace pnpm.
# O Home Broker é exportação estática (regra 3.3.4): o contêiner só serve arquivos.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter @bolsa/web...
COPY packages/contracts packages/contracts
COPY apps/web apps/web
# Vazio: o navegador usa o mesmo host da página, porta 3001 (api/config.ts)
ARG NEXT_PUBLIC_GATEWAY_URL=
ENV NEXT_PUBLIC_GATEWAY_URL=$NEXT_PUBLIC_GATEWAY_URL
RUN pnpm --filter @bolsa/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/out /usr/share/nginx/html
