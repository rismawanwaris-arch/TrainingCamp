const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = process.env.DATA_DIR || path.join(__dirname, '../../');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'tutorials.db');
const db = new Database(dbPath);

// Enable foreign keys and WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    icon TEXT DEFAULT 'folder',
    description TEXT,
    order_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tutorials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    summary TEXT,
    content TEXT NOT NULL,
    thumbnail TEXT,
    video_url TEXT,
    tags TEXT,
    status TEXT DEFAULT 'published', -- 'published' or 'draft'
    views_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tutorial_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tutorial_id INTEGER NOT NULL,
    visitor_id TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tutorial_id) REFERENCES tutorials(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_views_lookup ON tutorial_views(tutorial_id, visitor_id, viewed_at);

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
  );
`);

// Migration: Tambahkan kolom video_url jika belum ada di database lama
try {
  db.prepare("ALTER TABLE tutorials ADD COLUMN video_url TEXT").run();
} catch (e) {
  // Kolom sudah ada
}

// Password hashing helper using Node.js built-in crypto (PBKDF2)
const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalHash] = storedHash.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

// Seed default admin user if not exists
const countAdmin = db.prepare('SELECT COUNT(*) as count FROM admin_users').get();
if (countAdmin.count === 0) {
  const defaultPass = process.env.ADMIN_PASSWORD || 'admin123';
  const hashed = hashPassword(defaultPass);
  db.prepare(`
    INSERT INTO admin_users (username, password_hash, full_name)
    VALUES (?, ?, ?)
  `).run('admin', hashed, 'Administrator');
  console.log('Default admin account created: username "admin"');
}

// Seed default categories if empty
const countCat = db.prepare('SELECT COUNT(*) as count FROM categories').get();
if (countCat.count === 0) {
  const insertCat = db.prepare('INSERT INTO categories (name, slug, icon, description, order_index) VALUES (?, ?, ?, ?, ?)');
  
  const defaultCategories = [
    ['Memulai Cepat & Dasar', 'memulai-cepat-dan-dasar', 'fa-solid fa-rocket', 'Panduan awal instalasi, login, dan setup sistem pertama kali', 1],
    ['Master Data & Kontak', 'master-data-kontak', 'fa-solid fa-address-book', 'Manajemen barang, jasa, pelanggan, supplier, dan akun', 2],
    ['Penjualan & Kasir (POS)', 'penjualan-dan-pos', 'fa-solid fa-cash-register', 'Transaksi kasir, pesanan penjualan, invoice, dan retur jual', 3],
    ['Pembelian & Stok Gudang', 'pembelian-dan-stok', 'fa-solid fa-boxes-stacked', 'Penerimaan barang, PO supplier, mutasi gudang, dan opname', 4],
    ['Keuangan & Akuntansi', 'keuangan-akuntansi', 'fa-solid fa-scale-balanced', 'Kas/Bank, jurnal memorial, buku besar, dan neraca saldo', 5],
    ['Troubleshooting & FAQ', 'troubleshooting-faq', 'fa-solid fa-wrench', 'Panduan solusi kendala umum, error sistem, dan pemeliharaan', 6]
  ];

  for (const cat of defaultCategories) {
    insertCat.run(...cat);
  }
}

module.exports = db;
module.exports.db = db;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
