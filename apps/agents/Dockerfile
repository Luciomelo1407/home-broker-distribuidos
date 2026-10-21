# Build a partir da raiz do repositório (contexto "."), por causa do workspace pnpm.
# Sem etapa de compilação: o Node 24 roda o TypeScript direto (remoção de tipos).
FROM node:24-alpine
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agents/package.json apps/agents/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --prod --filter @bolsa/agents...
COPY packages/contracts/src packages/contracts/src
COPY apps/agents/src apps/agents/src
WORKDIR /src/apps/agents
USER node
CMD ["node", "src/main.ts"]
