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
  const LOGO = 'https://res.cloudinary.com/dhqjytd0e/image/upload/v1772393179/Kids_Cart_Brand_Identity_AW2_1_-01_phqsob.png';
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
  const LOGO = 'https://res.cloudinary.com/dhqjytd0e/image/upload/v1772393179/Kids_Cart_Brand_Identity_AW2_1_-01_phqsob.png';
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
const LOGO_URL = 'https://res.cloudinary.com/dhqjytd0e/image/upload/v1772393179/Kids_Cart_Brand_Identity_AW2_1_-01_phqsob.png';

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

// ── SHARED CSS VARIABLES & BASE STYLES ──────────────────────
// Injected into <head> so each page doesn't need to duplicate base styles.
(function injectBaseStyles() {
  if (document.getElementById('kc-shared-styles')) return;
  const style = document.createElement('style');
  style.id = 'kc-shared-styles';
  style.textContent = "/* ══════════════════════════════════════════\n   KIDSCART ADMIN v3 — Premium UI\n   Light body + Dark purple sidebar\n══════════════════════════════════════════ */\n\n/* ── Reset & base ── */\n*{box-sizing:border-box;margin:0;padding:0;}\nbody{font-family:'Nunito',sans-serif;background:#F0ECF7;color:#1a0a2e;min-height:100vh;}\n\n/* ── Sidebar ── */\n.sidebar{\n  position:fixed;left:0;top:0;width:240px;height:100vh;\n  background:linear-gradient(180deg,#4A1070 0%,#3a0d5c 50%,#2d0a47 100%);\n  display:flex;flex-direction:column;z-index:200;\n  transition:width .25s cubic-bezier(.4,0,.2,1);\n  overflow:hidden;\n}\n.sidebar.collapsed{width:68px;}\n.sidebar.collapsed .sb-label,\n.sidebar.collapsed .sb-logo-text,\n.sidebar.collapsed .sb-logo-sub,\n.sidebar.collapsed .nav-group-label,\n.sidebar.collapsed .sb-user-info,\n.sidebar.collapsed .nav-badge{display:none;}\n\n.sb-top{padding:18px 16px 14px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}\n.sb-brand{display:flex;align-items:center;gap:11px;min-width:0;}\n.sb-logo-img{width:36px;height:36px;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;}\n.sb-logo-img img{width:26px;height:26px;object-fit:contain;}\n.sb-logo-text{font-family:'Poppins',sans-serif;font-weight:800;font-size:.95rem;color:#fff;white-space:nowrap;}\n.sb-logo-sub{font-size:.6rem;color:rgba(255,255,255,.4);font-weight:600;white-space:nowrap;}\n.sb-toggle{width:28px;height:28px;background:rgba(255,255,255,.1);border:none;border-radius:8px;cursor:pointer;color:rgba(255,255,255,.7);font-size:.9rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:.2s;}\n.sb-toggle:hover{background:rgba(255,255,255,.18);}\n\n.sb-nav{flex:1;padding:10px 8px;overflow-y:auto;overflow-x:hidden;}\n.sb-nav::-webkit-scrollbar{width:3px;}\n.sb-nav::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:2px;}\n\n.nav-group-label{font-size:.58rem;font-weight:800;color:rgba(255,255,255,.25);text-transform:uppercase;letter-spacing:1px;padding:10px 10px 4px;white-space:nowrap;}\n\n.nav-item{\n  display:flex;align-items:center;gap:10px;padding:10px 10px;\n  border-radius:10px;cursor:pointer;color:rgba(255,255,255,.6);\n  font-size:.82rem;font-weight:700;transition:.15s;margin-bottom:2px;\n  white-space:nowrap;position:relative;text-decoration:none;\n}\n.nav-item:hover{background:rgba(255,255,255,.1);color:rgba(255,255,255,.95);}\n.nav-item.active{\n  background:rgba(255,255,255,.15);color:#fff;\n  border:1px solid rgba(255,255,255,.15);\n}\n.nav-item.active::before{\n  content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);\n  width:3px;height:55%;background:#f7941d;border-radius:0 3px 3px 0;\n}\n.nav-icon{font-size:1rem;width:20px;text-align:center;flex-shrink:0;}\n.nav-badge{\n  margin-left:auto;background:#25D366;color:#fff;\n  border-radius:20px;padding:1px 7px;font-size:.6rem;font-weight:800;\n  flex-shrink:0;\n}\n.nav-badge.red{background:#e53935;}\n\n.sb-user{\n  padding:12px 14px;border-top:1px solid rgba(255,255,255,.08);\n  display:flex;align-items:center;gap:10px;flex-shrink:0;\n}\n.sb-avatar{\n  width:34px;height:34px;border-radius:50%;flex-shrink:0;\n  background:linear-gradient(135deg,#f7941d,#e07819);\n  display:flex;align-items:center;justify-content:center;\n  font-size:.75rem;font-weight:800;color:#fff;\n}\n.sb-user-name{font-size:.78rem;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n.sb-user-role{font-size:.62rem;color:rgba(255,255,255,.4);white-space:nowrap;}\n.sb-logout{\n  width:28px;height:28px;border:none;border-radius:8px;\n  background:rgba(255,0,0,.15);color:rgba(255,120,120,.8);\n  cursor:pointer;font-size:.8rem;flex-shrink:0;\n  display:flex;align-items:center;justify-content:center;transition:.2s;\n}\n.sb-logout:hover{background:rgba(255,0,0,.25);}\n\n/* ── Main area ── */\n.main{\n  margin-left:240px;min-height:100vh;display:flex;flex-direction:column;\n  transition:margin-left .25s cubic-bezier(.4,0,.2,1);\n}\n.main.expanded{margin-left:68px;}\n\n/* ── Topbar ── */\n.topbar{\n  background:#fff;padding:12px 28px;display:flex;align-items:center;\n  justify-content:space-between;border-bottom:1px solid rgba(123,45,139,.08);\n  position:sticky;top:0;z-index:100;\n  box-shadow:0 1px 20px rgba(74,16,112,.06);\n}\n.topbar-left{display:flex;align-items:center;gap:12px;}\n.page-title{font-family:'Poppins',sans-serif;font-weight:800;font-size:1.1rem;color:#1a0a2e;}\n.breadcrumb{font-size:.75rem;color:#aaa;font-weight:600;}\n.topbar-right{display:flex;align-items:center;gap:10px;}\n\n.notif-btn{\n  position:relative;width:36px;height:36px;background:#F0ECF7;\n  border-radius:10px;display:flex;align-items:center;justify-content:center;\n  cursor:pointer;border:1px solid rgba(123,45,139,.1);font-size:.9rem;\n  transition:.2s;\n}\n.notif-btn:hover{background:#e8e0f5;}\n.notif-dot{\n  position:absolute;top:7px;right:8px;width:8px;height:8px;\n  background:#f7941d;border-radius:50%;border:2px solid #fff;\n}\n.ai-btn{\n  display:flex;align-items:center;gap:6px;padding:8px 16px;\n  background:linear-gradient(135deg,#f7941d,#e07819);\n  border:none;border-radius:20px;color:#fff;font-family:'Nunito',sans-serif;\n  font-weight:800;font-size:.78rem;cursor:pointer;transition:.2s;\n  box-shadow:0 4px 12px rgba(247,148,29,.3);\n}\n.ai-btn:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(247,148,29,.4);}\n.view-shop-btn{\n  padding:8px 16px;background:#F0ECF7;border:1px solid rgba(123,45,139,.15);\n  border-radius:20px;color:#4A1070;font-family:'Nunito',sans-serif;font-weight:800;\n  font-size:.78rem;text-decoration:none;transition:.2s;\n}\n.view-shop-btn:hover{background:#e8e0f5;}\n.admin-badge{\n  background:#ede7f6;color:#4A1070;font-size:.75rem;font-weight:800;\n  padding:6px 14px;border-radius:20px;border:1px solid rgba(123,45,139,.15);\n}\n\n/* ── Content ── */\n.content{flex:1;padding:24px 28px;}\n\n/* ── Panels ── */\n.panel{display:none;}\n.panel.active{display:block;}\n\n/* ── Stat cards ── */\n.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:22px;}\n.stat-card{\n  background:#fff;border-radius:16px;padding:20px;\n  border:1px solid rgba(123,45,139,.07);\n  box-shadow:0 2px 16px rgba(74,16,112,.06);\n  position:relative;overflow:hidden;transition:.2s;\n}\n.stat-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(74,16,112,.1);}\n.stat-card::after{\n  content:'';position:absolute;top:-24px;right:-24px;\n  width:80px;height:80px;border-radius:50%;opacity:.08;\n}\n.stat-card.v1::after{background:#4A1070;}\n.stat-card.v2::after{background:#f7941d;}\n.stat-card.v3::after{background:#00a651;}\n.stat-card.v4::after{background:#e53935;}\n.stat-icon{\n  width:40px;height:40px;border-radius:12px;margin-bottom:14px;\n  display:flex;align-items:center;justify-content:center;font-size:1.1rem;\n}\n.v1 .stat-icon{background:#ede7f6;}\n.v2 .stat-icon{background:#fff3e0;}\n.v3 .stat-icon{background:#e8f5e9;}\n.v4 .stat-icon{background:#ffebee;}\n.stat-label{font-size:.72rem;font-weight:800;color:#999;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}\n.stat-value{font-family:'Poppins',sans-serif;font-size:1.9rem;font-weight:900;color:#1a0a2e;line-height:1;}\n.stat-sub{font-size:.7rem;color:#bbb;margin-top:6px;font-weight:600;}\n.stat-trend{\n  position:absolute;top:16px;right:16px;\n  font-size:.68rem;font-weight:800;padding:3px 8px;border-radius:20px;\n}\n.trend-up{background:#e8f5e9;color:#2e7d32;}\n.trend-dn{background:#ffebee;color:#c62828;}\n\n/* ── Dashboard grid ── */\n.dash-grid{display:grid;grid-template-columns:1fr 340px;gap:18px;margin-bottom:18px;}\n.dash-grid-bottom{display:grid;grid-template-columns:1fr 1fr;gap:18px;}\n\n/* ── Cards ── */\n.card{\n  background:#fff;border-radius:16px;padding:22px 24px;\n  border:1px solid rgba(123,45,139,.07);\n  box-shadow:0 2px 16px rgba(74,16,112,.05);margin-bottom:20px;\n}\n.card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}\n.card-title{font-family:'Poppins',sans-serif;font-size:.92rem;font-weight:800;color:#1a0a2e;}\n.card-action{\n  font-size:.75rem;font-weight:800;color:#4A1070;text-decoration:none;\n  padding:5px 12px;background:#ede7f6;border-radius:20px;border:none;cursor:pointer;\n  transition:.15s;\n}\n.card-action:hover{background:#d1c4e9;}\n\n/* ── Chart ── */\n.chart-wrap{height:140px;display:flex;align-items:flex-end;gap:6px;padding-bottom:4px;}\n.chart-bar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;}\n.chart-bar{\n  width:100%;border-radius:6px 6px 0 0;\n  background:linear-gradient(180deg,#c9b3e8,#ddd5f5);\n  transition:.3s;min-height:4px;\n}\n.chart-bar.today{background:linear-gradient(180deg,#f7941d,#e07819);}\n.chart-bar.high{background:linear-gradient(180deg,#4A1070,#7B2D8B);}\n.chart-label{font-size:.6rem;color:#bbb;font-weight:700;}\n.chart-legend{display:flex;gap:16px;margin-top:12px;}\n.legend-item{display:flex;align-items:center;gap:5px;font-size:.68rem;color:#888;font-weight:700;}\n.legend-dot{width:8px;height:8px;border-radius:50%;}\n\n/* ── Recent orders table ── */\n.ord-table{width:100%;border-collapse:collapse;font-size:.82rem;}\n.ord-table th{\n  background:#f8f5fd;color:#4A1070;font-weight:800;\n  padding:10px 12px;text-align:left;white-space:nowrap;font-size:.72rem;\n  text-transform:uppercase;letter-spacing:.3px;\n}\n.ord-table td{padding:11px 12px;border-bottom:1px solid #f5f0fb;vertical-align:middle;}\n.ord-table tr:last-child td{border-bottom:none;}\n.ord-table tr:hover td{background:#faf7fe;}\n.ord-avatar{\n  width:30px;height:30px;border-radius:9px;\n  background:linear-gradient(135deg,#4A1070,#7B2D8B);\n  display:inline-flex;align-items:center;justify-content:center;\n  color:#fff;font-weight:800;font-size:.7rem;margin-right:8px;vertical-align:middle;\n}\n\n/* ── Badges ── */\n.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.68rem;font-weight:800;}\n.b-placed{background:#e3f2fd;color:#1565c0;}\n.b-confirmed{background:#e8f5e9;color:#2e7d32;}\n.b-processing{background:#fff8e1;color:#e65100;}\n.b-shipped{background:#e1f5fe;color:#0277bd;}\n.b-out_for_delivery{background:#f3e5f5;color:#6a1b9a;}\n.b-delivered{background:#e8f5e9;color:#1b5e20;}\n.b-cancelled{background:#ffebee;color:#b71c1c;}\n.b-returned{background:#fce4ec;color:#880e4f;}\n\n/* ── Low stock list ── */\n.ls-item{\n  display:flex;align-items:center;justify-content:space-between;\n  padding:10px 0;border-bottom:1px solid #f5f0fb;font-size:.82rem;\n}\n.ls-item:last-child{border-bottom:none;}\n.ls-name{font-weight:700;color:#1a0a2e;}\n.ls-stock{font-weight:900;font-size:.85rem;}\n\n/* ── AI Panel ── */\n.ai-panel{\n  background:linear-gradient(135deg,#f8f4ff,#ede7f6);\n  border:1px solid rgba(123,45,139,.15);border-radius:16px;padding:20px;\n}\n.ai-panel-header{display:flex;align-items:center;gap:12px;margin-bottom:16px;}\n.ai-orb{\n  width:38px;height:38px;border-radius:12px;flex-shrink:0;\n  background:linear-gradient(135deg,#f7941d,#4A1070);\n  display:flex;align-items:center;justify-content:center;font-size:1rem;\n  box-shadow:0 4px 12px rgba(247,148,29,.3);\n}\n.ai-panel-title{font-family:'Poppins',sans-serif;font-weight:800;font-size:.88rem;color:#1a0a2e;}\n.ai-panel-sub{font-size:.68rem;color:#999;font-weight:600;}\n.ai-chips{display:flex;flex-direction:column;gap:7px;margin-bottom:14px;}\n.ai-chip{\n  background:#fff;border:1px solid rgba(123,45,139,.12);border-radius:10px;\n  padding:8px 12px;font-size:.75rem;color:#4A1070;cursor:pointer;font-weight:700;\n  transition:.15s;text-align:left;display:flex;align-items:center;gap:8px;\n}\n.ai-chip:hover{background:#ede7f6;border-color:rgba(123,45,139,.25);}\n.ai-input-wrap{display:flex;gap:8px;margin-top:4px;}\n.ai-input{\n  flex:1;padding:9px 14px;background:#fff;\n  border:1px solid rgba(123,45,139,.15);border-radius:10px;\n  font-family:'Nunito',sans-serif;font-size:.82rem;outline:none;color:#1a0a2e;\n}\n.ai-input:focus{border-color:#4A1070;}\n.ai-send-btn{\n  width:36px;height:36px;background:linear-gradient(135deg,#f7941d,#e07819);\n  border:none;border-radius:10px;cursor:pointer;font-size:.85rem;color:#fff;\n  display:flex;align-items:center;justify-content:center;flex-shrink:0;\n  box-shadow:0 3px 10px rgba(247,148,29,.3);transition:.15s;\n}\n.ai-send-btn:hover{transform:translateY(-1px);}\n.ai-response{\n  background:#fff;border:1px solid rgba(123,45,139,.1);border-radius:10px;\n  padding:12px;margin-top:10px;font-size:.78rem;line-height:1.6;color:#333;\n  display:none;\n}\n.ai-typing{color:#aaa;font-style:italic;}\n\n/* ── Quick actions ── */\n.quick-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}\n.qa-card{\n  background:#fff;border:1px solid rgba(123,45,139,.08);border-radius:14px;\n  padding:16px 12px;text-align:center;cursor:pointer;transition:.2s;\n  text-decoration:none;display:block;\n}\n.qa-card:hover{background:#f8f5fd;border-color:rgba(123,45,139,.2);transform:translateY(-2px);}\n.qa-icon{\n  width:44px;height:44px;border-radius:12px;margin:0 auto 10px;\n  display:flex;align-items:center;justify-content:center;font-size:1.2rem;\n}\n.qa-label{font-size:.72rem;font-weight:800;color:#4A1070;}\n\n/* ── Customers panel ── */\n.search-bar{display:flex;gap:10px;margin-bottom:16px;}\n.search-bar input,.search-bar select{\n  padding:9px 14px;border:1.5px solid #e8dff5;border-radius:10px;\n  font-family:'Nunito',sans-serif;font-size:.85rem;outline:none;\n  transition:.2s;background:#fff;\n}\n.search-bar input{flex:1;}\n.search-bar input:focus,.search-bar select:focus{border-color:#4A1070;}\n\n/* ── Reports ── */\n.report-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;}\n\n/* ── Tables (shared) ── */\n.tbl-wrap{overflow-x:auto;}\ntable{width:100%;border-collapse:collapse;font-size:.83rem;}\nth{background:#f8f5fd;color:#4A1070;font-weight:800;padding:10px 12px;text-align:left;white-space:nowrap;font-size:.72rem;text-transform:uppercase;letter-spacing:.3px;}\ntd{padding:11px 12px;border-bottom:1px solid #f5f0fb;vertical-align:middle;}\ntr:hover td{background:#faf7fe;}\n\n/* ── Buttons ── */\n.btn{padding:8px 16px;border-radius:10px;border:none;font-family:'Nunito',sans-serif;font-weight:800;cursor:pointer;font-size:.82rem;transition:.15s;}\n.btn-sm{padding:5px 12px;font-size:.76rem;}\n.btn-pp{background:#4A1070;color:#fff;}\n.btn-pp:hover{background:#3a0d5c;}\n.btn-ok-g{background:#e8f5e9;color:#2e7d32;}\n.btn-ok-g:hover{background:#2e7d32;color:#fff;}\n.btn-er-g{background:#ffebee;color:#c62828;}\n.btn-er-g:hover{background:#c62828;color:#fff;}\n.btn-ghost{background:#f0ecf7;color:#4A1070;}\n.btn-ghost:hover{background:#ede7f6;}\n.btn-full{\n  width:100%;padding:12px;border-radius:10px;border:none;\n  background:linear-gradient(135deg,#4A1070,#7B2D8B);color:#fff;\n  font-family:'Poppins',sans-serif;font-weight:700;font-size:.95rem;cursor:pointer;\n  transition:.2s;\n}\n.btn-full:hover{opacity:.9;}\n\n/* ── Forms ── */\n.fgroup{margin-bottom:14px;}\n.fgroup label{display:block;font-weight:800;font-size:.75rem;color:#666;margin-bottom:5px;text-transform:uppercase;letter-spacing:.3px;}\n.fgroup input,.fgroup select,.fgroup textarea{\n  width:100%;padding:10px 14px;border:1.5px solid #e8dff5;border-radius:10px;\n  font-family:'Nunito',sans-serif;font-size:.88rem;outline:none;transition:.2s;background:#fff;\n}\n.fgroup input:focus,.fgroup select:focus,.fgroup textarea:focus{border-color:#4A1070;box-shadow:0 0 0 3px rgba(74,16,112,.08);}\n.fgroup textarea{resize:vertical;min-height:80px;}\n.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}\n\n/* ── Toast ── */\n#toast{\n  position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(20px);\n  background:#1a0a2e;color:#fff;padding:11px 24px;border-radius:50px;\n  font-size:.85rem;font-weight:700;opacity:0;transition:.3s;z-index:9999;\n  pointer-events:none;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.2);\n}\n#toast.show{opacity:1;transform:translateX(-50%) translateY(0);}\n\n/* ── Order modal ── */\n.modal-overlay{\n  display:none;position:fixed;inset:0;background:rgba(26,10,46,.5);\n  z-index:500;align-items:center;justify-content:center;padding:16px;\n  backdrop-filter:blur(4px);\n}\n.modal-box{\n  background:#fff;border-radius:20px;width:100%;max-width:460px;\n  box-shadow:0 24px 64px rgba(0,0,0,.2);animation:modalIn .2s ease;\n}\n.modal-box.wide{max-width:660px;max-height:92vh;overflow-y:auto;}\n@keyframes modalIn{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}\n.modal-head{\n  padding:18px 22px;border-bottom:1px solid #f0e8fb;\n  display:flex;justify-content:space-between;align-items:center;\n  position:sticky;top:0;background:#fff;border-radius:20px 20px 0 0;z-index:1;\n}\n.modal-head h3{font-family:'Poppins',sans-serif;color:#4A1070;font-size:.95rem;font-weight:800;}\n.modal-close{\n  width:32px;height:32px;background:#f0ecf7;border:none;border-radius:50%;\n  cursor:pointer;font-size:1rem;color:#4A1070;display:flex;align-items:center;justify-content:center;\n}\n.modal-body{padding:22px;}\n\n/* ── Mobile header ── */\n.mob-header{display:none;}\n.mob-bar{display:none;}\n\n/* ── Notification drawer ── */\n.notif-drawer{\n  position:fixed;top:60px;right:20px;width:300px;background:#fff;\n  border-radius:16px;border:1px solid rgba(123,45,139,.12);\n  box-shadow:0 16px 40px rgba(74,16,112,.15);z-index:400;\n  display:none;overflow:hidden;\n}\n.notif-drawer.open{display:block;animation:modalIn .15s ease;}\n.notif-item{\n  padding:12px 16px;border-bottom:1px solid #f5f0fb;\n  display:flex;gap:10px;align-items:flex-start;cursor:pointer;\n  transition:.15s;\n}\n.notif-item:hover{background:#faf7fe;}\n.notif-item:last-child{border-bottom:none;}\n.notif-dot-indicator{width:8px;height:8px;border-radius:50%;margin-top:5px;flex-shrink:0;}\n.notif-text{font-size:.78rem;color:#333;line-height:1.5;}\n.notif-time{font-size:.65rem;color:#bbb;margin-top:2px;font-weight:600;}\n\n/* ── Responsive ── */\n@media(max-width:1100px){\n  .sidebar{width:68px;}\n  .sb-label,.sb-logo-text,.sb-logo-sub,.nav-group-label,.sb-user-info,.nav-badge{display:none;}\n  .main{margin-left:68px;}\n  .stats-grid{grid-template-columns:1fr 1fr;}\n  .dash-grid{grid-template-columns:1fr;}\n}\n@media(max-width:768px){\n  .sidebar{display:none!important;}\n  .main{margin-left:0!important;margin-top:54px;margin-bottom:66px;}\n  .topbar{display:none!important;}\n  .content{padding:14px 12px!important;}\n  .stats-grid{grid-template-columns:1fr 1fr!important;gap:10px;margin-bottom:14px;}\n  .stat-card{padding:14px!important;}\n  .stat-value{font-size:1.5rem!important;}\n  .dash-grid,.dash-grid-bottom,.report-row{grid-template-columns:1fr!important;}\n  .grid2{grid-template-columns:1fr!important;}\n  .card{padding:16px!important;border-radius:14px!important;}\n  .quick-grid{grid-template-columns:repeat(4,1fr);gap:8px;}\n  .qa-icon{width:36px;height:36px;font-size:1rem;}\n\n  .mob-header{\n    display:flex;position:fixed;top:0;left:0;right:0;height:54px;\n    background:linear-gradient(90deg,#4A1070,#3a0d5c);z-index:300;\n    align-items:center;padding:0 14px;gap:10px;\n    box-shadow:0 2px 16px rgba(0,0,0,.2);\n  }\n  .mob-header img{height:28px;object-fit:contain;filter:brightness(0) invert(1);}\n  .mob-hdr-title{flex:1;color:#fff;font-weight:800;font-size:.9rem;font-family:'Poppins',sans-serif;margin:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n  .mob-hdr-right{color:rgba(255,255,255,.7);font-size:.72rem;}\n\n  .mob-bar{\n    display:block;position:fixed;bottom:0;left:0;right:0;height:62px;\n    background:#fff;border-top:1.5px solid #f0e8fb;z-index:300;\n    box-shadow:0 -2px 16px rgba(74,16,112,.08);\n  }\n  .mob-bar-inner{display:flex;height:100%;overflow-x:auto;scrollbar-width:none;}\n  .mob-bar-inner::-webkit-scrollbar{display:none;}\n  .mob-btn{\n    display:flex;flex-direction:column;align-items:center;justify-content:center;\n    min-width:62px;flex:1;gap:2px;border:none;background:transparent;\n    cursor:pointer;color:#aaa;padding:6px 2px;font-family:'Nunito',sans-serif;\n    transition:.15s;position:relative;\n  }\n  .mob-btn.active{color:#4A1070;}\n  .mob-btn .mi{font-size:1.2rem;line-height:1;}\n  .mob-btn .ml{font-size:.52rem;font-weight:800;white-space:nowrap;}\n  .mob-badge{\n    position:absolute;top:4px;right:8px;background:#25D366;color:#fff;\n    border-radius:50%;min-width:16px;height:16px;font-size:.58rem;\n    font-weight:900;display:flex;align-items:center;justify-content:center;padding:0 3px;\n  }\n  #orderDetailModal .modal-box{border-radius:20px 20px 0 0;margin-top:auto;}\n}\n@media(max-width:480px){\n  .stats-grid{grid-template-columns:1fr 1fr!important;}\n}";
  document.head.appendChild(style);
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
