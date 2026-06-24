const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const path = require('path');
const { initDataLayer } = require('./lib/dataAccess');
const { getDatabaseUrl, resetPool, pingDatabase, startPgKeepAlive, isProductionDb } = require('./lib/pg');
const { ensureAvatarDir } = require('./lib/avatarStorage');
const cloudinaryAvatar = require('./lib/cloudinaryAvatar');
const { getJwtSecret } = require('./lib/jwtSecret');

// على Render لا نستبدل متغيرات المنصة بملف .env (يمنع DATABASE_URL خاطئ يكسر الاتصال).
// محلياً: بدون RENDER نسمح لـ .env أن يحدّث القيم (مثل تعطيل DATABASE_URL للتجربة).
dotenv.config({ override: !process.env.RENDER });

const app = express();
/** مطلوب خلف Render/nginx حتى يعمل rate limit وIP بشكل صحيح */
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const devOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8000',
    'http://127.0.0.1:8000'
];

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? (process.env.CORS_ORIGINS
            ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
            : true)
        : devOrigins,
    credentials: true
}));

// Rate limiting — الحدّ السابق (100/15د) كان يُستنزف بفحص الرسائل كل ثانيتين في الواجهة
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from frontend
app.use(express.static(path.join(__dirname)));

// Import routes
const authRoutes = require('./routes/auth');
const donorRoutes = require('./routes/donors');
const messageRoutes = require('./routes/messages');
const smsRoutes = require('./routes/sms');
const pushRoutes = require('./routes/push');

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/donors', donorRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/push', pushRoutes);

// Health check — يتحقق من القاعدة في الإنتاج
app.get('/api/health', async (req, res) => {
    const payload = {
        status: 'OK',
        message: 'Blood Connect API is running',
        timestamp: new Date().toISOString(),
        storage: getDatabaseUrl() ? 'postgresql' : 'json'
    };
    if (getDatabaseUrl()) {
        try {
            const dbOk = await pingDatabase();
            if (!dbOk) {
                return res.status(503).json({ ...payload, status: 'DEGRADED', db: 'unreachable' });
            }
            payload.db = 'connected';
        } catch (e) {
            return res.status(503).json({
                ...payload,
                status: 'DEGRADED',
                db: 'error',
                message: isProductionDb() ? 'Database unreachable' : (e.message || 'db error')
            });
        }
    }
    res.json(payload);
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

async function start() {
    if (isProductionDb() && !getDatabaseUrl()) {
        console.error('❌ الإنتاج يتطلب DATABASE_URL (PostgreSQL). اربط قاعدة البيانات من Render.');
        process.exit(1);
    }
    try {
        getJwtSecret();
    } catch (e) {
        console.error('فشل التحقق من JWT_SECRET:', e.message);
        process.exit(1);
    }
    try {
        await initDataLayer();
        try {
            ensureAvatarDir();
            console.log('📷 مجلد صور الملف الشخصي (محلي):', path.join(__dirname, 'uploads', 'avatars'));
            if (cloudinaryAvatar.isEnabled()) {
                console.log('☁️ صور المستخدمين: Cloudinary (تخزين دائم)');
            } else if (getDatabaseUrl()) {
                console.log('🗄️ صور الملف الشخصي: PostgreSQL BYTEA (تخزين دائم مع قاعدة البيانات — مناسب لـ Render)');
            } else {
                console.log('📁 Cloudinary غير مضبوط ولا يوجد DATABASE_URL — الصور في مجلد uploads محلياً (غير دائم على Render).');
            }
        } catch (dirErr) {
            console.error('تعذر إنشاء مجلد uploads/avatars:', dirErr.message || dirErr);
            process.exit(1);
        }
    } catch (e) {
        const canFallbackJson =
            !isProductionDb() &&
            process.env.PG_REQUIRED !== '1' &&
            (process.env.DATABASE_URL || process.env.DATABASE_EXTERNAL_URL);

        if (canFallbackJson) {
            console.warn('⚠️ تعذر الاتصال بـ PostgreSQL:', e.message || e);
            console.warn('⚠️ التطوير المحلي: سيتم استخدام data/app-data.json (علّق DATABASE_URL في .env أو أصلح الرابط من Render)');
            delete process.env.DATABASE_URL;
            delete process.env.DATABASE_EXTERNAL_URL;
            await resetPool();
            try {
                await initDataLayer();
            } catch (fallbackErr) {
                console.error('فشل التخزين البديل:', fallbackErr.message || fallbackErr);
                process.exit(1);
            }
        } else {
            console.error('فشل تهيئة قاعدة البيانات:', e.message || e);
            if (process.env.DATABASE_URL && String(e.message || '').toLowerCase().includes('ssl')) {
                console.error('تلميح: جرّب PGSSLMODE=disable محلياً فقط إن كانت قاعدتك بدون SSL.');
            }
            if (process.env.DATABASE_URL && String(e.message || '').includes('terminated')) {
                console.error(
                    'تلميح: من Render → Postgres تأكد أن القاعدة «Available» وليست معلّقة. ' +
                        'انسخ External URL للتطوير المحلي و Internal URL لخدمة الويب. جرّب: npm run db:test'
                );
            }
            process.exit(1);
        }
    }
    startPgKeepAlive();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Blood Connect API server running on port ${PORT} (جميع الواجهات — للوصول من الهاتف على نفس الشبكة استخدم IP جهازك)`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
        console.log(`📱 Twilio configured: ${process.env.TWILIO_ACCOUNT_SID ? 'Yes' : 'No'}`);
        console.log(`🗄️ Storage: ${getDatabaseUrl() ? 'PostgreSQL' : 'JSON file'}`);
        console.log(`🔔 Web Push: ${process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? 'configured' : 'not configured (set VAPID_* in .env)'}`);
    });
}

start();
