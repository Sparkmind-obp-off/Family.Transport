# Family Transport Manager

Alat operasional internal Family Transport untuk Fahruk. WhatsApp tetap menjadi kanal komunikasi; aplikasi mencatat customer, perjalanan, driver, kendaraan, assignment, status, harga dasar, dan catatan. Bukan marketplace, booking publik, atau sistem akuntansi.

## URL dan status
- Produksi BYOK: https://family-transport-manager.pages.dev
- Repository: https://github.com/Sparkmind-obp-off/Family.Transport
- Stack: TypeScript Worker + Cloudflare Pages Assets + D1; tanpa framework UI besar atau dependensi runtime tambahan.
- Deploy produksi dan 12 pemeriksaan smoke telah dijalankan pada 2026-10-04. Record sintetis smoke dibersihkan berdasarkan ID yang dibuat oleh pengujian itu saja. Data lokal pengujian tidak disalin ke produksi.
- GitHub Actions telah diperbarui. Kredensial integrasi saat pengerjaan menerima HTTP 403 untuk API repository Actions secrets; keberadaan secrets CI tidak dapat diperiksa atau disetel lewat integrasi tersebut. Ini tidak menghalangi deploy BYOK langsung yang telah dilakukan.

## Fungsi selesai
- Dashboard hari ini, mendatang, perlu tindakan, dan jumlah operasional yang dihitung database, bukan jumlah halaman hasil.
- Buat, baca, edit trip; filter tanggal/status/pencarian; paginasi 25 record di UI, batas API 100.
- Customer: tambah, edit, daftar, dan riwayat trip berpaginasi.
- Driver/kendaraan: tambah, edit, aktif/nonaktif; identitas kendaraan opsional.
- Assignment parsial driver atau kendaraan pada trip CONFIRMED. Ketika keduanya lengkap status otomatis ASSIGNED. Assignment dapat diganti sebelum ON_TRIP; driver/kendaraan nonaktif ditolak.
- Workflow PENDING → CONFIRMED → ASSIGNED → ON_TRIP → COMPLETED. CANCELLED dari setiap status nonterminal. Perubahan mundur/lompatan ditolak. Trip terminal tidak diedit atau dihapus melalui API.
- Chat customer/driver, konfirmasi dan kirim detail melalui tautan wa.me. Nomor awalan 0 dinormalisasi ke 62. Tidak ada pengiriman otomatis/WhatsApp API.
- UI mobile-first, dialog edit/detail, loading tombol, empty state dan pesan error bahasa Indonesia.

## Akses operator
Semua halaman, assets, dan API dilindungi **HTTP Basic di Worker**, melalui HTTPS produksi. Browser menampilkan prompt login: username `operator`; password disampaikan privat, tidak tersimpan dalam Git, HTML, atau bundle. Password produksi dan lokal berbeda. Tidak ada akun customer/driver, peran kompleks, atau registrasi.

`OPERATOR_PASSWORD` harus diisi sebagai Cloudflare Pages secret, minimal 24 karakter; gunakan password acak kuat. Jika secret hilang/pendek, aplikasi menolak seluruh akses dengan 503. Password tidak dikirim ke frontend JavaScript; browser menangani header autentikasi. Gunakan perangkat tepercaya. Basic auth tidak memiliki logout aplikasi: tutup seluruh sesi browser/private window setelah selesai. Rotasi password lewat Cloudflare Pages secret dan redeploy untuk memastikan seluruh deployment menggunakan secret terbaru; revoke deployment lama jika diperlukan. Tidak ada MFA atau rate-limiter khusus aplikasi; password acak kuat dan perlindungan Cloudflare menjadi baseline alat satu operator ini.

## Panduan singkat
1. Login, tambah driver dan kendaraan aktif melalui navigasi.
2. Pilih **Trip baru**. Pilih customer yang sudah ada atau masukkan customer baru, jadwal, rute, jumlah penumpang, harga rupiah opsional, sumber/partner dan catatan minimal.
3. Simpan sebagai PENDING, koordinasikan ketersediaan via WhatsApp, lalu buka trip dan konfirmasi.
4. Pilih driver dan kendaraan pada Assignment. Keduanya lengkap → ASSIGNED.
5. Tandai Dalam perjalanan lalu Selesai. Batalkan alih-alih menghapus jika perjalanan batal.
6. Cari riwayat lewat Trips/Customer. Tanggal dashboard mengikuti perangkat operator; pastikan zona waktu/jam perangkat benar.

## Data dan migrasi
Entitas tetap `customers`, `drivers`, `vehicles`, `trips` di D1. ID UUID; tanggal `YYYY-MM-DD`, jam `HH:mm`, timestamp UTC ISO 8601. Harga integer rupiah 0–1.000.000.000 atau null; penumpang 1–100. Nomor/catatan opsional. Driver/kendaraan nullable sebelum assignment lengkap. FK tidak cascade-delete sehingga riwayat terlindungi.

- `migrations/0001_initial.sql`: schema awal dengan CREATE IF NOT EXISTS, aman pada database lama.
- `migrations/0002_integrity.sql`: indeks tambahan dan trigger validasi/status/assignment. Tidak DROP, DELETE, rebuild, atau rewrite record lama. Record historis yang tidak mengikuti aturan baru tetap dipertahankan; perubahan berikutnya harus valid.
- `schema.sql`: schema lengkap instalasi baru; gunakan migrations untuk upgrade, jangan reset database produksi.
- `wrangler.jsonc`: konfigurasi Pages utama, binding DB ke ID database nyata yang diperoleh dari Cloudflare.
- `wrangler.toml`: konfigurasi Worker asli tetap tersedia untuk jalur alternatif, `run_worker_first=true` mencegah assets melewati autentikasi. Worker alternatif tidak dideploy pada pekerjaan ini.
- `.dev.vars`: secret lokal, `.env.production`: salinan handover privat saat pelaksanaan; keduanya diabaikan Git dan tidak masuk build. Jangan membagikan atau menyertakannya dalam backup umum.

## API
Semua route memerlukan autentikasi. JSON sukses: `{ "data": ... }`; daftar juga `{ "has_more": true/false }`. Error: `{ "error": "pesan aman" }`. POST 201, GET/PATCH 200; validasi 400, auth 401, CSRF 403, tidak ditemukan 404, konflik workflow 409, payload besar 413, tipe konten 415. Metode yang tidak tersedia 405; kegagalan internal 500 tanpa detail database.

- `GET/POST /api/trips`, `GET/PATCH /api/trips/:id`
- `PATCH /api/trips/:id/assignment`: `driver_id`, `vehicle_id` (ID atau null)
- `GET/POST /api/customers`, `GET/PATCH /api/customers/:id`
- `GET /api/customers/:id/trips`
- `GET/POST /api/drivers`, `GET/PATCH /api/drivers/:id`
- `GET/POST /api/vehicles`, `GET/PATCH /api/vehicles/:id`
- `GET /api/dashboard?date=YYYY-MM-DD`

Kolom trip: `customer_id`, `trip_date`, `trip_time`, `pickup`, `destination`, `passengers`, `price`, `partner_source`, `notes`, `status`. Trip baru selalu PENDING; buat customer lewat API customer terlebih dahulu. Kolom customer: `name`, `whatsapp`, `notes`; driver menambah `active` boolean; kendaraan memakai `name`, `identifier`, `notes`, `active` boolean.

Filter trips: `from`, `to`, `status`, `q`, `attention=YYYY-MM-DD`, `open=1`; daftar dan riwayat mendukung `limit` (1–100, default 50), `offset` (default 0). UI default tidak memuat seluruh riwayat. Jangan memasukkan nomor telepon/catatan ke query URL. Semua mutation memerlukan `Content-Type: application/json` dan header `X-Requested-With: FamilyTransport`; Origin berbeda/cross-site ditolak.

## Keamanan
- Validasi tipe/kolom, tanggal kalender, jam, rentang angka, ID, status, kontak, panjang teks, dan payload maksimal 16 KiB.
- Query berparameter; nama tabel/kolom berasal dari allowlist server, bukan input user.
- UI memakai textContent/DOM API, bukan innerHTML untuk data; CSP tanpa unsafe-inline/eval.
- CSP, nosniff, DENY framing, no-referrer, no-store, HSTS, dan pembatasan izin browser.
- Error database disamarkan; tidak ada logging request body, nomor customer, catatan, stack trace, atau secrets. Pemindai secrets melaporkan lokasi, bukan nilai.
- Tidak menyimpan data pribadi di localStorage, tidak menggunakan CDN analytics atau WhatsApp API.
- Pemindaian pola history dan pengecekan nilai secrets aktif tidak menemukan secrets dalam source/Git. Pemindai pola bukan jaminan audit kredensial sempurna.

## Pengembangan dan pengujian
Node 22, Python 3, npm. `npm ci` menggunakan lockfile.

```sh
npm ci
npm run typecheck
npm run build
npm run db:local
# Isi OPERATOR_PASSWORD acak lokal dalam .dev.vars yang diabaikan Git.
# Start preview dengan ecosystem.config.cjs melalui PM2, port 3000.
# Setelah preview aktif:
npm test
npx playwright install --with-deps chromium
npm run test:ui
npm run validate:deploy
npm audit
python3 scripts/security-scan.py
```

`node scripts/check.mjs` menjalankan runner CI lokal: membuat secret sintetis lokal (mengganti .dev.vars), menerapkan migrasi lokal, menjalankan preview, tes API/security/schema/browser, lalu menghentikan preview. Jangan jalankan bersamaan dengan preview port 3000 yang sudah aktif.

Hasil yang telah dieksekusi: Node test runner 62 pass, 0 fail (57 kasus API, 4 security, 1 wrapper suite); Python 9 pass; browser 14 checks pass; typecheck/build/dry-run pass; npm audit 0 vulnerabilities. Lint tidak dikonfigurasi; sintaks frontend diperiksa dengan `node --check public/app.js`. D1 local/remote foreign_key_check tanpa pelanggaran; integrity_check SQLite lokal `ok` (pragma integrity_check tidak diizinkan runtime D1, jadi diperiksa lewat SQLite lokal).

## Deployment BYOK dan CI
Tidak memakai Hosted Genspark; aplikasi ada di akun Cloudflare pengguna.

1. API token Cloudflare tersedia aman lewat Deploy panel atau environment CI, izin Pages Edit dan D1 Edit pada akun yang sesuai. Jangan menjalankan wrangler login/OAuth sandbox.
2. Proyek `family-transport-manager` dan database D1 telah dibuat; binding memakai ID nyata pada kedua konfigurasi.
3. Provision secret lewat `npx wrangler pages secret put OPERATOR_PASSWORD --project-name family-transport-manager` (stdin/prompt, tidak hardcode).
4. `npm run db:remote`, lalu `npm run deploy` (build bersih dan deploy branch main).
5. `node tests/production-smoke.mjs` memerlukan .env.production privat dan token D1 cleanup di environment. Menciptakan dan membersihkan hanya record sintetis milik run; jangan gunakan sebagai pilot data nyata.

Workflow `.github/workflows/deploy.yml` melakukan install terkunci, scan, typecheck, build, migrasi lokal, tes, audit, lalu migrasi remote dan deploy. Administrator repository perlu memastikan Actions secrets `CLOUDFLARE_API_TOKEN` dan `CLOUDFLARE_ACCOUNT_ID` tersedia di Settings → Secrets and variables → Actions; integrasi saat ini tidak mempunyai izin mengelolanya (HTTP 403). Secret operator tetap disimpan di Pages, bukan dibake oleh CI. Preview branch tanpa secret akan fail closed.

## Batas dan langkah operasional berikutnya
Seluruh fitur MVP yang diminta telah diimplementasikan. Belum dilaksanakan: pilot langsung dengan Fahruk dan customer nyata; pengujian menggunakan data sintetis. Konfirmasi akses dan coba satu perjalanan nyata sebagai handover, bukan penambahan fitur. Aktivasi/verifikasi auto-deploy CI memerlukan izin GitHub Actions secrets di atas. Pembayaran, GPS, accounting, akun customer/driver, WhatsApp API, AI, dan multi-tenant tetap sengaja di luar scope.
