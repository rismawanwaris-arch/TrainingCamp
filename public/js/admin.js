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
          image: customImageHandler,
          video: customVideoHandler
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

function customVideoHandler() {
  let url = prompt('Masukkan URL Video (Google Drive, YouTube, atau MP4 direct link):');
  if (!url) return;
  url = url.trim();

  // Otomatis ubah link sharing Google Drive menjadi link embed preview
  // Contoh: https://drive.google.com/file/d/1A2B3C/view?usp=sharing -> https://drive.google.com/file/d/1A2B3C/preview
  if (url.includes('drive.google.com/file/d/')) {
    const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      url = `https://drive.google.com/file/d/${match[1]}/preview`;
    }
  } else if (url.includes('drive.google.com/open?id=')) {
    const match = url.match(/id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      url = `https://drive.google.com/file/d/${match[1]}/preview`;
    }
  }

  const range = quillEditor.getSelection(true) || { index: quillEditor.getLength() };
  quillEditor.insertEmbed(range.index, 'video', url);
  quillEditor.setSelection(range.index + 1);
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
    'live-tracking': 'Live Tracking & Analisa IP Pengunjung',
    tutorials: 'Kelola Seluruh Tutorial',
    categories: 'Kelola Kategori Modul & Hak Akses',
    users: 'Kelola Pengguna Administrator',
    backup: 'Backup & Restore Database'
  };
  document.getElementById('pageTitle').innerText = titles[tabName] || 'Admin Console';

  if (tabName === 'dashboard') {
    stopLiveTrackingAutoRefresh();
    loadDashboardStats();
  } else if (tabName === 'live-tracking') {
    initLiveTrackingTab();
  } else {
    stopLiveTrackingAutoRefresh();
  }

  if (tabName === 'tutorials') loadAdminTutorials();
  if (tabName === 'categories') loadAdminCategories();
  if (tabName === 'users') loadAdminUsers();
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
    if (document.getElementById('statTopIp')) {
      if (d.topIp && d.topIp.ip_address) {
        document.getElementById('statTopIp').innerHTML = `<code>${escapeHtml(d.topIp.ip_address)}</code> <span style="font-size:0.75rem; color:#64748b;">(${d.topIp.hits}x)</span>`;
      } else {
        document.getElementById('statTopIp').innerText = '-';
      }
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
        logBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:25px; color:#94a3b8;"><i class="fa-solid fa-user-clock"></i> Belum ada aktivitas pembaca riil yang tercatat</td></tr>`;
      } else {
        logBody.innerHTML = d.recentViewLogs.map(log => `
          <tr>
            <td style="color:#64748b; font-size:0.82rem;"><i class="fa-regular fa-clock"></i> ${new Date(log.viewed_at).toLocaleTimeString('id-ID')} (${new Date(log.viewed_at).toLocaleDateString('id-ID')})</td>
            <td>
              <span class="ip-code" style="cursor:pointer;" onclick="switchTab('live-tracking'); openIpDetailModal('${escapeHtml(log.ip_address || '127.0.0.1')}')" title="Klik untuk lihat detail riwayat IP ini">
                ${escapeHtml(log.ip_address || '127.0.0.1')}
              </span>
            </td>
            <td>${renderDeviceBadge(log.parsed_ua)}</td>
            <td><a href="/tutorial/${log.tutorial_slug}" target="_blank" style="font-weight:600; color:#0f172a;">${escapeHtml(log.tutorial_title)}</a></td>
            <td><span class="badge" style="background:#f1f5f9; padding:2px 8px; border-radius:4px; font-size:0.8rem;">${escapeHtml(log.category_name)}</span></td>
          </tr>
        `).join('');
      }
    }

  } catch (err) {
    console.error('Error load stats:', err);
  }
}

// ----------------- LIVE TRACKING & IP ANALYTICS -----------------
let currentIpTimeRange = 'all';
let isAutoRefreshLive = true;
let liveStreamTimer = null;
let lastSeenStreamId = 0;
let ipFilterDebounceTimer = null;

function initLiveTrackingTab() {
  populateIpCategoryFilter();
  loadIpAnalytics();
  loadIpLiveStream();
  startLiveTrackingAutoRefresh();
}

function stopLiveTrackingAutoRefresh() {
  if (liveStreamTimer) {
    clearInterval(liveStreamTimer);
    liveStreamTimer = null;
  }
}

function startLiveTrackingAutoRefresh() {
  stopLiveTrackingAutoRefresh();
  if (isAutoRefreshLive) {
    liveStreamTimer = setInterval(() => {
      const targetPane = document.getElementById('tab-live-tracking');
      if (targetPane && targetPane.style.display !== 'none') {
        loadIpLiveStream();
      }
    }, 4000);
  }
}

function toggleAutoRefresh(enable) {
  isAutoRefreshLive = enable;
  const statusElem = document.getElementById('liveStatusText');
  if (enable) {
    if (statusElem) statusElem.innerText = 'Live Tracking Aktif';
    startLiveTrackingAutoRefresh();
  } else {
    if (statusElem) statusElem.innerText = 'Auto-Refresh Dijeda';
    stopLiveTrackingAutoRefresh();
  }
}

function manualRefreshLiveIp() {
  const btn = document.getElementById('btnManualRefresh');
  if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memuat...';
  Promise.all([loadIpAnalytics(), loadIpLiveStream(true)]).finally(() => {
    if (btn) btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh Sekarang';
  });
}

function setIpTimeFilter(range, btn) {
  currentIpTimeRange = range;
  document.querySelectorAll('#timeFilterPills .filter-pill').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadIpAnalytics();
}

function debounceIpFilter() {
  if (ipFilterDebounceTimer) clearTimeout(ipFilterDebounceTimer);
  ipFilterDebounceTimer = setTimeout(() => {
    loadIpAnalytics();
  }, 350);
}

function populateIpCategoryFilter() {
  const select = document.getElementById('ipFilterCat');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="">Semua Kategori</option>' + 
    allCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if (currentVal) select.value = currentVal;
}

function timeAgo(dateString) {
  if (!dateString) return '-';
  const now = new Date();
  const past = new Date(dateString);
  const diffSec = Math.floor((now - past) / 1000);
  if (diffSec < 10) return 'Baru saja';
  if (diffSec < 60) return `${diffSec} detik lalu`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDays = Math.floor(diffHour / 24);
  return `${diffDays} hari lalu`;
}

function renderDeviceBadge(ua) {
  if (!ua) return `<span class="device-badge"><i class="fa-solid fa-desktop"></i> Desktop</span>`;
  let icon = 'fa-solid fa-desktop';
  if (ua.device === 'Mobile') icon = 'fa-solid fa-mobile-screen';
  if (ua.device === 'Tablet') icon = 'fa-solid fa-tablet-screen-button';
  return `<span class="device-badge" title="${escapeHtml(ua.browser + ' - ' + ua.os)}"><i class="${icon}"></i> ${escapeHtml(ua.browser)} (${escapeHtml(ua.os)})</span>`;
}

async function loadIpAnalytics() {
  try {
    const search = (document.getElementById('ipFilterSearch')?.value || '').trim();
    const catId = document.getElementById('ipFilterCat')?.value || '';

    const params = new URLSearchParams();
    if (currentIpTimeRange) params.set('time_range', currentIpTimeRange);
    if (search) params.set('search', search);
    if (catId) params.set('category_id', catId);

    const res = await fetchAdmin(`/api/admin/ip-analytics?${params.toString()}`);
    const json = await res.json();
    if (!json.success) return;

    const data = json.data;

    // KPI cards
    if (document.getElementById('ipStatTotalHits')) {
      document.getElementById('ipStatTotalHits').innerText = data.summary.total_views;
    }
    if (document.getElementById('ipStatUniqueIps')) {
      document.getElementById('ipStatUniqueIps').innerText = data.summary.unique_ips;
    }
    if (document.getElementById('ipStatActiveNow')) {
      document.getElementById('ipStatActiveNow').innerText = data.summary.active_now;
    }
    if (document.getElementById('ipStatTopIp')) {
      if (data.summary.top_ip) {
        document.getElementById('ipStatTopIp').innerHTML = `<span class="ip-code" style="cursor:pointer;" onclick="openIpDetailModal('${escapeHtml(data.summary.top_ip.ip_address)}')">${escapeHtml(data.summary.top_ip.ip_address)}</span> <small style="font-size:0.8rem; color:#64748b;">(${data.summary.top_ip.total_views}x)</small>`;
      } else {
        document.getElementById('ipStatTopIp').innerText = '-';
      }
    }

    // Top IPs Table
    const topBody = document.getElementById('topIpTableBody');
    if (topBody) {
      if (!data.top_ips || data.top_ips.length === 0) {
        topBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:36px; color:#94a3b8;"><i class="fa-solid fa-magnifying-glass"></i> Belum ada aktivitas kunjungan IP pada filter waktu ini</td></tr>`;
      } else {
        const maxHits = data.top_ips[0].total_views || 1;
        topBody.innerHTML = data.top_ips.map((row, idx) => {
          const rank = idx + 1;
          const pct = Math.max(8, Math.round((row.total_views / maxHits) * 100));
          const favTitle = row.favorite_tutorial ? `<a href="/tutorial/${row.favorite_tutorial.slug}" target="_blank" style="font-weight:600; color:#0f172a;" title="${escapeHtml(row.favorite_tutorial.title)}">${escapeHtml(row.favorite_tutorial.title)}</a> <span style="font-size:0.75rem; color:#64748b;">(${row.favorite_tutorial.hits}x)</span>` : '<span style="color:#94a3b8;">-</span>';
          
          let rankBadge = `<span style="font-weight:700; color:#64748b;">${rank}</span>`;
          if (rank === 1) rankBadge = `<span style="color:#eab308; font-size:1.1rem;"><i class="fa-solid fa-crown" title="Peringkat 1 Teraktif"></i></span>`;
          else if (rank === 2) rankBadge = `<span style="color:#94a3b8; font-weight:700;"><i class="fa-solid fa-medal"></i> 2</span>`;
          else if (rank === 3) rankBadge = `<span style="color:#d97706; font-weight:700;"><i class="fa-solid fa-medal"></i> 3</span>`;

          return `
            <tr>
              <td>${rankBadge}</td>
              <td>
                <span class="ip-code" style="cursor:pointer;" onclick="openIpDetailModal('${escapeHtml(row.ip_address)}')" title="Klik untuk lihat riwayat lengkap IP ini">
                  ${escapeHtml(row.ip_address)}
                </span>
              </td>
              <td>${renderDeviceBadge(row.parsed_ua)}</td>
              <td>
                <div class="hits-progress-wrap">
                  <strong style="color:var(--admin-primary); min-width:32px;">${row.total_views}</strong>
                  <div class="hits-bar-bg"><div class="hits-bar-fill" style="width:${pct}%;"></div></div>
                </div>
              </td>
              <td><span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:600; padding:3px 8px; border-radius:12px;">${row.unique_tutorials_count} modul</span></td>
              <td style="max-width:240px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${favTitle}</td>
              <td><span class="badge" style="background:#f1f5f9; padding:2px 8px; border-radius:4px; font-size:0.8rem;">${escapeHtml(row.favorite_category)}</span></td>
              <td style="color:#64748b; font-size:0.82rem;" title="${new Date(row.last_viewed_at).toLocaleString('id-ID')}">
                <i class="fa-regular fa-clock"></i> ${timeAgo(row.last_viewed_at)}
              </td>
              <td style="text-align: right;">
                <button class="btn btn-outline btn-sm" onclick="openIpDetailModal('${escapeHtml(row.ip_address)}')">
                  <i class="fa-solid fa-circle-info"></i> Detail
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // Tutorial IP Distribution Table
    const tutStatsBody = document.getElementById('tutorialIpStatsTableBody');
    if (tutStatsBody) {
      if (!data.tutorial_stats || data.tutorial_stats.length === 0) {
        tutStatsBody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:24px; color:#94a3b8;">Belum ada tutorial yang diakses</td></tr>`;
      } else {
        tutStatsBody.innerHTML = data.tutorial_stats.map(t => `
          <tr>
            <td>
              <a href="/tutorial/${t.slug}" target="_blank" style="font-weight:600; color:#0f172a; display:block;">${escapeHtml(t.title)}</a>
              <span style="font-size:0.78rem; color:#64748b;">${escapeHtml(t.category_name)}</span>
            </td>
            <td><span class="badge" style="background:#ecfdf5; color:#059669; font-weight:700; padding:2px 8px; border-radius:12px;">${t.unique_ips_count} IP</span></td>
            <td><strong>${t.total_hits}</strong> hits</td>
          </tr>
        `).join('');
      }
    }

  } catch (err) {
    console.error('Error load IP analytics:', err);
  }
}

async function loadIpLiveStream(forceRefresh = false) {
  try {
    const res = await fetchAdmin('/api/admin/ip-live-stream?limit=35');
    const json = await res.json();
    if (!json.success) return;

    const data = json.data;
    const logs = data.logs || [];

    const lastUpdatedElem = document.getElementById('liveLastUpdated');
    if (lastUpdatedElem) {
      lastUpdatedElem.innerText = 'Pembaruan: ' + new Date().toLocaleTimeString('id-ID');
    }

    const counterElem = document.getElementById('liveStreamCounter');
    if (counterElem) {
      counterElem.innerText = `${logs.length} log terbaru (${data.active_users_5m} IP aktif 5 mnt)`;
    }

    const streamBody = document.getElementById('liveStreamTableBody');
    if (streamBody) {
      if (logs.length === 0) {
        streamBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:32px; color:#94a3b8;"><i class="fa-solid fa-satellite-dish"></i> Menunggu aktivitas pembaca live...</td></tr>`;
      } else {
        const previousId = lastSeenStreamId;
        const newHighestId = logs[0] ? logs[0].id : 0;
        
        streamBody.innerHTML = logs.map(log => {
          const isNew = previousId > 0 && log.id > previousId;
          return `
            <tr class="${isNew ? 'row-flash' : ''}">
              <td style="color:#64748b; font-size:0.82rem; white-space:nowrap;">
                <i class="fa-regular fa-clock"></i> ${new Date(log.viewed_at).toLocaleTimeString('id-ID')}
              </td>
              <td>
                <span class="ip-code" style="cursor:pointer;" onclick="openIpDetailModal('${escapeHtml(log.ip_address)}')" title="Lihat profil IP ini">
                  ${escapeHtml(log.ip_address)}
                </span>
              </td>
              <td>${renderDeviceBadge(log.parsed_ua)}</td>
              <td>
                <a href="/tutorial/${log.tutorial_slug}" target="_blank" style="font-weight:600; color:#0f172a; display:inline-block;" title="${escapeHtml(log.tutorial_title)}">
                  ${escapeHtml(log.tutorial_title)}
                </a>
                <span class="badge" style="background:#f1f5f9; padding:1px 6px; border-radius:4px; font-size:0.75rem; margin-left:4px;">${escapeHtml(log.category_name)}</span>
              </td>
            </tr>
          `;
        }).join('');

        if (newHighestId > lastSeenStreamId) {
          lastSeenStreamId = newHighestId;
          if (previousId > 0) {
            loadIpAnalytics();
          }
        }
      }
    }

  } catch (err) {
    console.error('Error load live stream:', err);
  }
}

async function openIpDetailModal(ip) {
  const modal = document.getElementById('ipDetailModal');
  if (!modal) return;
  modal.classList.add('active');

  document.getElementById('modalIpAddress').innerText = ip;
  document.getElementById('modalIpSubtitle').innerText = 'Memuat riwayat aktivitas...';
  document.getElementById('modalStatHits').innerText = '...';
  document.getElementById('modalStatTutorials').innerText = '...';
  document.getElementById('modalStatFirstSeen').innerText = '...';
  document.getElementById('modalStatLastSeen').innerText = '...';
  document.getElementById('modalTutorialsBody').innerHTML = '<tr><td colspan="4" style="text-align:center; padding:16px;">Memuat data...</td></tr>';
  document.getElementById('modalHistoryBody').innerHTML = '<tr><td colspan="3" style="text-align:center; padding:16px;">Memuat riwayat...</td></tr>';

  try {
    const res = await fetchAdmin(`/api/admin/ip-details/${encodeURIComponent(ip)}`);
    const json = await res.json();
    if (!json.success) {
      alert('Gagal memuat detail IP: ' + (json.error || 'Data tidak ditemukan'));
      closeIpDetailModal();
      return;
    }

    const d = json.data;
    const s = d.summary;

    document.getElementById('modalIpSubtitle').innerHTML = `Perangkat Terakhir: ${renderDeviceBadge(s.parsed_ua)}`;
    document.getElementById('modalStatHits').innerText = s.total_views;
    document.getElementById('modalStatTutorials').innerText = s.unique_tutorials;
    document.getElementById('modalStatFirstSeen').innerText = new Date(s.first_seen).toLocaleDateString('id-ID');
    document.getElementById('modalStatLastSeen').innerText = timeAgo(s.last_seen);

    const tutBody = document.getElementById('modalTutorialsBody');
    if (!d.tutorials || d.tutorials.length === 0) {
      tutBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:16px; color:#94a3b8;">Belum ada tutorial yang dibuka</td></tr>';
    } else {
      tutBody.innerHTML = d.tutorials.map(t => `
        <tr>
          <td><a href="/tutorial/${t.slug}" target="_blank" style="font-weight:600; color:#0f172a;">${escapeHtml(t.title)}</a></td>
          <td><span class="badge" style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-size:0.78rem;">${escapeHtml(t.category_name)}</span></td>
          <td><strong style="color:var(--admin-primary);">${t.hits}</strong> kali dibuka</td>
          <td style="color:#64748b; font-size:0.8rem;">${timeAgo(t.last_accessed)}</td>
        </tr>
      `).join('');
    }

    const histBody = document.getElementById('modalHistoryBody');
    if (!d.history || d.history.length === 0) {
      histBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:16px; color:#94a3b8;">Belum ada riwayat tercatat</td></tr>';
    } else {
      histBody.innerHTML = d.history.map(h => `
        <tr>
          <td style="color:#64748b; font-size:0.8rem; white-space:nowrap;">
            ${new Date(h.viewed_at).toLocaleTimeString('id-ID')} (${new Date(h.viewed_at).toLocaleDateString('id-ID')})
          </td>
          <td>
            <a href="/tutorial/${h.tutorial_slug}" target="_blank" style="font-weight:600; color:#0f172a;">${escapeHtml(h.tutorial_title)}</a>
            <span style="font-size:0.75rem; color:#64748b; margin-left:4px;">(${escapeHtml(h.category_name)})</span>
          </td>
          <td>${renderDeviceBadge(h.parsed_ua)}</td>
        </tr>
      `).join('');
    }

  } catch (err) {
    alert('Terjadi kesalahan saat memuat detail IP: ' + err.message);
  }
}

function closeIpDetailModal() {
  const modal = document.getElementById('ipDetailModal');
  if (modal) modal.classList.remove('active');
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
    document.getElementById('tutFormVideoUrl').value = tutData.video_url || '';
    document.getElementById('tutFormTags').value = tutData.tags || '';
    quillEditor.root.innerHTML = tutData.content || '';
  } else {
    document.getElementById('tutModalTitle').innerText = 'Upload Tutorial Baru';
    document.getElementById('tutFormId').value = '';
    document.getElementById('tutFormTitle').value = '';
    document.getElementById('tutFormStatus').value = 'published';
    document.getElementById('tutFormSummary').value = '';
    document.getElementById('tutFormVideoUrl').value = '';
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
  const video_url = document.getElementById('tutFormVideoUrl').value.trim();
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
  formData.append('video_url', video_url);
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
      <td>
        <strong>${escapeHtml(c.name)}</strong>
        <div style="font-size: 0.78rem; color: #94a3b8;"><code>/${escapeHtml(c.slug)}</code></div>
      </td>
      <td>
        ${c.is_locked === 1 ? `
          <button class="btn btn-sm" style="background:#fef2f2; color:#ef4444; border:1px solid #fecaca; padding:4px 10px;" onclick="toggleLockCategory(${c.id})" title="Klik untuk membuka kunci">
            <i class="fa-solid fa-lock"></i> Terkunci
          </button>
          <div style="font-size: 0.75rem; color:#b45309; margin-top: 3px;" title="Password untuk user">
            <i class="fa-solid fa-key"></i> <code>${escapeHtml(c.access_password || 'default admin')}</code>
          </div>
        ` : `
          <button class="btn btn-sm" style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; padding:4px 10px;" onclick="toggleLockCategory(${c.id})" title="Klik untuk mengunci kategori ini dengan password">
            <i class="fa-solid fa-lock-open"></i> Terbuka
          </button>
        `}
      </td>
      <td style="color:#64748b; font-size:0.85rem;">${escapeHtml(c.description || '-')}</td>
      <td><span style="font-weight:600;">${c.tutorial_count}</span> panduan</td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-outline btn-sm" onclick="editCategory(${c.id})"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-outline btn-sm" style="color: #ef4444; border-color: #fecaca;" onclick="deleteCategory(${c.id}, '${escapeHtml(c.name)}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

function toggleCatPasswordGroup() {
  const isLocked = document.getElementById('catFormLocked').value === '1';
  const group = document.getElementById('catPasswordGroup');
  if (group) group.style.display = isLocked ? 'block' : 'none';
}

async function toggleLockCategory(id) {
  const cat = allCategories.find(c => c.id === id);
  if (!cat) return;

  let passwordToSend = undefined;
  if (cat.is_locked === 0) {
    const inputPass = prompt(`Kunci kategori "${cat.name}".\nMasukkan kata sandi (password) untuk membuka akses kategori ini bagi pembaca publik:`, cat.access_password || '');
    if (inputPass === null) return; // User cancel
    if (!inputPass.trim()) {
      alert('Password tidak boleh kosong!');
      return;
    }
    passwordToSend = inputPass.trim();
  } else {
    if (!confirm(`Buka kunci kategori "${cat.name}" agar dapat diakses bebas oleh semua orang tanpa password?`)) {
      return;
    }
  }

  try {
    const res = await fetchAdmin(`/api/admin/categories/${id}/toggle-lock`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_password: passwordToSend })
    });
    const json = await res.json();
    if (json.success) {
      alert(json.message);
      loadAdminCategories();
      loadDashboardStats();
    } else {
      alert('Gagal mengubah status: ' + json.error);
    }
  } catch (err) {
    alert(err.message);
  }
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
    document.getElementById('catFormLocked').value = catData.is_locked ? '1' : '0';
    document.getElementById('catFormPassword').value = catData.access_password || '';
  } else {
    document.getElementById('catModalTitle').innerText = 'Tambah Kategori Baru';
    document.getElementById('catFormId').value = '';
    document.getElementById('catFormName').value = '';
    document.getElementById('catFormIcon').value = 'fa-solid fa-folder';
    document.getElementById('catFormDesc').value = '';
    document.getElementById('catFormOrder').value = allCategories.length + 1;
    document.getElementById('catFormLocked').value = '0';
    document.getElementById('catFormPassword').value = '';
  }
  toggleCatPasswordGroup();
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
  const is_locked = parseInt(document.getElementById('catFormLocked').value) || 0;
  const access_password = document.getElementById('catFormPassword').value.trim();

  if (!name) {
    alert('Nama kategori wajib diisi');
    return;
  }

  if (is_locked === 1 && !access_password) {
    alert('Silakan masukkan Password Akses Kategori jika kategori dikunci!');
    return;
  }

  const payload = { name, icon, description, order_index, is_locked, access_password };

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

// ----------------- USER MANAGEMENT -----------------
async function loadAdminUsers() {
  try {
    const res = await fetchAdmin('/api/admin/users');
    const json = await res.json();
    if (!json.success) return;

    const tbody = document.getElementById('adminUserTableBody');
    if (!json.data || json.data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#94a3b8;">Belum ada user.</td></tr>`;
      return;
    }

    tbody.innerHTML = json.data.map((u, idx) => `
      <tr>
        <td style="color:#94a3b8; font-weight:600;">${idx + 1}</td>
        <td><strong>${escapeHtml(u.username)}</strong></td>
        <td>${escapeHtml(u.full_name)}</td>
        <td><span class="badge" style="background:#e0e7ff; color:#3730a3; padding:3px 8px; border-radius:6px; font-weight:600; font-size:0.8rem;">${escapeHtml(u.role || 'admin')}</span></td>
        <td style="color:#64748b; font-size:0.82rem;">${new Date(u.created_at).toLocaleDateString('id-ID')}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-outline btn-sm" style="color: #ef4444; border-color: #fecaca;" onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')">
            <i class="fa-solid fa-trash"></i> Hapus
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error load users:', err);
  }
}

function openUserModal() {
  document.getElementById('userModal').classList.add('active');
  document.getElementById('newUserUsername').value = '';
  document.getElementById('newUserFullName').value = '';
  document.getElementById('newUserPassword').value = '';
  document.getElementById('newUserRole').value = 'admin';
}

function closeUserModal() {
  document.getElementById('userModal').classList.remove('active');
}

async function submitCreateUser() {
  const username = document.getElementById('newUserUsername').value.trim();
  const full_name = document.getElementById('newUserFullName').value.trim();
  const role = document.getElementById('newUserRole').value;
  const password = document.getElementById('newUserPassword').value;

  if (!username || !full_name || !password) {
    alert('Semua field wajib diisi!');
    return;
  }
  if (password.length < 5) {
    alert('Password minimal 5 karakter!');
    return;
  }

  const btn = document.getElementById('saveUserBtn');
  btn.disabled = true;
  btn.innerText = 'Menyimpan...';

  try {
    const res = await fetchAdmin('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, full_name, role, password })
    });
    const json = await res.json();
    if (json.success) {
      alert('User baru berhasil ditambahkan!');
      closeUserModal();
      loadAdminUsers();
    } else {
      alert('Gagal: ' + json.error);
    }
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Tambah User';
  }
}

async function deleteUser(id, username) {
  if (!confirm(`Hapus user "${username}"? User ini tidak akan bisa login lagi ke Admin Console.`)) return;

  try {
    const res = await fetchAdmin(`/api/admin/users/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      alert('User berhasil dihapus');
      loadAdminUsers();
    } else {
      alert('Gagal: ' + json.error);
    }
  } catch (err) {
    alert(err.message);
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

// ----------------- BACKUP & RESTORE DATABASE -----------------
async function downloadBackupDatabase() {
  const btn = document.getElementById('downloadBackupBtn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyiapkan Backup...';

  try {
    const res = await fetchAdmin('/api/admin/backup-db');
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || 'Gagal mengunduh file backup');
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;

    // Ambil nama file dari header Content-Disposition jika ada
    let filename = `tutorials-backup-${new Date().toISOString().slice(0, 10)}.db`;
    const disposition = res.headers.get('content-disposition');
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename="?([^";]+)"?/);
      if (match && match[1]) filename = match[1];
    }

    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  } catch (err) {
    alert('Error saat mengunduh backup: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

async function submitRestoreDatabase() {
  const fileInput = document.getElementById('restoreDbFileInput');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Silakan pilih file database backup (.db) terlebih dahulu!');
    return;
  }

  const file = fileInput.files[0];
  if (!file.name.endsWith('.db') && !file.name.endsWith('.sqlite')) {
    alert('File harus berformat SQLite database (.db atau .sqlite)!');
    return;
  }

  const confirmRestore = confirm(
    `PERINGATAN: Anda akan memulihkan database dari file "${file.name}".\n\n` +
    `Semua data tutorial, kategori, dan akun saat ini akan ditimpa dengan data dari file backup tersebut.\n\n` +
    `Apakah Anda yakin ingin melanjutkan?`
  );

  if (!confirmRestore) return;

  const btn = document.getElementById('restoreSubmitBtn');
  const statusMsg = document.getElementById('restoreStatusMsg');
  const originalHtml = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memulihkan Database...';
  statusMsg.style.display = 'none';

  const formData = new FormData();
  formData.append('database_file', file);

  try {
    const res = await fetchAdmin('/api/admin/restore-db', {
      method: 'POST',
      body: formData
    });
    const json = await res.json();

    if (json.success) {
      statusMsg.style.display = 'block';
      statusMsg.style.background = '#ecfdf5';
      statusMsg.style.color = '#065f46';
      statusMsg.style.border = '1px solid #a7f3d0';
      statusMsg.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + json.message;

      alert('Restore Database Berhasil!\nHalaman akan dimuat ulang untuk menampilkan data terbaru.');
      fileInput.value = '';
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } else {
      statusMsg.style.display = 'block';
      statusMsg.style.background = '#fef2f2';
      statusMsg.style.color = '#991b1b';
      statusMsg.style.border = '1px solid #fecaca';
      statusMsg.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' + (json.error || 'Gagal memulihkan database.');
      alert('Gagal: ' + (json.error || 'Terjadi kesalahan'));
    }
  } catch (err) {
    statusMsg.style.display = 'block';
    statusMsg.style.background = '#fef2f2';
    statusMsg.style.color = '#991b1b';
    statusMsg.style.border = '1px solid #fecaca';
    statusMsg.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' + err.message;
    alert('Error saat restore: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

