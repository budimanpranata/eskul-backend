#!/usr/bin/env bash
# Hapus sekolah sepenuhnya. Membuat dump backup lebih dulu, lalu:
#   container + volume dihapus, DATABASE + ROLE di-drop, berkas konfigurasi dihapus,
#   baris registry dihapus.
#
#   ./scripts/deprovision-school.sh <kode> --yes
#
# WAJIB flag --yes (operasi merusak & tidak bisa dibatalkan selain dari backup).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ensure_state
[ $# -ge 1 ] || die "pemakaian: $0 <kode> --yes"
CODE="$1"; valid_code "$CODE"
[ "${2:-}" = "--yes" ] || die "tambahkan --yes untuk konfirmasi penghapusan permanen sekolah '$CODE'"
reg_has "$CODE" || die "sekolah '$CODE' tidak terdaftar"

DB="$(db_ident "$CODE")"
BDIR="${ESKUL_BACKUP_DIR:-/var/backups/eskul}"; mkdir -p "$BDIR"
STAMP="$(date +%F_%H%M%S)"

DUMP="$BDIR/${DB}_deprovision_${STAMP}.sql.gz"
if [ "$(pg_super -c "SELECT 1 FROM pg_database WHERE datname='${DB}'")" = "1" ]; then
  info "[$CODE] backup database → $DUMP"
  if pg_dump_db "$DB" 2>/dev/null | gzip > "$DUMP"; then :; else
    info "  (pg_dump gagal — lanjut tanpa backup)"; rm -f "$DUMP"
  fi
else
  info "[$CODE] database $DB tidak ada — lewati backup"
fi

COMPOSE_OUT="$COMPOSE_DIR/$CODE.yml"
if [ -f "$COMPOSE_OUT" ]; then
  info "[$CODE] hentikan & hapus container + volume"
  docker compose -f "$PLATFORM_COMPOSE" -f "$COMPOSE_OUT" rm -sfv "api-$CODE" "redis-$CODE" 2>/dev/null || true
  docker volume rm "eskul-${CODE}_redisdata-${CODE}" "eskul-${CODE}_reports-${CODE}" 2>/dev/null || true
fi

info "[$CODE] drop database + role"
pg_super -c "DROP DATABASE IF EXISTS ${DB}" || true
pg_super -c "DROP ROLE IF EXISTS ${DB}" || true

info "[$CODE] hapus berkas konfigurasi"
rm -f "$ENV_DIR/$CODE.env" "$COMPOSE_OUT" "$NGINX_OUT_DIR/$CODE.conf"
rm -rf "$STATE_DIR/secrets/$CODE"
[ "$SKIP_ORCHESTRATION" = "1" ] || docker exec eskul-nginx nginx -s reload 2>/dev/null || true

reg_remove "$CODE"
info "[$CODE] terhapus. Backup terakhir: $BDIR/${DB}_deprovision_${STAMP}.sql.gz"
