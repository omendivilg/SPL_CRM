FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY mobile/package.json ./mobile/package.json
RUN npm ci
COPY . .
RUN npm run build && npm run build:server:production

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY package.json package-lock.json ./
COPY mobile/package.json ./mobile/package.json
RUN npm ci --omit=dev --workspaces=false
COPY --from=build /app/dist ./dist
COPY --from=build /app/build-server ./build-server
COPY server/db/migrations ./server/db/migrations
EXPOSE 3001
CMD ["node", "build-server/server/index.js"]
