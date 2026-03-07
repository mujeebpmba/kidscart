// ============================================================
// KIDSCART – Backend API v4
// Fixes: secrets in .env, Cloudinary uploads, admin login bug,
//        CORS hardened, email-only OTP (WhatsApp OTP coming soon),
//        rate limiting on register, RegExp safety, banner crash fixed
// ============================================================

const express    = require('express');
const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const multer     = require('multer');
const path       = require('path');
const nodemailer = require('nodemailer');
const http       = require('http');
const { Server } = require('socket.io');
const crypto     = require('crypto');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 5000;

// ── CORS – only your domain ────────────────────────────────
const allowedOrigins = [
  'https://kidscart-peach.vercel.app',
  'https://kidscart.kids',
  'https://www.kidscart.kids',
  'http://localhost:5000',
  'http://localhost:3000'
];
const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true }
});
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static('uploads'));

// ── CONSTANTS ─────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('❌ FATAL: JWT_SECRET not set in .env'); process.exit(1); }

const SITE_URL = process.env.FRONTEND_URL || 'https://kidscart.kids';
const BRAND    = 'KidsCart';
const PP       = '#7B2D8B';
const OR       = '#F7941D';
const LOGO     = 'https://res.cloudinary.com/dhqjytd0e/image/upload/v1772393179/Kids_Cart_Brand_Identity_AW2_1_-01_phqsob.png';

// ── CLOUDINARY ────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Cloudinary storage for product images
const productCloudStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'kidscart/products',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 900, height: 900, crop: 'limit', quality: 'auto:good' }]
  }
});

// Cloudinary storage for banner images
const bannerCloudStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'kidscart/banners',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1400, height: 560, crop: 'limit', quality: 'auto:good' }]
  }
});

const uploadProducts = multer({
  storage: productCloudStorage,
  limits: { fileSize: 8 * 1024 * 1024 },  // 8MB – handles 2.6MB easily
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|jpg|png|webp)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP images are allowed'));
  }
});

const uploadBanner = multer({
  storage: bannerCloudStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|jpg|png|webp)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP images are allowed'));
  }
});

// ── ZEPTOMAIL ─────────────────────────────────────────────
// ZeptoMail SMTP - primary on 587, fallback config
const mailer = nodemailer.createTransport({
  host: 'smtp.zeptomail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'emailapikey',
    pass: process.env.ZEPTO_API_KEY
  },
  tls: { rejectUnauthorized: false, ciphers: 'SSLv3' },
  pool: false,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
});

// Verify mailer on startup
mailer.verify((err) => {
  if (err) console.error('❌ ZeptoMail SMTP error:', err.message);
  else console.log('✅ ZeptoMail SMTP ready');
});

// ── EMAIL HELPERS ─────────────────────────────────────────
function emailWrap(title, body, ctaUrl, ctaText) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F0F8;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:30px 0;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;max-width:96%;">
<tr><td style="background:linear-gradient(135deg,${PP},#5C1F7A);padding:22px 32px;text-align:center;">
  <img src="${LOGO}" alt="KidsCart" height="48" style="display:inline-block;">
</td></tr>
<tr><td style="padding:30px 36px;">
  <h2 style="color:${PP};font-size:20px;margin:0 0 14px;">${title}</h2>
  ${body}
  ${ctaUrl ? `<div style="text-align:center;margin:24px 0;">
    <a href="${ctaUrl}" style="background:${PP};color:#fff;padding:13px 30px;border-radius:50px;text-decoration:none;font-weight:bold;font-size:14px;">${ctaText}</a>
  </div>` : ''}
  <hr style="border:none;border-top:1px solid #f0e5f8;margin:22px 0;">
  <p style="color:#aaa;font-size:11px;text-align:center;margin:0;">© 2025 ${BRAND} | kidscart.kids | info@kidscart.kids</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendEmail(to, subject, html) {
  const from = `"${BRAND}" <${process.env.ZEPTO_FROM_EMAIL || 'noreply@kidscart.kids'}>`;
  try {
    const info = await mailer.sendMail({ from, to, subject, html });
    console.log('✉️  Sent to:', to, '| msgId:', info.messageId);
    return true;
  } catch (e) {
    console.error('✉️  FAIL sending to:', to, '| from:', from, '| error:', e.message, '| code:', e.code);
    return false;
  }
}

const emailOTP = (to, otp, name) => sendEmail(to, `${BRAND} – Your OTP`,
  emailWrap('Your Login OTP 🔐',
    `<p style="color:#444;font-size:15px;">Hi ${name || 'there'},</p>
     <div style="background:#F5F0F8;border:2px dashed ${PP};border-radius:12px;padding:22px;text-align:center;margin:18px 0;">
       <span style="font-size:40px;font-weight:900;color:${PP};letter-spacing:10px;">${otp}</span>
     </div>
     <p style="color:#888;font-size:13px;text-align:center;">Valid for 10 minutes. Never share this OTP with anyone.</p>`));

const emailForgot = (to, name, token, uid) => sendEmail(to, `${BRAND} – Reset Password`,
  emailWrap('Reset Your Password 🔒',
    `<p style="color:#444;font-size:15px;">Hi ${name}, click below to set a new password. This link expires in 1 hour.</p>
     <p style="color:#888;font-size:13px;">Didn't request this? You can safely ignore this email.</p>`,
    `${SITE_URL}/admin.html?resetToken=${token}&userId=${uid}`, 'Reset Password →'));

const emailWelcome = (to, name) => sendEmail(to, `Welcome to ${BRAND}! 🎉`,
  emailWrap(`Welcome, ${name}! 🎉`,
    `<p style="color:#444;font-size:15px;">Thank you for joining ${BRAND} — your favourite kids fashion store!</p>
     <div style="background:#F5F0F8;border-radius:12px;padding:18px;text-align:center;margin:16px 0;">
       <p style="color:${PP};font-weight:bold;font-size:16px;margin:0;">Use <span style="font-size:22px;letter-spacing:4px;">WELCOME10</span> for 10% off your first order!</p>
     </div>`, SITE_URL, 'Start Shopping →'));

const emailOrderConfirm = (to, name, order) => {
  const rows = order.items.map(i =>
    `<tr><td style="padding:8px 4px;border-bottom:1px solid #f0e5f8;">${i.emoji || '🛍️'} ${i.name} (${i.size || '-'})</td>
     <td style="padding:8px;text-align:center;border-bottom:1px solid #f0e5f8;">×${i.qty}</td>
     <td style="padding:8px;text-align:right;border-bottom:1px solid #f0e5f8;">₹${i.price * i.qty}</td></tr>`).join('');
  return sendEmail(to, `${BRAND} – Order #${order.orderId} Confirmed! 🎉`,
    emailWrap('Order Confirmed! 🎉',
      `<p style="color:#444;font-size:15px;">Hi ${name}, your order <strong style="color:${PP};">#${order.orderId}</strong> has been placed!</p>
       <table width="100%" style="border-collapse:collapse;font-size:13px;margin:14px 0;">
         <tr style="background:#F5F0F8;"><th style="padding:8px;text-align:left;">Item</th><th style="padding:8px;">Qty</th><th style="padding:8px;text-align:right;">Price</th></tr>
         ${rows}
         <tr><td colspan="2" style="padding:8px;font-weight:bold;color:#333;">Total</td>
             <td style="padding:8px;text-align:right;font-weight:bold;color:${PP};font-size:15px;">₹${order.total.toLocaleString('en-IN')}</td></tr>
       </table>
       <p style="color:#666;font-size:13px;">Payment: <strong>${(order.payment?.method || 'COD').toUpperCase()}</strong> | Estimated delivery: 3-5 business days</p>`));
};

const emailOrderStatus = (to, name, orderId, status, msg) => {
  const emoji = { confirmed: '✅', processing: '⚙️', shipped: '🚚', out_for_delivery: '🏍️', delivered: '🎉', cancelled: '❌' }[status] || '📦';
  return sendEmail(to, `${BRAND} – Order #${orderId} ${status}`,
    emailWrap(`Order ${status.charAt(0).toUpperCase() + status.slice(1)} ${emoji}`,
      `<p style="color:#444;font-size:15px;">Hi ${name}, your order <strong>#${orderId}</strong> is now <strong>${status.toUpperCase()}</strong>.</p>
       ${msg ? `<div style="background:#F5F0F8;border-left:4px solid ${OR};padding:12px 16px;border-radius:0 8px 8px 0;margin:14px 0;">${msg}</div>` : ''}`));
};

// ── MODELS ────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  email:    { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  phone:    { type: String, unique: true, sparse: true, trim: true },
  password: String,
  role:     { type: String, enum: ['customer', 'admin', 'super_admin'], default: 'customer' },
  addresses: [{
    label: { type: String, default: 'Home' }, name: String, phone: String,
    line1: String, line2: String, city: String, state: String, pincode: String,
    isDefault: { type: Boolean, default: false }
  }],
  wishlist:         [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  isVerified:       { type: Boolean, default: false },
  otp:              String,
  otpExpiry:        Date,
  resetToken:       String,
  resetTokenExpiry: Date,
  createdAt: { type: Date, default: Date.now }
});

const ProductSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  slug:        { type: String, unique: true, sparse: true },
  description: { type: String, default: '' },
  category:    { type: String, required: true },
  gender:      { type: String, enum: ['Boys', 'Girls', 'Unisex', 'Baby'], default: 'Unisex' },
  ageGroup:    { type: String, default: '' },
  sizes:       [{ size: String, stock: { type: Number, default: 0 } }],
  colors:      [String],
  price:       { type: Number, required: true },
  mrp:         { type: Number, required: true },
  costPrice:   { type: Number, default: 0 },
  images:      [String],
  thumbnail:   String,
  emoji:       { type: String, default: '👗' },
  material:    String,
  brand:       String,
  tags:        [String],
  seoTitle:    String,
  seoDesc:     String,
  rating:      { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 },
  totalStock:  { type: Number, default: 0 },
  sold:        { type: Number, default: 0 },
  isFeatured:  { type: Boolean, default: false },
  isActive:    { type: Boolean, default: true },
  codEnabled:  { type: Boolean, default: true },
  badge:       String,
  createdAt:   { type: Date, default: Date.now }
});

const OrderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true },
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: String, emoji: String, price: Number, qty: Number, size: String, thumbnail: String
  }],
  shippingAddress: { name: String, phone: String, line1: String, line2: String, city: String, state: String, pincode: String },
  payment: {
    method:        { type: String, enum: ['cod', 'online', 'upi'], default: 'cod' },
    status:        { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
    transactionId: String
  },
  status: {
    type: String,
    enum: ['placed', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned'],
    default: 'placed'
  },
  subtotal:          Number,
  deliveryFee:       { type: Number, default: 0 },
  discount:          { type: Number, default: 0 },
  couponCode:        String,
  total:             Number,
  notes:             String,
  tracking: [{ status: String, message: String, time: { type: Date, default: Date.now } }],
  estimatedDelivery: Date,
  deliveredAt:       Date,
  createdAt:         { type: Date, default: Date.now }
});

const ReviewSchema = new mongoose.Schema({
  product:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
  rating:    { type: Number, min: 1, max: 5, required: true },
  title:     String,
  comment:   String,
  createdAt: { type: Date, default: Date.now }
});

const CouponSchema = new mongoose.Schema({
  code:         { type: String, unique: true, uppercase: true, required: true },
  type:         { type: String, enum: ['percent', 'flat'], required: true },
  value:        { type: Number, required: true },
  minOrder:     { type: Number, default: 0 },
  maxDiscount:  Number,
  usageLimit:   { type: Number, default: 0 },
  perUserLimit: { type: Number, default: 1 },
  usedCount:    { type: Number, default: 0 },
  usedBy:       [{ user: mongoose.Schema.Types.ObjectId, count: { type: Number, default: 1 } }],
  validFrom:    Date,
  validTill:    Date,
  isActive:     { type: Boolean, default: true },
  createdAt:    { type: Date, default: Date.now }
});

const BannerSchema = new mongoose.Schema({
  title:        { type: String, required: true },
  subtitle:     String,
  badge:        String,
  discountText: String,
  buttonText:   { type: String, default: 'Shop Now' },
  buttonLink:   { type: String, default: '#products' },
  color:        { type: String, default: PP },
  image:        String,  // Now stores Cloudinary URL
  timerHours:   { type: Number, default: 0 },
  isActive:     { type: Boolean, default: true },
  order:        { type: Number, default: 0 },
  createdAt:    { type: Date, default: Date.now }
});

const ChatSchema = new mongoose.Schema({
  sessionId:     { type: String, unique: true, required: true },
  customerName:  String,
  customerEmail: String,
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', sparse: true },
  messages: [{
    sender: { type: String, enum: ['customer', 'admin'] },
    text:   String,
    time:   { type: Date, default: Date.now }
  }],
  status:    { type: String, enum: ['active', 'closed'], default: 'active' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const SettingsSchema = new mongoose.Schema({
  key:       { type: String, unique: true, required: true },
  value:     mongoose.Schema.Types.Mixed,
  updatedAt: { type: Date, default: Date.now }
});

const User     = mongoose.model('User',     UserSchema);
const Product  = mongoose.model('Product',  ProductSchema);
const Order    = mongoose.model('Order',    OrderSchema);
const Review   = mongoose.model('Review',   ReviewSchema);
const Coupon   = mongoose.model('Coupon',   CouponSchema);
const Banner   = mongoose.model('Banner',   BannerSchema);
const Chat     = mongoose.model('Chat',     ChatSchema);
const Settings = mongoose.model('Settings', SettingsSchema);

// ── HELPERS ───────────────────────────────────────────────
const genOTP     = () => Math.floor(100000 + Math.random() * 900000).toString();
const genOrderId = () => 'KC' + Date.now().toString(36).toUpperCase();
const genToken   = () => crypto.randomBytes(32).toString('hex');
const makeSlug   = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();

// Safe RegExp – prevents ReDoS attacks from malicious search input
function safeRegex(str) {
  const escaped = str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

// ── AUTH MIDDLEWARE ───────────────────────────────────────
const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const d = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(d.id).select('-password');
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
};

// FIXED: was only checking role === 'admin', now checks both admin roles
const adminAuth = async (req, res, next) => {
  await auth(req, res, () => {
    if (!['admin', 'super_admin'].includes(req.user.role))
      return res.status(403).json({ error: 'Admin access required' });
    next();
  });
};

const superAdminAuth = async (req, res, next) => {
  await auth(req, res, () => {
    if (req.user.role !== 'super_admin')
      return res.status(403).json({ error: 'Super admin access required' });
    next();
  });
};

// ── RATE LIMITING ─────────────────────────────────────────
const rateMap = new Map();
function rateLimit(key, max, windowMs) {
  const now   = Date.now();
  const entry = rateMap.get(key) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateMap.set(key, entry);
  return entry.count > max;
}
const rateLimitMW = (max, windowMs) => (req, res, next) => {
  const key = (req.ip || 'x') + req.path;
  if (rateLimit(key, max, windowMs))
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  next();
};

// ── AUTH ROUTES ───────────────────────────────────────────

// Register – now rate limited (was missing before)
app.post('/api/auth/register', rateLimitMW(5, 60000), async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !password)    return res.status(400).json({ error: 'Name and password required' });
    if (!email && !phone)      return res.status(400).json({ error: 'Email or phone required' });
    if (password.length < 8)   return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const orQ = [email && { email: email.toLowerCase() }, phone && { phone }].filter(Boolean);
    if (await User.findOne({ $or: orQ }))
      return res.status(409).json({ error: 'Account already exists with this email/phone' });
    const hashed = await bcrypt.hash(password, 12);
    const user   = await User.create({
      name: name.trim(),
      email: email?.toLowerCase().trim(),
      phone: phone?.trim(),
      password: hashed,
      isVerified: true
    });
    if (email) emailWelcome(email, name).catch(() => {});
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ success: true, token, user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', rateLimitMW(10, 60000), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.password || !await bcrypt.compare(password, user.password))
      return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// OTP – EMAIL ONLY (WhatsApp OTP coming soon)
app.post('/api/auth/send-otp', rateLimitMW(5, 60000), async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email address required' });
    if (rateLimit('otp:' + email, 5, 10 * 60000))
      return res.status(429).json({ error: 'Too many OTP requests. Try after 10 minutes.' });
    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'No account found with this email. Please register first.' });
    const otp = genOTP();
    user.otp = otp; user.otpExpiry = new Date(Date.now() + 10 * 60000);
    await user.save();
    await emailOTP(email, otp, user.name).catch(e => console.error('Email OTP:', e.message));
    res.json({ success: true, message: 'OTP sent to ' + email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || user.otp !== otp || new Date() > user.otpExpiry)
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    user.isVerified = true; user.otp = undefined; user.otpExpiry = undefined;
    await user.save();
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/forgot-password', rateLimitMW(5, 60000), async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });
    // Always return success to prevent email enumeration
    if (!user) return res.json({ success: true, message: 'If the email exists, a reset link has been sent' });
    const token = genToken();
    user.resetToken = token; user.resetTokenExpiry = new Date(Date.now() + 3600000);
    await user.save();
    emailForgot(email, user.name, token, user._id).catch(() => {});
    res.json({ success: true, message: 'Password reset link sent to your email' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, userId, id, newPassword, password } = req.body;
    const uid = userId || id;
    const pwd = newPassword || password;
    if (!uid || !token || !pwd) return res.status(400).json({ error: 'Missing required fields' });
    if (pwd.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const user = await User.findOne({ _id: uid, resetToken: token, resetTokenExpiry: { $gt: new Date() } });
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    user.password = await bcrypt.hash(pwd, 12);
    user.resetToken = undefined; user.resetTokenExpiry = undefined;
    await user.save();
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  res.json({ success: true, user: req.user });
});

app.put('/api/auth/profile', auth, async (req, res) => {
  try {
    const { name, phone } = req.body;
    const u = await User.findByIdAndUpdate(req.user._id, { name, phone }, { new: true }).select('-password');
    res.json({ success: true, user: u });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/auth/change-password', auth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (newPassword?.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
    const u = await User.findById(req.user._id);
    if (!await bcrypt.compare(oldPassword, u.password))
      return res.status(400).json({ error: 'Current password is incorrect' });
    u.password = await bcrypt.hash(newPassword, 12); await u.save();
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Addresses
app.post('/api/auth/address', auth, async (req, res) => {
  try {
    const u = await User.findById(req.user._id);
    if (req.body.isDefault) u.addresses.forEach(a => a.isDefault = false);
    u.addresses.push(req.body); await u.save();
    res.json({ success: true, addresses: u.addresses });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/auth/address/:id', auth, async (req, res) => {
  try {
    const u = await User.findById(req.user._id);
    const idx = u.addresses.findIndex(a => a._id.toString() === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Address not found' });
    if (req.body.isDefault) u.addresses.forEach(a => a.isDefault = false);
    Object.assign(u.addresses[idx], req.body); await u.save();
    res.json({ success: true, addresses: u.addresses });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/auth/address/:id', auth, async (req, res) => {
  try {
    const u = await User.findById(req.user._id);
    u.addresses = u.addresses.filter(a => a._id.toString() !== req.params.id);
    await u.save();
    res.json({ success: true, addresses: u.addresses });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PRODUCTS ──────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const { category, gender, search, sort, featured, page = 1, limit = 20, minPrice, maxPrice } = req.query;
    const q = { isActive: true };
    if (category) q.category = category;
    if (gender)   q.gender   = gender;
    if (featured === 'true') q.isFeatured = true;
    if (search) {
      const rx = safeRegex(search);  // FIXED: safe RegExp prevents ReDoS
      q.$or = [{ name: rx }, { category: rx }, { tags: { $in: [rx] } }];
    }
    if (minPrice || maxPrice) q.price = {};
    if (minPrice) q.price.$gte = +minPrice;
    if (maxPrice) q.price.$lte = +maxPrice;
    const sortMap = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, price_asc: { price: 1 }, price_desc: { price: -1 }, popular: { sold: -1 }, rating: { rating: -1 } };
    const s    = sortMap[sort] || { isFeatured: -1, createdAt: -1 };
    const skip = (page - 1) * limit;
    const [products, total] = await Promise.all([
      Product.find(q).sort(s).skip(skip).limit(+limit),
      Product.countDocuments(q)
    ]);
    res.json({ success: true, products, total, page: +page, pages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const p = await Product.findById(req.params.id);
    if (!p || !p.isActive) return res.status(404).json({ error: 'Product not found' });
    const reviews = await Review.find({ product: p._id }).populate('user', 'name').sort({ createdAt: -1 }).limit(10);
    res.json({ success: true, product: p, reviews });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/categories', async (req, res) => {
  try {
    const cats = await Product.distinct('category', { isActive: true });
    res.json({ success: true, categories: cats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/banners', async (req, res) => {
  try {
    const banners = await Banner.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
    res.json({ success: true, banners });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SETTINGS ──────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  try {
    const items = await Settings.find();
    const obj = {}; items.forEach(i => obj[i.key] = i.value);
    res.json({ success: true, settings: obj });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/settings', adminAuth, async (req, res) => {
  try {
    const items = await Settings.find();
    const obj = {}; items.forEach(i => obj[i.key] = i.value);
    res.json({ success: true, settings: obj });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/settings', adminAuth, async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body))
      await Settings.findOneAndUpdate({ key }, { key, value, updatedAt: new Date() }, { upsert: true, new: true });
    res.json({ success: true, message: 'Settings saved!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ORDERS ────────────────────────────────────────────────
app.post('/api/orders', auth, async (req, res) => {
  try {
    const { items, shippingAddress, payment, couponCode, notes } = req.body;
    if (!items?.length)   return res.status(400).json({ error: 'Cart is empty' });
    if (!shippingAddress) return res.status(400).json({ error: 'Shipping address required' });

    const oi = []; let subtotal = 0;
    for (const it of items) {
      const p = await Product.findById(it.productId);
      if (!p || !p.isActive) return res.status(400).json({ error: `Product not available: ${it.name}` });
      const sz = p.sizes.find(s => s.size === it.size);
      if (sz && sz.stock < it.qty) return res.status(400).json({ error: `Insufficient stock for ${p.name} (${it.size})` });
      if (sz) sz.stock -= it.qty;
      p.sold = (p.sold || 0) + it.qty;
      p.totalStock = p.sizes.reduce((a, b) => a + (b.stock || 0), 0);
      await p.save();
      oi.push({ product: p._id, name: p.name, emoji: p.emoji, price: p.price, qty: it.qty, size: it.size, thumbnail: p.thumbnail });
      subtotal += p.price * it.qty;
    }

    let discount = 0;
    if (couponCode) {
      const cp = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
      if (cp && cp.validTill >= new Date() && subtotal >= cp.minOrder) {
        const uu = cp.usedBy.find(u => u.user?.toString() === req.user._id.toString());
        if (!cp.perUserLimit || !uu || uu.count < cp.perUserLimit) {
          discount = cp.type === 'percent'
            ? Math.min(subtotal * cp.value / 100, cp.maxDiscount || Infinity)
            : cp.value;
          discount = Math.floor(discount);
          cp.usedCount += 1;
          if (uu) uu.count += 1; else cp.usedBy.push({ user: req.user._id, count: 1 });
          await cp.save();
        }
      }
    }

    const fee     = subtotal - discount >= 999 ? 0 : 60;
    const total   = subtotal - discount + fee;
    const orderId = genOrderId();
    const ord     = await Order.create({
      orderId, user: req.user._id, items: oi, shippingAddress,
      payment: { method: payment?.method || 'cod' },
      subtotal, discount, deliveryFee: fee, total, couponCode, notes,
      tracking:          [{ status: 'placed', message: 'Order placed successfully!' }],
      estimatedDelivery: new Date(Date.now() + 5 * 24 * 3600000)
    });
    const u = await User.findById(req.user._id);
    if (u?.email) emailOrderConfirm(u.email, u.name, { ...ord.toObject(), items: oi }).catch(() => {});
    // Notify admin of new order
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@kidscart.kids';
    sendEmail(adminEmail, `🛍️ New Order #${ord.orderId} — ₹${ord.total}`,
      emailWrap('New Order Received! 🛍️',
        `<p style="color:#444;font-size:15px;">A new order has been placed.</p>
         <table style="width:100%;border-collapse:collapse;font-size:14px;">
           <tr><td style="padding:8px;color:#888">Order ID</td><td style="padding:8px;font-weight:800">#${ord.orderId}</td></tr>
           <tr style="background:#faf6ff"><td style="padding:8px;color:#888">Customer</td><td style="padding:8px">${u.name} (${u.email})</td></tr>
           <tr><td style="padding:8px;color:#888">Items</td><td style="padding:8px">${oi.map(i=>i.name+' ×'+i.qty).join(', ')}</td></tr>
           <tr style="background:#faf6ff"><td style="padding:8px;color:#888">Total</td><td style="padding:8px;font-weight:800;color:#7B2D8B">₹${ord.total}</td></tr>
           <tr><td style="padding:8px;color:#888">Payment</td><td style="padding:8px">${payment.method?.toUpperCase()} — ${payment.status || 'pending'}</td></tr>
           <tr style="background:#faf6ff"><td style="padding:8px;color:#888">Ship To</td><td style="padding:8px">${shippingAddress.name}, ${shippingAddress.line1}, ${shippingAddress.city} − ${shippingAddress.pincode}</td></tr>
         </table>
         <p style="margin-top:16px"><a href="https://kidscart.kids/admin.html" style="background:#7B2D8B;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:800">Open Admin Panel →</a></p>`
      )
    ).catch(() => {});
    res.status(201).json({ success: true, order: ord });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders', auth, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders/:id', auth, async (req, res) => {
  try {
    const o = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!o) return res.status(404).json({ error: 'Order not found' });
    res.json({ success: true, order: o });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/orders/:id/cancel', auth, async (req, res) => {
  try {
    const o = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!o) return res.status(404).json({ error: 'Order not found' });
    if (!['placed', 'confirmed'].includes(o.status))
      return res.status(400).json({ error: 'This order cannot be cancelled' });
    o.status = 'cancelled';
    o.tracking.push({ status: 'cancelled', message: req.body.reason || 'Cancelled by customer' });
    await o.save();
    res.json({ success: true, order: o });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── COUPONS ───────────────────────────────────────────────
app.post('/api/coupons/validate', auth, async (req, res) => {
  try {
    const { code, orderAmount } = req.body;
    if (!code) return res.status(400).json({ error: 'Coupon code required' });
    const cp = await Coupon.findOne({ code: code.trim().toUpperCase(), isActive: true });
    if (!cp)                     return res.status(404).json({ error: 'Invalid coupon code' });
    if (cp.validTill < new Date()) return res.status(400).json({ error: 'Coupon has expired' });
    if (orderAmount < cp.minOrder) return res.status(400).json({ error: `Minimum order ₹${cp.minOrder} required` });
    if (cp.usageLimit && cp.usedCount >= cp.usageLimit)
      return res.status(400).json({ error: 'Coupon usage limit reached' });
    const uu = cp.usedBy.find(u => u.user?.toString() === req.user._id.toString());
    if (cp.perUserLimit && uu && uu.count >= cp.perUserLimit)
      return res.status(400).json({ error: `You can only use this coupon ${cp.perUserLimit} time(s)` });
    const discount = cp.type === 'percent'
      ? Math.min(orderAmount * cp.value / 100, cp.maxDiscount || Infinity)
      : cp.value;
    res.json({ success: true, discount: Math.floor(discount), coupon: { code: cp.code, type: cp.type, value: cp.value } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── REVIEWS ───────────────────────────────────────────────
app.post('/api/reviews', auth, async (req, res) => {
  try {
    const { productId, rating, title, comment } = req.body;
    if (await Review.findOne({ product: productId, user: req.user._id }))
      return res.status(409).json({ error: 'You have already reviewed this product' });
    const rv  = await Review.create({ product: productId, user: req.user._id, rating, title, comment });
    const rvs = await Review.find({ product: productId });
    const avg = rvs.reduce((a, b) => a + b.rating, 0) / rvs.length;
    await Product.findByIdAndUpdate(productId, { rating: +avg.toFixed(1), reviewCount: rvs.length });
    res.status(201).json({ success: true, review: rv });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── WISHLIST ──────────────────────────────────────────────
app.post('/api/wishlist/toggle', auth, async (req, res) => {
  try {
    const u   = await User.findById(req.user._id);
    const idx = u.wishlist.findIndex(id => id.toString() === req.body.productId);
    if (idx > -1) u.wishlist.splice(idx, 1); else u.wishlist.push(req.body.productId);
    await u.save();
    res.json({ success: true, wishlist: u.wishlist, added: idx === -1 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/wishlist', auth, async (req, res) => {
  try {
    const u = await User.findById(req.user._id).populate('wishlist');
    res.json({ success: true, wishlist: u.wishlist || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── LIVE CHAT ─────────────────────────────────────────────
app.post('/api/chat/start', async (req, res) => {
  try {
    const { customerName, customerEmail, userId } = req.body;
    const sessionId = genToken().slice(0, 20);
    await Chat.create({
      sessionId, customerName: customerName || 'Guest', customerEmail, userId,
      messages: [{ sender: 'admin', text: `Hi ${customerName || 'there'}! 👋 Welcome to KidsCart! How can we help you today?` }]
    });
    io.to('admins').emit('admin:new_chat', { sessionId, customerName, customerEmail, time: new Date() });
    res.json({ success: true, sessionId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/chat/:sid', async (req, res) => {
  try {
    const s = await Chat.findOne({ sessionId: req.params.sid });
    if (!s) return res.status(404).json({ error: 'Chat session not found' });
    res.json({ success: true, session: s });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN DASHBOARD ───────────────────────────────────────
app.get('/api/admin/dashboard', adminAuth, async (req, res) => {
  try {
    const [totalOrders, activeOrders, totalProducts, totalUsers, rev, activeRev, recentOrders, lowStock, activeChats] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: { $ne: 'cancelled' } }),
      Product.countDocuments({ isActive: true }),
      User.countDocuments({ role: 'customer' }),
      Order.aggregate([{ $group: { _id: null, total: { $sum: '$total' } } }]),
      Order.aggregate([{ $match: { status: { $ne: 'cancelled' } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Order.find().sort({ createdAt: -1 }).limit(10).populate('user', 'name email phone'),
      Product.find({ totalStock: { $lte: 10 }, isActive: true }).select('name totalStock emoji').limit(20),
      Chat.countDocuments({ status: 'active' })
    ]);
    res.json({
      success: true,
      stats: { totalOrders, activeOrders, totalProducts, totalUsers, totalRevenue: rev[0]?.total || 0, activeRevenue: activeRev[0]?.total || 0, activeChats },
      recentOrders, lowStock
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN PRODUCTS ────────────────────────────────────────
app.get('/api/admin/products', adminAuth, async (req, res) => {
  try {
    const { search, category, page = 1, limit = 500 } = req.query;
    const q = {};
    if (search) { const rx = safeRegex(search); q.$or = [{ name: rx }, { category: rx }]; }
    if (category) q.category = category;
    const [products, total] = await Promise.all([
      Product.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(+limit),
      Product.countDocuments(q)
    ]);
    res.json({ success: true, products, total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/products', adminAuth, async (req, res) => {
  try {
    const d = { ...req.body };
    d.slug       = makeSlug(d.name);
    d.totalStock = (d.sizes || []).reduce((a, b) => a + (+b.stock || 0), 0);
    res.status(201).json({ success: true, product: await Product.create(d) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/products/:id', adminAuth, async (req, res) => {
  try {
    const d = { ...req.body };
    if (d.sizes) d.totalStock = d.sizes.reduce((a, b) => a + (+b.stock || 0), 0);
    res.json({ success: true, product: await Product.findByIdAndUpdate(req.params.id, d, { new: true }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/products/:id', adminAuth, async (req, res) => {
  try { await Product.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/products/:id/stock', adminAuth, async (req, res) => {
  try {
    const p = await Product.findById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Product not found' });
    p.sizes      = req.body.sizes;
    p.totalStock = p.sizes.reduce((a, b) => a + (+b.stock || 0), 0);
    await p.save();
    res.json({ success: true, product: p });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// FIXED: Product image upload now goes to Cloudinary
app.post('/api/admin/upload', adminAuth, (req, res, next) => {
  uploadProducts.array('images', 10)(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
    res.json({ success: true, urls: req.files.map(f => f.path) }); // f.path = Cloudinary URL
  });
});

// FIXED: Banner image upload now goes to Cloudinary – crash bug resolved
app.post('/api/admin/upload-banner', adminAuth, (req, res, next) => {
  uploadBanner.single('image')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed. Max size 8MB.' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ success: true, url: req.file.path }); // Cloudinary URL – permanent storage
  });
});

app.get('/api/admin/orders/:id', adminAuth, async (req, res) => {
  try {
    const o = await Order.findById(req.params.id).populate('user','name email phone');
    if (!o) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, order: o });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN ORDERS ──────────────────────────────────────────
app.get('/api/admin/orders', adminAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 200, search } = req.query;
    const q = status ? { status } : {};
    if (search) q.orderId = safeRegex(search);
    const [orders, total] = await Promise.all([
      Order.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(+limit).populate('user', 'name email phone'),
      Order.countDocuments(q)
    ]);
    res.json({ success: true, orders, total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/orders/:id/status', adminAuth, async (req, res) => {
  try {
    const { status, message } = req.body;
    const o = await Order.findById(req.params.id).populate('user', 'name email');
    if (!o) return res.status(404).json({ error: 'Order not found' });
    o.status = status;
    o.tracking.push({ status, message: message || `Order ${status}` });
    if (status === 'delivered') { o.deliveredAt = new Date(); o.payment.status = 'paid'; }
    await o.save();
    if (o.user?.email) emailOrderStatus(o.user.email, o.user.name, o.orderId, status, message).catch(() => {});
    res.json({ success: true, order: o });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/orders/:id', superAdminAuth, async (req, res) => {
  try { await Order.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/orders/:id/payment', adminAuth, async (req, res) => {
  try {
    const { method, status } = req.body;
    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'Order not found' });
    if (method) o.payment.method = method;
    if (status) o.payment.status = status;
    await o.save();
    res.json({ success: true, order: o });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN USERS ───────────────────────────────────────────
app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const q = { role: 'customer' };
    if (search) { const rx = safeRegex(search); q.$or = [{ name: rx }, { email: rx }, { phone: rx }]; }
    const [users, total] = await Promise.all([
      User.find(q).select('-password').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(+limit),
      User.countDocuments(q)
    ]);
    res.json({ success: true, users, total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/users/:id', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (['admin','super_admin'].includes(user.role))
      return res.status(403).json({ error: 'Cannot delete admin users' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN ADMINS ──────────────────────────────────────────
app.get('/api/admin/admins', superAdminAuth, async (req, res) => {
  try {
    const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } }).select('-password');
    res.json({ success: true, admins });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/admins', superAdminAuth, async (req, res) => {
  try {
    const { name, email, password, role = 'admin' } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
    if (await User.findOne({ email: email.toLowerCase() })) return res.status(409).json({ error: 'Email already exists' });
    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email: email.toLowerCase(), password: hashed, role, isVerified: true });
    res.status(201).json({ success: true, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/admins/:id', superAdminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'super_admin') return res.status(403).json({ error: 'Cannot delete super admin' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN COUPONS ─────────────────────────────────────────
app.get('/api/admin/coupons', adminAuth, async (req, res) => {
  try { res.json({ success: true, coupons: await Coupon.find().sort({ createdAt: -1 }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/coupons', adminAuth, async (req, res) => {
  try { res.status(201).json({ success: true, coupon: await Coupon.create({ ...req.body, usedBy: [] }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/coupons/:id', adminAuth, async (req, res) => {
  try { res.json({ success: true, coupon: await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/coupons/:id', adminAuth, async (req, res) => {
  try { await Coupon.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN BANNERS ─────────────────────────────────────────
app.get('/api/admin/banners', adminAuth, async (req, res) => {
  try { res.json({ success: true, banners: await Banner.find().sort({ order: 1, createdAt: 1 }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/banners', adminAuth, async (req, res) => {
  try { res.status(201).json({ success: true, banner: await Banner.create(req.body) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/banners/:id', adminAuth, async (req, res) => {
  try { res.json({ success: true, banner: await Banner.findByIdAndUpdate(req.params.id, req.body, { new: true }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/banners/:id', adminAuth, async (req, res) => {
  try { await Banner.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN REPORTS ─────────────────────────────────────────
app.get('/api/admin/reports/sales', adminAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = from && to ? { createdAt: { $gte: new Date(from), $lte: new Date(to) } } : {};
    const [salesByDay, topProducts, statusBreakdown] = await Promise.all([
      Order.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$total' }, orders: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Order.aggregate([{ $match: match }, { $unwind: '$items' }, { $group: { _id: '$items.name', sold: { $sum: '$items.qty' }, revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } } } }, { $sort: { sold: -1 } }, { $limit: 10 }]),
      Order.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }])
    ]);
    res.json({ success: true, salesByDay, topProducts, statusBreakdown });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN CHATS ───────────────────────────────────────────
app.get('/api/admin/chats', adminAuth, async (req, res) => {
  try {
    const chats = await Chat.find().sort({ updatedAt: -1 }).limit(50);
    res.json({ success: true, chats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN UTILITIES ───────────────────────────────────────

// Update product display order
app.put('/api/admin/products/:id/order', adminAuth, async (req, res) => {
  try {
    const { order } = req.body;
    await Product.findByIdAndUpdate(req.params.id, { order: +order || 0 });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// ── ANNOUNCEMENT BAR ─────────────────────────────────────
app.get('/api/settings/announcement', async (req, res) => {
  try {
    const s = await Settings.findOne({ key: 'announcement' });
    res.json(s ? s.value : { text: '', link: '', linkText: 'Shop Now →', hidden: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/announcement', adminAuth, async (req, res) => {
  try {
    const s = await Settings.findOne({ key: 'announcement' });
    res.json(s ? s.value : { text: '', link: '', linkText: 'Shop Now →', hidden: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/announcement', adminAuth, async (req, res) => {
  try {
    const { text, link, linkText, hidden } = req.body;
    await Settings.findOneAndUpdate(
      { key: 'announcement' },
      { key: 'announcement', value: { text: text || '', link: link || '', linkText: linkText || 'Shop Now →', hidden: !!hidden }, updatedAt: new Date() },
      { upsert: true }
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/test-email', adminAuth, async (req, res) => {
  const ok = await sendEmail('admin@kidscart.kids', 'KidsCart Email Test ✅',
    emailWrap('Email Working!', '<p style="color:#444;font-size:15px;">ZeptoMail is configured correctly. ✅</p>'));
  res.json({ success: ok, message: ok ? 'Test email sent!' : 'Email failed — check server logs' });
});

// ADDED: Fix current admin account role if needed
app.post('/api/admin/fix-admin', async (req, res) => {
  try {
    const { secret, email } = req.body;
    if (secret !== process.env.JWT_SECRET) return res.status(403).json({ error: 'Forbidden' });
    const user = await User.findOneAndUpdate(
      { email: email.toLowerCase() },
      { role: 'super_admin', isVerified: true },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, message: `${user.email} is now super_admin` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/health', (req, res) => res.json({ status: 'OK', version: '4.0', time: new Date(), domain: 'kidscart.kids' }));

// ── SOCKET.IO LIVE CHAT ───────────────────────────────────
io.on('connection', socket => {
  socket.on('admin:join',    ()              => socket.join('admins'));
  socket.on('customer:join', ({ sessionId }) => socket.join(`chat:${sessionId}`));

  socket.on('customer:message', async ({ sessionId, text }) => {
    try {
      const s = await Chat.findOneAndUpdate(
        { sessionId },
        { $push: { messages: { sender: 'customer', text } }, updatedAt: new Date() },
        { new: true }
      );
      io.to(`chat:${sessionId}`).emit('chat:message', { sender: 'customer', text, time: new Date() });
      io.to('admins').emit('admin:message', { sessionId, sender: 'customer', text, customerName: s?.customerName, time: new Date() });
    } catch (e) { console.error('Socket err:', e); }
  });

  socket.on('admin:message', async ({ sessionId, text }) => {
    try {
      await Chat.findOneAndUpdate({ sessionId }, { $push: { messages: { sender: 'admin', text } }, updatedAt: new Date() });
      io.to(`chat:${sessionId}`).emit('chat:message', { sender: 'admin', text, time: new Date() });
      io.to('admins').emit('admin:message', { sessionId, sender: 'admin', text, time: new Date() });
    } catch (e) { console.error('Socket err:', e); }
  });

  socket.on('admin:close_chat', async ({ sessionId }) => {
    await Chat.findOneAndUpdate({ sessionId }, { status: 'closed' }).catch(() => {});
    io.to(`chat:${sessionId}`).emit('chat:closed', { message: 'Chat ended by support. Thank you! 😊' });
    io.to('admins').emit('admin:chat_closed', { sessionId });
  });
});

// ── SEED ──────────────────────────────────────────────────
async function seed() {
  if (!await Product.countDocuments()) {
    await Product.insertMany([
      { name: 'Floral Frock Dress',    category: 'Girls',  gender: 'Girls',  price: 599,  mrp: 999,  emoji: '👗', ageGroup: '2-10Y', sizes: [{ size: 'S', stock: 20 }, { size: 'M', stock: 15 }, { size: 'L', stock: 10 }], totalStock: 45, isFeatured: true,  badge: 'Best Seller', rating: 4.8, reviewCount: 234, isActive: true, slug: 'floral-frock-dress-' + Date.now() },
      { name: 'Denim Dungaree Set',    category: 'Boys',   gender: 'Boys',   price: 799,  mrp: 1299, emoji: '👖', ageGroup: '3-12Y', sizes: [{ size: 'S', stock: 18 }, { size: 'M', stock: 22 }, { size: 'L', stock: 12 }], totalStock: 52, isFeatured: true,  badge: 'New',        rating: 4.7, reviewCount: 187, isActive: true, slug: 'denim-dungaree-set-' + Date.now() },
      { name: 'Birthday Party Dress',  category: 'Party',  gender: 'Girls',  price: 1199, mrp: 1999, emoji: '🎀', ageGroup: '2-8Y',  sizes: [{ size: 'S', stock: 8 },  { size: 'M', stock: 12 }],                          totalStock: 20, isFeatured: true,  badge: 'Sale',       rating: 4.9, reviewCount: 312, isActive: true, slug: 'birthday-party-dress-' + Date.now() },
      { name: 'Ethnic Lehenga Choli',  category: 'Ethnic', gender: 'Girls',  price: 1499, mrp: 2499, emoji: '🌸', ageGroup: '3-12Y', sizes: [{ size: 'S', stock: 10 }, { size: 'M', stock: 14 }, { size: 'L', stock: 8 }],  totalStock: 32, isFeatured: true,  badge: 'Top Pick',   rating: 4.9, reviewCount: 428, isActive: true, slug: 'ethnic-lehenga-choli-' + Date.now() },
      { name: 'Princess Gown Dress',   category: 'Party',  gender: 'Girls',  price: 1899, mrp: 2999, emoji: '👑', ageGroup: '3-10Y', sizes: [{ size: 'S', stock: 5 },  { size: 'M', stock: 8 },  { size: 'L', stock: 7 }],  totalStock: 20, isFeatured: true,  badge: 'Premium',    rating: 4.9, reviewCount: 567, isActive: true, slug: 'princess-gown-dress-' + Date.now() },
      { name: 'Cotton Romper Suit',    category: 'Baby',   gender: 'Baby',   price: 399,  mrp: 599,  emoji: '🍼', ageGroup: '0-24M', sizes: [{ size: 'XS', stock: 15 }, { size: 'S', stock: 20 }],                          totalStock: 35, isFeatured: false, badge: 'New',        rating: 4.6, reviewCount: 156, isActive: true, slug: 'cotton-romper-suit-' + Date.now() },
      { name: 'Boys Kurta Pyjama Set', category: 'Ethnic', gender: 'Boys',   price: 899,  mrp: 1499, emoji: '🧡', ageGroup: '2-12Y', sizes: [{ size: 'S', stock: 12 }, { size: 'M', stock: 18 }, { size: 'L', stock: 10 }], totalStock: 40, isFeatured: true,  badge: 'Trending',   rating: 4.7, reviewCount: 203, isActive: true, slug: 'boys-kurta-pyjama-' + Date.now() },
      { name: 'Summer Shorts Set',     category: 'Boys',   gender: 'Boys',   price: 499,  mrp: 799,  emoji: '🩳', ageGroup: '3-12Y', sizes: [{ size: 'S', stock: 25 }, { size: 'M', stock: 20 }, { size: 'L', stock: 15 }], totalStock: 60, isFeatured: false, badge: 'Fresh',      rating: 4.5, reviewCount: 98,  isActive: true, slug: 'summer-shorts-set-' + Date.now() },
    ]);
    console.log('✅ Products seeded');
  }

  // FIXED: Admin seed now uses findOneAndUpdate so it always ensures correct role
  // even if the user already exists with wrong role
  const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@kidscart.kids';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@2025!';
  const existing   = await User.findOne({ email: adminEmail });
  if (!existing) {
    await User.create({
      name: 'KidsCart Admin', email: adminEmail,
      password: await bcrypt.hash(adminPassword, 12),
      role: 'super_admin', isVerified: true
    });
    console.log('✅ Admin created:', adminEmail);
  } else if (!['admin', 'super_admin'].includes(existing.role)) {
    await User.findOneAndUpdate({ email: adminEmail }, { role: 'super_admin', isVerified: true });
    console.log('✅ Admin role corrected for:', adminEmail);
  }

  if (!await Coupon.findOne({ code: 'WELCOME10' })) {
    await Coupon.create({ code: 'WELCOME10', type: 'percent', value: 10, minOrder: 299, maxDiscount: 150, perUserLimit: 1, validFrom: new Date(), validTill: new Date('2026-12-31'), isActive: true, usedBy: [] });
    console.log('✅ WELCOME10 coupon seeded');
  }
  if (!await Coupon.findOne({ code: 'FLAT100' })) {
    await Coupon.create({ code: 'FLAT100', type: 'flat', value: 100, minOrder: 799, perUserLimit: 2, validFrom: new Date(), validTill: new Date('2026-12-31'), isActive: true, usedBy: [] });
    console.log('✅ FLAT100 coupon seeded');
  }
  if (!await Banner.countDocuments()) {
    await Banner.insertMany([
      { title: 'New AW25 Collection is Here!', subtitle: 'Premium kids fashion for every occasion', badge: '✨ New Arrivals', discountText: 'Up to 50% OFF', buttonText: 'Shop Now', color: '#7B2D8B', timerHours: 48, isActive: true, order: 1 },
      { title: 'Ethnic Wear for Little Stars',  subtitle: 'Festival & occasion wear for kids',      badge: '🌸 Ethnic Picks', discountText: 'From ₹899',    buttonText: 'Explore',  color: '#C0392B', timerHours: 0,  isActive: true, order: 2 },
    ]);
    console.log('✅ Banners seeded');
  }
}

// ── START ─────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/kidscart')
  .then(async () => {
    console.log('✅ MongoDB connected');
    await seed();
    server.listen(PORT, () => console.log(`🚀 KidsCart API v4 running on port ${PORT}`));
  })
  .catch(err => console.error('❌ DB connection error:', err));

module.exports = app;
