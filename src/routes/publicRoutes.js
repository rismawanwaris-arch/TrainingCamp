const express = require('express');
const router = express.Router();
const db = require('../database/db');

// GET all categories with count of published tutorials (exclude locked categories for public)
router.get('/categories', (req, res) => {
  try {
    const categories = db.prepare(`
      SELECT c.*, COUNT(t.id) as tutorial_count 
      FROM categories c 
      LEFT JOIN tutorials t ON c.id = t.category_id AND t.status = 'published'
      WHERE c.is_locked = 0
      GROUP BY c.id 
      ORDER BY c.order_index ASC, c.name ASC
    `).all();
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET category by slug with its tutorials
router.get('/categories/:slug', (req, res) => {
  try {
    const category = db.prepare('SELECT * FROM categories WHERE slug = ?').get(req.params.slug);
    if (!category) {
      return res.status(404).json({ success: false, error: 'Kategori tidak ditemukan' });
    }
    if (category.is_locked === 1) {
      return res.status(403).json({ success: false, error: 'Kategori ini sedang dikunci oleh administrator' });
    }

    const tutorials = db.prepare(`
      SELECT id, title, slug, summary, thumbnail, tags, views_count, created_at, updated_at
      FROM tutorials 
      WHERE category_id = ? AND status = 'published'
      ORDER BY created_at DESC
    `).all(category.id);

    res.json({ success: true, data: { ...category, tutorials } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET tutorials list (search, filter by tag, pagination, popular)
router.get('/tutorials', (req, res) => {
  try {
    const { q, category_id, tag, sort = 'latest', limit = 20, page = 1 } = req.query;
    let conditions = ["t.status = 'published'", "c.is_locked = 0"];
    let params = [];

    if (q) {
      conditions.push("(t.title LIKE ? OR t.summary LIKE ? OR t.content LIKE ? OR t.tags LIKE ?)");
      const term = `%${q}%`;
      params.push(term, term, term, term);
    }

    if (category_id) {
      conditions.push("t.category_id = ?");
      params.push(category_id);
    }

    if (tag) {
      conditions.push("t.tags LIKE ?");
      params.push(`%${tag}%`);
    }

    let orderBy = 't.created_at DESC';
    if (sort === 'popular') {
      orderBy = 't.views_count DESC, t.created_at DESC';
    } else if (sort === 'title') {
      orderBy = 't.title ASC';
    }

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const tutorials = db.prepare(`
      SELECT t.id, t.title, t.slug, t.summary, t.thumbnail, t.tags, t.views_count, t.created_at, t.updated_at,
             c.name as category_name, c.slug as category_slug, c.icon as category_icon
      FROM tutorials t
      JOIN categories c ON t.category_id = c.id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    const totalCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM tutorials t
      JOIN categories c ON t.category_id = c.id
      ${whereClause}
    `).get(...params).count;

    res.json({
      success: true,
      data: tutorials,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single tutorial by slug (real views tracking with spam prevention)
router.get('/tutorials/:slug', (req, res) => {
  try {
    const tutorial = db.prepare(`
      SELECT t.*, c.name as category_name, c.slug as category_slug, c.icon as category_icon, c.is_locked
      FROM tutorials t
      JOIN categories c ON t.category_id = c.id
      WHERE t.slug = ? AND t.status = 'published'
    `).get(req.params.slug);

    if (!tutorial) {
      return res.status(404).json({ success: false, error: 'Tutorial tidak ditemukan' });
    }

    if (tutorial.is_locked === 1) {
      return res.status(403).json({ success: false, error: 'Tutorial ini berada di dalam kategori yang dikunci' });
    }

    // Identifikasi pengunjung (via header x-visitor-id, cookie, atau IP + User-Agent)
    const visitorId = req.headers['x-visitor-id'] || req.ip || 'anonymous';
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    // Cek apakah pengunjung ini sudah membaca tutorial ini dalam kurun waktu 30 menit terakhir
    // Ini mencegah spam refresh (F5 berkali-kali) agar angka pembaca benar-benar REAL
    const recentView = db.prepare(`
      SELECT id FROM tutorial_views
      WHERE tutorial_id = ? AND visitor_id = ?
        AND viewed_at >= datetime('now', '-30 minutes')
    `).get(tutorial.id, visitorId);

    if (!recentView) {
      // Catat log view baru
      db.prepare(`
        INSERT INTO tutorial_views (tutorial_id, visitor_id, ip_address, user_agent)
        VALUES (?, ?, ?, ?)
      `).run(tutorial.id, visitorId, ipAddress, userAgent);

      // Increment total real views
      db.prepare('UPDATE tutorials SET views_count = views_count + 1 WHERE id = ?').run(tutorial.id);
      tutorial.views_count += 1;
    }

    // Get related tutorials in same category
    const related = db.prepare(`
      SELECT id, title, slug, summary, created_at, views_count
      FROM tutorials
      WHERE category_id = ? AND id != ? AND status = 'published'
      ORDER BY views_count DESC
      LIMIT 5
    `).all(tutorial.category_id, tutorial.id);

    res.json({
      success: true,
      data: {
        ...tutorial,
        related
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET stats summary
router.get('/stats', (req, res) => {
  try {
    const totalTutorials = db.prepare("SELECT COUNT(*) as count FROM tutorials WHERE status = 'published'").get().count;
    const totalCategories = db.prepare("SELECT COUNT(*) as count FROM categories").get().count;
    const totalViews = db.prepare("SELECT SUM(views_count) as count FROM tutorials").get().count || 0;

    res.json({
      success: true,
      data: {
        totalTutorials,
        totalCategories,
        totalViews
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
