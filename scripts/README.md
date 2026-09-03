# Provisioning multi-sekolah — Model 1 (`scripts/`)

"Satu deployment per sekolah": **satu server PostgreSQL bersama** (banyak database —
satu per sekolah) + **nginx bersama** + **satu container Redis & satu container API
per sekolah**. Aplikasi NestJS **tidak diubah** — tiap instance hanya menunjuk
`DATABASE_URL` / `REDIS_HOST` yang berbeda.

Isolasi:

- Database **dan role Postgres terpisah** per sekolah; `REVOKE CONNECT … FROM PUBLIC`
  → `.env` sekolah A yang bocor tidak bisa menyentuh DB sekolah B.
- Redis terpisah per sekolah → antrean BullMQ tidak bercampur.
- Subdomain `<kode>.<domain>` → nginx mem-proxy ke container API sekolah itu.

Cocok untuk **puluhan sekolah**. Untuk ratusan/ribuan sekolah self-serve, jalur
lain adalah shared multi-tenant — lihat [`../MULTI-TENANT.md`](../MULTI-TENANT.md).

---

## Prasyarat server (sekali)

```bash
# 1. Docker + Node 22 + nginx client tools (lihat runbook deploy utama)
sudo apt-get install -y postgresql-client        # psql + pg_dump di host (untuk migrate/backup)

# 2. Jaringan & state
docker network create eskul-net
sudo mkdir -p /opt/eskul/state /etc/eskul/nginx /var/www/eskul-admin
sudo chown -R "$USER" /opt/eskul/state

# 3. Bangun image API sekali (dipakai semua sekolah)
docker build -t eskul-api:latest .

# 4. Panel admin (build BERSAMA — satu untuk semua sekolah, base URL /api/v1 same-origin)
#    (di repo web-admin)  npm ci && npm run build
sudo rsync -a --delete web-admin/dist/ /var/www/eskul-admin/

# 5. Infra bersama
cp scripts/.platform.env.example scripts/.platform.env   # isi PG_PASSWORD
docker compose --env-file scripts/.platform.env -f scripts/platform-compose.yml up -d
```

Environment yang dibaca skrip (set di shell / `/etc/environment` / systemd):

| Env | Contoh | Fungsi |
|---|---|---|
| `ESKUL_PG_SUPER_URL` | `postgresql://eskul:PASS@127.0.0.1:5432/postgres` | koneksi superuser Postgres bersama |
| `ESKUL_BASE_DOMAIN` | `eskul.sekolah.id` | subdomain sekolah = `<kode>.<domain>` |
| `ESKUL_STATE_DIR` | `/opt/eskul/state` | `.env`, compose, dan registry per sekolah |
| `ESKUL_NGINX_DIR` | `/etc/eskul/nginx` | tujuan blok server nginx per sekolah |
| `ESKUL_PORT_BASE` | `31000` | port loopback API sekolah pertama = base+1 |

---

## Perintah

### Daftarkan sekolah baru

```bash
./scripts/provision-school.sh <kode> "<Nama Sekolah>" <email-admin> ["Nama Admin"]
# contoh
./scripts/provision-school.sh sdn-melati "SDN Melati 01" admin@sdnmelati.sch.id "Kepala TU"
```

Langkah otomatis: buat role+DB Postgres → `prisma migrate deploy` → seed 4 role +
1 akun ADMIN (password di-generate) → render `.env` / compose / nginx →
`docker compose up redis-<kode> api-<kode>` → reload nginx → catat ke registry.
Output terakhir (stdout) = satu baris JSON; ringkasan + **password admin** dicetak
ke stderr — berikan sekali, minta ganti saat login pertama.

Setelah itu, terbitkan TLS:

```bash
sudo certbot --nginx -d <kode>.<domain> --redirect -m ops@... --agree-tos --no-eff-email
```

### Lihat semua sekolah

```bash
./scripts/list-schools.sh
```

### Bekukan / aktifkan kembali

```bash
./scripts/suspend-school.sh <kode>     # stop container; DB & volume tetap
./scripts/resume-school.sh  <kode>
```

### Hapus permanen (dump backup dulu)

```bash
./scripts/deprovision-school.sh <kode> --yes
```

### Update semua sekolah setelah rilis backend baru

```bash
git pull && npm ci
docker build -t eskul-api:latest .
for f in "$ESKUL_STATE_DIR"/env/*.hosturl; do
  code=$(basename "$f" .hosturl)
  DATABASE_URL="$(cat "$f")" npx prisma migrate deploy      # migrasi per sekolah
  docker compose -f scripts/platform-compose.yml -f "$ESKUL_STATE_DIR/compose/$code.yml" up -d "api-$code"
done
```

---

## Test

```bash
npm run provision:test
```

Butuh container `eskul-postgres` (compose dev) hidup. Menguji **lapisan data**:
buat DB+role per sekolah, `migrate deploy`, seed role+admin, isolasi antar-sekolah
(kredensial B ditolak DB A; data di A tak terlihat di B), guard duplikat, dan
deprovision bersih. Orkestrasi container/nginx/certbot **dilewati** di test dan
diverifikasi manual di server (checklist di runbook deploy).

---

## Batas & catatan

- ~10 sekolah nyaman di 1 VPS 4 GB (shared PG + N×{redis,api}). Lebih dari itu →
  besarkan VPS atau pindah sebagian sekolah ke VPS lain (`ESKUL_STATE_DIR` per host).
- Belum ada: pendaftaran mandiri (form publik + antrean approval), konsol operator,
  tagihan. Itu ranah Model 2 — lihat `MULTI-TENANT.md`.
- Analitik lintas-sekolah butuh lapisan agregasi terpisah (query N database).
- `state/` dan `scripts/.platform.env` **gitignored** — berisi rahasia per sekolah.
