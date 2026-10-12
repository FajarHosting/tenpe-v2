# AdViora — Production Architecture, Security & Deployment Guide

## 1. Ringkasan Arsitektur
AdViora adalah platform niaga produk digital dan lisensi perangkat lunak resmi dengan pemisahan domain dan otorisasi peran (RBAC) yang tegas:
- **Toko Pelanggan Publik & Ritel**: `https://adviora.partnerhub.dpdns.org`
- **Portal Partner B2B (PartnerHub)**: `https://partnerhub.dpdns.org` (atau `/partner`)
- **Area Administrator**: `/admin` (diverifikasi secara ketat pada server melalui sesi `HttpOnly` dan role `ADMIN`).

### Alur Order, Pembayaran QRIS, dan Pemenuhan Lisensi (Fulfillment)
1. **Pembuatan Order (`POST /api/orders`)**:
   - Memerlukan sesi pelanggan terautentikasi (`adviora_session` `HttpOnly` cookie) dan header `X-CSRF-Token`.
   - Menghitung ulang harga dari database server (`retail_price` untuk `CUSTOMER`, `partner_price` untuk `PARTNER`). Nilai harga dari browser diabaikan sepenuhnya.
   - Menggunakan transaksi database atomik (`BEGIN IMMEDIATE TRANSACTION`) untuk memeriksa dan mereservasi unit stok nyata pada tabel `inventory_items` (`AVAILABLE -> RESERVED`).
   - Menerbitkan tagihan QRIS (`PENDING_PAYMENT`) dengan masa berlaku terukur (`QRIS_EXPIRY_MINUTES`, default 15 menit) dan mencatat riwayat di `stock_audit_logs` serta `order_status_history`.
2. **Verifikasi Pembayaran QRIS (`POST /api/webhooks/qris`)**:
   - Pembayaran hanya diverifikasi melalui callback server-to-server yang membawa header tanda tangan kriptografis `X-Adviora-Signature` (HMAC-SHA256 menggunakan `QRIS_WEBHOOK_SECRET`).
   - Memvalidasi batas waktu timestamp (anti-replay 5 menit), keunikan `eventId` pada tabel `payment_webhook_events` (idempotensi penuh), kecocokan `merchantId`, mata uang `IDR`, dan kecocokan nominal persis (`amount === order.total_amount`).
3. **Pemenuhan Stok Atomik & Pengiriman WhatsApp v32**:
   - Dalam transaksi database yang sama saat order berubah menjadi `PAID`, sistem mengklaim unit `inventory_items` yang direservasi (`RESERVED -> CLAIMED`), mencatat `fulfillments` (`SUCCESS`), dan mengubah status order menjadi `COMPLETED`.
   - Kredensial lisensi **hanya** ditampilkan pada halaman `/orders/:id` milik pembeli yang sah dan dimasukkan ke antrean `whatsapp_outbox` dengan target `CUSTOMER_PRIVATE` (menuju nomor WhatsApp pembeli).
   - Notifikasi grup operasional Admin (`ADMIN_GROUP`) di-sanitasi secara otomatis sehingga tidak pernah memuat password, secret, atau kode lisensi produk.

---

## 2. Migrasi Database, Backup, dan Rollback

### Menjalankan Migrasi Database
```bash
# Menjalankan migrasi skema (up)
npm run db:migrate

# Rollback skema (down - hanya untuk environment pengujian/staging)
npx tsx scripts/migrate.ts down
```

### Prosedur Backup & Restore (SQLite / PostgreSQL)
- **SQLite (Single-Node / VPS)**:
  ```bash
  # Backup online aman menggunakan perintah sqlite3 .backup
  sqlite3 ./data/adviora.sqlite ".backup './data/adviora-backup-$(date +%F-%H%M).sqlite'"
  ```
- **PostgreSQL (Managed Cloud SQL / Neon / Supabase)**:
  File `db/schema.sql` kompatibel dengan standar SQL relasional. Jalankan `psql "$DATABASE_URL" -f db/schema.sql` sebelum men-deploy versi baru.

---

## 3. Langkah Deployment Produksi (DNS, HTTPS, Backend, Webhook & Bot v32)

### A. Konfigurasi DNS & HTTPS
1. Arahkan A/CNAME record `adviora.partnerhub.dpdns.org` dan `partnerhub.dpdns.org` ke alamat IP / Load Balancer server produksi.
2. Aktifkan sertifikat TLS/HTTPS (Let's Encrypt / Cloudflare Full Strict) dan pastikan `NODE_ENV="production"` agar cookie sesi otomatis menggunakan atribut `Secure`.

### B. Konfigurasi Environment Server (`.env`)
Salin `.env.example` menjadi `.env` di server (jangan pernah di-commit ke Git) dan isi variabel berikut:
- `SESSION_SECRET`: String acak minimal 64 karakter hex (`openssl rand -hex 32`).
- `ADMIN_BOOTSTRAP_USERNAME`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_BOOTSTRAP_WHATSAPP`: Kredensial awal Admin. Set `ADMIN_FORCE_PASSWORD_ROTATION="true"` pada saat pertama kali deploy.
- `QRIS_PROVIDER_MODE`: Gunakan `"DYNAMIC_API"` atau `"STATIC_VERIFIED_WEBHOOK"` di produksi setelah kredensial merchant resmi siap, atau `"UNCONFIGURED"` untuk menonaktifkan checkout publik secara aman.
- `QRIS_WEBHOOK_SECRET`: Secret HMAC-SHA256 untuk memvalidasi callback `POST https://adviora.partnerhub.dpdns.org/api/webhooks/qris`.
- `WA_BOT_V32_ENABLED="true"`, `WA_BOT_V32_URL`, `WA_BOT_V32_SHARED_SECRET`, `WA_BOT_V32_ADMIN_GROUP_JID`: Konfigurasi koneksi internal menuju container WhatsApp Bot v32 di Pterodactyl.

### C. Integrasi WhatsApp Bot v32 di Pterodactyl
1. Pada container Pterodactyl Bot v32, pasang environment variable `WA_BOT_V32_SHARED_SECRET` yang identik dengan backend AdViora.
2. Pastikan Bot v32 mengekspos endpoint internal:
   - `GET /internal/v32/health`
   - `POST /internal/v32/dispatch` (memverifikasi header `X-Adviora-Bot-Signature` HMAC-SHA256 dan `X-Adviora-Idempotency-Key`).
3. Jika container Pterodactyl sedang restart atau terputus dari WhatsApp Web, transaksi order di AdViora tetap berhasil disimpan di database dan pesan masuk ke tabel `whatsapp_outbox` dengan status `FAILED_RETRYABLE` untuk dikirim ulang secara otomatis maupun melalui tombol **Flush Outbox** di `/admin`.

### D. Build, Verifikasi & Menjalankan Server
```bash
npm install
npm run lint
npm run build
npm test
npm start
```

---

## 4. Daftar Blocker Eksternal & Risiko Residual (Kejujuran Status Produksi)
Aplikasi telah lulus seluruh pengujian integrasi lokal, otorisasi RBAC, reservasi stok atomik, dan verifikasi webhook kriptografis. Sebelum melayani transaksi uang nyata di domain publik, pemilik sistem wajib melengkapi kredensial eksternal berikut di environment produksi:
1. **Kredensial Penyedia QRIS Produksi**: Mengisi `QRIS_MERCHANT_ID`, `QRIS_API_KEY`, dan `QRIS_WEBHOOK_SECRET` resmi dari penyedia payment gateway serta mendaftarkan URL webhook `https://adviora.partnerhub.dpdns.org/api/webhooks/qris`.
2. **Koneksi Container Pterodactyl WhatsApp Bot v32**: Mengatur `WA_BOT_V32_URL` dan `WA_BOT_V32_SHARED_SECRET` yang dapat dijangkau dari jaringan privat backend, lalu mengubah `WA_BOT_V32_ENABLED="true"`.
3. **Rotasi Password Bootstrap Admin**: Mengganti nilai `ADMIN_BOOTSTRAP_PASSWORD` di environment produksi dan melakukan rotasi password melalui `/dashboard` setelah login pertama.
