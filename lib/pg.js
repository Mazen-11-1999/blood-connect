const { Pool } = require('pg');

let pool;

/** استخراج المضيف من رابط postgres — لتحديد محلي مقابل سحابي */
function pgHostFromUrl(databaseUrl) {
    try {
        const u = new URL(String(databaseUrl).replace(/^postgres(ql)?:\/\//i, 'http://'));
        return (u.hostname || '').toLowerCase();
    } catch {
        return '';
    }
}

/**
 * SSL لـ PostgreSQL السحابي: كثير من المزودين يقطعون الاتصال فوراً بدون TLS صحيح.
 * PGSSLMODE=disable يعطّل SSL صراحة (تطوير محلي فقط).
 */
function resolveSsl(databaseUrl) {
    const url = String(databaseUrl || '');
    if (process.env.PGSSLMODE === 'disable' || /sslmode=disable/i.test(url)) {
        return false;
    }
    if (process.env.PGSSLMODE === 'require' || /sslmode=require/i.test(url)) {
        return { rejectUnauthorized: false };
    }
    const host = pgHostFromUrl(url);
    const isLocal =
        !host ||
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host.endsWith('.local');
    if (isLocal) {
        return false;
    }
    // أي مضيف بعيد: TLS (Render وغيره؛ يقلّل Connection terminated unexpectedly)
    return { rejectUnauthorized: false };
}

async function resetPool() {
    if (pool) {
        await pool.end().catch(() => {});
        pool = null;
    }
}

function getPool() {
    if (!pool) {
        if (!process.env.DATABASE_URL) {
            throw new Error('DATABASE_URL is not set');
        }
        const ssl = resolveSsl(process.env.DATABASE_URL);
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: Math.min(Number(process.env.PG_POOL_MAX || 10), 20),
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 60000),
            ssl,
            keepAlive: true
        });
    }
    return pool;
}

async function initSchema() {
    const p = getPool();
    await p.query(`
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(64) PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            full_name VARCHAR(255) NOT NULL,
            blood_type VARCHAR(8) NOT NULL,
            governorate VARCHAR(512) NOT NULL,
            region VARCHAR(512) NOT NULL,
            phone VARCHAR(128) DEFAULT '',
            show_phone BOOLEAN DEFAULT false,
            age INTEGER,
            has_health_condition BOOLEAN DEFAULT false,
            health_conditions JSONB DEFAULT '[]'::jsonb,
            health_notes TEXT,
            is_available BOOLEAN DEFAULT true,
            last_donation VARCHAR(64),
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    await p.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id VARCHAR(64) PRIMARY KEY,
            sender_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            recipient_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            sender_name VARCHAR(255) NOT NULL,
            recipient_name VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            sender_phone VARCHAR(128) DEFAULT '',
            urgency VARCHAR(16) DEFAULT 'normal',
            needed_datetime TIMESTAMPTZ,
            read BOOLEAN DEFAULT false,
            needy_confirmed_at TIMESTAMPTZ,
            donor_confirmed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id);`);
    await p.query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);`);
    await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`);
    await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data BYTEA;`);
    await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime VARCHAR(128);`);
}

module.exports = { getPool, initSchema, resetPool };
