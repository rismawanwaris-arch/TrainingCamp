// Global state
let quillEditor = null;
let allTutorials = [];
let allCategories = [];
let adminToken = localStorage.getItem('tc_admin_token') || '';

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

// Helper fetch with Admin Auth Header
async function fetchAdmin(url, options = {}) {
  options.headers = options.headers || {};
  if (adminToken) {
    if (options.headers instanceof Headers) {
      options.headers.set('x-admin-token', adminToken);
    } else {
      options.headers['x-admin-token'] = adminToken;
    }
  }

  const res = await fetch(url, options);
  if (res.status === 401) {
    // Unauthorized / session expired
    localStorage.removeItem('tc_admin_token');
    adminToken = '';
    showLoginOverlay();
    throw new Error('Sesi telah berakhir, silakan login kembali.');
  }
  return res;
}

// Check auth status
async function checkAuth() {
  if (!adminToken) {
    showLoginOverlay();
    return;
  }

  try {
    const res = await fetch('/api/admin/check-auth', {
      headers: { 'x-admin-token': adminToken }
    });
    const json = await res.json();
    if (json.success) {
      hideLoginOverlay();
      initQuillEditor();
      loadDashboardStats();
      loadAdminCategories();
      loadAdminTutorials();
    } else {
      showLoginOverlay();
    }
  } catch (err) {
    showLoginOverlay();
  }
}

function showLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.style.display = 'flex';
}

function hideLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function submitLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginErrorMsg');
  const btn = document.getElementById('loginSubmitBtn');

  errBox.style.display = 'none';
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memverifikasi...';

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const json = await res.json();

    if (json.success && json.token) {
      adminToken = json.token;
      localStorage.setItem('tc_admin_token', adminToken);
      hideLoginOverlay();
      document.getElementById('loginPassword').value = '';
      if (!quillEditor) initQuillEditor();
      loadDashboardStats();
      loadAdminCategories();
      loadAdminTutorials();
    } else {
      errBox.innerText = json.error || 'Login gagal, periksa username dan password.';
      errBox.style.display = 'block';
    }
  } catch (err) {
    errBox.innerText = 'Terjadi kesalahan: ' + err.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Masuk ke Admin Console';
  }
}

async function logoutAdmin() {
  if (!confirm('Apakah Anda yakin ingin keluar dari Admin Console?')) return;
  try {
    await fetch('/api/admin/logout', {
      method: 'POST',
      headers: { 'x-admin-token': adminToken }
    });
  } catch (e) {}
  localStorage.removeItem('tc_admin_token');
  adminToken = '';
  showLoginOverlay();
}

function openPasswordModal() {
  document.getElementById('passwordModal').classList.add('active');
  document.getElementById('oldPasswordInput').value = '';
  document.getElementById('newPasswordInput').value = '';
  document.getElementById('confirmPasswordInput').value = '';
}

function closePasswordModal() {
  document.getElementById('passwordModal').classList.remove('active');
}

async function submitChangePassword() {
  const oldPassword = document.getElementById('oldPasswordInput').value;
  const newPassword = document.getElementById('newPasswordInput').value;
  const confirmPassword = document.getElementById('confirmPasswordInput').value;

  if (newPassword !== confirmPassword) {
    alert('Konfirmasi password baru tidak cocok!');
    return;
  }
  if (newPassword.length < 5) {
    alert('Password baru minimal 5 karakter!');
    return;
  }

  const btn = document.getElementById('changePassBtn');
  btn.disabled = true;
  btn.innerText = 'Menyimpan...';

  try {
    const res = await fetchAdmin('/api/admin/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword })
    });
    const json = await res.json();
    if (json.success) {
      alert('Password berhasil diperbarui! Silakan gunakan password baru ini di kemudian hari.');
      closePasswordModal();
    } else {
      alert('Gagal: ' + json.error);
    }
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Simpan Password';
  }
}

// Setup Quill Rich Text Editor with custom Image Uploader
function initQuillEditor() {
  quillEditor = new Quill('#editor-container', {
    modules: {
      toolbar: {
        container: '#editor-toolbar',
        handlers: {
          image: customImageHandler
        }
      }
    },
    theme: 'snow',
    placeholder: 'Tuliskan panduan langkah demi langkah, instruksi sistem, dan lampirkan screenshot...'
  });

  // Support direct paste (Ctrl+V / Cmd+V) from clipboard / screenshot tool
  const editorElem = document.querySelector('#editor-container .ql-editor');
  if (editorElem) {
    editorElem.addEventListener('paste', async (e) => {
      const clipboardData = e.clipboardData || window.clipboardData;
      if (!clipboardData || !clipboardData.items) return;

      for (const item of clipboardData.items) {
        if (item.type.indexOf('image') !== -1) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            await uploadAndInsertImage(file);
          }
        }
      }
    });
  }
}

async function uploadAndInsertImage(file) {
  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetchAdmin('/api/admin/upload-image', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      const range = quillEditor.getSelection(true) || { index: quillEditor.getLength() };
      quillEditor.insertEmbed(range.index, 'image', data.url);
      quillEditor.setSelection(range.index + 1);
    } else {
      alert('Gagal upload gambar: ' + (data.error || 'Terjadi kesalahan'));
    }
  } catch (err) {
    alert('Error saat mengunggah gambar: ' + err.message);
  }
}

function customImageHandler() {
  const fileInput = document.getElementById('quillImageInput');
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    await uploadAndInsertImage(file);
    fileInput.value = ''; // reset input
  };
  fileInput.click();
}

// Tab navigation
function switchTab(tabName) {
  document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');

  const navItem = document.getElementById(`nav-${tabName}`);
  const targetPane = document.getElementById(`tab-${tabName}`);

  if (navItem) navItem.classList.add('active');
  if (targetPane) targetPane.style.display = 'block';

  const titles = {
    dashboard: 'Ringkasan Dashboard',
    tutorials: 'Kelola Seluruh Tutorial',
    categories: 'Kelola Kategori Modul'
  };
  document.getElementById('pageTitle').innerText = titles[tabName] || 'Admin Console';

  if (tabName === 'dashboard') loadDashboardStats();
  if (tabName === 'tutorials') loadAdminTutorials();
  if (tabName === 'categories') loadAdminCategories();
}

// ----------------- DASHBOARD -----------------
async function loadDashboardStats() {
  try {
    const res = await fetchAdmin('/api/admin/dashboard-stats');
    const json = await res.json();
    if (!json.success) return;

    const d = json.data;
    document.getElementById('statTotalTutorials').innerText = d.totalTutorials;
    document.getElementById('statPublished').innerText = d.publishedCount;
    document.getElementById('statCategories').innerText = d.totalCategories;
    document.getElementById('statViews').innerText = d.totalViews;
    if (document.getElementById('statUniqueVisitors')) {
      document.getElementById('statUniqueVisitors').innerText = d.totalUniqueVisitors || 0;
    }

    // Render Recent
    const recentBody = document.getElementById('dashboardRecentTable');
    if (!d.recentTutorials || d.recentTutorials.length === 0) {
      recentBody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px; color:#94a3b8;"><i class="fa-regular fa-folder-open"></i> Belum ada tutorial yang di-upload</td></tr>`;
    } else {
      recentBody.innerHTML = d.recentTutorials.map(t => `
        <tr>
          <td><a href="/tutorial/${t.slug}" target="_blank" style="font-weight:600;">${escapeHtml(t.title)}</a></td>
          <td><span class="badge" style="background:#f1f5f9; padding:2px 8px; border-radius:4px; font-size:0.8rem;">${escapeHtml(t.category_name)}</span></td>
          <td><span class="status-badge ${t.status}">${t.status === 'published' ? 'Published' : 'Draft'}</span></td>
        </tr>
      `).join('');
    }

    // Render Top Views
    const topBody = document.getElementById('dashboardTopTable');
    if (!d.topTutorials || d.topTutorials.length === 0) {
      topBody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px; color:#94a3b8;"><i class="fa-regular fa-chart-bar"></i> Belum ada data views</td></tr>`;
    } else {
      topBody.innerHTML = d.topTutorials.map(t => `
        <tr>
          <td><a href="/tutorial/${t.slug}" target="_blank" style="font-weight:600;">${escapeHtml(t.title)}</a></td>
          <td><span class="badge" style="background:#f1f5f9; padding:2px 8px; border-radius:4px; font-size:0.8rem;">${escapeHtml(t.category_name)}</span></td>
          <td><strong style="color:var(--primary);">${t.views_count}</strong> pembaca</td>
        </tr>
      `).join('');
    }

    // Render Real-time Visitor Logs
    const logBody = document.getElementById('dashboardVisitorLogsTable');
    if (logBody) {
      if (!d.recentViewLogs || d.recentViewLogs.length === 0) {
        logBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:25px; color:#94a3b8;"><i class="fa-solid fa-user-clock"></i> Belum ada aktivitas pembaca riil yang tercatat</td></tr>`;
      } else {
        logBody.innerHTML = d.recentViewLogs.map(log => `
          <tr>
            <td style="color:#64748b; font-size:0.82rem;"><i class="fa-regular fa-clock"></i> ${new Date(log.viewed_at).toLocaleTimeString('id-ID')} (${new Date(log.viewed_at).toLocaleDateString('id-ID')})</td>
            <td><a href="/tutorial/${log.tutorial_slug}" target="_blank" style="font-weight:600; color:#0f172a;">${escapeHtml(log.tutorial_title)}</a></td>
            <td><span class="badge" style="background:#f1f5f9; padding:2px 8px; border-radius:4px; font-size:0.8rem;">${escapeHtml(log.category_name)}</span></td>
            <td><code style="font-size:0.8rem; background:#f8fafc; padding:2px 6px; border-radius:4px; border:1px solid #e2e8f0;">${escapeHtml(log.ip_address || '127.0.0.1')}</code></td>
          </tr>
        `).join('');
      }
    }

  } catch (err) {
    console.error('Error load stats:', err);
  }
}

// ----------------- TUTORIALS CRUD -----------------
async function loadAdminTutorials() {
  try {
    const res = await fetchAdmin('/api/admin/tutorials');
    const json = await res.json();
    if (!json.success) return;

    allTutorials = json.data;
    renderTutorialTable(allTutorials);
  } catch (err) {
    console.error('Error loading tutorials:', err);
  }
}

function renderTutorialTable(list) {
  const tbody = document.getElementById('adminTutorialTableBody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:40px; color:#94a3b8;">Tidak ada tutorial yang cocok.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((t, index) => `
    <tr>
      <td style="color:#94a3b8; font-weight:600;">${index + 1}</td>
      <td>
        <a href="/tutorial/${t.slug}" target="_blank" style="font-weight:600; color:#0f172a;">${escapeHtml(t.title)}</a>
        ${t.summary ? `<div style="color:#64748b; font-size:0.8rem; margin-top:2px;">${escapeHtml(t.summary)}</div>` : ''}
      </td>
      <td><span style="background:#f1f5f9; padding:3px 8px; border-radius:6px; font-size:0.8rem; font-weight:500;">${escapeHtml(t.category_name)}</span></td>
      <td><span class="status-badge ${t.status}">${t.status === 'published' ? 'Published' : 'Draft'}</span></td>
      <td><i class="fa-regular fa-eye" style="color:#94a3b8;"></i> ${t.views_count}</td>
      <td style="color:#64748b; font-size:0.82rem;">${new Date(t.created_at).toLocaleDateString('id-ID')}</td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-outline btn-sm" onclick="editTutorial(${t.id})"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
        <button class="btn btn-outline btn-sm" style="color: #ef4444; border-color: #fecaca;" onclick="deleteTutorial(${t.id}, '${escapeHtml(t.title)}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

function filterAdminTutorials() {
  const q = document.getElementById('adminTutSearch').value.toLowerCase();
  const cat = document.getElementById('adminTutCatFilter').value;

  const filtered = allTutorials.filter(t => {
    const matchesQ = t.title.toLowerCase().includes(q) || (t.summary && t.summary.toLowerCase().includes(q));
    const matchesCat = !cat || t.category_id == cat;
    return matchesQ && matchesCat;
  });

  renderTutorialTable(filtered);
}

function openTutorialModal(tutData = null) {
  const modal = document.getElementById('tutorialModal');
  const catSelect = document.getElementById('tutFormCat');

  // Populate categories in select
  catSelect.innerHTML = allCategories.map(c => `
    <option value="${c.id}">${escapeHtml(c.name)}</option>
  `).join('');

  if (tutData) {
    document.getElementById('tutModalTitle').innerText = 'Edit Tutorial';
    document.getElementById('tutFormId').value = tutData.id;
    document.getElementById('tutFormTitle').value = tutData.title;
    document.getElementById('tutFormCat').value = tutData.category_id;
    document.getElementById('tutFormStatus').value = tutData.status;
    document.getElementById('tutFormSummary').value = tutData.summary || '';
    document.getElementById('tutFormTags').value = tutData.tags || '';
    quillEditor.root.innerHTML = tutData.content || '';
  } else {
    document.getElementById('tutModalTitle').innerText = 'Upload Tutorial Baru';
    document.getElementById('tutFormId').value = '';
    document.getElementById('tutFormTitle').value = '';
    document.getElementById('tutFormStatus').value = 'published';
    document.getElementById('tutFormSummary').value = '';
    document.getElementById('tutFormTags').value = '';
    quillEditor.root.innerHTML = '';
  }

  modal.classList.add('active');
}

function closeTutorialModal() {
  document.getElementById('tutorialModal').classList.remove('active');
}

async function editTutorial(id) {
  try {
    const res = await fetchAdmin(`/api/admin/tutorials/${id}`);
    const json = await res.json();
    if (json.success) {
      openTutorialModal(json.data);
    }
  } catch (err) {
    alert('Gagal mengambil data tutorial: ' + err.message);
  }
}

async function deleteTutorial(id, title) {
  if (!confirm(`Apakah Anda yakin ingin menghapus tutorial "${title}"?`)) return;

  try {
    const res = await fetchAdmin(`/api/admin/tutorials/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      loadAdminTutorials();
      loadDashboardStats();
    } else {
      alert('Gagal menghapus: ' + json.error);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function submitTutorial() {
  const id = document.getElementById('tutFormId').value;
  const title = document.getElementById('tutFormTitle').value.trim();
  const category_id = document.getElementById('tutFormCat').value;
  const status = document.getElementById('tutFormStatus').value;
  const summary = document.getElementById('tutFormSummary').value.trim();
  const tags = document.getElementById('tutFormTags').value.trim();
  const content = quillEditor.root.innerHTML;
  const fileInput = document.getElementById('tutFormThumbnailFile');

  if (!title) {
    alert('Judul tutorial wajib diisi');
    return;
  }
  if (!content || content === '<p><br></p>') {
    alert('Isi tutorial tidak boleh kosong');
    return;
  }

  const formData = new FormData();
  formData.append('title', title);
  formData.append('category_id', category_id);
  formData.append('status', status);
  formData.append('summary', summary);
  formData.append('tags', tags);
  formData.append('content', content);

  if (fileInput.files.length > 0) {
    formData.append('thumbnail', fileInput.files[0]);
  }

  const submitBtn = document.getElementById('tutSubmitBtn');
  submitBtn.disabled = true;
  submitBtn.innerText = 'Menyimpan...';

  try {
    const url = id ? `/api/admin/tutorials/${id}` : '/api/admin/tutorials';
    const method = id ? 'PUT' : 'POST';

    const res = await fetchAdmin(url, {
      method: method,
      body: formData
    });
    const json = await res.json();

    if (json.success) {
      closeTutorialModal();
      loadAdminTutorials();
      loadDashboardStats();
      alert('Tutorial berhasil disimpan!');
    } else {
      alert('Gagal menyimpan: ' + json.error);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Tutorial';
  }
}

// ----------------- CATEGORIES CRUD -----------------
async function loadAdminCategories() {
  try {
    const res = await fetchAdmin('/api/admin/categories');
    const json = await res.json();
    if (!json.success) return;

    allCategories = json.data;

    // Populate filter dropdown in tutorials tab
    const filterSelect = document.getElementById('adminTutCatFilter');
    if (filterSelect) {
      filterSelect.innerHTML = `<option value="">Semua Kategori</option>` +
        allCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    }

    renderCategoryTable(allCategories);
  } catch (err) {
    console.error('Error load categories:', err);
  }
}

function renderCategoryTable(list) {
  const tbody = document.getElementById('adminCategoryTableBody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;">Belum ada kategori.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((c, idx) => `
    <tr>
      <td style="color:#94a3b8; font-weight:600;">${idx + 1}</td>
      <td style="font-size:1.2rem; color:var(--primary);"><i class="${c.icon || 'fa-solid fa-folder'}"></i></td>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td><code>/${escapeHtml(c.slug)}</code></td>
      <td style="color:#64748b; font-size:0.85rem;">${escapeHtml(c.description || '-')}</td>
      <td><span style="font-weight:600;">${c.tutorial_count}</span> panduan</td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-outline btn-sm" onclick="editCategory(${c.id})"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-outline btn-sm" style="color: #ef4444; border-color: #fecaca;" onclick="deleteCategory(${c.id}, '${escapeHtml(c.name)}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

function openCategoryModal(catData = null) {
  const modal = document.getElementById('categoryModal');
  if (catData) {
    document.getElementById('catModalTitle').innerText = 'Edit Kategori';
    document.getElementById('catFormId').value = catData.id;
    document.getElementById('catFormName').value = catData.name;
    document.getElementById('catFormIcon').value = catData.icon || 'fa-solid fa-folder';
    document.getElementById('catFormDesc').value = catData.description || '';
    document.getElementById('catFormOrder').value = catData.order_index || 0;
  } else {
    document.getElementById('catModalTitle').innerText = 'Tambah Kategori Baru';
    document.getElementById('catFormId').value = '';
    document.getElementById('catFormName').value = '';
    document.getElementById('catFormIcon').value = 'fa-solid fa-folder';
    document.getElementById('catFormDesc').value = '';
    document.getElementById('catFormOrder').value = allCategories.length + 1;
  }
  modal.classList.add('active');
}

function closeCategoryModal() {
  document.getElementById('categoryModal').classList.remove('active');
}

function editCategory(id) {
  const cat = allCategories.find(c => c.id === id);
  if (cat) openCategoryModal(cat);
}

async function deleteCategory(id, name) {
  if (!confirm(`Hapus kategori "${name}"? Kategori yang masih berisi artikel tutorial tidak bisa dihapus.`)) return;

  try {
    const res = await fetchAdmin(`/api/admin/categories/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      loadAdminCategories();
      loadDashboardStats();
    } else {
      alert('Gagal: ' + json.error);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function submitCategory() {
  const id = document.getElementById('catFormId').value;
  const name = document.getElementById('catFormName').value.trim();
  const icon = document.getElementById('catFormIcon').value.trim();
  const description = document.getElementById('catFormDesc').value.trim();
  const order_index = document.getElementById('catFormOrder').value;

  if (!name) {
    alert('Nama kategori wajib diisi');
    return;
  }

  const payload = { name, icon, description, order_index };

  try {
    const url = id ? `/api/admin/categories/${id}` : '/api/admin/categories';
    const method = id ? 'PUT' : 'POST';

    const res = await fetchAdmin(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();

    if (json.success) {
      closeCategoryModal();
      loadAdminCategories();
      loadDashboardStats();
    } else {
      alert('Gagal: ' + json.error);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// Utility
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}
