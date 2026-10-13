# Deploy — eskul-backend

Server bersama `203.194.115.120` (VPS 1 vCPU/2.2GB RAM), dipakai juga oleh
Sispen (`:8081`) dan Koperasi Roti Bogoh (`:8082`) — lihat arsitektur lengkap
di `D:\project\koperasi-roti-bogoh\CLAUDE.md`. eskul sendiri diakses di
`http://eskul.sekolah.sch.id` (Nginx `:80`, belum HTTPS).

| | |
|---|---|
| SSH | `ssh -i ~/.ssh/sispen_pvs eskul@203.194.115.120` |
| Repo di server | `/opt/eskul/eskul-backend` (backend), `/opt/eskul/eskul-web-admin` (web admin) |
| Container | `eskul-api` (`127.0.0.1:3100`), `eskul-postgres` (`127.0.0.1:5432`, db `eskul`), `eskul-redis` (`127.0.0.1:6379`) |
| Web root | `/var/www/eskul-admin` (static build `eskul-web-admin`, di-serve Nginx) |
| Secret produksi | `/opt/eskul/eskul-backend/.env` (permission default, TIDAK ada di git — kalau hilang, generate ulang password & update role Postgres) |

## Deploy backend

```bash
ssh -i ~/.ssh/sispen_pvs eskul@203.194.115.120
cd /opt/eskul/eskul-backend
./deploy/deploy.sh
```

Langkah di dalamnya: `git pull` → `npm ci` + `prisma generate` (host — bukan
di dalam container, lihat catatan di `deploy.sh`) → `prisma migrate deploy` →
`docker compose build api` → `docker compose up -d api` → healthcheck retry
(`GET /api/v1/health`, 20× percobaan @ 3 detik).

Gagal healthcheck → cek `docker logs eskul-api`. Rollback migrasi: lihat
`backend/README.md` bagian Rollback (`down.sql` per migration + `migrate deploy`
ulang), atau restore dari backup `pg_dump` kalau sudah terlanjur jalan.

## Deploy web admin (statis, tanpa container)

```bash
ssh -i ~/.ssh/sispen_pvs eskul@203.194.115.120
cd /opt/eskul/eskul-web-admin
git pull
npm ci
npm run build
cp -r dist/* /var/www/eskul-admin/
```

`/var/www/eskul-admin` dimiliki user `eskul` — **tidak perlu sudo** dan
**tidak perlu reload Nginx** (konten statis, config Nginx tidak berubah).

## Hal yang TIDAK boleh disentuh dari sesi kerja eskul

Server ini dipakai bersama Sispen & Bogoh (`sispen-api`, `bogoh-api`, dan
Redis masing-masing). Jangan jalankan `~/deploy-all.sh` (punya milik mereka)
atau menyentuh `/opt/sispen`, `/opt/bogoh`, `/etc/nginx/sites-available/{sispen,bogoh}`
dari sesi kerja eskul. Postgres (`eskul-postgres`) dipakai bertiga (database
terpisah per app, role terpisah) — jangan jalankan perintah yang menyentuh
database selain `eskul`.
