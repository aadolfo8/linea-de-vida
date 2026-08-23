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
template='/etc/nginx/config-templates/http.conf.template'

case "${ENABLE_HTTPS:-false}" in
  false)
    ;;
  true)
    if [ -r "${certificate_directory}/fullchain.pem" ] && [ -r "${certificate_directory}/privkey.pem" ]; then
      template='/etc/nginx/config-templates/https.conf.template'
    else
      echo 'ENABLE_HTTPS is true but no readable certificate and key are available; using HTTP bootstrap.' >&2
    fi
    ;;
  *)
    echo 'ENABLE_HTTPS must be true or false.' >&2
    exit 1
    ;;
esac

envsubst '${PUBLIC_DOMAIN} ${HSTS_MAX_AGE}' < "$template" > /etc/nginx/conf.d/default.conf
nginx -t
exec nginx -g 'daemon off;'
