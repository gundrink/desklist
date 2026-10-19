# Build from the monorepo root:  docker build -f server/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY app/package.json app/
RUN npm ci --workspace server --include-workspace-root --ignore-scripts
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
RUN npm run build -w server

FROM node:20-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY app/package.json app/
RUN npm ci --workspace server --include-workspace-root --omit=dev --ignore-scripts
COPY --from=build /repo/server/dist server/dist
COPY server/migrations server/migrations
WORKDIR /repo/server
# Railway injects PORT; migrations are idempotent, so run them on boot.
CMD ["sh", "-c", "node dist/migrate.js && node dist/index.js"]
