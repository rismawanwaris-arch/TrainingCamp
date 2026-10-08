const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/db');

const UNLOCK_SECRET = process.env.UNLOCK_SECRET || 'trainingcamp_unlock_cat_secret_2026';

function getClientIp(req) {
  let ip = req.headers['cf-connecting-ip'] || 
           req.headers['x-real-ip'] || 
           (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) || 
           req.ip || 
           req.socket?.remoteAddress || 
           '';
  if (typeof ip === 'string') {
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }
    if (ip === '::1') {
      ip = '127.0.0.1';
    }
  }
  return ip || '127.0.0.1';
}

function generateUnlockToken(categoryId) {
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 hari
  const payload = `${categoryId}:${expiresAt}`;
  const sig = crypto.createHmac('sha256', UNLOCK_SECRET).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

function isTokenValidForCategory(token, categoryId) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split(':');
  if (parts.length !== 3) return false;
  const [tokenCatId, expiresAtStr, sig] = parts;
  if (parseInt(tokenCatId) !== parseInt(categoryId)) return false;
  if (Date.now() > parseInt(expiresAtStr)) return false;
  const expectedSig = crypto.createHmac('sha256', UNLOCK_SECRET).update(`${tokenCatId}:${expiresAtStr}`).digest('hex');
  return sig === expectedSig;
}

function checkCategoryAccess(req, categoryId) {
  // 1. Cek apakah ada admin session yang valid (Admin selalu memiliki akses)
  const adminToken = req.headers['x-admin-token'];
  if (adminToken) {
    const session = db.prepare('SELECT user_id FROM admin_sessions WHERE token = ?').get(adminToken);
    if (session) return true;
  }

  // 2. Cek header unlock kategori (bisa berupa JSON map { [catId]: token } atau string token langsung)
  const unlockHeader = req.headers['x-unlocked-categories'];
  if (unlockHeader) {
    try {
      const parsed = JSON.parse(unlockHeader);
      if (parsed && typeof parsed === 'object') {
        const token = parsed[categoryId];
        if (isTokenValidForCategory(token, categoryId)) return true;
      }
    } catch (e) {
      if (isTokenValidForCategory(unlockHeader, categoryId)) return true;
    }
  }

  const singleToken = req.headers['x-category-token'] || req.query.unlock_token;
  if (singleToken && isTokenValidForCategory(singleToken, categoryId)) {
    return true;
  }

  return false;
}

// GET all categories with count of published tutorials (semua kategori ditampilkan ke publik)
router.get('/categories', (req, res) => {
  try {
    const categories = db.prepare(`
      SELECT c.id, c.name, c.slug, c.icon, c.description, c.order_index, c.is_locked, c.created_at,
             COUNT(t.id) as tutorial_count 
      FROM categories c 
      LEFT JOIN tutorials t ON c.id = t.category_id AND t.status = 'published'
      GROUP BY c.id 
      ORDER BY c.order_index ASC, c.name ASC
    `).all();
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST verify password to unlock a locked category
router.post('/categories/:id/verify-password', (req, res) => {
  try {
    const catId = req.params.id;
    const category = db.prepare('SELECT id, name, is_locked, access_password FROM categories WHERE id = ?').get(catId);
    if (!category) {
      return res.status(404).json({ success: false, error: 'Kategori tidak ditemukan' });
    }

    if (category.is_locked === 0) {
      return res.json({ success: true, message: 'Kategori ini tidak terkunci', unlocked: true });
    }

    const { password } = req.body || {};
    if (!password || !password.trim()) {
      return res.status(400).json({ success: false, error: 'Silakan masukkan password untuk membuka kategori ini' });
    }

    const inputPass = password.trim();
    let isMatch = false;

    if (category.access_password && category.access_password.trim()) {
      isMatch = (inputPass === category.access_password.trim());
    } else {
      // Fallback ke password admin jika password khusus kategori belum diset
      const admin = db.prepare('SELECT password_hash FROM admin_users ORDER BY id ASC LIMIT 1').get();
      if (admin && db.verifyPassword) {
        isMatch = db.verifyPassword(inputPass, admin.password_hash);
      }
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Password salah! Silakan coba lagi atau tanyakan ke admin.' });
    }

    const token = generateUnlockToken(category.id);
    res.json({
      success: true,
      message: `Akses kategori "${category.name}" berhasil dibuka!`,
      token,
      category_id: category.id
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET category by slug with its tutorials
router.get('/categories/:slug', (req, res) => {
  try {
    const category = db.prepare('SELECT id, name, slug, icon, description, order_index, is_locked FROM categories WHERE slug = ?').get(req.params.slug);
    if (!category) {
      return res.status(404).json({ success: false, error: 'Kategori tidak ditemukan' });
    }

    if (category.is_locked === 1) {
      const hasAccess = checkCategoryAccess(req, category.id);
      if (!hasAccess) {
        return res.json({
          success: true,
          is_locked: true,
          data: {
            ...category,
            tutorials: []
          }
        });
      }
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
    let conditions = ["t.status = 'published'"];
    let params = [];

    // Jika difilter spesifik per kategori yang terkunci, cek izin akses
    if (category_id) {
      const cat = db.prepare('SELECT id, is_locked FROM categories WHERE id = ?').get(category_id);
      if (cat && cat.is_locked === 1) {
        const hasAccess = checkCategoryAccess(req, cat.id);
        if (!hasAccess) {
          return res.json({
            success: true,
            is_locked: true,
            data: [],
            pagination: { page: 1, limit: parseInt(limit), total: 0, totalPages: 0 }
          });
        }
      }
      conditions.push("t.category_id = ?");
      params.push(category_id);
    }

    if (q) {
      conditions.push("(t.title LIKE ? OR t.summary LIKE ? OR t.content LIKE ? OR t.tags LIKE ?)");
      const term = `%${q}%`;
      params.push(term, term, term, term);
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
             c.id as category_id, c.name as category_name, c.slug as category_slug, c.icon as category_icon, c.is_locked as category_is_locked
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
      const hasAccess = checkCategoryAccess(req, tutorial.category_id);
      if (!hasAccess) {
        return res.json({
          success: true,
          is_locked: true,
          data: {
            id: tutorial.id,
            title: tutorial.title,
            slug: tutorial.slug,
            category_id: tutorial.category_id,
            category_name: tutorial.category_name,
            category_icon: tutorial.category_icon,
            created_at: tutorial.created_at,
            summary: tutorial.summary
          }
        });
      }
    }

    // Identifikasi pengunjung (via header x-visitor-id, cookie, atau IP + User-Agent)
    const ipAddress = getClientIp(req);
    const visitorId = req.headers['x-visitor-id'] || ipAddress || 'anonymous';
    const userAgent = req.headers['user-agent'] || '';

    // Cek apakah pengunjung ini sudah membaca tutorial ini dalam kurun waktu 2 menit terakhir
    // Ini mencegah spam refresh (F5 berkali-kali) agar angka pembaca akurat dan live tracking responsif
    const recentView = db.prepare(`
      SELECT id FROM tutorial_views
      WHERE tutorial_id = ? AND (visitor_id = ? OR ip_address = ?)
        AND viewed_at >= datetime('now', '-2 minutes')
    `).get(tutorial.id, visitorId, ipAddress);

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
