#!/usr/bin/env bash
# Aktifkan lagi sekolah yang di-suspend.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ensure_state
[ $# -eq 1 ] || die "pemakaian: $0 <kode>"
CODE="$1"; valid_code "$CODE"
reg_has "$CODE" || die "sekolah '$CODE' tidak terdaftar"
COMPOSE_OUT="$COMPOSE_DIR/$CODE.yml"
[ -f "$COMPOSE_OUT" ] || die "berkas compose hilang: $COMPOSE_OUT"

info "[$CODE] menjalankan lagi container"
docker compose -f "$PLATFORM_COMPOSE" -f "$COMPOSE_OUT" up -d "redis-$CODE" "api-$CODE"
reg_set_status "$CODE" "active"
info "[$CODE] active kembali."
