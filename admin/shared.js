// ============================================================
// KidsCart Admin — shared.js  v1.0
// Loaded by every admin page via: <script src="/admin/shared.js"></script>
// Contains: API config · auth · session · navigation helpers ·
//           utility functions (toast, fmtDate, fixImgSrc) ·
//           Socket.io loader · page-title map · mobile nav sync ·
//           forgot/reset password · inbox badge sync
// ============================================================

// ── CONFIG ──────────────────────────────────────────────────
const API = window.location.hostname === 'localhost'
  ? 'http://localhost:5000/api'
  : 'https://kidscart-production.up.railway.app/api';

// Page-level state (populated after login)
let token     = localStorage.getItem('kc_admin_token') || '';
let adminUser = null;

// ── SESSION TIMEOUT (1 hour inactivity) ─────────────────────
let adminLastActivity = Date.now();
const SESSION_TIMEOUT = 60 * 60 * 1000;

document.addEventListener('click',    () => adminLastActivity = Date.now());
document.addEventListener('keypress', () => adminLastActivity = Date.now());

setInterval(() => {
  if (token && Date.now() - adminLastActivity > SESSION_TIMEOUT) {
    toast('⏰ Session expired. Please login again.');
    setTimeout(adminLogout, 2000);
  }
}, 60000);

// ── AUTH: Auto-login on page load ───────────────────────────
// Each page calls KC.init(onSuccess) from its own DOMContentLoaded.
// shared.js exposes window.KC as the public API for page files.
window.KC = {

  /** Call this from each page's DOMContentLoaded.
   *  onSuccess(adminUser) fires if the token is still valid.
   *  If not, the login screen is shown automatically. */
  init(onSuccess) {
    if (token) {
      tryAutoLogin(onSuccess);
    } else {
      showLoginScreen();
    }
  },

  // Expose for pages that need to check role
  getUser: () => adminUser,
  getToken: () => token,
};

async function tryAutoLogin(onSuccess) {
  try {
    const r = await apiFetch('/auth/me');
    if (r.user && ['admin','super_admin'].includes(r.user.role)) {
      adminUser = r.user;
      if (typeof onSuccess === 'function') onSuccess(adminUser);
    } else {
      showLoginScreen();
    }
  } catch {
    showLoginScreen();
  }
}

// ── LOGIN SCREEN ────────────────────────────────────────────
function showLoginScreen() {
  const ls = document.getElementById('loginScreen');
  const aa = document.getElementById('adminApp');
  if (ls) ls.style.display = 'flex';
  if (aa) aa.style.display = 'none';
}

function showAdminApp() {
  const ls = document.getElementById('loginScreen');
  const aa = document.getElementById('adminApp');
  if (ls) ls.style.display = 'none';
  if (aa) aa.style.display = 'flex';
  // Update name badge wherever it exists on the page
  const nb = document.getElementById('adminName');
  if (nb && adminUser) nb.textContent = '👤 ' + adminUser.name;
  // Show Admin Users nav only for super_admin
  if (adminUser?.role === 'super_admin') {
    document.querySelectorAll('.super-only').forEach(el => el.style.display = '');
  }
  updateMobUser();
  initAdminSocket();
}

// ── LOGIN ACTION (called by login button) ────────────────────
async function adminLogin() {
  const email  = document.getElementById('adminEmail')?.value.trim();
  const pass   = document.getElementById('adminPass')?.value;
  const errEl  = document.getElementById('loginErr');
  if (errEl) errEl.style.display = 'none';

  if (!email || !pass) {
    if (errEl) { errEl.textContent = '⚠️ Please enter email and password'; errEl.style.display = 'block'; }
    return;
  }
  try {
    const r = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Login failed');
    if (!['admin','super_admin'].includes(d.user.role)) throw new Error('Not an admin account');
    token     = d.token;
    adminUser = d.user;
    localStorage.setItem('kc_admin_token', token);
    // Let the page handle what to show after login
    if (typeof window._kcAfterLogin === 'function') window._kcAfterLogin(adminUser);
    else showAdminApp();
  } catch(e) {
    if (errEl) { errEl.textContent = '❌ ' + e.message; errEl.style.display = 'block'; }
  }
}

// ── LOGOUT ──────────────────────────────────────────────────
function adminLogout() {
  token     = '';
  adminUser = null;
  localStorage.removeItem('kc_admin_token');
  showLoginScreen();
}

// ── API HELPER ──────────────────────────────────────────────
async function apiFetch(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    }
  };
  if (body) opts.body = JSON.stringify(body);
  let r;
  try {
    r = await fetch(API + path, opts);
  } catch(e) {
    throw new Error('Cannot connect to server. Is it running?');
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed (' + r.status + ')');
  return d;
}

// Alias used in older inline code
const api = apiFetch;

// ── IMAGE URL FIXER ─────────────────────────────────────────
// Converts /uploads/file.jpg → full absolute URL so images load on any page
function fixImgSrc(src) {
  if (!src) return '';
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) return src;
  return window.location.origin + (src.startsWith('/') ? src : '/' + src);
}

// ── TOAST NOTIFICATION ──────────────────────────────────────
function toast(msg, dur = 2800) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

// ── UTILITY HELPERS ─────────────────────────────────────────
function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

// WhatsApp-style relative time
function fmtT(d) {
  const diff = Date.now() - d;
  if (diff < 86400000)  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

// ── SOCKET.IO LAZY LOADER ────────────────────────────────────
function loadSocketIO(cb) {
  if (typeof io !== 'undefined') { cb(); return; }
  const s = document.createElement('script');
  s.src = 'https://cdn.socket.io/4.6.1/socket.io.min.js';
  s.onload  = cb;
  s.onerror = () => console.warn('Socket.io unavailable');
  document.head.appendChild(s);
}

// Global socket reference
let adminSocket = null;

function initAdminSocket() {
  loadSocketIO(() => {
    if (typeof io === 'undefined') return;
    try {
      adminSocket = io(API.replace('/api', ''), {
        auth: { token: localStorage.getItem('kc_admin_token') },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 3
      });
      adminSocket.on('connect_error', () => {});

      // WhatsApp real-time update (pages that have loadInbox / refreshConvs will pick this up)
      adminSocket.on('wa_message', d => {
        if (typeof refreshConvs === 'function') refreshConvs();
        if (typeof appendMsg === 'function' && d.phone === activePhone) {
          appendMsg({ direction: 'inbound', body: d.body, timestamp: d.timestamp, status: 'received' });
        }
      });
      adminSocket.on('inbox_update', () => {
        if (typeof refreshConvs === 'function') refreshConvs();
      });

      // Live chat (dashboard page)
      adminSocket.on('admin:message', ({ sessionId, sender, text, customerName, time }) => {
        if (typeof handleAdminChatMsg === 'function') {
          handleAdminChatMsg({ sessionId, sender, text, customerName, time });
        }
      });
      adminSocket.on('admin:chat_closed', ({ sessionId }) => {
        if (typeof handleChatClosed === 'function') handleChatClosed(sessionId);
      });

      adminSocket.emit('admin:join');
      adminSocket.emit('join_admin');
    } catch(e) {
      console.warn('Admin socket error:', e);
    }
  });
}

// ── MOBILE NAV HELPERS ──────────────────────────────────────
function updateMobUser() {
  const el = document.getElementById('mobUser');
  if (el && adminUser) el.textContent = adminUser.name || '';
}

// Sync the WhatsApp unread badge on mobile bottom nav
// Pages that have allConvs should call syncMobBadge() after updating conversations
function syncMobBadge() {
  const allConvs = window.allConvs || [];
  const total    = allConvs.reduce((s, cv) => s + (cv.unreadCount || 0), 0);
  const mb = document.getElementById('mobInboxBadge');
  if (mb) { mb.textContent = total; mb.style.display = total > 0 ? 'flex' : 'none'; }
  const sb = document.getElementById('inboxBadge');
  if (sb) { sb.textContent = total; sb.style.display = total > 0 ? 'inline-flex' : 'none'; }
}

// ── CROSS-PAGE NAVIGATION ────────────────────────────────────
// Returns the URL for a given admin section name so sidebar links
// on each page can navigate to the correct file.
const ADMIN_PAGES = {
  dashboard:  '/admin.html',
  orders:     '/admin/orders.html',
  products:   '/admin/products.html',
  stock:      '/admin/products.html#stock',
  addprod:    '/admin/products.html#addprod',
  banners:    '/admin/products.html#banners',
  coupons:    '/admin/products.html#coupons',
  customers:  '/admin.html#customers',
  reports:    '/admin.html#reports',
  adminusers: '/admin.html#adminusers',
  crm:        '/admin/crm.html',
  crmstages:  '/admin/crm.html#crmstages',
  inbox:      '/admin/whatsapp.html',
};

/** Navigate to another admin page.
 *  If already on that page, shows the panel inline (legacy behaviour).
 *  If on a different page, does a full navigation. */
function adminNav(section) {
  const target = ADMIN_PAGES[section];
  if (!target) return;

  // Strip hash to compare base pages
  const currentPage = window.location.pathname;
  const targetPage  = target.split('#')[0];

  if (currentPage === targetPage || currentPage === targetPage.replace('.html','')) {
    // Already on the right page — handle hash/panel switch locally
    const hash = target.includes('#') ? target.split('#')[1] : null;
    if (hash && typeof show === 'function') show(hash);
    return;
  }
  window.location.href = target;
}

// ── SHARED SIDEBAR HTML ─────────────────────────────────────
// Each page calls renderSidebar('orders') to get the sidebar with
// the correct item highlighted. Keeps sidebar in sync across all pages.
function renderSidebar(activePage) {
  const LOGO = '/logo-white.png';
  const items = [
    { id:'dashboard',  ico:'📊', lbl:'Dashboard',    url:'/admin.html' },
    { id:'orders',     ico:'📦', lbl:'Orders',        url:'/admin/orders.html' },
    { id:'products',   ico:'👗', lbl:'Products',      url:'/admin/products.html' },
    { id:'stock',      ico:'📋', lbl:'Stock',         url:'/admin/products.html#stock',   sub:true },
    { id:'addprod',    ico:'➕', lbl:'Add Product',   url:'/admin/products.html#addprod', sub:true },
    { id:'banners',    ico:'🎨', lbl:'Banners',       url:'/admin/products.html#banners', sub:true },
    { id:'coupons',    ico:'🎟️', lbl:'Coupons',      url:'/admin/products.html#coupons', sub:true },
    { id:'customers',  ico:'👥', lbl:'Customers',     url:'/admin.html#customers' },
    { id:'inbox',      ico:'📱', lbl:'WhatsApp',      url:'/admin/whatsapp.html', badge:'inboxBadge', badgeColor:'#25D366' },
    { id:'crm',        ico:'🤝', lbl:'CRM',           url:'/admin/crm.html' },
    { id:'reports',    ico:'📈', lbl:'Reports',       url:'/admin.html#reports' },
    { id:'adminusers', ico:'🔐', lbl:'Admin Users',   url:'/admin.html#adminusers', superOnly:true },
  ];
  const groups = [
    { label:'Main',          ids:['dashboard','orders','products','stock','addprod'] },
    { label:'Marketing',     ids:['banners','coupons','customers'] },
    { label:'Communication', ids:['inbox','crm'] },
    { label:'Analytics',     ids:['reports','adminusers'] },
  ];
  let navHTML = '';
  groups.forEach(g => {
    navHTML += `<div class="nav-group-label${g.ids.some(id=>items.find(i=>i.id===id)?.superOnly)?'" style="display:none':''}">${g.label}</div>`;
    g.ids.forEach(id => {
      const it = items.find(i => i.id === id);
      if (!it) return;
      const isActive = it.id === activePage;
      const tag      = it.url ? 'a' : 'div';
      const href     = it.url ? `href="${it.url}"` : '';
      const superCls = it.superOnly ? ' super-only" style="display:none' : '';
      const badge    = it.badge ? `<span id="${it.badge}" style="display:none;background:${it.badgeColor||'#25D366'};color:#fff;border-radius:20px;padding:1px 7px;font-size:.6rem;font-weight:800;margin-left:auto;">0</span>` : '';
      const indent   = it.sub ? ' style="padding-left:32px;font-size:.78rem;"' : '';
      navHTML += `<${tag} class="nav-item${isActive?' active':''}${superCls}" ${href}${indent}><span class="nav-icon">${it.ico}</span><span class="sb-label">${it.lbl}</span>${badge}</${tag}>`;
    });
  });

  const user = adminUser;
  const init = user ? (user.name||'A').charAt(0).toUpperCase() : 'A';
  const name = user ? (user.name||'Admin') : 'Admin';
  const role = user ? (user.role==='super_admin'?'Super Admin':'Admin') : 'Admin';

  return `
  <div class="sidebar" id="sidebar">
    <div class="sb-top">
      <div class="sb-brand">
        <div class="sb-logo-img"><img src="${LOGO}" alt="KidsCart"></div>
        <div><div class="sb-logo-text">KidsCart</div><div class="sb-logo-sub">Admin Panel v3</div></div>
      </div>
      <button class="sb-toggle" onclick="toggleSidebarGlobal()" title="Collapse sidebar">◀</button>
    </div>
    <nav class="sb-nav">${navHTML}</nav>
    <div class="sb-user">
      <div class="sb-avatar">${init}</div>
      <div class="sb-user-info"><div class="sb-user-name">${name}</div><div class="sb-user-role">${role}</div></div>
      <button class="sb-logout" onclick="adminLogout()" title="Logout">🚪</button>
    </div>
  </div>`;
}

function toggleSidebarGlobal() {
  const sb   = document.getElementById('sidebar');
  const main = document.getElementById('mainArea');
  const btn  = sb?.querySelector('.sb-toggle');
  if (!sb) return;
  const isOpen = !sb.classList.contains('collapsed');
  sb.classList.toggle('collapsed', isOpen);
  if (main) main.classList.toggle('expanded', isOpen);
  if (btn) btn.textContent = isOpen ? '▶' : '◀';
  localStorage.setItem('kc_sidebar', isOpen ? '0' : '1');
}

function initSidebarState() {
  if (localStorage.getItem('kc_sidebar') === '0') {
    setTimeout(() => {
      const sb   = document.getElementById('sidebar');
      const main = document.getElementById('mainArea');
      if (sb) { sb.classList.add('collapsed'); if(main) main.classList.add('expanded'); const btn=sb.querySelector('.sb-toggle'); if(btn) btn.textContent='▶'; }
    }, 50);
  }
}


// ── SHARED MOBILE BOTTOM NAV HTML ───────────────────────────
// Lightweight version — main tabs only. Pages add this to their HTML.
function renderMobBar(activePage) {
  const tabs = [
    { id:'dashboard', ico:'📊', lbl:'Home',     url:'/admin.html' },
    { id:'orders',    ico:'📦', lbl:'Orders',   url:'/admin/orders.html' },
    { id:'products',  ico:'👗', lbl:'Products', url:'/admin/products.html' },
    { id:'inbox',     ico:'📱', lbl:'WhatsApp', url:'/admin/whatsapp.html', badge:true },
    { id:'crm',       ico:'🤝', lbl:'CRM',      url:'/admin/crm.html' },
  ];
  const LOGO = '/logo-white.png';
  return `
  <div class="mob-header">
    <img src="${LOGO}" alt="KidsCart">
    <span class="mob-hdr-title" id="mobTitle">KidsCart Admin</span>
    <div class="mob-hdr-right" id="mobUser"></div>
  </div>
  <div class="mob-bar">
    <div class="mob-bar-inner">
      ${tabs.map(t => `
      <button class="mob-btn${t.id===activePage?' active':''}" onclick="location.href='${t.url}'">
        <span class="mi">${t.ico}</span><span class="ml">${t.lbl}</span>
        ${t.badge?'<span class="mob-badge" id="mobInboxBadge" style="display:none;">0</span>':''}
      </button>`).join('')}
      <button class="mob-btn" onclick="adminLogout()"><span class="mi">🚪</span><span class="ml">Logout</span></button>
    </div>
  </div>`;
}


// ── SHARED LOGIN SCREEN HTML ─────────────────────────────────
const LOGO_URL = '/logo-white.png'; // white logo for dark sidebar

function renderLoginScreen() {
  return `
  <div id="loginScreen" style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:linear-gradient(135deg,#7B2D8B,#5C1F7A);">
    <div class="login-box">
      <div class="login-logo"><img src="${LOGO_URL}" alt="KidsCart"></div>
      <h2>Admin Panel</h2>
      <p>Sign in to manage your store</p>
      <input class="linp" type="email" id="adminEmail" placeholder="admin@kidscart.kids" autocomplete="username">
      <input class="linp" type="password" id="adminPass" placeholder="Password" autocomplete="current-password"
        onkeydown="if(event.key==='Enter')adminLogin()">
      <button class="lbtn" onclick="adminLogin()">🔐 Sign In</button>
      <p style="text-align:center;margin-top:12px;font-size:.82rem;">
        <a href="#" onclick="document.getElementById('forgotBox').style.display=document.getElementById('forgotBox').style.display==='none'?'block':'none'"
           style="color:#9b60bf;font-weight:700;">Forgot password?</a>
      </p>
      <div id="forgotBox" style="display:none;margin-top:8px;">
        <input class="linp" type="email" id="forgotEmail" placeholder="admin@kidscart.kids">
        <button class="lbtn" style="margin-top:8px;" onclick="adminForgot()">Send Reset Link 📧</button>
      </div>
      <div id="loginErr" style="color:#c62828;font-size:.83rem;text-align:center;margin-top:10px;display:none;"></div>
    </div>
  </div>`;
}

// ── FORGOT PASSWORD ──────────────────────────────────────────
async function adminForgot() {
  const email = document.getElementById('forgotEmail')?.value.trim();
  if (!email) { toast('⚠️ Enter your email'); return; }
  try {
    await fetch(API + '/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    toast('✅ Reset link sent to ' + email);
    const fb = document.getElementById('forgotBox');
    if (fb) fb.style.display = 'none';
  } catch(e) { toast('❌ ' + e.message); }
}

// ── RESET PASSWORD (handles ?resetToken= URL) ────────────────
(function handleResetToken() {
  const p  = new URLSearchParams(window.location.search);
  const rt = p.get('resetToken');
  const uid = p.get('userId');
  if (!rt || !uid) return;

  document.addEventListener('DOMContentLoaded', () => {
    const ls = document.getElementById('loginScreen');
    if (!ls) return;
    ls.innerHTML = `
      <div class="login-box">
        <div class="login-logo"><img src="${LOGO_URL}" alt="KidsCart"></div>
        <h2>Set New Password</h2>
        <p>Enter your new admin password</p>
        <input class="linp" type="password" id="np1" placeholder="New password (min 8 chars)">
        <input class="linp" type="password" id="np2" placeholder="Confirm new password">
        <button class="lbtn" onclick="doReset('${rt}','${uid}')">Set Password</button>
        <div id="loginErr" style="color:#c62828;font-size:.83rem;text-align:center;margin-top:8px;"></div>
      </div>`;
    ls.style.display = 'flex';
  });
})();

async function doReset(token, userId) {
  const p1  = document.getElementById('np1')?.value;
  const p2  = document.getElementById('np2')?.value;
  const err = document.getElementById('loginErr');
  if (p1.length < 8) { if (err) err.textContent = 'Min 8 characters'; return; }
  if (p1 !== p2)     { if (err) err.textContent = 'Passwords do not match'; return; }
  try {
    const r = await fetch(API + '/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, userId, newPassword: p1 })
    });
    const d = await r.json();
    if (r.ok) {
      toast('✅ Password updated! Redirecting…');
      setTimeout(() => location.href = '/admin.html', 2000);
    } else {
      if (err) err.textContent = d.error || 'Failed';
    }
  } catch(e) {
    if (err) err.textContent = e.message;
  }
}

// ── BASE STYLES: injected via admin-styles.css link tag ────────
(function injectStylesheet() {
  if (document.getElementById('kc-styles-link')) return;
  const link = document.createElement('link');
  link.id   = 'kc-styles-link';
  link.rel  = 'stylesheet';
  link.href = '/admin/admin-styles.css';
  document.head.insertBefore(link, document.head.firstChild);
})();



// ── FAVICON INJECTION ────────────────────────────────────────
// Adds favicon to every admin page automatically — no manual tags needed.
(function injectFavicon() {
  // Remove any existing favicon tags first
  document.querySelectorAll('link[rel*="icon"]').forEach(el => el.remove());

  const ico = document.createElement('link');
  ico.rel = 'icon'; ico.type = 'image/x-icon';
  ico.href = '/favicon.ico';
  document.head.appendChild(ico);

  const png192 = document.createElement('link');
  png192.rel = 'icon'; png192.type = 'image/png'; png192.sizes = '192x192';
  png192.href = '/favicon-192.png';
  document.head.appendChild(png192);

  const apple = document.createElement('link');
  apple.rel = 'apple-touch-icon'; apple.sizes = '180x180';
  apple.href = '/apple-touch-icon.png';
  document.head.appendChild(apple);
})();

// ── PANEL SWITCHER (for pages that still use inline panels) ──
const panelTitles = {
  dashboard:'Dashboard', orders:'Orders', products:'Product Catalog',
  stock:'Stock Management', addprod:'Add New Product', customers:'Customers',
  coupons:'Coupons', banners:'Banners & Promotions', chat:'Live Chat',
  reports:'Reports & Analytics', adminusers:'Admin Users',
  inbox:'📱 WhatsApp Inbox', crm:'📊 CRM', crmstages:'⚙️ CRM Settings'
};

function show(id, navEl) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(id + 'Panel');
  if (panel) panel.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (navEl) navEl.classList.add('active');
  const pt = document.getElementById('pageTitle');
  if (pt) pt.textContent = panelTitles[id] || id;
  const mt = document.getElementById('mobTitle');
  if (mt) mt.textContent = panelTitles[id] || id;
  window.scrollTo(0, 0);
}

// ── KEYBOARD SHORTCUTS (global) ──────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    // Close any open modal
    ['orderModal','orderDetailModal','leadModal','addLeadModal'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.style.display !== 'none') el.style.display = 'none';
    });
  }
  if (e.key === 'Enter' && document.activeElement?.id === 'adminPass') adminLogin();
});
