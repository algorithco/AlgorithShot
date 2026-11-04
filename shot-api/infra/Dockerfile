FROM node:24.13.0-alpine AS base
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shot-api/package.json ./shot-api/package.json
FROM base AS build
RUN pnpm install --frozen-lockfile --filter @algorithco/shot-api
COPY shot-api/src ./shot-api/src
COPY shot-api/tsconfig*.json ./shot-api/
RUN pnpm --dir shot-api build

FROM base AS production-dependencies
RUN pnpm install --prod --frozen-lockfile --filter @algorithco/shot-api

FROM node:24.13.0-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /workspace
# Preserve pnpm's relative links while copying only production packages.
COPY --from=production-dependencies --chown=node:node /workspace/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /workspace/shot-api/node_modules ./shot-api/node_modules
COPY --from=base --chown=node:node /workspace/shot-api/package.json ./shot-api/package.json
COPY --from=build --chown=node:node /workspace/shot-api/dist ./shot-api/dist
COPY --chown=node:node shot-api/README.md ./shot-api/README.md
COPY --chown=node:node shot-api/docs ./shot-api/docs
COPY --chown=node:node shot-api/integration ./shot-api/integration
COPY --chown=node:node LICENSE ./shot-api/LICENSE
WORKDIR /workspace/shot-api
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3000/health',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
