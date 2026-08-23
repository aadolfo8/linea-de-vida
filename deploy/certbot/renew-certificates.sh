#!/bin/sh
set -eu

compose() {
  docker compose --env-file .env -f docker-compose.production.yml "$@"
}

compose --profile certbot run --rm certbot renew --quiet
compose exec -T nginx nginx -t
compose exec -T nginx nginx -s reload
