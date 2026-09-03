#!/usr/bin/env bash
# Bekukan sekolah: hentikan container API + Redis, status → suspended.
# Data (database + volume) TETAP. Balikkan dengan resume-school.sh.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ensure_state
[ $# -eq 1 ] || die "pemakaian: $0 <kode>"
CODE="$1"; valid_code "$CODE"
reg_has "$CODE" || die "sekolah '$CODE' tidak terdaftar"

info "[$CODE] menghentikan container"
docker stop "eskul-api-$CODE" "eskul-redis-$CODE" 2>/dev/null || true
reg_set_status "$CODE" "suspended"
info "[$CODE] suspended. Login sekolah ini akan gagal sampai di-resume."
