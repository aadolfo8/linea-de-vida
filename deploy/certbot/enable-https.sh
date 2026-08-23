#!/bin/sh
set -eu

compose() {
  docker compose --env-file .env -f docker-compose.production.yml "$@"
}

# The HTTP-only Nginx container must already be running and sharing the certificate volume.
compose exec -T nginx sh -ec 'openssl x509 -in "/etc/letsencrypt/live/$PUBLIC_DOMAIN/fullchain.pem" -noout -checkend 0 -checkhost "$PUBLIC_DOMAIN"'

# Nginx chooses its HTTPS configuration only when a readable certificate exists.
compose up -d --no-deps --force-recreate nginx
compose exec -T nginx nginx -t
