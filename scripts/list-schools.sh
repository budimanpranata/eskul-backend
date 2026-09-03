#!/usr/bin/env bash
# Tampilkan semua sekolah terdaftar + status container + jumlah siswa.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ensure_state

printf '%-16s %-28s %-7s %-10s %-7s %s\n' CODE NAMA PORT STATUS SISWA CONTAINER
printf '%s\n' "--------------------------------------------------------------------------------------"

# Baca langsung dari file (tanpa pipe / process-substitution — portabel di Git Bash).
# Lewati baris header dengan penghitung; perintah di dalam loop diberi </dev/null
# agar tidak menyedot baris registry berikutnya.
_first=1
while IFS=$'\t' read -r code name port status created; do
  if [ "$_first" = "1" ]; then _first=0; continue; fi
  [ -n "$code" ] || continue
  db="$(db_ident "$code")"
  students="-"
  if s="$(pg_super -d "$db" -c "SELECT count(*) FROM students WHERE is_active" </dev/null 2>/dev/null)"; then
    students="$s"
  fi
  cstate="$(docker inspect -f '{{.State.Status}}' "eskul-api-$code" </dev/null 2>/dev/null | tr -d '\r\n')" || cstate=""
  [ -n "$cstate" ] || cstate="(mati)"
  printf '%-16s %-28.28s %-7s %-10s %-7s %s\n' "$code" "$name" "$port" "$status" "$students" "$cstate"
done < "$REGISTRY"
