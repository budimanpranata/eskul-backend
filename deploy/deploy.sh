#!/usr/bin/env bash
# Deploy script — dijalankan di server (/opt/eskul/eskul-backend).
# Pola sama dengan sispen/bogoh (server bersama 203.194.115.120, lihat
# D:\project\koperasi-roti-bogoh\CLAUDE.md untuk arsitektur lengkap):
# pull -> migrate -> build image -> restart -> healthcheck retry.
#
# Beda dari sispen/bogoh: migrasi Prisma dijalankan LANGSUNG DI HOST (bukan
# lewat `docker run` image terpisah), karena node_modules + .env di host
# sudah ada sejak awal provisioning eskul dan DATABASE_URL di .env memakai
# 127.0.0.1 (Postgres di-bind ke host juga, bukan cuma network docker).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> git pull"
git pull

echo "==> install deps + generate prisma client (host)"
npm ci
npx prisma generate

echo "==> jalankan migrasi pending (jika ada)"
npx prisma migrate deploy

echo "==> build image backend"
docker compose build api

echo "==> restart backend"
docker compose up -d api

echo "==> tunggu backend siap"
ok=0
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:3100/api/v1/health >/dev/null; then
    ok=1
    break
  fi
  sleep 3
done
if [ "$ok" -ne 1 ]; then
  echo "HEALTHCHECK GAGAL setelah 60 detik. Cek: docker logs eskul-api"
  exit 1
fi
echo "backend siap."
