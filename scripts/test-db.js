/**
 * اختبار اتصال PostgreSQL — شغّل: npm run db:test
 * يقرأ .env محلياً (نفس server.js)
 */
require('dotenv').config({ override: true });

const { testConnection, getDatabaseUrl, pgHostFromUrl } = require('../lib/pg');

async function main() {
    const url = getDatabaseUrl();
    if (!url) {
        console.error('❌ لم يُضبط DATABASE_URL. للتطوير بدون قاعدة: اترك السطر فارغاً في .env');
        process.exit(1);
    }
    const host = pgHostFromUrl(url);
    console.log(`🔌 جاري الاتصال بـ ${host}…`);
    try {
        const ok = await testConnection();
        if (ok) {
            console.log('✅ الاتصال بقاعدة البيانات ناجح');
            process.exit(0);
        }
        console.error('❌ فشل الاتصال');
        process.exit(1);
    } catch (e) {
        console.error('❌', e.message || e);
        if (String(e.message || '').includes('terminated') || String(e.message || '').includes('Internal')) {
            console.error('');
            console.error('تلميح: من جهازك استخدم External Database URL من Render في .env');
            console.error('  DATABASE_EXTERNAL_URL=postgresql://...');
        }
        process.exit(1);
    }
}

main();
