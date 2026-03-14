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
  const items = [
    { id:'dashboard',  ico:'📊', lbl:'Dashboard' },
    { id:'orders',     ico:'📦', lbl:'Orders' },
    { id:'products',   ico:'👗', lbl:'Products' },
    { id:'stock',      ico:'📋', lbl:'Stock',        sub:true },
    { id:'addprod',    ico:'➕', lbl:'Add Product',  sub:true },
    { id:'banners',    ico:'🎨', lbl:'Banners',      sub:true },
    { id:'coupons',    ico:'🎟️', lbl:'Coupons',     sub:true },
    { id:'customers',  ico:'👥', lbl:'Customers' },
    { id:'reports',    ico:'📈', lbl:'Reports' },
    { id:'inbox',      ico:'📱', lbl:'WhatsApp', badge:'inboxBadge' },
    { id:'crm',        ico:'📊', lbl:'CRM' },
    { id:'adminusers', ico:'🔐', lbl:'Admin Users',  superOnly:true },
  ];

  const LOGO = 'https://res.cloudinary.com/dhqjytd0e/image/upload/v1772393179/Kids_Cart_Brand_Identity_AW2_1_-01_phqsob.png';

  return `
  <div class="sidebar">
    <div class="sb-logo">
      <img src="${LOGO}" alt="KidsCart">
      <small>Admin Panel v3</small>
    </div>
    <nav class="sb-nav">
      ${items.map(it => {
        const isActive = it.id === activePage || (it.sub && activePage === 'products' && ['stock','addprod','banners','coupons'].includes(it.id));
        const hide     = it.superOnly ? ' super-only" style="display:none' : '';
        const badge    = it.badge ? `<span id="${it.badge}" style="display:none;background:#25D366;color:#fff;border-radius:50%;min-width:18px;height:18px;font-size:.6rem;font-weight:900;align-items:center;justify-content:center;padding:0 3px;margin-left:auto;">0</span>` : '';
        const indent   = it.sub ? ' style="padding-left:36px;font-size:.82rem;"' : '';
        return `<div class="nav-item${isActive ? ' active' : ''}${hide}" onclick="adminNav('${it.id}')"${indent}>
          <span class="ico">${it.ico}</span><span class="lbl">${it.lbl}</span>${badge}
        </div>`;
      }).join('')}
    </nav>
    <div class="sb-footer">
      <a href="/" target="_blank" style="display:block;text-align:center;color:rgba(255,255,255,.7);font-size:.75rem;font-weight:700;text-decoration:none;margin-bottom:10px;">🛍️ View Shop</a>
      <button onclick="adminLogout()">🚪 Logout</button>
    </div>
  </div>`;
}

// ── SHARED MOBILE BOTTOM NAV HTML ───────────────────────────
// Lightweight version — main tabs only. Pages add this to their HTML.
function renderMobBar(activePage) {
  const tabs = [
    { id:'dashboard', ico:'📊', lbl:'Home' },
    { id:'orders',    ico:'📦', lbl:'Orders' },
    { id:'products',  ico:'👗', lbl:'Products' },
    { id:'inbox',     ico:'📱', lbl:'WhatsApp', badge:true },
    { id:'crm',       ico:'🤝', lbl:'CRM' },
  ];
  return `
  <div class="mob-bar">
    <div class="mob-bar-inner">
      ${tabs.map(t => `
      <button class="mob-btn${t.id === activePage ? ' active' : ''}" onclick="adminNav('${t.id}')">
        <span class="mi">${t.ico}</span>
        <span class="ml">${t.lbl}</span>
        ${t.badge ? '<span class="mob-badge" id="mobInboxBadge" style="display:none;">0</span>' : ''}
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
// Each page can still add its own <style> after this for page-specific rules.
(function injectBaseStyles() {
  if (document.getElementById('kc-shared-styles')) return;
  const style = document.createElement('style');
  style.id = 'kc-shared-styles';
  style.textContent = `
:root {
  --pp:#7B2D8B; --pp2:#5C1F7A; --or:#F7941D;
  --ok:#00a651; --er:#c62828; --gy:#888;
  --lt:#f8f4fc; --lt2:#ede7f6; --wh:#fff;
  --rs:10px; --shadow:0 2px 16px rgba(123,45,139,.10);
}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Nunito',sans-serif;background:#F5F0F8;color:#222;min-height:100vh;}

/* Login */
.login-box{background:#fff;border-radius:20px;padding:40px 36px;width:360px;max-width:96vw;box-shadow:0 8px 40px rgba(0,0,0,.18);}
.login-logo{text-align:center;margin-bottom:24px;}
.login-logo img{height:90px;}
.login-box h2{text-align:center;font-family:'Poppins',sans-serif;color:var(--pp);font-size:1.4rem;margin-bottom:6px;}
.login-box p{text-align:center;color:var(--gy);font-size:.85rem;margin-bottom:24px;}
.linp{width:100%;padding:12px 14px;border:2px solid #ddd;border-radius:var(--rs);font-family:'Nunito',sans-serif;font-size:.95rem;outline:none;transition:.2s;margin-bottom:12px;}
.linp:focus{border-color:var(--pp);}
.lbtn{width:100%;padding:13px;background:linear-gradient(135deg,var(--pp),var(--pp2));color:#fff;border:none;border-radius:var(--rs);font-family:'Poppins',sans-serif;font-weight:700;font-size:1rem;cursor:pointer;margin-top:4px;}
.lbtn:hover{opacity:.92;}

/* Layout */
#adminApp{display:none;min-height:100vh;}
.sidebar{position:fixed;left:0;top:0;width:230px;height:100vh;background:linear-gradient(180deg,var(--pp) 0%,var(--pp2) 100%);overflow-y:auto;z-index:100;display:flex;flex-direction:column;}
.sb-logo{padding:20px 20px 16px;border-bottom:1px solid rgba(255,255,255,.15);}
.sb-logo img{height:72px;filter:brightness(0) invert(1);object-fit:contain;max-width:180px;}
.sb-logo small{display:block;color:rgba(255,255,255,.6);font-size:.7rem;margin-top:4px;}
.sb-nav{flex:1;padding:12px 0;}
.nav-item{display:flex;align-items:center;gap:10px;padding:11px 20px;color:rgba(255,255,255,.8);font-size:.88rem;font-weight:700;cursor:pointer;border-left:3px solid transparent;transition:.2s;}
.nav-item:hover,.nav-item.active{background:rgba(255,255,255,.12);color:#fff;border-left-color:#fff;}
.nav-item span.ico{font-size:1.1rem;width:22px;text-align:center;}
.sb-footer{padding:16px 20px;border-top:1px solid rgba(255,255,255,.15);}
.sb-footer button{background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:8px;padding:8px 16px;font-family:'Nunito',sans-serif;font-weight:700;font-size:.82rem;cursor:pointer;width:100%;}
.sb-footer button:hover{background:rgba(255,255,255,.25);}
.main{margin-left:230px;min-height:100vh;display:flex;flex-direction:column;}
.topbar{background:#fff;padding:14px 28px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #eee;position:sticky;top:0;z-index:50;box-shadow:0 2px 8px rgba(0,0,0,.04);}
.topbar h2{font-family:'Poppins',sans-serif;color:var(--pp);font-size:1.15rem;font-weight:800;}
.topbar-right{display:flex;align-items:center;gap:12px;}
.admin-badge{background:var(--lt2);color:var(--pp);font-size:.78rem;font-weight:800;padding:5px 12px;border-radius:50px;}
.content{flex:1;padding:24px 28px;}
.panel{display:none;}
.panel.active{display:block;}

/* Cards */
.card{background:#fff;border-radius:14px;padding:20px 24px;box-shadow:var(--shadow);margin-bottom:20px;}
.card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}
.card-head h3{font-family:'Poppins',sans-serif;font-size:1rem;color:var(--pp);}

/* Stat cards */
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px;}
.stat-card{background:#fff;border-radius:14px;padding:20px;box-shadow:var(--shadow);border-left:4px solid var(--pp);}
.stat-card.or{border-left-color:var(--or);} .stat-card.ok{border-left-color:var(--ok);} .stat-card.er{border-left-color:var(--er);}
.stat-card p{color:var(--gy);font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}
.stat-card h2{font-family:'Poppins',sans-serif;font-size:1.8rem;font-weight:800;color:#222;}
.stat-card small{font-size:.75rem;color:var(--gy);margin-top:4px;display:block;}

/* Tables */
.tbl-wrap{overflow-x:auto;}
table{width:100%;border-collapse:collapse;font-size:.85rem;}
th{background:var(--lt);color:var(--pp);font-weight:800;padding:10px 12px;text-align:left;white-space:nowrap;}
td{padding:10px 12px;border-bottom:1px solid #f0e5f8;vertical-align:middle;}
tr:hover td{background:#FAF7FC;}

/* Badges */
.badge{display:inline-block;padding:3px 10px;border-radius:50px;font-size:.72rem;font-weight:800;}
.b-placed{background:#e3f2fd;color:#1565c0;} .b-confirmed{background:#e8f5e9;color:#2e7d32;}
.b-processing{background:#fff8e1;color:#e65100;} .b-shipped{background:#e1f5fe;color:#0277bd;}
.b-out_for_delivery{background:#f3e5f5;color:#6a1b9a;} .b-delivered{background:#e8f5e9;color:#1b5e20;}
.b-cancelled{background:#ffebee;color:#b71c1c;} .b-returned{background:#fce4ec;color:#880e4f;}

/* Buttons */
.btn{padding:8px 16px;border-radius:8px;border:none;font-family:'Nunito',sans-serif;font-weight:800;cursor:pointer;font-size:.82rem;transition:.2s;}
.btn-sm{padding:5px 12px;font-size:.78rem;}
.btn-ok-g{background:#e8f5e9;color:#2e7d32;} .btn-ok-g:hover{background:#2e7d32;color:#fff;}
.btn-er-g{background:#ffebee;color:var(--er);} .btn-er-g:hover{background:var(--er);color:#fff;}
.btn-pp{background:var(--pp);color:#fff;} .btn-pp:hover{background:var(--pp2);}
.btn-or{background:var(--or);color:#fff;}
.btn-ghost{background:var(--lt);color:var(--pp);} .btn-ghost:hover{background:var(--lt2);}
.btn-full{width:100%;padding:12px;border-radius:var(--rs);border:none;background:linear-gradient(135deg,var(--pp),var(--pp2));color:#fff;font-family:'Poppins',sans-serif;font-weight:700;font-size:.95rem;cursor:pointer;}
.btn-full:hover{opacity:.9;}

/* Forms */
.fgroup{margin-bottom:14px;}
.fgroup label{display:block;font-weight:800;font-size:.8rem;color:#555;margin-bottom:5px;}
.fgroup input,.fgroup select,.fgroup textarea{width:100%;padding:10px 12px;border:2px solid #e0d6ee;border-radius:8px;font-family:'Nunito',sans-serif;font-size:.88rem;outline:none;transition:.2s;}
.fgroup input:focus,.fgroup select:focus,.fgroup textarea:focus{border-color:var(--pp);}
.fgroup textarea{resize:vertical;min-height:80px;}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}

/* Search bar */
.search-bar{display:flex;gap:10px;margin-bottom:16px;}
.search-bar input{flex:1;padding:9px 14px;border:2px solid #e0d6ee;border-radius:8px;font-family:'Nunito',sans-serif;font-size:.88rem;outline:none;}
.search-bar input:focus{border-color:var(--pp);}
.search-bar select{padding:9px 12px;border:2px solid #e0d6ee;border-radius:8px;font-family:'Nunito',sans-serif;font-size:.85rem;outline:none;}

/* Reports */
.report-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;}

/* Low stock */
.ls-item{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0e5f8;font-size:.85rem;}

/* Toast */
#toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(20px);background:#333;color:#fff;padding:11px 24px;border-radius:50px;font-size:.88rem;font-weight:700;opacity:0;transition:.3s;z-index:9999;pointer-events:none;white-space:nowrap;}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0);}

/* Mobile header */
.mob-header{display:none;}
.mob-bar{display:none;}

/* Responsive */
@media(max-width:900px){
  .sidebar{width:60px;}
  .nav-item span.lbl{display:none;}
  .sb-logo small,.sb-logo span{display:none;}
  .main{margin-left:60px;}
  .stats-grid{grid-template-columns:1fr 1fr;}
}
@media(max-width:768px){
  .sidebar{display:none!important;}
  .main{margin-left:0!important;margin-top:54px;margin-bottom:66px;}
  .topbar{display:none!important;}
  .content{padding:12px 10px!important;}
  .stats-grid{grid-template-columns:1fr 1fr!important;gap:8px;margin-bottom:16px;}
  .stat-card{padding:14px 10px!important;}
  .grid2,.grid3{grid-template-columns:1fr!important;gap:10px;}
  .report-row{grid-template-columns:1fr!important;}
  .card{padding:14px 12px!important;border-radius:14px!important;margin-bottom:14px;}
  .card-head{flex-wrap:wrap;gap:8px;}
  .tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}
  table{font-size:.74rem;min-width:480px;}
  table td,table th{padding:8px 6px!important;white-space:nowrap;}
  #loginScreen{padding:16px;}
  .login-box{width:100%!important;max-width:100%!important;padding:28px 20px!important;}

  /* Mobile top header */
  .mob-header{display:flex;position:fixed;top:0;left:0;right:0;height:54px;background:linear-gradient(90deg,#7B2D8B,#5C1F7A);z-index:300;align-items:center;padding:0 14px;gap:10px;box-shadow:0 2px 10px rgba(0,0,0,.2);}
  .mob-header img{height:30px;object-fit:contain;filter:brightness(0) invert(1);}
  .mob-hdr-title{flex:1;color:#fff;font-weight:800;font-size:.9rem;font-family:'Poppins',sans-serif;margin:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .mob-hdr-right{color:rgba(255,255,255,.8);font-size:.72rem;text-align:right;line-height:1.3;flex-shrink:0;}

  /* Mobile bottom bar */
  .mob-bar{display:block;position:fixed;bottom:0;left:0;right:0;height:62px;background:#fff;border-top:1.5px solid #f0e4f9;z-index:300;box-shadow:0 -2px 12px rgba(123,45,139,.08);}
  .mob-bar-inner{display:flex;height:100%;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;}
  .mob-bar-inner::-webkit-scrollbar{display:none;}
  .mob-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:62px;flex:1;gap:2px;border:none;background:transparent;cursor:pointer;color:#aaa;padding:6px 2px;font-family:'Nunito',sans-serif;transition:.15s;position:relative;}
  .mob-btn.active{color:var(--pp);}
  .mob-btn .mi{font-size:1.25rem;line-height:1;}
  .mob-btn.active .mi{transform:scale(1.15);}
  .mob-btn .ml{font-size:.55rem;font-weight:800;white-space:nowrap;margin-top:1px;}
  .mob-badge{position:absolute;top:4px;right:8px;background:#25D366;color:#fff;border-radius:50%;min-width:16px;height:16px;font-size:.6rem;font-weight:900;display:flex;align-items:center;justify-content:center;padding:0 3px;}
}
@media(max-width:600px){
  .stats-grid{grid-template-columns:1fr 1fr;}
}
`;
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
