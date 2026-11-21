# syntax=docker/dockerfile:1
# Production image for Chibi Outbreak. One process serves the client build and the game WebSocket.

ARG NODE_IMAGE=node:26.13.1-trixie-slim

# --- build: typecheck + Vite client build ---
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run typecheck && npm run build

# --- runtime deps: production deps plus tsx, which `npm start` uses to run the TypeScript server ---
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && TSX_VERSION="$(node -p "require('./package.json').devDependencies.tsx")" \
 && mkdir /tmp/tsx && cd /tmp/tsx \
 && npm install --no-save --no-package-lock --no-audit --no-fund "tsx@${TSX_VERSION}" \
 && cp -R node_modules/. /app/node_modules/ \
 && rm -rf /tmp/tsx

# --- runtime ---
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
# The server imports the shared sim code (protocol, constants, chapters) straight from source.
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "--import", "tsx", "server/index.ts"]
