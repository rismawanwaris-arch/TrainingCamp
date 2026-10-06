const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const slugify = require('slugify');
const fs = require('fs');
const db = require('../database/db');

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
    const { name, icon = 'folder', description = '', order_index = 0 } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Nama kategori wajib diisi' });
    }
    const slug = createUniqueSlug('categories', name);
    const stmt = db.prepare(`
      INSERT INTO categories (name, slug, icon, description, order_index)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(name.trim(), slug, icon || 'folder', description, parseInt(order_index) || 0);
    res.json({ success: true, data: { id: info.lastInsertRowid, name, slug } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/categories/:id', (req, res) => {
  try {
    const { name, icon, description, order_index } = req.body;
    const catId = req.params.id;
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(catId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Kategori tidak ditemukan' });
    }

    const slug = name && name !== existing.name ? createUniqueSlug('categories', name, catId) : existing.slug;

    db.prepare(`
      UPDATE categories
      SET name = ?, slug = ?, icon = ?, description = ?, order_index = ?
      WHERE id = ?
    `).run(
      name || existing.name,
      slug,
      icon !== undefined ? icon : existing.icon,
      description !== undefined ? description : existing.description,
      order_index !== undefined ? parseInt(order_index) : existing.order_index,
      catId
    );

    res.json({ success: true, message: 'Kategori berhasil diperbarui' });
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
    const { category_id, title, summary, content, tags, status = 'published' } = req.body;

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
      INSERT INTO tutorials (category_id, title, slug, summary, content, thumbnail, tags, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      category_id,
      title.trim(),
      slug,
      summary || '',
      content,
      thumbnail,
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

    const { category_id, title, summary, content, tags, status } = req.body;

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
          thumbnail = ?, tags = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      category_id || existing.category_id,
      title ? title.trim() : existing.title,
      slug,
      summary !== undefined ? summary : existing.summary,
      content !== undefined ? content : existing.content,
      thumbnail,
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
