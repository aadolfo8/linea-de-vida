# Production deployment

Production runs three long-lived services: PostgreSQL, the NestJS API (which also runs the sync scheduler) and the Next.js web application. The `migrate` service is a one-shot Prisma migration gate; the API starts only after it completes successfully.

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
