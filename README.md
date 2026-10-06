# Panduan Platform Tutorial & Knowledgebase Internal (TrainingCamp)

Platform web internal untuk dokumentasi dan panduan tutorial ala [Bee.id Knowledgebase](https://www.bee.id/knowledgebase-beeaccounting/). Dilengkapi antarmuka pembaca modern serta panel **Administrator Console** untuk upload dan kelola tutorial.

---

## 🚀 Cara Menjalankan

### A. Menjalankan di Komputer Lokal
```bash
cd /Users/wisnuwar/Documents/Coding/TraningCamp
npm start
```
- **Portal Publik:** http://localhost:3000
- **Admin Console:** http://localhost:3000/admin

---

### B. Deployment ke ZimaOS (Port 5001)

Konfigurasi Docker & Compose siap pakai telah disediakan:
* Port container telah diatur ke **`5001`**.
* Data SQLite dan direktori upload gambar dipersistensikan di folder `/app/data` (volume aman saat container restart/update).

#### Cara 1: Deploy via ZimaOS Web UI (Custom App / Import)
1. Salin seluruh folder `TraningCamp` ini ke storage ZimaOS Anda, misalnya di `/DATA/AppData/trainingcamp`.
2. Di dashboard **ZimaOS / CasaOS**, buka **App Store** > klik **Custom Install** (atau klik ikon **+** di pojok kanan atas).
3. Klik tombol **Import** (ikon dokumen di pojok kanan atas form install).
4. Paste isi dari file [docker-compose-zimaos.yml](file:///Users/wisnuwar/Documents/Coding/TraningCamp/docker-compose-zimaos.yml) atau [docker-compose.yml](file:///Users/wisnuwar/Documents/Coding/TraningCamp/docker-compose.yml).
5. Klik **Submit / Install**. Aplikasi akan muncul di dashboard ZimaOS dan dapat diakses di `http://<IP-ZIMAOS>:5001`.

#### Cara 2: Deploy via Terminal / SSH di ZimaOS
```bash
# Masuk ke direktori project di ZimaOS
cd /DATA/AppData/trainingcamp

# Build dan jalankan container
docker compose up -d --build
```
Aplikasi langsung aktif di port **5001**:
* **Website Utama:** `http://<IP-ZIMAOS>:5001`
* **Admin Dashboard:** `http://<IP-ZIMAOS>:5001/admin`

---

## 🛠️ Fitur Utama Platform

### 1. Portal Knowledgebase Publik (`/`)
- **Pencarian Real-Time**: Kolom pencarian hero section untuk menemukan tutorial berdasarkan judul, isi konten, atau tag.
- **Kategori Modul**: Grid kategori dengan ikon representatif, badge jumlah tutorial, dan deskripsi modul.
- **Penyortiran Tutorial**: Filter tutorial berdasarkan Terbaru, Terpopuler (pembaca terbanyak), atau Alfabetis.
- **Tampilan Artikel Detail (`/tutorial/:slug`)**:
  - Breadcrumb navigasi.
  - Tip box & highlight panduan interaktif.
  - Widget umpan balik pembaca (*"Apakah tutorial ini membantu?"*).
  - Sidebar tutorial terkait dalam kategori yang sama.
  - Auto-increment penghitung pembaca (*views count*).

### 2. Administrator Console (`/admin`)
- **Dashboard Ringkasan**: Statistik total tutorial, artikel terbit, jumlah modul kategori, total pembaca (*views*), serta tabel tutorial terbaru dan terpopuler.
- **Formulir Upload Tutorial Baru**:
  - Form input judul, kategori modul, dan status publikasi (Published / Draft).
  - **Quill Rich Text Editor**: Format heading, bullet/nomor urut, kode, dan cetak tebal.
  - **Image Uploader Langsung**: Mengunggah screenshot step-by-step langsung ke dalam teks panduan via API `/api/admin/upload-image`.
  - Input Tag dan Upload Gambar Sampul (Thumbnail).
- **Manajemen Kategori**: Menambah, mengedit ikon FontAwesome, dan menghapus kategori.
- **Manajemen Tutorial**: Fitur pencarian, filter kategori, pengeditan dokumen panduan, dan penghapusan tutorial.

---

## 🗄️ Struktur Proyek

```text
TraningCamp/
├── package.json
├── tutorials.db             # Database SQLite lokal (WAL mode aktif)
├── public/                  # Asset web publik
│   ├── index.html           # Halaman beranda knowledgebase
│   ├── tutorial.html        # Halaman baca artikel tutorial
│   ├── admin.html           # Dashboard & upload console admin
│   ├── css/
│   │   ├── style.css        # Styling tema ala Bee.id (biru korporat)
│   │   └── admin.css        # Styling layout admin console
│   ├── js/
│   │   └── admin.js         # Logika interaktif admin & Quill uploader
│   └── uploads/             # Folder penyimpanan gambar & screenshot
└── src/
    ├── server.js            # Server Express.js
    ├── database/
    │   └── db.js            # Inisialisasi skema & seed kategori bawaan
    └── routes/
        ├── publicRoutes.js  # REST API publik (artikel & kategori)
        └── adminRoutes.js   # REST API admin (upload, CRUD, stats)
```
