#!/bin/sh
# Container start: apply migrations, then run the API.
set -eu

alembic upgrade head

# One process: the failed-login counter (app/auth/rate_limit.py) lives in memory.
# --proxy-headers takes the client IP from X-Forwarded-For, but only when the request comes
# from FORWARDED_ALLOW_IPS (the Caddy container, see deploy/docker-compose.prod.yml).
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:?FORWARDED_ALLOW_IPS is not set}" \
  --no-server-header
