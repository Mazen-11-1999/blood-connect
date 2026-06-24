const dns = require('dns');
const { Pool } = require('pg');

let pool;

/** استخراج المضيف من رابط postgres */
function pgHostFromUrl(databaseUrl) {
    try {
        const u = new URL(String(databaseUrl).replace(/^postgres(ql)?:\/\//i, 'http://'));
        return (u.hostname || '').toLowerCase();
    } catch {
        return '';
    }
}

/** مضيف Render الداخلي — يعمل فقط داخل شبكة Render وليس من جهازك */
function isRenderInternalHost(host) {
    const h = String(host || '').toLowerCase();
    return /^dpg-[a-z0-9]+-a$/i.test(h);
}

/**
 * اختيار رابط القاعدة:
 * - على Render: DATABASE_URL (Internal)
 * - محلياً: DATABASE_EXTERNAL_URL إن وُجد، وإلا DATABASE_URL
 */
function getDatabaseUrl() {
    const main = String(process.env.DATABASE_URL || '').trim();
    const external = String(process.env.DATABASE_EXTERNAL_URL || '').trim();

    if (process.env.RENDER) {
        return main || null;
    }

    if (external) {
        return external;
    }

    if (main && isRenderInternalHost(pgHostFromUrl(main))) {
        throw new Error(
            'DATABASE_URL يشير إلى مضيف Render الداخلي ولا يعمل من جهازك. ' +
                'من لوحة Render → Postgres → انسخ External Database URL وضعه في DATABASE_EXTERNAL_URL أو DATABASE_URL داخل .env'
        );
    }

    return main || null;
}

function isLocalHost(host) {
    const h = String(host || '').toLowerCase();
    return !h || h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local');
}

/** Render: المضيف القصير داخل الشبكة + اسم SNI الكامل للشهادة */
function resolveRenderEndpoints(hostname) {
    const h = String(hostname || '').toLowerCase();
    const external = h.match(/^(dpg-[a-z0-9]+-a)\.([a-z0-9-]+)\.render\.com$/i);
    if (external) {
        const shortHost = external[1];
        return {
            connectHost: process.env.RENDER ? shortHost : h,
            sslServername: hostname
        };
    }
    const internal = h.match(/^(dpg-[a-z0-9]+-a)$/i);
    if (internal && process.env.RENDER) {
        return { connectHost: internal[1], sslServername: hostname };
    }
    return { connectHost: h, sslServername: hostname };
}

/** تحليل الرابط إلى خيارات Pool — SSL عبر خيار pool فقط (بدون sslmode في الرابط) */
function buildPoolConfig(databaseUrl) {
    const raw = String(databaseUrl || '').trim();
    if (!raw) {
        throw new Error('DATABASE_URL is not set');
    }

    let parsed;
    try {
        parsed = new URL(raw.replace(/^postgres(ql)?:\/\//i, 'http://'));
    } catch {
        throw new Error('DATABASE_URL غير صالح');
    }

    const host = parsed.hostname;
    const { connectHost, sslServername } = resolveRenderEndpoints(host);
    const database = decodeURIComponent((parsed.pathname || '/postgres').replace(/^\//, '') || 'postgres');
    const user = decodeURIComponent(parsed.username || '');
    const password = decodeURIComponent(parsed.password || '');
    const port = parsed.port ? Number(parsed.port) : 5432;

    let ssl = false;
    if (!isLocalHost(host) && process.env.PGSSLMODE !== 'disable') {
        ssl = { rejectUnauthorized: false, servername: sslServername };
    }

    return {
        host: connectHost,
        port,
        database,
        user,
        password,
        ssl,
        _meta: { urlHost: host, connectHost, sslServername }
    };
}

function poolLookup(hostname, _options, callback) {
    dns.lookup(hostname, { family: 4 }, callback);
}

async function resetPool() {
    if (pool) {
        await pool.end().catch(() => {});
        pool = null;
    }
}

function getPool() {
    if (!pool) {
        const databaseUrl = getDatabaseUrl();
        if (!databaseUrl) {
            throw new Error('DATABASE_URL is not set');
        }

        const base = buildPoolConfig(databaseUrl);
        const useIpv4Lookup =
            process.env.PG_FORCE_IPV4 === '1' ||
            (!process.env.RENDER && /\.render\.com$/i.test(base._meta?.urlHost || ''));

        const { _meta, ...poolBase } = base;
        const poolOpts = {
            ...poolBase,
            max: Math.min(Number(process.env.PG_POOL_MAX || 10), 20),
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 60000),
            keepAlive: true
        };

        if (useIpv4Lookup) {
            poolOpts.lookup = poolLookup;
        }

        const where = process.env.RENDER ? 'Render' : 'local';
        const meta = _meta || {};
        console.log(
            `📦 PostgreSQL (${where}): connect=${poolBase.host} db=${poolBase.database} ssl=${!!poolBase.ssl} ipv4=${useIpv4Lookup}` +
                (meta.urlHost && meta.urlHost !== meta.connectHost ? ` (من ${meta.urlHost})` : '')
        );

        pool = new Pool(poolOpts);
    }
    return pool;
}

/** اختبار اتصال سريع — للتشخيص */
async function testConnection() {
    const databaseUrl = getDatabaseUrl();
    if (!databaseUrl) {
        throw new Error('لم يُضبط DATABASE_URL أو DATABASE_EXTERNAL_URL');
    }
    const cfg = buildPoolConfig(databaseUrl);
    const { _meta, ...poolBase } = cfg;
    const useIpv4Lookup =
        process.env.PG_FORCE_IPV4 === '1' ||
        (!process.env.RENDER && /\.render\.com$/i.test(_meta?.urlHost || ''));
    const testPool = new Pool({
        ...poolBase,
        max: 1,
        connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 30000),
        ...(useIpv4Lookup ? { lookup: poolLookup } : {})
    });
    try {
        const res = await testPool.query('SELECT 1 AS ok');
        return res.rows[0]?.ok === 1;
    } finally {
        await testPool.end().catch(() => {});
    }
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

module.exports = {
    getPool,
    initSchema,
    resetPool,
    testConnection,
    getDatabaseUrl,
    pgHostFromUrl
};
