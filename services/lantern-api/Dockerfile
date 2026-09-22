# Lantern API — the explainer proxy (services/lantern-api). Built from the
# repo root so @lantern/scanner and @stellar/stellar-sdk resolve from the root
# node_modules at runtime (the service bundle keeps packages external).
FROM node:22-slim AS build
WORKDIR /app
# node:22's bundled npm 10 rejects esbuild 0.28's optional `openharmony`
# platform package outright (EBADPLATFORM) instead of skipping it; npm 11
# skips it as an optional dep should be.
RUN npm install -g npm@11 --no-audit --no-fund
COPY package.json package-lock.json ./
COPY packages/lantern-scanner/package.json packages/lantern-scanner/package.json
RUN npm ci --omit=dev --ignore-scripts
COPY packages/lantern-scanner packages/lantern-scanner
# The telemetry validator is shared with the wallet (src/core/telemetry).
COPY src/core/telemetry src/core/telemetry
COPY services/lantern-api services/lantern-api
RUN cd services/lantern-api && npm ci --ignore-scripts && npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/services/lantern-api/node_modules services/lantern-api/node_modules
COPY --from=build /app/services/lantern-api/package.json services/lantern-api/package.json
COPY --from=build /app/services/lantern-api/dist services/lantern-api/dist
USER node
EXPOSE 8080
CMD ["node", "services/lantern-api/dist/index.js"]
