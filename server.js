const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const path = require('path');
const { initDataLayer } = require('./lib/dataAccess');
const { getJwtSecret } = require('./lib/jwtSecret');

// Load environment variables (.env يتجاوز متغيرات النظام حتى يُلغى DATABASE_URL عند التعليق)
dotenv.config({ override: true });

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

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Blood Connect API is running',
        timestamp: new Date().toISOString()
    });
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
    try {
        getJwtSecret();
    } catch (e) {
        console.error('فشل التحقق من JWT_SECRET:', e.message);
        process.exit(1);
    }
    try {
        await initDataLayer();
    } catch (e) {
        console.error('فشل تهيئة قاعدة البيانات:', e.message || e);
        if (process.env.DATABASE_URL && String(e.message || '').toLowerCase().includes('ssl')) {
            console.error('تلميح: جرّب إضافة PGSSLMODE=require في متغيرات البيئة على Render.');
        }
        process.exit(1);
    }
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Blood Connect API server running on port ${PORT} (جميع الواجهات — للوصول من الهاتف على نفس الشبكة استخدم IP جهازك)`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
        console.log(`📱 Twilio configured: ${process.env.TWILIO_ACCOUNT_SID ? 'Yes' : 'No'}`);
        console.log(`🗄️ Storage: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'JSON file'}`);
        console.log(`🔔 Web Push: ${process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? 'configured' : 'not configured (set VAPID_* in .env)'}`);
    });
}

start();
