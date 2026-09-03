#!/usr/bin/env bash
# ============================================================================
# lib.sh — helper bersama untuk provisioning multi-sekolah (Model 1).
#
# Model 1 = "satu deployment per sekolah": PostgreSQL bersama (satu server),
# tapi SATU database + SATU role + SATU container Redis + SATU container API
# per sekolah. Aplikasi NestJS TIDAK diubah — tiap instance hanya menunjuk
# DATABASE_URL / REDIS_HOST yang berbeda. Isolasi = database & kredensial
# terpisah per tenant.
#
# Semua skrip meng-`source` file ini. Jangan dijalankan langsung.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/templates"

# --- lokasi state (dapat di-override lewat env; default = tata letak Ubuntu) ---
STATE_DIR="${ESKUL_STATE_DIR:-/opt/eskul/state}"
ENV_DIR="$STATE_DIR/env"                 # <code>.env per sekolah
COMPOSE_DIR="$STATE_DIR/compose"         # <code>.yml per sekolah
REGISTRY="$STATE_DIR/schools.tsv"        # code \t name \t port \t status \t created_at
NGINX_OUT_DIR="${ESKUL_NGINX_DIR:-/etc/nginx/conf.d}"
BASE_DOMAIN="${ESKUL_BASE_DOMAIN:-eskul.example.com}"
PORT_BASE="${ESKUL_PORT_BASE:-31000}"   # port loopback API sekolah pertama = PORT_BASE+1

PLATFORM_COMPOSE="$SCRIPT_DIR/platform-compose.yml"
API_IMAGE="${ESKUL_API_IMAGE:-eskul-api:latest}"

# --- koneksi superuser ke PostgreSQL bersama (buat DB & ROLE) ---
# Contoh: postgresql://eskul:rahasia@127.0.0.1:5432/postgres
PG_SUPER_URL="${ESKUL_PG_SUPER_URL:?ESKUL_PG_SUPER_URL wajib di-set (superuser conn ke Postgres bersama)}"
# Host:port Postgres yang dilihat CONTAINER API (default = nama service compose).
PG_APP_HOST="${ESKUL_PG_APP_HOST:-postgres}"
PG_APP_PORT="${ESKUL_PG_APP_PORT:-5432}"

# Perintah klien (bisa di-override untuk lingkungan tanpa psql/pg_dump di host,
# mis. ESKUL_PSQL="docker exec -i eskul-postgres psql").
read -r -a PSQL_BASE   <<< "${ESKUL_PSQL:-psql}"
read -r -a PGDUMP_BASE <<< "${ESKUL_PGDUMP:-pg_dump}"

# host:port yang dipakai `prisma migrate deploy` / `tsx seed` — DIJALANKAN DI HOST,
# jadi bisa berbeda dari host:port di PG_SUPER_URL (yang mungkin sudut pandang container).
_su_rest="${PG_SUPER_URL#*://}"; _su_hp="${_su_rest#*@}"
MIGRATE_HOSTPORT="${ESKUL_PG_MIGRATE_HOSTPORT:-${_su_hp%%/*}}"
PG_SUPER_BASE_URL="${PG_SUPER_URL%/*}"   # tanpa nama db di akhir

# --- orkestrasi bisa dilewati (dipakai test data-layer) ---
SKIP_ORCHESTRATION="${ESKUL_SKIP_ORCHESTRATION:-0}"

die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo ">> $*" >&2; }

valid_code() {
  [[ "$1" =~ ^[a-z][a-z0-9-]{1,30}$ ]] \
    || die "kode sekolah '$1' tidak valid (a-z0-9-, 2-31 char, diawali huruf)"
}

gen_secret()   { openssl rand -hex 32; }
gen_password() { openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | cut -c1-20; }

# nama database & role Postgres untuk sebuah kode sekolah (ganti '-' → '_')
db_ident() { echo "eskul_${1//-/_}"; }

ensure_state() {
  mkdir -p "$ENV_DIR" "$COMPOSE_DIR"
  [ -f "$REGISTRY" ] || printf 'code\tname\tport\tstatus\tcreated_at\n' > "$REGISTRY"
}

reg_has()    { awk -F'\t' -v c="$1" 'NR>1 && $1==c{f=1} END{exit !f}' "$REGISTRY"; }
reg_field()  { awk -F'\t' -v c="$1" -v n="$2" 'NR>1 && $1==c{print $n}' "$REGISTRY"; }
reg_add()    { printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$(date -Iseconds)" >> "$REGISTRY"; }

reg_set_status() {
  local tmp; tmp="$(mktemp)"
  awk -F'\t' -v OFS='\t' -v c="$1" -v s="$2" \
    'NR==1{print;next} $1==c{$4=s} {print}' "$REGISTRY" > "$tmp" && mv "$tmp" "$REGISTRY"
}
reg_remove() {
  local tmp; tmp="$(mktemp)"
  awk -F'\t' -v c="$1" 'NR==1 || $1!=c' "$REGISTRY" > "$tmp" && mv "$tmp" "$REGISTRY"
}

# port loopback berikutnya = (port maksimum di registry, atau PORT_BASE) + 1
next_port() {
  local max="$PORT_BASE" port
  while IFS=$'\t' read -r _ _ port _ _; do
    [[ "$port" =~ ^[0-9]+$ ]] && (( port > max )) && max="$port"
  done < <(tail -n +2 "$REGISTRY" 2>/dev/null || true)
  echo $(( max + 1 ))
}

# pg_super [-d <db>] <psql-args...>   — jalankan psql sebagai superuser.
# Default db = yang ada di PG_SUPER_URL; -d <db> menimpanya.
pg_super() {
  local url="$PG_SUPER_URL"
  if [ "${1:-}" = "-d" ]; then url="$PG_SUPER_BASE_URL/$2"; shift 2; fi
  "${PSQL_BASE[@]}" "$url" -v ON_ERROR_STOP=1 -qtAX "$@"
}
pg_dump_db() { "${PGDUMP_BASE[@]}" "$PG_SUPER_BASE_URL/$1"; }

# render template: ganti @@KEY@@ dengan nilai variabel shell bernama KEY
render_template() {
  local src="$1"; shift
  local out="$src"
  local pair k v
  for pair in "$@"; do
    k="${pair%%=*}"; v="${pair#*=}"
    out="${out//@@${k}@@/${v}}"
  done
  printf '%s' "$out"
}
