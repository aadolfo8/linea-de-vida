#!/bin/sh
set -eu

case "${PUBLIC_DOMAIN:-}" in
  '' | *[!A-Za-z0-9.-]* | .* | *. | *..* | -* | *.-* | *-)
    echo 'PUBLIC_DOMAIN must be a DNS hostname.' >&2
    exit 1
    ;;
esac

case "${HSTS_MAX_AGE:-0}" in
  *[!0-9]*)
    echo 'HSTS_MAX_AGE must be a non-negative integer.' >&2
    exit 1
    ;;
esac

certificate_directory="/etc/letsencrypt/live/${PUBLIC_DOMAIN}"
template='/etc/nginx/templates/http.conf.template'

if [ -r "${certificate_directory}/fullchain.pem" ] && [ -r "${certificate_directory}/privkey.pem" ]; then
  template='/etc/nginx/templates/https.conf.template'
fi

envsubst '${PUBLIC_DOMAIN} ${HSTS_MAX_AGE}' < "$template" > /etc/nginx/conf.d/default.conf
exec /docker-entrypoint.sh nginx -g 'daemon off;'
