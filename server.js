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
const Razorpay = require('razorpay');

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
app.use((req, res, next) => {
  // Webhook routes from Meta/Razorpay — always allow, no CORS check
  if (req.path.startsWith('/api/webhook/')) return next();
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true
  })(req, res, next);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static('uploads'));

// ── CONSTANTS ─────────────────────────────────────────────
// Required env vars: MONGO_URI, JWT_SECRET, CLOUDINARY_*, ZEPTO_API_KEY,
// ZEPTO_FROM_EMAIL, ADMIN_EMAIL, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
// WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID, WA_VERIFY_TOKEN (optional, default set)

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

// ── Cloudinary storage for voice notes and media (audio/video) ──
const mediaCloudStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'kidscart/media',
    resource_type: 'auto',   // allows audio, video, image
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'mp3', 'ogg', 'webm', 'wav', 'mp4', 'm4a'],
  }
});
const uploadMedia = multer({
  storage: mediaCloudStorage,
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB for audio
});

// ── RAZORPAY ──────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});
console.log('✅ Razorpay init — key:', process.env.RAZORPAY_KEY_ID ? process.env.RAZORPAY_KEY_ID.slice(0,12)+'...' : 'NOT SET');


// ══════════════════════════════════════════════════════════
// WHATSAPP CLOUD API HELPERS
// ══════════════════════════════════════════════════════════
const WA_TOKEN    = process.env.WA_ACCESS_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_NUMBER_ID;
const WA_VERIFY   = process.env.WA_VERIFY_TOKEN || 'kidscart_wa_verify_2026';

// Admin WA numbers for notifications (set in Railway env: ADMIN_WA_NUMBERS=918848703272,917012631235)
const ADMIN_WA_NUMBERS = (process.env.ADMIN_WA_NUMBERS || '')
  .split(',').map(n => n.trim()).filter(Boolean);

async function waSend(to, text) {
  if (!WA_TOKEN || !WA_PHONE_ID) { console.error('❌ WhatsApp env vars not set'); return null; }
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to,
        type:    'text',
        text:    { preview_url: false, body: text }
      })
    });
    const d = await r.json();
    if (r.ok) return d.messages?.[0]?.id;
    console.error('WA send error:', JSON.stringify(d));
    return null;
  } catch(e) { console.error('WA send exception:', e.message); return null; }
}

async function waSendTemplate(to, templateName, params = []) {
  if (!WA_TOKEN || !WA_PHONE_ID) return null;
  try {
    const components = params.length ? [{ type: 'body', parameters: params.map(p => ({ type: 'text', text: p })) }] : [];
    const r = await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: templateName, language: { code: 'en' }, components }
      })
    });
    const d = await r.json();
    return r.ok ? d.messages?.[0]?.id : null;
  } catch(e) { return null; }
}

// ── Send media (image/audio/video) via Meta media API ──
async function waSendMedia(to, mediaUrl, type = 'image', caption = '') {
  if (!WA_TOKEN || !WA_PHONE_ID) return null;
  try {
    const fileRes = await fetch(mediaUrl);
    const fileBuffer = await fileRes.arrayBuffer();
    let mime = 'application/octet-stream';
    if (mediaUrl.includes('.webm'))  mime = 'audio/webm';
    else if (mediaUrl.includes('.ogg'))   mime = 'audio/ogg; codecs=opus';
    else if (mediaUrl.includes('.mp3'))   mime = 'audio/mpeg';
    else if (mediaUrl.includes('.png'))   mime = 'image/png';
    else if (mediaUrl.includes('.jpg') || mediaUrl.includes('.jpeg')) mime = 'image/jpeg';
    else if (type === 'image')  mime = 'image/jpeg';
    else if (type === 'audio')  mime = 'audio/webm';

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([fileBuffer], { type: mime }),
      type === 'audio' ? 'voice.webm' : `media.${mime.split('/')[1].split(';')[0]}`);
    const uploadRes = await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/media`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}` },
      body: form
    });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) { console.error('WA media upload error:', JSON.stringify(uploadData)); return null; }
    const mediaId = uploadData.id;
    if (!mediaId) return null;

    const msgBody = { messaging_product: 'whatsapp', recipient_type: 'individual', to, type };
    if (type === 'image')    msgBody.image    = { id: mediaId, caption };
    if (type === 'audio')    msgBody.audio    = { id: mediaId };
    if (type === 'video')    msgBody.video    = { id: mediaId, caption };
    if (type === 'document') msgBody.document = { id: mediaId, caption, filename: 'document.pdf' };

    const sendRes = await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(msgBody)
    });
    const sendData = await sendRes.json();
    if (sendRes.ok) return sendData.messages?.[0]?.id;
    console.error('WA media send error:', JSON.stringify(sendData));
    return null;
  } catch(e) { console.error('waSendMedia exception:', e.message); return null; }
}

// ── Notify both admin WA numbers ──
async function notifyAdmins(text) {
  for (const num of ADMIN_WA_NUMBERS) {
    await waSend(num, text).catch(() => {});
  }
}

// ── WA OTP helper ──
async function waOTP(phone, otp, name) {
  return waSend(phone,
    `🔐 *KidsCart OTP*\n\nHi ${name || 'there'}! Your one-time password is:\n\n*${otp}*\n\nValid for 10 minutes. Never share this with anyone.`
  );
}

// ── WA order notification helper ──
async function waOrderNotify(phone, name, orderId, status, total) {
  if (!phone) return;
  const msgs = {
    placed:           `📦 Hi ${name}! Your KidsCart order *#${orderId}* has been placed. Total: ₹${total}. We'll confirm shortly!`,
    confirmed:        `✅ Hi ${name}! Your KidsCart order *#${orderId}* is confirmed! Total: ₹${total}. Preparing now. 🛍️`,
    processing:       `⚙️ Hi ${name}! Your KidsCart order *#${orderId}* is being packed. Dispatching soon!`,
    shipped:          `🚚 Hi ${name}! Your KidsCart order *#${orderId}* has been shipped! Delivery in 2–3 days. Thank you! 💜`,
    out_for_delivery: `🏍️ Hi ${name}! Your KidsCart order *#${orderId}* is out for delivery today! Keep your phone handy.`,
    delivered:        `🎉 Hi ${name}! Your KidsCart order *#${orderId}* has been delivered. Hope your little ones love it! 💜`,
    cancelled:        `❌ Hi ${name}! Your KidsCart order *#${orderId}* has been cancelled. Refund (if any) in 5–7 days.`,
    returned:         `↩️ Hi ${name}! Your KidsCart return for order *#${orderId}* has been initiated.`,
  };
  const msg = msgs[status];
  if (!msg) return;
  return waSend(phone, msg);
}

// Upsert Lead + Conversation from an inbound WhatsApp number
async function upsertWaContact(phone, name = '') {
  // Normalize phone: remove any spaces/dashes, keep as-is (Meta sends correct format)
  phone = String(phone).replace(/[\s-]/g, '');

  // Ensure default CRM stage exists
  let stage = await CrmStage.findOne({ order: 0 });

  // Upsert Lead
  let lead = await Lead.findOne({ phone });
  if (!lead) {
    lead = await Lead.create({ phone, name: name || phone, source: 'whatsapp', stage: stage?._id });
    console.log('📋 New CRM Lead created:', phone);
  } else if (name && lead.name === phone) {
    // Update name if it was just the phone number before
    lead.name = name; await lead.save();
  }

  // Upsert Conversation - also update name if we have it now
  let conv = await WaConversation.findOne({ phone });
  if (!conv) {
    conv = await WaConversation.create({ phone, lead: lead._id, contactName: name || phone });
  } else if (name && (!conv.contactName || conv.contactName === phone)) {
    await WaConversation.findByIdAndUpdate(conv._id, { contactName: name });
    conv.contactName = name;
  }

  return { lead, conv };
}

// ── ZEPTOMAIL REST API ────────────────────────────────────
// Uses HTTP REST (port 443) - works on Railway (SMTP ports blocked)
console.log('✅ ZeptoMail REST API ready');

// ── EMAIL HELPERS ─────────────────────────────────────────
function emailWrap(title, body, ctaUrl, ctaText) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F0F8;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 0;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:18px;overflow:hidden;max-width:96%;box-shadow:0 4px 24px rgba(123,45,139,.10);">

<!-- HEADER: white background so logo is always visible -->
<tr><td style="background:#fff;padding:20px 32px;text-align:center;border-bottom:3px solid ${PP};">
  <img src="${LOGO}" alt="KidsCart" height="52" style="display:inline-block;max-width:160px;">
</td></tr>

<!-- PURPLE BAND -->
<tr><td style="background:linear-gradient(135deg,${PP},#5C1F7A);padding:16px 32px;text-align:center;">
  <span style="color:#fff;font-size:15px;font-weight:700;letter-spacing:.5px;">${title}</span>
</td></tr>

<!-- BODY -->
<tr><td style="padding:30px 36px;">
  ${body}
  ${ctaUrl ? `<div style="text-align:center;margin:24px 0;">
    <a href="${ctaUrl}" style="background:${PP};color:#fff;padding:13px 32px;border-radius:50px;text-decoration:none;font-weight:bold;font-size:14px;display:inline-block;">${ctaText}</a>
  </div>` : ''}
</td></tr>

<!-- FOOTER -->
<tr><td style="background:#F5F0F8;padding:20px 32px;border-top:1px solid #e8d8f5;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="text-align:center;padding-bottom:10px;">
        <a href="https://kidscart.kids" style="color:${PP};font-weight:800;font-size:14px;text-decoration:none;">🛍️ kidscart.kids</a>
      </td>
    </tr>
    <tr>
      <td style="text-align:center;padding-bottom:8px;">
        <a href="mailto:admin@kidscart.kids" style="color:#666;font-size:12px;text-decoration:none;">📧 admin@kidscart.kids</a>
        &nbsp;&nbsp;|&nbsp;&nbsp;
        <a href="https://instagram.com/kidscart.kids" style="color:#666;font-size:12px;text-decoration:none;">📸 @kidscart.kids</a>
        &nbsp;&nbsp;|&nbsp;&nbsp;
        <a href="tel:+919497596110" style="color:#666;font-size:12px;text-decoration:none;">📞 +91 94975 96110</a>
      </td>
    </tr>
    <tr>
      <td style="text-align:center;">
        <p style="color:#bbb;font-size:11px;margin:6px 0 0;">© 2026 ${BRAND} — Premium Kids Fashion | All rights reserved</p>
        <p style="color:#ccc;font-size:10px;margin:4px 0 0;">This email was sent to you because you have an account on kidscart.kids</p>
      </td>
    </tr>
  </table>
</td></tr>

</table></td></tr></table></body></html>`;
}

async function sendEmail(to, subject, html) {
  const fromEmail = process.env.ZEPTO_FROM_EMAIL || 'admin@kidscart.kids';
  const token = process.env.ZEPTO_API_KEY;
  if (!token) { console.error('✉️  FAIL: ZEPTO_API_KEY not set'); return false; }
  try {
    const res = await fetch('https://api.zeptomail.com/v1.1/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Zoho-enczapikey ${token}`,
      },
      body: JSON.stringify({
        from: { address: fromEmail, name: BRAND },
        to: [{ email_address: { address: to } }],
        subject,
        htmlbody: html,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      console.log('✉️  Sent to:', to, '| status:', res.status);
      return true;
    } else {
      console.error('✉️  FAIL to:', to, '| status:', res.status, '| error:', JSON.stringify(data));
      return false;
    }
  } catch (e) {
    console.error('✉️  FAIL to:', to, '| error:', e.message);
    return false;
  }
}

const emailOTP = (to, otp, name) => sendEmail(to, `${BRAND} – Your OTP: ${otp}`,
  emailWrap('Your Login OTP 🔐',
    `<p style="color:#444;font-size:15px;">Hi <strong>${name || 'there'}</strong>,</p>
     <p style="color:#666;font-size:14px;">Use the OTP below to log in to your KidsCart account.</p>
     <div style="background:#F5F0F8;border:2px dashed ${PP};border-radius:14px;padding:26px;text-align:center;margin:20px 0;">
       <p style="margin:0 0 6px;color:#888;font-size:12px;font-weight:700;letter-spacing:1px;">YOUR ONE-TIME PASSWORD</p>
       <span style="font-size:46px;font-weight:900;color:${PP};letter-spacing:12px;">${otp}</span>
     </div>
     <div style="background:#fff8e1;border-radius:10px;padding:12px 16px;text-align:center;">
       <p style="margin:0;color:#e65100;font-size:13px;">⏱️ Valid for <strong>10 minutes</strong> &nbsp;|&nbsp; 🔒 Never share this OTP with anyone</p>
     </div>
     <p style="color:#bbb;font-size:12px;text-align:center;margin-top:16px;">If you didn't request this, please ignore this email. Your account is safe.</p>`));

const emailForgot = (to, name, token, uid) => sendEmail(to, `${BRAND} – Reset Your Password 🔒`,
  emailWrap('Reset Your Password 🔒',
    `<p style="color:#444;font-size:15px;">Hi <strong>${name}</strong>,</p>
     <p style="color:#666;font-size:14px;">We received a request to reset your KidsCart password. Click the button below to create a new one.</p>
     <div style="background:#fff8e1;border-radius:10px;padding:12px 16px;margin:16px 0;">
       <p style="margin:0;color:#e65100;font-size:13px;">⏱️ This link expires in <strong>1 hour</strong>.</p>
     </div>
     <p style="color:#bbb;font-size:12px;">Didn't request this? You can safely ignore this email — your password will remain unchanged.</p>`,
    `${SITE_URL}/admin.html?resetToken=${token}&userId=${uid}`, 'Reset My Password →'));

const emailWelcome = (to, name) => sendEmail(to, `Welcome to KidsCart! 🎉 Here's a gift for you`,
  emailWrap(`Welcome, ${name}! 🎉`,
    `<p style="color:#444;font-size:15px;">Thank you for joining <strong>KidsCart</strong> — India's favourite kids fashion store! 👗👕</p>
     
     <!-- Welcome gift box -->
     <div style="background:linear-gradient(135deg,${PP},#5C1F7A);border-radius:14px;padding:22px;text-align:center;margin:20px 0;">
       <p style="color:rgba(255,255,255,.8);font-size:12px;margin:0 0 6px;letter-spacing:1px;">YOUR WELCOME GIFT 🎁</p>
       <p style="color:#fff;font-size:32px;font-weight:900;letter-spacing:6px;margin:0 0 6px;">WELCOME10</p>
       <p style="color:rgba(255,255,255,.9);font-size:14px;margin:0;">10% off your first order!</p>
     </div>

     <!-- Features -->
     <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
       <tr>
         <td style="text-align:center;padding:10px;">
           <p style="font-size:28px;margin:0;">🚚</p>
           <p style="font-size:12px;color:#666;margin:4px 0 0;">Free delivery<br>above ₹999</p>
         </td>
         <td style="text-align:center;padding:10px;">
           <p style="font-size:28px;margin:0;">👗</p>
           <p style="font-size:12px;color:#666;margin:4px 0 0;">Premium kids<br>fashion</p>
         </td>
         <td style="text-align:center;padding:10px;">
           <p style="font-size:28px;margin:0;">🔒</p>
           <p style="font-size:12px;color:#666;margin:4px 0 0;">Secure<br>payments</p>
         </td>
       </tr>
     </table>`, SITE_URL, 'Start Shopping →'));

const emailOrderConfirm = (to, name, order) => {
  const rows = order.items.map(i =>
    `<tr><td style="padding:10px 4px;border-bottom:1px solid #f0e5f8;font-size:13px;">${i.emoji || '🛍️'} ${i.name} <span style="color:#999;">(${i.size || 'Free Size'})</span></td>
     <td style="padding:10px 8px;text-align:center;border-bottom:1px solid #f0e5f8;font-size:13px;">×${i.qty}</td>
     <td style="padding:10px 4px;text-align:right;border-bottom:1px solid #f0e5f8;font-weight:700;font-size:13px;">₹${(i.price * i.qty).toLocaleString('en-IN')}</td></tr>`).join('');
  const isPaid = order.payment?.status === 'paid';
  const payLabel = order.payment?.method === 'online' ? '💳 Online — Paid ✅' : '💵 Cash on Delivery';
  const disc = order.discount > 0 ? `<tr style="background:#fff8f0;"><td colspan="2" style="padding:8px 4px;font-size:13px;color:#e65100;">🎟️ Coupon Discount</td><td style="padding:8px 4px;text-align:right;color:#e65100;font-weight:700;">−₹${order.discount.toLocaleString('en-IN')}</td></tr>` : '';
  const delFee = `<tr><td colspan="2" style="padding:8px 4px;font-size:13px;color:#666;">🚚 Delivery</td><td style="padding:8px 4px;text-align:right;font-size:13px;">${order.deliveryFee === 0 ? '🎉 FREE' : '₹60'}</td></tr>`;
  return sendEmail(to, `${BRAND} – Order #${order.orderId} Confirmed! 🎉`,
    emailWrap('Your Order is Confirmed! 🎉',
      `<p style="color:#444;font-size:15px;margin:0 0 16px;">Hi <strong>${name}</strong>, thank you for shopping with us! 🛍️</p>
       
       <!-- Order ID badge -->
       <div style="background:#F5F0F8;border-radius:12px;padding:14px 18px;margin-bottom:18px;text-align:center;">
         <p style="margin:0;color:#888;font-size:12px;">Order ID</p>
         <p style="margin:4px 0 0;color:${PP};font-size:22px;font-weight:900;letter-spacing:2px;">#${order.orderId}</p>
       </div>

       <!-- Items table -->
       <table width="100%" style="border-collapse:collapse;margin-bottom:6px;">
         <tr style="background:#F5F0F8;"><th style="padding:10px 4px;text-align:left;font-size:12px;color:#888;font-weight:700;">ITEM</th><th style="padding:10px 8px;font-size:12px;color:#888;font-weight:700;">QTY</th><th style="padding:10px 4px;text-align:right;font-size:12px;color:#888;font-weight:700;">PRICE</th></tr>
         ${rows}
         ${disc}
         ${delFee}
         <tr style="background:#F5F0F8;"><td colspan="2" style="padding:12px 4px;font-weight:900;color:#333;font-size:15px;">Total</td>
             <td style="padding:12px 4px;text-align:right;font-weight:900;color:${PP};font-size:18px;">₹${order.total.toLocaleString('en-IN')}</td></tr>
       </table>

       <!-- Payment + delivery info -->
       <div style="display:flex;gap:10px;margin:18px 0 0;">
         <div style="flex:1;background:#f9f9f9;border-radius:10px;padding:12px;text-align:center;">
           <p style="margin:0;font-size:11px;color:#999;">PAYMENT</p>
           <p style="margin:4px 0 0;font-size:13px;font-weight:700;color:#333;">${payLabel}</p>
         </div>
         <div style="flex:1;background:#f9f9f9;border-radius:10px;padding:12px;text-align:center;">
           <p style="margin:0;font-size:11px;color:#999;">ESTIMATED DELIVERY</p>
           <p style="margin:4px 0 0;font-size:13px;font-weight:700;color:#333;">3–5 Business Days</p>
         </div>
       </div>

       <!-- Ship to -->
       <div style="background:#f9f9f9;border-radius:10px;padding:14px;margin-top:12px;">
         <p style="margin:0 0 4px;font-size:11px;color:#999;font-weight:700;">SHIPPING TO</p>
         <p style="margin:0;font-size:13px;color:#333;line-height:1.6;">
           📍 ${order.shippingAddress?.name}, ${order.shippingAddress?.phone}<br>
           ${order.shippingAddress?.line1}${order.shippingAddress?.line2 ? ', ' + order.shippingAddress.line2 : ''}<br>
           ${order.shippingAddress?.city}, ${order.shippingAddress?.state} – ${order.shippingAddress?.pincode}
         </p>
       </div>
       
       <p style="color:#888;font-size:13px;margin:16px 0 0;text-align:center;">We'll email you when your order ships. Happy shopping! 🛍️</p>`,
      `${SITE_URL}`, 'Track My Order →'));
};

const STATUS_META = {
  confirmed:        { emoji: '✅', color: '#2e7d32', label: 'Order Confirmed',        bg: '#e8f5e9', msg: 'Great news! Your order has been confirmed and is being prepared.' },
  processing:       { emoji: '⚙️', color: '#e65100', label: 'Being Prepared',         bg: '#fff3e0', msg: 'Our team is carefully picking and packing your items.' },
  shipped:          { emoji: '🚚', color: '#1565c0', label: 'Shipped!',               bg: '#e3f2fd', msg: 'Your order is on its way! Expected delivery in 2–3 days.' },
  out_for_delivery: { emoji: '🏍️', color: '#6a1b9a', label: 'Out for Delivery',       bg: '#f3e5f5', msg: 'Your order is out for delivery today. Please keep your phone handy!' },
  delivered:        { emoji: '🎉', color: '#2e7d32', label: 'Delivered!',             bg: '#e8f5e9', msg: 'Your order has been delivered. Hope your little ones love it!' },
  cancelled:        { emoji: '❌', color: '#c62828', label: 'Order Cancelled',        bg: '#ffebee', msg: 'Your order has been cancelled. Refund (if any) will be processed in 5–7 days.' },
  returned:         { emoji: '↩️', color: '#555',    label: 'Return Initiated',       bg: '#f5f5f5', msg: 'Your return has been initiated. We will process it shortly.' },
};
const emailOrderStatus = (to, name, orderId, status, msg) => {
  const meta = STATUS_META[status] || { emoji: '📦', color: PP, label: status, bg: '#F5F0F8', msg: '' };
  const finalMsg = msg || meta.msg;
  const subj = { delivered: `🎉 Delivered! Your KidsCart order #${orderId}`, shipped: `🚚 Shipped! Your KidsCart order #${orderId} is on the way`, out_for_delivery: `🏍️ Out for Delivery! Order #${orderId} arrives today`, cancelled: `Order #${orderId} Cancelled` }[status] || `${BRAND} – Order #${orderId} ${meta.label}`;
  return sendEmail(to, subj,
    emailWrap(`${meta.emoji} ${meta.label}`,
      `<p style="color:#444;font-size:15px;">Hi <strong>${name}</strong>,</p>
       
       <!-- Status badge -->
       <div style="background:${meta.bg};border-radius:14px;padding:20px;text-align:center;margin:18px 0;">
         <div style="font-size:42px;margin-bottom:8px;">${meta.emoji}</div>
         <p style="margin:0;color:${meta.color};font-size:18px;font-weight:900;">${meta.label}</p>
         <p style="margin:6px 0 0;color:#666;font-size:13px;">Order <strong style="color:${PP};">#${orderId}</strong></p>
       </div>

       <!-- Message -->
       <div style="background:#f9f9f9;border-left:4px solid ${meta.color};border-radius:0 10px 10px 0;padding:14px 18px;margin:16px 0;">
         <p style="margin:0;color:#444;font-size:14px;line-height:1.6;">${finalMsg}</p>
       </div>

       ${status === 'delivered' ? `
       <div style="background:#F5F0F8;border-radius:12px;padding:16px;text-align:center;margin-top:16px;">
         <p style="margin:0;color:#666;font-size:13px;">Love your new clothes? 💜</p>
         <p style="margin:6px 0 0;color:${PP};font-weight:700;font-size:14px;">Share a photo & tag us on Instagram!</p>
         <a href="https://instagram.com/kidscart.kids" style="color:${PP};font-weight:800;font-size:13px;">@kidscart.kids</a>
       </div>` : ''}

       ${status === 'shipped' ? `
       <div style="background:#e3f2fd;border-radius:12px;padding:14px;text-align:center;margin-top:14px;">
         <p style="margin:0;color:#1565c0;font-size:13px;">📦 Keep your phone handy for delivery updates from our courier partner.</p>
       </div>` : ''}

       <p style="color:#999;font-size:12px;text-align:center;margin:20px 0 0;">Need help? Reply to this email or contact us at <a href="mailto:admin@kidscart.kids" style="color:${PP};">admin@kidscart.kids</a></p>`,
      status !== 'cancelled' ? SITE_URL : null,
      status !== 'cancelled' ? 'Continue Shopping →' : null));
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


// ══════════════════════════════════════════════════════════
// CRM + WHATSAPP SCHEMAS
// ══════════════════════════════════════════════════════════

const CrmStageSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  color:   { type: String, default: '#7B2D8B' },
  order:   { type: Number, default: 0 },
  isWon:   { type: Boolean, default: false },
  isLost:  { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const CrmTagSchema = new mongoose.Schema({
  name:  { type: String, required: true, unique: true, trim: true },
  color: { type: String, default: '#F7941D' }
});

const LeadSchema = new mongoose.Schema({
  phone:       { type: String, required: true, unique: true, trim: true },
  name:        { type: String, trim: true, default: '' },
  email:       { type: String, trim: true, default: '' },
  stage:       { type: mongoose.Schema.Types.ObjectId, ref: 'CrmStage' },
  tags:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'CrmTag' }],
  source:      { type: String, enum: ['whatsapp', 'instagram', 'website', 'manual'], default: 'whatsapp' },
  status:      { type: String, enum: ['open', 'won', 'lost'], default: 'open' },
  value:       { type: Number, default: 0 },         // expected order value
  wonValue:    { type: Number, default: 0 },          // actual revenue on win
  assignedTo:  { type: String, default: '' },
  lastSeen:    { type: Date, default: Date.now },
  notes: [{
    text:      String,
    createdBy: String,
    createdAt: { type: Date, default: Date.now }
  }],
  linkedUser:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', sparse: true },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now }
});

const WaConversationSchema = new mongoose.Schema({
  phone:         { type: String, required: true, unique: true, trim: true },
  lead:          { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  contactName:   { type: String, default: '' },
  unreadCount:   { type: Number, default: 0 },
  lastMessage:   { type: String, default: '' },
  lastMessageAt: { type: Date, default: Date.now },
  isBlocked:     { type: Boolean, default: false },
  createdAt:     { type: Date, default: Date.now }
});

const WaMessageSchema = new mongoose.Schema({
  waMessageId:   String,                        // Meta's message ID
  conversation:  { type: mongoose.Schema.Types.ObjectId, ref: 'WaConversation' },
  lead:          { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  phone:         { type: String, required: true },
  direction:     { type: String, enum: ['inbound', 'outbound'], required: true },
  type:          { type: String, enum: ['text', 'image', 'document', 'audio', 'video', 'template', 'interactive'], default: 'text' },
  body:          { type: String, default: '' },
  mediaUrl:      String,
  status:        { type: String, enum: ['sent', 'delivered', 'read', 'failed', 'received'], default: 'sent' },
  sentBy:        { type: String, default: 'customer' },  // 'customer' or admin name
  timestamp:     { type: Date, default: Date.now },
  createdAt:     { type: Date, default: Date.now }
});

const WaTemplateSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  body:     { type: String, required: true },
  category: { type: String, default: 'general' },
  isActive: { type: Boolean, default: true },
  createdAt:{ type: Date, default: Date.now }
});

const WaBotSessionSchema = new mongoose.Schema({
  phone:        { type: String, required: true, unique: true },
  state:        { type: String, default: 'idle' },
  humanHandoff: { type: Boolean, default: false },
  handoffAt:    Date,
  lastBotMsgAt: Date,
  updatedAt:    { type: Date, default: Date.now }
});

const User     = mongoose.model('User',     UserSchema);
const Product  = mongoose.model('Product',  ProductSchema);
const Order    = mongoose.model('Order',    OrderSchema);
const Review   = mongoose.model('Review',   ReviewSchema);
const Coupon   = mongoose.model('Coupon',   CouponSchema);
const Banner   = mongoose.model('Banner',   BannerSchema);
const Chat     = mongoose.model('Chat',     ChatSchema);
const Settings       = mongoose.model('Settings',       SettingsSchema);
const CrmStage       = mongoose.model('CrmStage',       CrmStageSchema);
const CrmTag         = mongoose.model('CrmTag',          CrmTagSchema);
const Lead           = mongoose.model('Lead',            LeadSchema);
const WaConversation = mongoose.model('WaConversation',  WaConversationSchema);
const WaMessage      = mongoose.model('WaMessage',       WaMessageSchema);
const WaTemplate     = mongoose.model('WaTemplate',      WaTemplateSchema);
const WaBotSession   = mongoose.model('WaBotSession',     WaBotSessionSchema);

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

// OTP – Email + WhatsApp
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
    // Always send email OTP
    await emailOTP(email, otp, user.name).catch(e => console.error('Email OTP:', e.message));
    // Also send WA OTP if user has phone (silent fail — email is primary)
    if (user.phone) waOTP(user.phone, otp, user.name).catch(() => {});
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


// ══════════════════════════════════════════════
// RAZORPAY PAYMENT ROUTES
// ══════════════════════════════════════════════

// Step 1: Create Razorpay order (called before showing payment popup)
app.post('/api/payment/create-order', auth, async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ error: 'Invalid amount' });
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // paise
      currency,
      receipt: receipt || `rcpt_${Date.now()}`,
      notes: { userId: req.user._id.toString() }
    });
    res.json({ success: true, order });
  } catch (e) {
    console.error('Razorpay create order error:', e);
    res.status(500).json({ error: 'Payment initiation failed. Please try again.' });
  }
});

// Step 2: Verify payment + create our order in DB
app.post('/api/payment/verify', auth, async (req, res) => {
  try {
    const {
      razorpay_order_id, razorpay_payment_id, razorpay_signature,
      items, shippingAddress, couponCode, notes
    } = req.body;

    // ── Verify HMAC signature ──
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const body   = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed. Please contact support.' });
    }

    // ── Signature valid — create order in DB ──
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

    const fee   = subtotal - discount >= 999 ? 0 : 60;
    const total = subtotal - discount + fee;
    const orderId = genOrderId();
    const ord = await Order.create({
      orderId, user: req.user._id, items: oi, shippingAddress,
      payment: { method: 'upi', status: 'paid', transactionId: razorpay_payment_id },
      status: 'confirmed',
      subtotal, discount, deliveryFee: fee, total, couponCode, notes,
      tracking: [
        { status: 'placed',    message: 'Order placed successfully!' },
        { status: 'confirmed', message: 'Payment received & order confirmed ✅' }
      ],
      estimatedDelivery: new Date(Date.now() + 5 * 24 * 3600000)
    });

    const u = await User.findById(req.user._id);
    // Email to customer (existing)
    if (u?.email) emailOrderConfirm(u.email, u.name, { ...ord.toObject(), items: oi }).catch(() => {});
    // WA to customer
    const custPhone = u?.phone || shippingAddress?.phone;
    if (custPhone) waOrderNotify(custPhone, u?.name || 'Customer', ord.orderId, 'confirmed', ord.total).catch(() => {});
    // Email to admin (existing)
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@kidscart.kids';
    sendEmail(adminEmail, `💳 Paid Order #${ord.orderId} — ₹${ord.total}`,
      emailWrap('New PAID Order! 💳',
        `<p style="color:#444;font-size:15px;">A new online payment order has been confirmed.</p>
         <table style="width:100%;border-collapse:collapse;font-size:14px;">
           <tr><td style="padding:8px;color:#888">Order ID</td><td style="padding:8px;font-weight:800">#${ord.orderId}</td></tr>
           <tr style="background:#faf6ff"><td style="padding:8px;color:#888">Customer</td><td style="padding:8px">${u?.name} (${u?.email})</td></tr>
           <tr><td style="padding:8px;color:#888">Items</td><td style="padding:8px">${oi.map(i=>i.name+' ×'+i.qty).join(', ')}</td></tr>
           <tr style="background:#faf6ff"><td style="padding:8px;color:#888">Total</td><td style="padding:8px;font-weight:800;color:#7B2D8B">₹${ord.total}</td></tr>
           <tr><td style="padding:8px;color:#888">Payment</td><td style="padding:8px;color:#2e7d32;font-weight:800">UPI — ${razorpay_payment_id} ✅</td></tr>
         </table>
         <p style="margin-top:16px"><a href="https://kidscart.kids/admin.html" style="background:#7B2D8B;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:800">Open Admin Panel →</a></p>`
      )
    ).catch(() => {});
    // WA to both admin numbers
    notifyAdmins(`💳 New PAID order!\n#${ord.orderId} — ₹${ord.total}\nCustomer: ${u?.name || 'Unknown'}\nUPI: ${razorpay_payment_id}\nItems: ${oi.map(i=>i.name+' ×'+i.qty).join(', ')}`).catch(() => {});

    res.status(201).json({ success: true, order: ord });
  } catch (e) {
    console.error('Payment verify error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Step 3: Webhook — backup confirmation (handles network drops/browser close)
app.post('/api/webhook/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (secret) {
      const sig  = req.headers['x-razorpay-signature'];
      const hash = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
      if (hash !== sig) return res.status(400).json({ error: 'Invalid signature' });
    }
    const event = JSON.parse(req.body.toString());
    if (event.event === 'payment.captured') {
      const payId = event.payload.payment.entity.id;
      // Find order by transactionId and confirm if not already
      await Order.findOneAndUpdate(
        { 'payment.transactionId': payId, 'payment.status': { $ne: 'paid' } },
        { 'payment.status': 'paid', status: 'confirmed',
          $push: { tracking: { status: 'confirmed', message: 'Payment confirmed via webhook ✅' } }
        }
      );
    }
    res.json({ received: true });
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).json({ error: e.message });
  }
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
    // WA to customer
    const custPhoneCOD = u?.phone || shippingAddress?.phone;
    if (custPhoneCOD) waOrderNotify(custPhoneCOD, u?.name || 'Customer', ord.orderId, 'placed', ord.total).catch(() => {});
    // WA to both admin numbers
    notifyAdmins(`🛍️ New COD order!\n#${ord.orderId} — ₹${ord.total}\nCustomer: ${u?.name || 'Unknown'} | ${shippingAddress.phone}\nItems: ${oi.map(i=>i.name+' ×'+i.qty).join(', ')}\nShip to: ${shippingAddress.city}`).catch(() => {});
    // Email to admin (existing)
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
  // Try image upload first, fall back to media upload for audio/video
  uploadProducts.array('images', 10)(req, res, err => {
    if (!err && req.files?.length) {
      return res.json({ success: true, urls: req.files.map(f => f.path) });
    }
    // If image upload failed (e.g. audio file), try media upload
    uploadMedia.array('images', 10)(req, res, err2 => {
      if (err2) return res.status(400).json({ error: err2.message || 'Upload failed' });
      if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
      res.json({ success: true, urls: req.files.map(f => f.path) });
    });
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
    const o = await Order.findById(req.params.id).populate('user', 'name email phone');
    if (!o) return res.status(404).json({ error: 'Order not found' });
    o.status = status;
    o.tracking.push({ status, message: message || `Order ${status}` });
    if (status === 'delivered') { o.deliveredAt = new Date(); o.payment.status = 'paid'; }
    await o.save();
    // Email (existing — untouched)
    if (o.user?.email) emailOrderStatus(o.user.email, o.user.name, o.orderId, status, message).catch(() => {});
    // WA to customer
    const custPhone = o.user?.phone || o.shippingAddress?.phone;
    if (custPhone) waOrderNotify(custPhone, o.user?.name || 'Customer', o.orderId, status, o.total).catch(() => {});
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
  const fromEmail = process.env.ZEPTO_FROM_EMAIL || 'admin@kidscart.kids';
  const apiKeySet = !!process.env.ZEPTO_API_KEY;
  const apiKeyLen = process.env.ZEPTO_API_KEY ? process.env.ZEPTO_API_KEY.length : 0;
  const ok = await sendEmail(fromEmail, 'KidsCart Email Test ✅',
    emailWrap('Email Working!', '<p style="color:#444;font-size:15px;">ZeptoMail REST API is working correctly. ✅</p>'));
  res.json({ success: ok, message: ok ? 'Test email sent to ' + fromEmail : 'Send failed — check Railway logs', fromEmail, apiKeySet, apiKeyLen });
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


// ══════════════════════════════════════════════════════════
// WHATSAPP WEBHOOK (Meta)
// ══════════════════════════════════════════════════════════

// Verification handshake — Meta calls this GET when you add webhook URL
app.get('/api/webhook/whatsapp', (req, res) => {
  const mode  = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === WA_VERIFY) {
    console.log('✅ WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Incoming messages from Meta
app.post('/api/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200); // Always ack immediately
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const val = change.value;

        // ── Handle status updates (delivered, read) ──
        for (const status of val.statuses || []) {
          const st = { delivered: 'delivered', read: 'read', failed: 'failed' }[status.status];
          if (st) await WaMessage.findOneAndUpdate({ waMessageId: status.id }, { status: st });
        }

        // ── Handle incoming messages ──
        for (const msg of val.messages || []) {
          const phone      = msg.from;
          const waId       = msg.id;
          const profileName = val.contacts?.[0]?.profile?.name || '';
          const msgType    = msg.type;
          let body_text    = '';

          if (msgType === 'text')        body_text = msg.text?.body || '';
          else if (msgType === 'image')  body_text = '[Image]';
          else if (msgType === 'audio')  body_text = '[Voice Message]';
          else if (msgType === 'video')  body_text = '[Video]';
          else if (msgType === 'document') body_text = '[Document]';
          else if (msgType === 'interactive') body_text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '[Interactive]';
          else body_text = `[${msgType}]`;

          // Dedup — skip if already saved
          if (await WaMessage.findOne({ waMessageId: waId })) continue;

          const { lead, conv } = await upsertWaContact(phone, profileName);

          // Save message
          const waMsg = await WaMessage.create({
            waMessageId: waId,
            conversation: conv._id,
            lead: lead._id,
            phone,
            direction: 'inbound',
            type: msgType,
            body: body_text,
            status: 'received',
            sentBy: 'customer',
            timestamp: new Date(parseInt(msg.timestamp) * 1000)
          });

          // Update conversation
          await WaConversation.findByIdAndUpdate(conv._id, {
            lastMessage:   body_text,
            lastMessageAt: waMsg.timestamp,
            contactName:   profileName || conv.contactName,
            $inc: { unreadCount: 1 }
          });

          // Update lead lastSeen
          await Lead.findByIdAndUpdate(lead._id, { lastSeen: new Date(), updatedAt: new Date() });

          // Real-time push to admin dashboard
          io.to('admin').emit('wa_message', {
            phone, profileName, body: body_text, type: msgType,
            timestamp: waMsg.timestamp, leadId: lead._id, convId: conv._id,
            waMessageId: waId
          });
          io.to('admin').emit('inbox_update', { phone, unreadCount: conv.unreadCount + 1, lastMessage: body_text });

          console.log(`📱 WA inbound from ${phone}: ${body_text.slice(0,50)}`);

          // Notify admin numbers via WA (don't notify if message is from admin itself)
          if (!ADMIN_WA_NUMBERS.includes(phone)) {
            notifyAdmins(`📱 New WhatsApp!\nFrom: ${profileName || phone}\n${phone}\nMsg: ${body_text.slice(0,80)}\n\nReply: kidscart.kids/admin/whatsapp.html`).catch(() => {});
          }

          // Bot engine
          handleBotMessage(phone, profileName, body_text, msgType).catch(e =>
            console.error('Bot error:', e.message)
          );
        }
      }
    }
  } catch(e) { console.error('WA webhook error:', e.message); }
});

// ── Bot engine ──
async function handleBotMessage(phone, name, text, msgType) {
  if (ADMIN_WA_NUMBERS.includes(phone)) return;
  let session = await WaBotSession.findOne({ phone });
  if (!session) session = await WaBotSession.create({ phone, state: 'idle' });

  // Human handoff — bot silent for 30 min after admin replies
  if (session.humanHandoff) {
    const thirtyMin = 30 * 60 * 1000;
    if (session.handoffAt && (Date.now() - new Date(session.handoffAt).getTime()) < thirtyMin) return;
    session.humanHandoff = false;
    await session.save();
  }

  const lowerText = (text || '').toLowerCase().trim();

  // Handle interactive button replies
  if (msgType === 'interactive') {
    const btnId = text.toLowerCase();
    if (btnId === 'track_order') {
      await WaBotSession.findOneAndUpdate({ phone }, { state: 'track_order' });
      await waSend(phone, `📦 *Order Tracking*\n\nPlease enter your *Order ID* (e.g. KC2024001) or your registered *phone number* and we'll find your orders.`);
      return;
    }
    if (btnId === 'browse') {
      await WaBotSession.findOneAndUpdate({ phone }, { state: 'browse' });
      await waSend(phone, `🛍️ *Shop KidsCart*\n\n👗 *Girls* — Frocks, dresses, ethnic\n👖 *Boys* — Casuals, ethnic, party\n🍼 *Baby* — Rompers, sets 0–24M\n🎀 *Party Wear* — Birthday & occasions\n🌸 *Ethnic* — Lehenga, kurta sets\n\nShop now: https://kidscart.kids\n\nReply *MENU* to go back.`);
      return;
    }
    if (btnId === 'support') {
      await WaBotSession.findOneAndUpdate({ phone }, { state: 'support' });
      await waSend(phone, `💬 *Support*\n\nOur team will assist you shortly!\n\n📧 admin@kidscart.kids\n📞 +91 94975 96110\n\nDescribe your issue and we'll get back to you. 💜`);
      notifyAdmins(`🆘 Support request from ${name || phone}. Open admin WhatsApp panel!`).catch(() => {});
      return;
    }
  }

  // MENU state — text replies
  if (session.state === 'menu') {
    if (lowerText.includes('track') || lowerText === '1') {
      await WaBotSession.findOneAndUpdate({ phone }, { state: 'track_order' });
      await waSend(phone, `📦 *Order Tracking*\n\nEnter your *Order ID* (e.g. KC2024001) or registered *phone number*.`);
      return;
    }
    if (lowerText.includes('shop') || lowerText.includes('browse') || lowerText === '2') {
      await WaBotSession.findOneAndUpdate({ phone }, { state: 'browse' });
      await waSend(phone, `🛍️ *Shop KidsCart*\n\n👗 Girls 👖 Boys 🍼 Baby 🎀 Party 🌸 Ethnic\n\nVisit: https://kidscart.kids\n\nReply *MENU* to go back.`);
      return;
    }
    if (lowerText.includes('support') || lowerText === '3') {
      await WaBotSession.findOneAndUpdate({ phone }, { state: 'support' });
      await waSend(phone, `💬 Our team will assist you shortly! Describe your issue below. 💜`);
      notifyAdmins(`🆘 Support from ${name || phone}. Check WhatsApp admin panel!`).catch(() => {});
      return;
    }
  }

  // TRACK ORDER state
  if (session.state === 'track_order') {
    if (lowerText === 'menu' || lowerText === 'back') { await sendWelcomeMenu(phone, name); return; }
    let orders = [];
    const orderIdMatch = text.match(/KC[A-Z0-9]+/i);
    if (orderIdMatch) {
      const ord = await Order.findOne({ orderId: { $regex: new RegExp(orderIdMatch[0], 'i') } }).populate('user', 'name phone');
      if (ord) orders = [ord];
    } else {
      const cleanPhone = text.replace(/\D/g, '');
      if (cleanPhone.length >= 10) {
        const u = await User.findOne({ phone: { $regex: cleanPhone.slice(-10) } });
        if (u) orders = await Order.find({ user: u._id }).sort({ createdAt: -1 }).limit(3);
      }
    }
    if (!orders.length) {
      await waSend(phone, `❌ No orders found for "${text.slice(0,30)}".\n\nTry your Order ID (e.g. KC2024001) or registered phone number.\n\nReply *MENU* for main menu.`);
      return;
    }
    const se = { placed:'📋', confirmed:'✅', processing:'⚙️', shipped:'🚚', out_for_delivery:'🏍️', delivered:'🎉', cancelled:'❌', returned:'↩️' };
    const reply = orders.map(o => `${se[o.status]||'📦'} *Order #${o.orderId}*\nStatus: *${o.status.toUpperCase()}*\nTotal: ₹${o.total}\nDate: ${new Date(o.createdAt).toLocaleDateString('en-IN')}`).join('\n\n');
    await waSend(phone, `📦 *Your Orders*\n\n${reply}\n\nNeed help? Reply *SUPPORT*\nMain menu? Reply *MENU*`);
    return;
  }

  // SUPPORT state — let admin handle, bot stays quiet
  if (session.state === 'support') {
    if (lowerText === 'menu' || lowerText === 'back') { await sendWelcomeMenu(phone, name); return; }
    return; // Admin handles
  }

  // Default / greeting — show welcome menu
  const greetWords = ['hi', 'hello', 'hey', 'start', 'menu', 'help', 'hai', 'hii'];
  const isGreeting = greetWords.some(w => lowerText.includes(w)) || lowerText.length <= 4;
  if (session.state === 'idle' || isGreeting || lowerText === 'menu') {
    await sendWelcomeMenu(phone, name);
    return;
  }

  await waSend(phone, `Hi ${name || 'there'}! 👋 Reply *MENU* to see what I can help you with, or type *SUPPORT* to talk to our team.`);
}

async function sendWelcomeMenu(phone, name) {
  await WaBotSession.findOneAndUpdate({ phone }, { state: 'menu', lastBotMsgAt: new Date() }, { upsert: true });
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', recipient_type: 'individual', to: phone,
        type: 'interactive',
        interactive: {
          type: 'button',
          header: { type: 'text', text: '👋 Welcome to KidsCart!' },
          body: { text: `Hi ${name || 'there'}! 🛍️ India's favourite kids fashion store. How can I help?` },
          footer: { text: 'kidscart.kids | Free delivery above ₹999' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'track_order', title: '📦 Track My Order' } },
              { type: 'reply', reply: { id: 'browse',      title: '🛍️ Shop Now' } },
              { type: 'reply', reply: { id: 'support',     title: '💬 Support' } }
            ]
          }
        }
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(d));
  } catch(e) {
    console.log('Interactive buttons unavailable, using text menu:', e.message);
    await waSend(phone, `👋 Hi ${name || 'there'}! Welcome to *KidsCart* 🛍️\n\nWhat can I help you with?\n\n1️⃣ 📦 Track my order\n2️⃣ 🛍️ Shop / Browse\n3️⃣ 💬 Support & Help\n\n_Reply with 1, 2, or 3_`);
  }
}

// ══════════════════════════════════════════════════════════
// WHATSAPP SEND API
// ══════════════════════════════════════════════════════════

app.post('/api/admin/whatsapp/send', adminAuth, async (req, res) => {
  try {
    const { phone, text, type, imageUrl, audioUrl, videoUrl, mediaUrl } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const { lead, conv } = await upsertWaContact(phone);
    let waId, msgType, msgBody, msgMediaUrl;

    if (type === 'image' && (imageUrl || mediaUrl)) {
      msgType = 'image'; msgMediaUrl = imageUrl || mediaUrl;
      waId = await waSendMedia(phone, msgMediaUrl, 'image', text || '');
      msgBody = '[Image]';
    } else if (type === 'audio' && (audioUrl || mediaUrl)) {
      msgType = 'audio'; msgMediaUrl = audioUrl || mediaUrl;
      waId = await waSendMedia(phone, msgMediaUrl, 'audio');
      msgBody = '[Voice Message]';
    } else if (type === 'video' && (videoUrl || mediaUrl)) {
      msgType = 'video'; msgMediaUrl = videoUrl || mediaUrl;
      waId = await waSendMedia(phone, msgMediaUrl, 'video', text || '');
      msgBody = '[Video]';
    } else {
      if (!text?.trim()) return res.status(400).json({ error: 'text required' });
      msgType = 'text'; msgBody = text.trim();
      waId = await waSend(phone, text.trim());
    }

    if (!waId) return res.status(502).json({ error: 'Failed to send via WhatsApp API. Check WA env vars.' });

    // Mark human handoff — pause bot for 30 min when admin replies
    await WaBotSession.findOneAndUpdate({ phone }, { humanHandoff: true, handoffAt: new Date(), state: 'idle' }, { upsert: true });

    const waMsg = await WaMessage.create({
      waMessageId: waId, conversation: conv._id, lead: lead._id, phone,
      direction: 'outbound', type: msgType, body: msgBody, mediaUrl: msgMediaUrl,
      status: 'sent', sentBy: req.user?.name || 'Admin', timestamp: new Date()
    });

    await WaConversation.findByIdAndUpdate(conv._id, { lastMessage: msgBody, lastMessageAt: new Date() });
    io.to('admin').emit('wa_message_sent', { phone, body: msgBody, type: msgType, mediaUrl: msgMediaUrl, waMessageId: waId, msgId: waMsg._id });

    res.json({ success: true, messageId: waId, msg: waMsg });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get conversation messages
app.get('/api/admin/whatsapp/messages/:phone', adminAuth, async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const page  = parseInt(req.query.page) || 1;
    const limit = 50;
    const msgs  = await WaMessage.find({ phone })
      .sort({ timestamp: -1 }).skip((page-1)*limit).limit(limit).lean();
    const conv  = await WaConversation.findOne({ phone }).lean();
    res.json({ messages: msgs.reverse(), conv });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get all conversations (inbox list)
app.get('/api/admin/whatsapp/inbox', adminAuth, async (req, res) => {
  try {
    const search = req.query.search?.trim();
    const filter = req.query.filter; // 'unread' | 'all'
    let q = {};
    if (search) { const rx = safeRegex(search); q.$or = [{ phone: rx }, { contactName: rx }]; }
    if (filter === 'unread') q.unreadCount = { $gt: 0 };
    const convs = await WaConversation.find(q)
      .sort({ lastMessageAt: -1 }).limit(100)
      .populate('lead', 'name stage tags status').lean();
    res.json({ conversations: convs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Mark conversation as read
app.put('/api/admin/whatsapp/read/:phone', adminAuth, async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    await WaConversation.findOneAndUpdate({ phone }, { unreadCount: 0 });
    io.to('admin').emit('inbox_read', { phone });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Send template message
app.post('/api/admin/whatsapp/template', adminAuth, async (req, res) => {
  try {
    const { phone, templateName, params, lang } = req.body;
    const waId = await waSendTemplate(phone, templateName, params || [], lang || 'en');
    if (!waId) return res.status(502).json({ error: 'Template send failed. Check template name and that it is approved in Meta.' });

    // Save to DB so it appears in chat
    const { lead, conv } = await upsertWaContact(phone);
    const waMsg = await WaMessage.create({
      waMessageId: waId, conversation: conv._id, lead: lead._id, phone,
      direction: 'outbound', type: 'template',
      body: `[Template: ${templateName}]`,
      status: 'sent', sentBy: req.user?.name || 'Admin', timestamp: new Date()
    });
    await WaConversation.findByIdAndUpdate(conv._id, {
      lastMessage: `[Template: ${templateName}]`, lastMessageAt: new Date()
    });
    // Pause bot when admin sends template
    await WaBotSession.findOneAndUpdate({ phone }, { humanHandoff: true, handoffAt: new Date() }, { upsert: true });
    io.to('admin').emit('wa_message_sent', { phone, body: `[Template: ${templateName}]`, type: 'template', waMessageId: waId, msgId: waMsg._id });

    res.json({ success: true, messageId: waId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── WhatsApp Quick Reply Templates (saved in DB) ──
app.get('/api/admin/whatsapp/templates', adminAuth, async (req, res) => {
  try { res.json({ templates: await WaTemplate.find({ isActive: true }).sort({ name: 1 }) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/whatsapp/templates', adminAuth, async (req, res) => {
  try { res.json({ template: await WaTemplate.create(req.body) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/whatsapp/templates/:id', adminAuth, async (req, res) => {
  try { res.json({ template: await WaTemplate.findByIdAndUpdate(req.params.id, req.body, { new: true }) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/whatsapp/templates/:id', adminAuth, async (req, res) => {
  try { await WaTemplate.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
// CRM — PIPELINE STAGES
// ══════════════════════════════════════════════════════════

app.get('/api/admin/crm/stages', adminAuth, async (req, res) => {
  try { res.json({ stages: await CrmStage.find().sort({ order: 1 }) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/crm/stages', adminAuth, async (req, res) => {
  try {
    const count = await CrmStage.countDocuments();
    const stage = await CrmStage.create({ ...req.body, order: req.body.order ?? count });
    res.status(201).json({ stage });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/crm/stages/:id', adminAuth, async (req, res) => {
  try { res.json({ stage: await CrmStage.findByIdAndUpdate(req.params.id, req.body, { new: true }) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/crm/stages/reorder', adminAuth, async (req, res) => {
  try {
    const { order } = req.body; // array of { id, order }
    await Promise.all(order.map(({ id, order: o }) => CrmStage.findByIdAndUpdate(id, { order: o })));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/crm/stages/:id', adminAuth, async (req, res) => {
  try {
    await Lead.updateMany({ stage: req.params.id }, { $unset: { stage: 1 } });
    await CrmStage.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
// CRM — TAGS
// ══════════════════════════════════════════════════════════

app.get('/api/admin/crm/tags', adminAuth, async (req, res) => {
  try { res.json({ tags: await CrmTag.find().sort({ name: 1 }) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/crm/tags', adminAuth, async (req, res) => {
  try { res.json({ tag: await CrmTag.create(req.body) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/crm/tags/:id', adminAuth, async (req, res) => {
  try { res.json({ tag: await CrmTag.findByIdAndUpdate(req.params.id, req.body, { new: true }) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/crm/tags/:id', adminAuth, async (req, res) => {
  try {
    await Lead.updateMany({ tags: req.params.id }, { $pull: { tags: req.params.id } });
    await CrmTag.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
// CRM — LEADS
// ══════════════════════════════════════════════════════════

// All leads (with kanban grouping option)
app.get('/api/admin/crm/leads', adminAuth, async (req, res) => {
  try {
    const { stage, status, tag, search, view } = req.query;
    let q = {};
    if (stage)  q.stage  = stage;
    if (status) q.status = status;
    if (tag)    q.tags   = tag;
    if (search) { const rx = safeRegex(search); q.$or = [{ name: rx }, { phone: rx }, { email: rx }]; }

    const leads = await Lead.find(q)
      .populate('stage', 'name color isWon isLost')
      .populate('tags',  'name color')
      .populate('linkedUser', 'name email')
      .sort({ updatedAt: -1 }).lean();

    // For kanban view — group by stage
    if (view === 'kanban') {
      const stages = await CrmStage.find().sort({ order: 1 });
      const kanban = stages.map(s => ({
        stage: s,
        leads: leads.filter(l => l.stage?._id?.toString() === s._id.toString())
      }));
      // Unassigned
      kanban.unshift({
        stage: { _id: 'unassigned', name: 'No Stage', color: '#999', order: -1 },
        leads: leads.filter(l => !l.stage)
      });
      return res.json({ kanban });
    }

    res.json({ leads });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Single lead detail
app.get('/api/admin/crm/leads/:id', adminAuth, async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('stage', 'name color isWon isLost')
      .populate('tags',  'name color')
      .populate('linkedUser', 'name email phone').lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Attach recent messages
    const messages = await WaMessage.find({ lead: lead._id })
      .sort({ timestamp: -1 }).limit(20).lean();

    // Attach linked orders
    let orders = [];
    if (lead.linkedUser) {
      orders = await Order.find({ user: lead.linkedUser._id })
        .sort({ createdAt: -1 }).limit(10).select('orderId total status createdAt').lean();
    } else {
      // Try to match by phone
      const u = await User.findOne({ phone: lead.phone }).select('_id').lean();
      if (u) orders = await Order.find({ user: u._id }).sort({ createdAt: -1 }).limit(10).select('orderId total status createdAt').lean();
    }

    res.json({ lead, messages: messages.reverse(), orders });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create lead manually
app.post('/api/admin/crm/leads', adminAuth, async (req, res) => {
  try {
    const lead = await Lead.create({ ...req.body, source: req.body.source || 'manual' });
    // Auto-create conversation if phone provided
    if (lead.phone) {
      await WaConversation.findOneAndUpdate(
        { phone: lead.phone },
        { phone: lead.phone, lead: lead._id, contactName: lead.name },
        { upsert: true, new: true }
      );
    }
    res.status(201).json({ lead });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Update lead (stage change, tags, name, status, value etc)
app.put('/api/admin/crm/leads/:id', adminAuth, async (req, res) => {
  try {
    const update = { ...req.body, updatedAt: new Date() };
    // Won/Lost auto-set status
    const stageDoc = update.stage ? await CrmStage.findById(update.stage) : null;
    if (stageDoc?.isWon)  update.status = 'won';
    if (stageDoc?.isLost) update.status = 'lost';

    const lead = await Lead.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('stage', 'name color isWon isLost')
      .populate('tags',  'name color');

    io.to('admin').emit('lead_updated', { leadId: req.params.id, changes: update });
    res.json({ lead });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Add note to lead
app.post('/api/admin/crm/leads/:id/notes', adminAuth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Note text required' });
    const lead = await Lead.findByIdAndUpdate(
      req.params.id,
      { $push: { notes: { text: text.trim(), createdBy: req.admin?.name || 'Admin', createdAt: new Date() } }, updatedAt: new Date() },
      { new: true }
    );
    res.json({ notes: lead.notes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete note
app.delete('/api/admin/crm/leads/:leadId/notes/:noteId', adminAuth, async (req, res) => {
  try {
    await Lead.findByIdAndUpdate(req.params.leadId, { $pull: { notes: { _id: req.params.noteId } } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete lead
app.delete('/api/admin/crm/leads/:id', adminAuth, async (req, res) => {
  try {
    await Lead.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CRM Stats ──
app.get('/api/admin/crm/stats', adminAuth, async (req, res) => {
  try {
    const [total, open, won, lost, stages] = await Promise.all([
      Lead.countDocuments(),
      Lead.countDocuments({ status: 'open' }),
      Lead.countDocuments({ status: 'won' }),
      Lead.countDocuments({ status: 'lost' }),
      CrmStage.find().sort({ order: 1 }).lean()
    ]);
    const wonValue = await Lead.aggregate([{ $match: { status: 'won' } }, { $group: { _id: null, total: { $sum: '$wonValue' } } }]);
    const stageCounts = await Promise.all(stages.map(async s => ({
      ...s, count: await Lead.countDocuments({ stage: s._id })
    })));
    const totalUnread = await WaConversation.aggregate([{ $group: { _id: null, total: { $sum: '$unreadCount' } } }]);
    res.json({
      total, open, won, lost,
      wonRevenue: wonValue[0]?.total || 0,
      stageCounts,
      totalUnread: totalUnread[0]?.total || 0
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── New contact / start conversation ──
app.post('/api/admin/whatsapp/new-contact', adminAuth, async (req, res) => {
  try {
    const { phone, name, message } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const cleanPhone = phone.replace(/\D/g, '');
    const fullPhone  = cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone.slice(-10);
    const { lead, conv } = await upsertWaContact(fullPhone, name || fullPhone);
    let waId = null;
    if (message?.trim()) {
      waId = await waSend(fullPhone, message.trim());
      if (waId) {
        await WaMessage.create({ waMessageId: waId, conversation: conv._id, lead: lead._id, phone: fullPhone, direction: 'outbound', type: 'text', body: message.trim(), status: 'sent', sentBy: req.user?.name || 'Admin', timestamp: new Date() });
        await WaConversation.findByIdAndUpdate(conv._id, { lastMessage: message.trim(), lastMessageAt: new Date() });
      }
    }
    await WaBotSession.findOneAndUpdate({ phone: fullPhone }, { humanHandoff: true, handoffAt: new Date(), state: 'idle' }, { upsert: true });
    res.json({ success: true, phone: fullPhone, conv, lead, messageSent: !!waId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Get bot session status ──
app.get('/api/admin/whatsapp/bot-session/:phone', adminAuth, async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const session = await WaBotSession.findOne({ phone });
    res.json({ session: session || { phone, state: 'idle', humanHandoff: false } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Resume bot ──
app.post('/api/admin/whatsapp/bot-resume/:phone', adminAuth, async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    await WaBotSession.findOneAndUpdate({ phone }, { humanHandoff: false, state: 'idle' }, { upsert: true });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Broadcast ──
app.post('/api/admin/whatsapp/broadcast', adminAuth, async (req, res) => {
  try {
    const { phones, message, templateName, templateParams } = req.body;
    if (!phones?.length) return res.status(400).json({ error: 'phones array required' });
    if (!message && !templateName) return res.status(400).json({ error: 'message or templateName required' });
    let sent = 0, failed = 0;
    for (const phone of phones) {
      try {
        const waId = templateName
          ? await waSendTemplate(phone, templateName, templateParams || [])
          : await waSend(phone, message);
        if (waId) sent++; else failed++;
        await new Promise(r => setTimeout(r, 200));
      } catch(e) { failed++; }
    }
    res.json({ success: true, sent, failed, total: phones.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── List approved Meta templates from Meta API ──
app.get('/api/admin/whatsapp/meta-templates', adminAuth, async (req, res) => {
  try {
    if (!WA_TOKEN || !WA_PHONE_ID) return res.json({ templates: [] });

    // Step 1: Get the WABA ID from the phone number ID
    const phoneRes = await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}?fields=id,name,display_phone_number,verified_name,quality_rating,account_mode,certificate`, {
      headers: { 'Authorization': `Bearer ${WA_TOKEN}` }
    });
    const phoneData = await phoneRes.json();
    console.log('WA Phone data:', JSON.stringify(phoneData));

    // Step 2: Get WABA ID - try multiple approaches
    let wabaId = phoneData.id; // fallback: use phone number ID itself

    // Try to get the actual WABA ID
    const bizRes = await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}?fields=id,waba_id`, {
      headers: { 'Authorization': `Bearer ${WA_TOKEN}` }
    });
    const bizData = await bizRes.json();
    if (bizData.waba_id) wabaId = bizData.waba_id;

    // Step 3: Fetch templates using WABA ID
    const tmplRes = await fetch(`https://graph.facebook.com/v19.0/${wabaId}/message_templates?limit=100&fields=name,status,language,components,category`, {
      headers: { 'Authorization': `Bearer ${WA_TOKEN}` }
    });
    const tmplData = await tmplRes.json();
    console.log('WA Templates raw:', JSON.stringify(tmplData).slice(0, 300));

    // Include APPROVED and ACTIVE templates (Meta uses both terms)
    const approved = (tmplData.data || []).filter(t =>
      ['APPROVED', 'ACTIVE', 'Active'].includes(t.status)
    );

    // If no templates via WABA ID, try direct phone number ID approach
    if (!approved.length && tmplData.error) {
      const fallbackRes = await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/message_templates?limit=100`, {
        headers: { 'Authorization': `Bearer ${WA_TOKEN}` }
      });
      const fallbackData = await fallbackRes.json();
      const fallbackApproved = (fallbackData.data || []).filter(t =>
        ['APPROVED', 'ACTIVE', 'Active'].includes(t.status)
      );
      return res.json({ templates: fallbackApproved, debug: { wabaId, phoneId: WA_PHONE_ID } });
    }

    res.json({ templates: approved, debug: { wabaId, phoneId: WA_PHONE_ID } });
  } catch(e) {
    console.error('meta-templates error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Socket.io admin room ──
io.on('connection', socket => {
  socket.on('join_admin', () => {
    socket.join('admin');
    console.log('👤 Admin joined socket room');
  });
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
  // ── Seed default CRM pipeline stages ──
  if (!await CrmStage.countDocuments()) {
    await CrmStage.insertMany([
      { name: 'New Lead',    color: '#3498db', order: 0, isWon: false, isLost: false },
      { name: 'Contacted',   color: '#9b59b6', order: 1, isWon: false, isLost: false },
      { name: 'Interested',  color: '#e67e22', order: 2, isWon: false, isLost: false },
      { name: 'Quoted',      color: '#f39c12', order: 3, isWon: false, isLost: false },
      { name: 'Won ✅',       color: '#27ae60', order: 4, isWon: true,  isLost: false },
      { name: 'Lost ❌',      color: '#e74c3c', order: 5, isWon: false, isLost: true  },
    ]);
    console.log('✅ CRM default pipeline stages seeded');
  }

  // ── Seed default CRM tags ──
  if (!await CrmTag.countDocuments()) {
    await CrmTag.insertMany([
      { name: 'VIP',       color: '#f1c40f' },
      { name: 'Wholesale', color: '#3498db' },
      { name: 'Kerala',    color: '#27ae60' },
      { name: 'Repeat',    color: '#9b59b6' },
      { name: 'Cold',      color: '#95a5a6' },
      { name: 'Hot 🔥',    color: '#e74c3c' },
    ]);
    console.log('✅ CRM default tags seeded');
  }

  // ── Seed default WhatsApp quick reply templates ──
  if (!await WaTemplate.countDocuments()) {
    await WaTemplate.insertMany([
      { name: "Welcome",       body: "Hi! 👋 Welcome to KidsCart — India's favourite kids fashion store. How can I help you today?", category: "greeting" },
      { name: 'Order Update',  body: 'Hi! Your KidsCart order is on its way 🚚. Expected delivery in 2-3 business days. Thank you!', category: 'order' },
      { name: 'Price Query',   body: 'Hi! Thank you for your interest. Please visit www.kidscart.kids to see all prices and place your order directly. Use WELCOME10 for 10% off! 🎉', category: 'sales' },
      { name: 'Delivery Info', body: 'We deliver across Kerala! 🚚 Free delivery on orders above ₹999. Delivery takes 2-5 business days.', category: 'info' },
      { name: 'COD Info',      body: 'Yes, we accept Cash on Delivery! 💵 Place your order at www.kidscart.kids and choose COD at checkout.', category: 'info' },
    ]);
    console.log('✅ WA quick reply templates seeded');
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
