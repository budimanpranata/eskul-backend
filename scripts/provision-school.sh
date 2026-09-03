#!/usr/bin/env bash
# ============================================================================
# provision-school.sh — daftarkan satu sekolah baru (Model 1).
#
#   ./scripts/provision-school.sh <kode> "<Nama Sekolah>" <email-admin> ["Nama Admin"]
#
# Contoh:
#   ./scripts/provision-school.sh sdn-melati "SDN Melati 01" admin@sdnmelati.sch.id "Kepala TU"
#
# Langkah:
#   1. buat ROLE + DATABASE Postgres khusus sekolah (di server Postgres bersama)
#   2. prisma migrate deploy  →  skema penuh di DB baru
#   3. seed-school.ts          →  4 role + 1 akun ADMIN (password di-generate)
#   4. render  state/env/<kode>.env, state/compose/<kode>.yml, nginx/<kode>.conf
#   5. docker compose up  redis-<kode> + api-<kode>   (kecuali ESKUL_SKIP_ORCHESTRATION=1)
#   6. catat ke registry (state/schools.tsv)
#
# Env wajib:  ESKUL_PG_SUPER_URL   (mis. postgresql://eskul:pw@127.0.0.1:5432/postgres)
# Env berguna: ESKUL_BASE_DOMAIN, ESKUL_STATE_DIR, ESKUL_NGINX_DIR, ESKUL_PORT_BASE
# ============================================================================
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ $# -ge 3 ] || die "pemakaian: $0 <kode> \"<Nama Sekolah>\" <email-admin> [\"Nama Admin\"]"
CODE="$1"; SCHOOL_NAME="$2"; ADMIN_EMAIL="$3"; ADMIN_NAME="${4:-Administrator ${SCHOOL_NAME}}"

valid_code "$CODE"
[[ "$ADMIN_EMAIL" == *@*.* ]] || die "email admin tidak valid: $ADMIN_EMAIL"
ensure_state
reg_has "$CODE" && die "sekolah '$CODE' sudah terdaftar (lihat: scripts/list-schools.sh)"

DB="$(db_ident "$CODE")"
DB_PW="$(gen_password)"
PORT="$(next_port)"
JWT_ACCESS="$(gen_secret)"; JWT_REFRESH="$(gen_secret)"; REPORT_SIGNING="$(gen_secret)"
ADMIN_PW="$(gen_password)"

# --- URL: dari HOST (migrate/seed) vs dari CONTAINER (runtime) ---
HOST_DB_URL="postgresql://${DB}:${DB_PW}@${MIGRATE_HOSTPORT}/${DB}?schema=public"
APP_DB_URL="postgresql://${DB}:${DB_PW}@${PG_APP_HOST}:${PG_APP_PORT}/${DB}?schema=public"

info "[$CODE] membuat role + database Postgres ($DB)"
pg_super <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB}') THEN
    CREATE ROLE ${DB} LOGIN PASSWORD '${DB_PW}';
  ELSE
    ALTER ROLE ${DB} WITH LOGIN PASSWORD '${DB_PW}';
  END IF;
END \$\$;
SQL
if [ "$(pg_super -c "SELECT 1 FROM pg_database WHERE datname='${DB}'")" != "1" ]; then
  pg_super -c "CREATE DATABASE ${DB} OWNER ${DB}"
fi
# isolasi: hanya role sekolah ini yang boleh connect
pg_super -c "REVOKE CONNECT ON DATABASE ${DB} FROM PUBLIC" || true

info "[$CODE] prisma migrate deploy"
( cd "$BACKEND_DIR" && DATABASE_URL="$HOST_DB_URL" npx prisma migrate deploy >&2 )

info "[$CODE] seed role + akun admin"
SEED_JSON="$(
  cd "$BACKEND_DIR" && DATABASE_URL="$HOST_DB_URL" \
    SCHOOL_ADMIN_EMAIL="$ADMIN_EMAIL" SCHOOL_ADMIN_NAME="$ADMIN_NAME" \
    SCHOOL_ADMIN_PASSWORD="$ADMIN_PW" \
    npx tsx prisma/seed-school.ts
)"
echo "$SEED_JSON" | grep -q '"ok":true' || die "seed-school gagal: $SEED_JSON"

info "[$CODE] render berkas konfigurasi"
mkdir -p "$STATE_DIR/secrets/$CODE"
ENV_FILE="$ENV_DIR/$CODE.env"
COMPOSE_OUT="$COMPOSE_DIR/$CODE.yml"
NGINX_OUT="$NGINX_OUT_DIR/$CODE.conf"

render_template "$(cat "$TEMPLATE_DIR/school.env.tmpl")" \
  CODE="$CODE" DB_URL="$APP_DB_URL" JWT_ACCESS="$JWT_ACCESS" JWT_REFRESH="$JWT_REFRESH" \
  REPORT_SIGNING="$REPORT_SIGNING" MFA_ISSUER="Eskul ${SCHOOL_NAME}" \
  CORS_ORIGIN="https://${CODE}.${BASE_DOMAIN}" > "$ENV_FILE"
chmod 600 "$ENV_FILE"

# URL DB dari HOST — untuk migrasi/perbaikan manual berikutnya.
printf '%s\n' "$HOST_DB_URL" > "$ENV_DIR/$CODE.hosturl"
chmod 600 "$ENV_DIR/$CODE.hosturl"

render_template "$(cat "$TEMPLATE_DIR/school.compose.yml.tmpl")" \
  CODE="$CODE" API_IMAGE="$API_IMAGE" ENV_FILE="$ENV_FILE" PORT="$PORT" \
  SECRETS_DIR="$STATE_DIR/secrets/$CODE" BASE_DOMAIN="$BASE_DOMAIN" > "$COMPOSE_OUT"

if [ "$SKIP_ORCHESTRATION" != "1" ]; then
  mkdir -p "$NGINX_OUT_DIR"
  render_template "$(cat "$TEMPLATE_DIR/school.nginx.conf.tmpl")" \
    CODE="$CODE" BASE_DOMAIN="$BASE_DOMAIN" NGINX_DIR="$NGINX_OUT_DIR" > "$NGINX_OUT"

  info "[$CODE] docker compose up (redis + api)"
  docker compose -f "$PLATFORM_COMPOSE" -f "$COMPOSE_OUT" up -d "redis-$CODE" "api-$CODE" >&2

  info "[$CODE] reload nginx bersama"
  docker exec eskul-nginx nginx -s reload >&2 2>/dev/null \
    || info "  (lewati reload nginx — jalankan manual + certbot untuk ${CODE}.${BASE_DOMAIN})"
fi

reg_add "$CODE" "$SCHOOL_NAME" "$PORT" "active"

GEN_PW="$(echo "$SEED_JSON" | sed -n 's/.*"generatedPassword":"\([^"]*\)".*/\1/p')"
[ -n "$GEN_PW" ] || GEN_PW="$ADMIN_PW"

cat >&2 <<EOF

================ SEKOLAH SIAP: $CODE ================
  Nama         : $SCHOOL_NAME
  URL          : https://${CODE}.${BASE_DOMAIN}
  Database     : $DB   (role $DB, khusus sekolah ini)
  API loopback : 127.0.0.1:${PORT}
  Admin login  : $ADMIN_EMAIL
  Admin sandi  : $GEN_PW      <-- berikan sekali, minta ganti saat login pertama
  .env         : $ENV_FILE
  compose      : $COMPOSE_OUT
$( [ "$SKIP_ORCHESTRATION" != "1" ] && echo "  nginx        : $NGINX_OUT   (jalankan: certbot --nginx -d ${CODE}.${BASE_DOMAIN})" )
====================================================
EOF

# baris terakhir STDOUT = JSON siap-parse (skrip lain / test).
# Hanya field bernilai aman-JSON (tanpa backslash); path berkas dicetak ke stderr di atas.
printf '%s\n' "{\"code\":\"$CODE\",\"db\":\"$DB\",\"port\":$PORT,\"adminEmail\":\"$ADMIN_EMAIL\",\"adminPassword\":\"$GEN_PW\",\"hostUrl\":\"$HOST_DB_URL\"}"
