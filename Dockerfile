FROM node:22-alpine AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .
ARG VITE_API_URL=/v1
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm build

# Production-only copy of the API: its runtime dependencies, the compiled code and a generated
# Prisma client, without devDependencies or sources of the web app.
FROM build AS api-bundle

RUN pnpm --filter @linea-de-vida/api deploy --prod /out/api \
  && cp -r apps/api/dist /out/api/dist \
  && cd /out/api \
  && node /app/apps/api/node_modules/prisma/build/index.js generate --schema prisma/schema.prisma

FROM node:22-alpine AS api

ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-bundle --chown=node:node /out/api ./
# Owned by `node` so a fresh named volume mounted here is writable.
RUN mkdir -p /var/lib/linea/thumbs && chown -R node:node /var/lib/linea
USER node
CMD ["node", "dist/src/main.js"]

# The web app is plain static files: the build output served by a tiny Caddy. The shared proxy
# still reaches it as `linea-web:3000`.
FROM caddy:2-alpine AS web

COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 3000

# The one-shot migration job and local tooling keep the full workspace.
FROM build AS runtime

ENV NODE_ENV=production
WORKDIR /app

CMD ["node"]
