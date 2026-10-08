const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const slugify = require('slugify');
const fs = require('fs');
const crypto = require('crypto');
const { db, dbPath, hashPassword, verifyPassword } = require('../database/db');

// Setup multer storage for database restore upload (.db or .sqlite)
const uploadDb = multer({
  dest: path.join(__dirname, '../../public/uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.db') || file.originalname.endsWith('.sqlite') || file.mimetype.includes('sqlite') || file.mimetype.includes('octet-stream')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file database SQLite (.db) yang diperbolehkan!'));
    }
  }
});

// Middleware untuk memverifikasi session token admin
function authMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Akses ditolak: Silakan login terlebih dahulu' });
  }

  const session = db.prepare(`
    SELECT s.token, u.id as user_id, u.username, u.full_name
    FROM admin_sessions s
    JOIN admin_users u ON s.user_id = u.id
    WHERE s.token = ?
  `).get(token);

  if (!session) {
    return res.status(401).json({ success: false, error: 'Sesi login telah kedaluwarsa atau tidak valid' });
  }

  req.admin = session;
  next();
}

// ----------------- AUTHENTICATION ROUTES -----------------
// Login
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username dan password wajib diisi' });
    }

    const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username.trim());
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: 'Username atau password salah!' });
    }

    // Generate session token
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO admin_sessions (token, user_id) VALUES (?, ?)').run(token, user.id);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Check Session
router.get('/check-auth', authMiddleware, (req, res) => {
  res.json({ success: true, user: req.admin });
});

// Logout
router.post('/logout', (req, res) => {
  const token = req.headers['x-admin-token'] || req.body.token;
  if (token) {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
  }
  res.json({ success: true, message: 'Berhasil logout' });
});

// Change Password
router.post('/change-password', authMiddleware, (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Password lama dan baru wajib diisi' });
    }
    if (newPassword.length < 5) {
      return res.status(400).json({ success: false, error: 'Password baru minimal 5 karakter' });
    }

    const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.admin.user_id);
    if (!verifyPassword(oldPassword, user.password_hash)) {
      return res.status(400).json({ success: false, error: 'Password lama tidak sesuai' });
    }

    const newHash = hashPassword(newPassword);
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(newHash, user.id);

    res.json({ success: true, message: 'Password berhasil diubah!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------- USER MANAGEMENT ROUTES -----------------
// GET all users
router.get('/users', authMiddleware, (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, full_name, role, created_at FROM admin_users ORDER BY id ASC').all();
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST add new user
router.post('/users', authMiddleware, (req, res) => {
  try {
    const { username, password, full_name, role = 'admin' } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ success: false, error: 'Username wajib diisi' });
    }
    if (!password || password.length < 5) {
      return res.status(400).json({ success: false, error: 'Password wajib minimal 5 karakter' });
    }
    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ success: false, error: 'Nama lengkap wajib diisi' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(cleanUsername);
    if (existing) {
      return res.status(400).json({ success: false, error: 'Username sudah digunakan, silakan pilih yang lain' });
    }

    const hashed = hashPassword(password);
    const info = db.prepare(`
      INSERT INTO admin_users (username, password_hash, full_name, role)
      VALUES (?, ?, ?, ?)
    `).run(cleanUsername, hashed, full_name.trim(), role);

    res.json({
      success: true,
      message: 'User baru berhasil ditambahkan',
      data: { id: info.lastInsertRowid, username: cleanUsername, full_name: full_name.trim(), role }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE user
router.delete('/users/:id', authMiddleware, (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (targetId === req.admin.user_id) {
      return res.status(400).json({ success: false, error: 'Anda tidak bisa menghapus akun Anda sendiri saat sedang login!' });
    }

    const countUsers = db.prepare('SELECT COUNT(*) as count FROM admin_users').get().count;
    if (countUsers <= 1) {
      return res.status(400).json({ success: false, error: 'Tidak dapat menghapus user terakhir dalam sistem' });
    }

    db.prepare('DELETE FROM admin_users WHERE id = ?').run(targetId);
    res.json({ success: true, message: 'User berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------- DATABASE BACKUP & RESTORE ROUTES -----------------
// Download Backup Database (.db)
router.get('/backup-db', authMiddleware, (req, res) => {
  try {
    // Flush WAL to disk first so backup contains the absolute latest data
    db.pragma('wal_checkpoint(TRUNCATE)');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `tutorials-backup-${timestamp}.db`;

    res.download(dbPath, filename, (err) => {
      if (err) {
        console.error('Error sending backup file:', err);
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Gagal membuat backup database: ' + err.message });
  }
});

// Restore Database from uploaded .db file
router.post('/restore-db', authMiddleware, uploadDb.single('database_file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Silakan pilih file database backup (.db) terlebih dahulu' });
  }

  const uploadedFilePath = req.file.path;

  try {
    // Verifikasi bahwa file yang diupload adalah SQLite database valid
    const Database = require('better-sqlite3');
    const testDb = new Database(uploadedFilePath, { readonly: true });
    const checkTables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tutorials', 'categories')").all();
    testDb.close();

    if (checkTables.length < 2) {
      fs.unlinkSync(uploadedFilePath);
      return res.status(400).json({ success: false, error: 'File yang diupload bukan format database TrainingCamp yang valid!' });
    }

    // Flush current database
    db.pragma('wal_checkpoint(TRUNCATE)');

    // Timpa database aktif dengan file restore
    fs.copyFileSync(uploadedFilePath, dbPath);
    fs.unlinkSync(uploadedFilePath);

    // Reopen / wal checkpoint on new db
    db.pragma('wal_checkpoint(TRUNCATE)');

    res.json({
      success: true,
      message: 'Database berhasil dipulihkan (Restore Sukses)! Semua tutorial dan kategori telah kembali sesuai file backup.'
    });
  } catch (err) {
    if (fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
    res.status(500).json({ success: false, error: 'Gagal melakukan restore database: ' + err.message });
  }
});

// Lindungi seluruh endpoint admin setelah auth
router.use(authMiddleware);

// Setup multer storage for uploads (images, screenshots)
const uploadDir = process.env.UPLOADS_DIR || path.join(__dirname, '../../public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).toLowerCase().replace(/[^a-z0-9]/g, '-');
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar yang diperbolehkan!'));
    }
  }
});

// Helper slug generator with collision resolution
function createUniqueSlug(table, title, currentId = null) {
  let baseSlug = slugify(title, { lower: true, strict: true, trim: true });
  if (!baseSlug) baseSlug = 'tutorial-' + Date.now();
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    let query = `SELECT id FROM ${table} WHERE slug = ?`;
    let params = [slug];
    if (currentId) {
      query += ` AND id != ?`;
      params.push(currentId);
    }
    const exists = db.prepare(query).get(...params);
    if (!exists) break;
    slug = `${baseSlug}-${counter++}`;
  }
  return slug;
}

// ----------------- IMAGE UPLOAD (FOR RICHTEXT EDITOR) -----------------
router.post('/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Tidak ada file yang diunggah' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, url: fileUrl });
});

// ----------------- DASHBOARD STATS -----------------
router.get('/dashboard-stats', (req, res) => {
  try {
    const totalTutorials = db.prepare("SELECT COUNT(*) as count FROM tutorials").get().count;
    const publishedCount = db.prepare("SELECT COUNT(*) as count FROM tutorials WHERE status = 'published'").get().count;
    const draftCount = db.prepare("SELECT COUNT(*) as count FROM tutorials WHERE status = 'draft'").get().count;
    const totalCategories = db.prepare("SELECT COUNT(*) as count FROM categories").get().count;
    const totalViews = db.prepare("SELECT COALESCE(SUM(views_count), 0) as count FROM tutorials").get().count;

    // Statistik riil pembaca & pengunjung unik dari tabel tutorial_views
    const totalUniqueVisitors = db.prepare("SELECT COUNT(DISTINCT visitor_id) as count FROM tutorial_views").get().count;
    const todayViews = db.prepare("SELECT COUNT(*) as count FROM tutorial_views WHERE date(viewed_at) = date('now')").get().count;

    const topTutorials = db.prepare(`
      SELECT t.id, t.title, t.slug, t.views_count, c.name as category_name
      FROM tutorials t
      JOIN categories c ON t.category_id = c.id
      ORDER BY t.views_count DESC
      LIMIT 5
    `).all();

    const recentTutorials = db.prepare(`
      SELECT t.id, t.title, t.slug, t.status, t.created_at, c.name as category_name
      FROM tutorials t
      JOIN categories c ON t.category_id = c.id
      ORDER BY t.created_at DESC
      LIMIT 5
    `).all();

    // Log riil kunjungan terbaru
    const recentViewLogs = db.prepare(`
      SELECT v.viewed_at, v.ip_address, t.title as tutorial_title, t.slug as tutorial_slug, c.name as category_name
      FROM tutorial_views v
      JOIN tutorials t ON v.tutorial_id = t.id
      JOIN categories c ON t.category_id = c.id
      ORDER BY v.viewed_at DESC
      LIMIT 5
    `).all();

    res.json({
      success: true,
      data: {
        totalTutorials,
        publishedCount,
        draftCount,
        totalCategories,
        totalViews,
        totalUniqueVisitors,
        todayViews,
        topTutorials,
        recentTutorials,
        recentViewLogs
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------- CATEGORY CRUD -----------------
router.get('/categories', (req, res) => {
  try {
    const categories = db.prepare(`
      SELECT c.*, COUNT(t.id) as tutorial_count
      FROM categories c
      LEFT JOIN tutorials t ON c.id = t.category_id
      GROUP BY c.id
      ORDER BY c.order_index ASC, c.name ASC
    `).all();
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/categories', (req, res) => {
  try {
    const { name, icon = 'folder', description = '', order_index = 0, is_locked = 0, access_password = '' } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Nama kategori wajib diisi' });
    }
    const slug = createUniqueSlug('categories', name);
    const stmt = db.prepare(`
      INSERT INTO categories (name, slug, icon, description, order_index, is_locked, access_password)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(name.trim(), slug, icon || 'folder', description, parseInt(order_index) || 0, is_locked ? 1 : 0, access_password ? access_password.trim() : null);
    res.json({ success: true, data: { id: info.lastInsertRowid, name, slug } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/categories/:id', (req, res) => {
  try {
    const { name, icon, description, order_index, is_locked, access_password } = req.body;
    const catId = req.params.id;
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(catId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Kategori tidak ditemukan' });
    }

    const slug = name && name !== existing.name ? createUniqueSlug('categories', name, catId) : existing.slug;

    db.prepare(`
      UPDATE categories
      SET name = ?, slug = ?, icon = ?, description = ?, order_index = ?, is_locked = ?, access_password = ?
      WHERE id = ?
    `).run(
      name || existing.name,
      slug,
      icon !== undefined ? icon : existing.icon,
      description !== undefined ? description : existing.description,
      order_index !== undefined ? parseInt(order_index) : existing.order_index,
      is_locked !== undefined ? (is_locked ? 1 : 0) : existing.is_locked,
      access_password !== undefined ? (access_password ? access_password.trim() : null) : existing.access_password,
      catId
    );

    res.json({ success: true, message: 'Kategori berhasil diperbarui' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle lock / unlock kategori
router.patch('/categories/:id/toggle-lock', (req, res) => {
  try {
    const catId = req.params.id;
    const existing = db.prepare('SELECT is_locked, name, access_password FROM categories WHERE id = ?').get(catId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Kategori tidak ditemukan' });
    }

    const newLockState = existing.is_locked === 1 ? 0 : 1;
    const { access_password } = req.body || {};
    
    if (newLockState === 1 && access_password !== undefined) {
      db.prepare('UPDATE categories SET is_locked = ?, access_password = ? WHERE id = ?').run(
        newLockState, 
        access_password ? access_password.trim() : existing.access_password, 
        catId
      );
    } else {
      db.prepare('UPDATE categories SET is_locked = ? WHERE id = ?').run(newLockState, catId);
    }

    res.json({
      success: true,
      is_locked: newLockState,
      message: newLockState === 1
        ? `Kategori "${existing.name}" berhasil DIKUNCI (perlu password untuk diakses publik)`
        : `Kategori "${existing.name}" berhasil DIBUKA (dapat diakses bebas)`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/categories/:id', (req, res) => {
  try {
    const catId = req.params.id;
    // Check if category has tutorials
    const count = db.prepare('SELECT COUNT(*) as count FROM tutorials WHERE category_id = ?').get(catId).count;
    if (count > 0) {
      return res.status(400).json({
        success: false,
        error: `Kategori tidak dapat dihapus karena masih memiliki ${count} tutorial. Pindahkan atau hapus tutorial terlebih dahulu.`
      });
    }

    db.prepare('DELETE FROM categories WHERE id = ?').run(catId);
    res.json({ success: true, message: 'Kategori berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------- TUTORIAL CRUD -----------------
router.get('/tutorials', (req, res) => {
  try {
    const { q, category_id, status } = req.query;
    let conditions = [];
    let params = [];

    if (q) {
      conditions.push("(t.title LIKE ? OR t.summary LIKE ? OR t.tags LIKE ?)");
      const term = `%${q}%`;
      params.push(term, term, term);
    }
    if (category_id) {
      conditions.push("t.category_id = ?");
      params.push(category_id);
    }
    if (status) {
      conditions.push("t.status = ?");
      params.push(status);
    }

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const tutorials = db.prepare(`
      SELECT t.id, t.title, t.slug, t.summary, t.status, t.thumbnail, t.tags, t.views_count,
             t.created_at, t.updated_at, c.name as category_name
      FROM tutorials t
      JOIN categories c ON t.category_id = c.id
      ${whereClause}
      ORDER BY t.created_at DESC
    `).all(...params);

    res.json({ success: true, data: tutorials });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/tutorials/:id', (req, res) => {
  try {
    const tutorial = db.prepare(`
      SELECT t.*, c.name as category_name
      FROM tutorials t
      JOIN categories c ON t.category_id = c.id
      WHERE t.id = ?
    `).get(req.params.id);

    if (!tutorial) {
      return res.status(404).json({ success: false, error: 'Tutorial tidak ditemukan' });
    }
    res.json({ success: true, data: tutorial });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/tutorials', upload.single('thumbnail'), (req, res) => {
  try {
    const { category_id, title, summary, content, video_url, tags, status = 'published' } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Judul tutorial wajib diisi' });
    }
    if (!category_id) {
      return res.status(400).json({ success: false, error: 'Kategori wajib dipilih' });
    }
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, error: 'Konten tutorial wajib diisi' });
    }

    const slug = createUniqueSlug('tutorials', title);
    const thumbnail = req.file ? `/uploads/${req.file.filename}` : (req.body.thumbnail_url || null);

    const stmt = db.prepare(`
      INSERT INTO tutorials (category_id, title, slug, summary, content, thumbnail, video_url, tags, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      category_id,
      title.trim(),
      slug,
      summary || '',
      content,
      thumbnail,
      video_url || null,
      tags || '',
      status
    );

    res.json({
      success: true,
      message: 'Tutorial berhasil dibuat',
      data: { id: info.lastInsertRowid, slug }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/tutorials/:id', upload.single('thumbnail'), (req, res) => {
  try {
    const tutId = req.params.id;
    const existing = db.prepare('SELECT * FROM tutorials WHERE id = ?').get(tutId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Tutorial tidak ditemukan' });
    }

    const { category_id, title, summary, content, video_url, tags, status } = req.body;

    let slug = existing.slug;
    if (title && title.trim() !== existing.title) {
      slug = createUniqueSlug('tutorials', title, tutId);
    }

    let thumbnail = existing.thumbnail;
    if (req.file) {
      thumbnail = `/uploads/${req.file.filename}`;
    } else if (req.body.thumbnail_url !== undefined) {
      thumbnail = req.body.thumbnail_url;
    }

    db.prepare(`
      UPDATE tutorials
      SET category_id = ?, title = ?, slug = ?, summary = ?, content = ?,
          thumbnail = ?, video_url = ?, tags = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      category_id || existing.category_id,
      title ? title.trim() : existing.title,
      slug,
      summary !== undefined ? summary : existing.summary,
      content !== undefined ? content : existing.content,
      thumbnail,
      video_url !== undefined ? video_url : existing.video_url,
      tags !== undefined ? tags : existing.tags,
      status || existing.status,
      tutId
    );

    res.json({ success: true, message: 'Tutorial berhasil diperbarui', data: { id: tutId, slug } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/tutorials/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM tutorials WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Tutorial berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
