# Production deployment

Production runs three long-lived services: PostgreSQL, the NestJS API (which also runs the sync scheduler) and the web application, a static build (React + Vite) served by a small Caddy image. The `migrate` service is a one-shot Prisma migration gate; the API starts only after it completes successfully.

The app is served at `https://linea-de-vida.hidan.es`. Public traffic and HTTPS are handled by a shared Caddy reverse proxy that lives in `/srv/proxy` on the VPS, outside this repository.

## Prerequisites

- Docker Engine with Docker Compose v2 on the VPS.
- A clone at the deployment path configured with a read-only GitHub deploy key for `origin`.
- The shared Caddy proxy (`/srv/proxy`, outside this repo) running and attached to the external Docker network `proxy`. That network must exist before `docker compose up`; Compose fails otherwise.
- Public DNS for `PUBLIC_DOMAIN` must resolve to the VPS. Only the shared proxy publishes ports 80 and 443; this stack publishes no host ports.
- A Google OAuth web client whose production redirect URIs match the HTTPS public API origin.

## Environment

Copy `.env.production.example` to `.env` on the VPS and replace every placeholder. Never commit `.env` or copy it into an image. PostgreSQL uses the service DNS name `postgres` and are intentionally not published to host ports.

The API rejects production configuration unless public origins and Google callbacks are HTTPS, secrets are non-placeholder values, the encryption key decodes to exactly 32 bytes, and `METRICS_TOKEN` is present.

Set `PUBLIC_DOMAIN` to `linea-de-vida.hidan.es` and the API/web origins and OAuth callbacks to HTTPS origins for that hostname.

## Reverse proxy

The shared Caddy proxy reaches this stack through the external `proxy` network using two network aliases:

| Alias       | Service | Port |
| ----------- | ------- | ---- |
| `linea-api` | `api`   | 3001 |
| `linea-web` | `web`   | 3000 |

Caddy routes `/v1/` to `linea-api:3001` and every other path to `linea-web:3000`, and obtains and renews TLS certificates automatically. Only `api` and `web` join the `proxy` network; PostgreSQL and migrate stay on the private `app` network. Do not give any other service these aliases, or the proxy could route traffic to the wrong container.

The Caddy configuration is maintained in `/srv/proxy`, not in this repository.

## Web application

The web app is a single-page app built by Vite into static files (`apps/web/dist`). The `web` image is `caddy:2-alpine` with that build and `apps/web/Caddyfile`; it listens on `:3000`, so the alias `linea-web` and the shared proxy do not change.

- The build takes the `VITE_API_URL` build arg (`/v1`, same origin as the page). It is baked into the JavaScript, so changing it needs a rebuild.
- Paths with no file get `index.html` (client-side routes). `/assets/*` is hashed and cached as immutable; `index.html`, `sw.js` and `manifest.webmanifest` are always revalidated.
- The app is an installable PWA. Its service worker caches only the app shell. `/v1/*` (API, photos, downloads) is never cached nor answered by the worker, so private photos do not outlive the session.
- A new version is offered to the person ("Actualizar") instead of reloading by itself.
- Icons are generated from `apps/web/public/favicon.svg` with `pnpm --filter @linea-de-vida/web icons`.
- The web health check is `wget --spider http://127.0.0.1:3000/`.

## Deployment

The existing GitHub workflow copies its protected environment file to `$VPS_DEPLOY_PATH/.env`, checks out `origin/main`, and runs:

```bash
docker compose -f docker-compose.production.yml up --build --detach --remove-orphans
```

Compose waits for database health, applies Prisma migrations, then starts the API. The workflow waits for health checks from PostgreSQL, API, and web. The API health check uses `/v1/readiness`, which also verifies PostgreSQL connectivity.

Before enabling the workflow, store the complete production `.env` content in the `VPS_ENV_FILE` GitHub environment secret and configure the other `VPS_*` secrets required by `.github/workflows/deploy-production.yml`. The workflow rewrites the VPS `.env` from that secret on every deploy, so it must carry the current domain (`https://linea-de-vida.hidan.es`). Keep the private SSH key and `VPS_KNOWN_HOSTS` secret outside the repository.

Verify from a machine outside the VPS:

```bash
curl --fail --head "https://linea-de-vida.hidan.es"
curl --fail --head "https://linea-de-vida.hidan.es/v1/health"
```

## Thumbnail storage

The API keeps resized thumbnails (`?width=640|1280`) on the `thumbnail-data` volume, mounted at `THUMBNAIL_DIR` (`/var/lib/linea/thumbs`). Files are named after the photo's `contentKey`, so a changed photo never serves a stale image, and responses carry an `ETag` with `Cache-Control: immutable`. `THUMBNAIL_MAX_MB` (default 2048) caps the volume; the least recently used files are evicted past it. Without `THUMBNAIL_DIR` the store is off and thumbnails are generated per request.
