/**
 * سر توقيع JWT — يُقرأ من process.env فقط (السيرفر).
 * لا يُضاف أبداً في ملفات الواجهة (app.js / HTML).
 */

const MIN_LEN = 32;

function getJwtSecret() {
    const raw = process.env.JWT_SECRET;
    const secret = typeof raw === 'string' ? raw.trim() : '';
    const isProd = process.env.NODE_ENV === 'production';

    if (secret.length >= MIN_LEN) {
        return secret;
    }

    if (isProd) {
        throw new Error(
            `JWT_SECRET مطلوب في الإنتاج وبطول ${MIN_LEN} حرفاً على الأقل. ضبطه في متغيرات البيئة على الاستضافة.`
        );
    }

    if (secret.length > 0) {
        console.warn(
            `⚠️  JWT_SECRET قصير (أقل من ${MIN_LEN}). استخدم قيمة عشوائية أطول في .env`
        );
        return secret;
    }

    const devFallback = 'dev-insecure-only-not-for-production';
    console.warn(
        '⚠️  JWT_SECRET غير مضبوط — استخدم قيمة عشوائية طويلة في .env (لن يُقبل هذا الافتراض في NODE_ENV=production)'
    );
    return devFallback;
}

module.exports = { getJwtSecret, JWT_SECRET_MIN_LENGTH: MIN_LEN };
