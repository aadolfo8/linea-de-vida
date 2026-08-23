# Production deployment

Production runs five long-lived services: PostgreSQL, Redis, the NestJS API, the BullMQ worker, the Next.js web application, and Nginx. The `migrate` service is a one-shot Prisma migration gate; API and worker start only after it completes successfully.

## Prerequisites

- Docker Engine with Docker Compose v2 on the VPS.
- A clone at the deployment path configured with a read-only GitHub deploy key for `origin`.
- Public DNS for `PUBLIC_DOMAIN` must already resolve to the VPS, and the VPS firewall/provider must allow inbound TCP 80 and 443. Do not expose any other service port.
- A Google OAuth web client whose production redirect URIs match the HTTPS public API origin.

## Environment

Copy `.env.production.example` to `.env` on the VPS and replace every placeholder. Never commit `.env` or copy it into an image. PostgreSQL and Redis use service DNS names (`postgres`, `redis`) and are intentionally not published to host ports.

The API rejects production configuration unless public origins and Google callbacks are HTTPS, secrets are non-placeholder values, the encryption key decodes to exactly 32 bytes, and `METRICS_TOKEN` is present.

Set `PUBLIC_DOMAIN` to the public DNS hostname and `LETSENCRYPT_EMAIL` to an operations mailbox. Set API/web origins and OAuth callbacks to HTTPS origins for that hostname. Keep `HSTS_MAX_AGE=0` until the HTTPS deployment is proven.

## Nginx

Nginx routes `/v1/` to the API and all other paths to Next.js, retaining `Host`, client IP, and `X-Forwarded-*` headers. PostgreSQL, Redis, API, worker, and web remain private to the Compose network; only Nginx publishes ports 80 and 443.

`deploy/nginx/start.sh` selects an HTTP-only configuration when no readable certificate exists. This permits the HTTP-01 ACME challenge at `/.well-known/acme-challenge/` while the application remains available over HTTP. When a valid certificate is present and Nginx is recreated, it selects the HTTPS configuration: ACME paths remain on HTTP and every other HTTP request redirects to HTTPS.

## First certificate bootstrap

Run these commands as the restricted deploy user from the checked-out repository directory. Do not run Certbot until public DNS resolves to the VPS and port 80 reaches this Nginx container.

1. Copy `.env.production.example` to `.env`, fill all required production configuration, then start the HTTP bootstrap:

   ```bash
   docker compose --env-file .env -f docker-compose.production.yml up --build --detach --remove-orphans
   docker compose --env-file .env -f docker-compose.production.yml exec -T nginx nginx -t
   ```

2. Verify the app remains reachable on HTTP and that the ACME path is served by Nginx. Then issue the certificate. This is `certonly --webroot`; it does not modify Nginx configuration and a failure leaves Nginx in HTTP bootstrap mode:

   ```bash
   docker compose --env-file .env -f docker-compose.production.yml --profile certbot run --rm certbot
   ```

3. Validate the issued certificate before enabling redirects, then enable HTTPS. The script refuses to switch unless the certificate is currently valid; it recreates only Nginx, whose startup script selects the TLS configuration.

   ```bash
   ./deploy/certbot/enable-https.sh
   ```

4. Verify the certificate and redirect from a machine outside the VPS. Confirm the HTTP challenge path remains reachable during future renewals, `/v1/health` succeeds over HTTPS, and forwarded-protocol behavior remains correct.

   ```bash
   curl --fail --location --head "http://$PUBLIC_DOMAIN"
   curl --fail --head "https://$PUBLIC_DOMAIN/v1/health"
   ```

### Conservative HSTS rollout

HSTS is emitted only by the TLS configuration, and defaults to `max-age=0`. After external HTTPS, redirect, API, and OAuth validation have remained successful, raise `HSTS_MAX_AGE` to a short value, recreate Nginx, and verify again. Increase it gradually only after that window; do not add `includeSubDomains` or `preload` without an explicit domain-wide review.

### Renewal and rollback

Install a deploy-user cron or systemd timer that runs `./deploy/certbot/renew-certificates.sh` at least daily and records its output. For example, run `crontab -e` as the deploy user and add a daily job that changes to the checked-out repository directory before invoking the script. The script renews through the saved webroot configuration, tests Nginx, and reloads it only after Certbot succeeds. It is safe when no certificate is due for renewal.

If TLS activation fails, stop the Nginx container, remove or rename only the certificate directory in the `letsencrypt` Docker volume after preserving a backup, then start/recreate Nginx. Its startup script falls back to HTTP bootstrap and preserves ACME reachability. Do not delete the certificate volume unless intentionally abandoning all certificate lineages. Investigate DNS, port 80 reachability, and Certbot output before a new issuance attempt.

## Deployment

The existing GitHub workflow copies its protected environment file to `$VPS_DEPLOY_PATH/.env`, checks out `origin/main`, and runs:

```bash
docker compose -f docker-compose.production.yml up --build --detach --remove-orphans
```

Compose waits for database and Redis health, applies Prisma migrations, then starts API and worker. The workflow waits for health checks from PostgreSQL, Redis, API, worker, web, and Nginx. The API health check uses `/v1/readiness`, which also verifies PostgreSQL connectivity.

Before enabling the workflow, store the complete production `.env` content in the `VPS_ENV_FILE` GitHub environment secret and configure the other `VPS_*` secrets required by `.github/workflows/deploy-production.yml`. Keep the private SSH key and `VPS_KNOWN_HOSTS` secret outside the repository.
