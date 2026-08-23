# Production deployment

Production runs five long-lived services: PostgreSQL, Redis, the NestJS API, the BullMQ worker, the Next.js web application, and Nginx. The `migrate` service is a one-shot Prisma migration gate; API and worker start only after it completes successfully.

## Prerequisites

- Docker Engine with Docker Compose v2 on the VPS.
- A clone at the deployment path configured with a read-only GitHub deploy key for `origin`.
- A domain and TLS solution before public use. This repository deliberately exposes **HTTP port 80 only**. It does not provision certificates or claim TLS is configured.
- A Google OAuth web client whose production redirect URIs match the HTTPS public API origin.

## Environment

Copy `.env.production.example` to `.env` on the VPS and replace every placeholder. Never commit `.env` or copy it into an image. PostgreSQL and Redis use service DNS names (`postgres`, `redis`) and are intentionally not published to host ports.

The API rejects production configuration unless public origins and Google callbacks are HTTPS, secrets are non-placeholder values, the encryption key decodes to exactly 32 bytes, and `METRICS_TOKEN` is present.

## Nginx

`deploy/nginx/linea-de-vida.conf` is mounted by the `nginx` service. It routes `/v1/` to the API and all other paths to Next.js, retaining `Host`, client IP, and `X-Forwarded-*` headers. Nginx listens on port 80 only. Set `server_name` and add a verified TLS configuration only after a domain and certificate are available.

## Deployment

The existing GitHub workflow copies its protected environment file to `$VPS_DEPLOY_PATH/.env`, checks out `origin/main`, and runs:

```bash
docker compose -f docker-compose.production.yml up --build --detach --remove-orphans
```

Compose waits for database and Redis health, applies Prisma migrations, then starts API and worker. The workflow waits for health checks from PostgreSQL, Redis, API, worker, web, and Nginx. The API health check uses `/v1/readiness`, which also verifies PostgreSQL connectivity.

Before enabling the workflow, store the complete production `.env` content in the `VPS_ENV_FILE` GitHub environment secret and configure the other `VPS_*` secrets required by `.github/workflows/deploy-production.yml`. Keep the private SSH key and `VPS_KNOWN_HOSTS` secret outside the repository.
