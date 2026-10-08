const express = require('express');
const cors = require('cors');
const path = require('path');
const publicRoutes = require('./routes/publicRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Static files
app.use(express.static(path.join(__dirname, '../public')));
if (process.env.UPLOADS_DIR) {
  app.use('/uploads', express.static(process.env.UPLOADS_DIR));
}

// API Routes
app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

// SPA / Clean URL fallbacks for public & admin views
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/tutorial/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/tutorial.html'));
});

app.get('/category/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/category.html'));
});

app.get('{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Portal Knowledgebase Tutorial & Training Camp aktif!`);
  console.log(`🌐 Website Utama:  http://localhost:${PORT}`);
  console.log(`🛠️  Admin Console:  http://localhost:${PORT}/admin`);
  console.log(`=======================================================`);
});
