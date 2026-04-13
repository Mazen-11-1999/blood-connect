const { Pool } = require('pg');

let pool;

function getPool() {
    if (!pool) {
        if (!process.env.DATABASE_URL) {
            throw new Error('DATABASE_URL is not set');
        }
        const ssl =
            process.env.PGSSLMODE === 'require' || process.env.DATABASE_URL.includes('sslmode=require')
                ? { rejectUnauthorized: false }
                : false;
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: 15,
            idleTimeoutMillis: 30000,
            ssl
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
}

module.exports = { getPool, initSchema };
