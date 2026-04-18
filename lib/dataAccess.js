const store = require('./store');

const usePg = () => !!process.env.DATABASE_URL;

/** لا يتضمّن avatar_data (ثقيل) — فقط علم وجود صورة مخزّنة في القاعدة */
const PG_USER_SELECT = `
  SELECT id, email, password, full_name, blood_type, governorate, region, phone, show_phone, age,
    has_health_condition, health_conditions, health_notes, is_available, last_donation,
    avatar_url, created_at,
    (avatar_data IS NOT NULL AND octet_length(avatar_data) > 0) AS has_avatar_blob
  FROM users
`;

function rowToUser(row) {
    if (!row) return null;
    let avatarUrl = row.avatar_url || null;
    if (row.has_avatar_blob) {
        avatarUrl = `/api/auth/avatar/${row.id}`;
    }
    return {
        id: row.id,
        email: row.email,
        password: row.password,
        fullName: row.full_name,
        bloodType: row.blood_type,
        governorate: row.governorate,
        region: row.region,
        phone: row.phone || '',
        showPhone: row.show_phone,
        age: row.age,
        hasHealthCondition: row.has_health_condition,
        healthConditions: Array.isArray(row.health_conditions)
            ? row.health_conditions
            : (typeof row.health_conditions === 'string' ? JSON.parse(row.health_conditions) : []),
        healthNotes: row.health_notes,
        isAvailable: row.is_available,
        lastDonation: row.last_donation,
        avatarUrl,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
    };
}

function rowToMessage(row) {
    if (!row) return null;
    return {
        id: row.id,
        senderId: row.sender_id,
        recipientId: row.recipient_id,
        senderName: row.sender_name,
        recipientName: row.recipient_name,
        content: row.content,
        senderPhone: row.sender_phone || '',
        urgency: row.urgency,
        neededDateTime: row.needed_datetime
            ? (row.needed_datetime instanceof Date ? row.needed_datetime.toISOString() : row.needed_datetime)
            : null,
        read: row.read,
        needyConfirmedAt: row.needy_confirmed_at
            ? (row.needy_confirmed_at instanceof Date ? row.needy_confirmed_at.toISOString() : row.needy_confirmed_at)
            : null,
        donorConfirmedAt: row.donor_confirmed_at
            ? (row.donor_confirmed_at instanceof Date ? row.donor_confirmed_at.toISOString() : row.donor_confirmed_at)
            : null,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
    };
}

async function initDataLayer() {
    if (usePg()) {
        const { initSchema } = require('./pg');
        await initSchema();
        console.log('✅ PostgreSQL: الجداول جاهزة');
    } else {
        console.log('📁 التخزين: ملف JSON (data/app-data.json). للإنتاج اضبط DATABASE_URL لاستخدام PostgreSQL');
    }
}

async function findAllUsers() {
    if (!usePg()) {
        return store.load().users;
    }
    const { getPool } = require('./pg');
    const { rows } = await getPool().query(`${PG_USER_SELECT} ORDER BY created_at DESC`);
    return rows.map(rowToUser);
}

async function findUserById(id) {
    if (!usePg()) {
        return store.load().users.find(u => u.id === id) || null;
    }
    const { getPool } = require('./pg');
    const { rows } = await getPool().query(`${PG_USER_SELECT} WHERE id = $1`, [id]);
    return rows[0] ? rowToUser(rows[0]) : null;
}

async function findUserByEmail(email) {
    if (!usePg()) {
        return store.load().users.find(u => u.email === email) || null;
    }
    const { getPool } = require('./pg');
    const { rows } = await getPool().query(`${PG_USER_SELECT} WHERE email = $1`, [email]);
    return rows[0] ? rowToUser(rows[0]) : null;
}

async function createUser(user) {
    if (!usePg()) {
        const data = store.load();
        data.users.push(user);
        store.save(data);
        return user;
    }
    const { getPool } = require('./pg');
    const hc = JSON.stringify(user.healthConditions || []);
    await getPool().query(
        `INSERT INTO users (id, email, password, full_name, blood_type, governorate, region, phone, show_phone, age, has_health_condition, health_conditions, health_notes, is_available, last_donation, avatar_url, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17)`,
        [
            user.id,
            user.email,
            user.password,
            user.fullName,
            user.bloodType,
            user.governorate,
            user.region,
            user.phone || '',
            !!user.showPhone,
            user.age,
            !!user.hasHealthCondition,
            hc,
            user.healthNotes || null,
            user.isAvailable !== false,
            user.lastDonation || null,
            user.avatarUrl || null,
            user.createdAt || new Date().toISOString()
        ]
    );
    return user;
}

async function updateUser(id, updates) {
    if (!usePg()) {
        const data = store.load();
        const i = data.users.findIndex(u => u.id === id);
        if (i === -1) return null;
        data.users[i] = { ...data.users[i], ...updates };
        store.save(data);
        return data.users[i];
    }
    const keys = Object.keys(updates);
    if (keys.length === 0) return findUserById(id);
    const map = {
        fullName: 'full_name',
        bloodType: 'blood_type',
        governorate: 'governorate',
        region: 'region',
        phone: 'phone',
        showPhone: 'show_phone',
        age: 'age',
        hasHealthCondition: 'has_health_condition',
        healthConditions: 'health_conditions',
        healthNotes: 'health_notes',
        isAvailable: 'is_available',
        lastDonation: 'last_donation',
        avatarUrl: 'avatar_url',
        email: 'email',
        password: 'password'
    };
    const sets = [];
    const vals = [];
    let n = 1;
    keys.forEach(k => {
        const col = map[k];
        if (!col) return;
        if (k === 'healthConditions') {
            sets.push(`health_conditions = $${n}::jsonb`);
            vals.push(JSON.stringify(updates[k]));
            n++;
        } else if (k === 'avatarUrl') {
            sets.push(`avatar_url = $${n}`);
            vals.push(updates[k]);
            n++;
            const av = updates[k];
            if (av === null || av === '' || (typeof av === 'string' && /^https?:\/\//i.test(av))) {
                sets.push('avatar_data = NULL');
                sets.push('avatar_mime = NULL');
            }
        } else {
            sets.push(`${col} = $${n}`);
            vals.push(updates[k]);
            n++;
        }
    });
    if (sets.length === 0) return findUserById(id);
    vals.push(id);
    const { getPool } = require('./pg');
    await getPool().query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}`,
        vals
    );
    return findUserById(id);
}

/** تخزين صورة الملف الشخصي داخل PostgreSQL (دائم على Render دون خدمة خارجية) */
async function setUserAvatarBlob(userId, buffer, mime) {
    if (!usePg()) {
        throw new Error('setUserAvatarBlob requires DATABASE_URL');
    }
    const { getPool } = require('./pg');
    const publicPath = `/api/auth/avatar/${userId}`;
    await getPool().query(
        `UPDATE users SET avatar_data = $1, avatar_mime = $2, avatar_url = $3 WHERE id = $4`,
        [buffer, mime, publicPath, userId]
    );
    return findUserById(userId);
}

async function getAvatarBlobByUserId(userId) {
    if (!usePg()) return null;
    const { getPool } = require('./pg');
    const { rows } = await getPool().query(
        'SELECT avatar_data, avatar_mime FROM users WHERE id = $1',
        [userId]
    );
    if (!rows[0] || !rows[0].avatar_data) return null;
    const buf = rows[0].avatar_data;
    const len = Buffer.isBuffer(buf) ? buf.length : (buf ? buf.length : 0);
    if (!len) return null;
    return {
        buffer: Buffer.isBuffer(buf) ? buf : Buffer.from(buf),
        mime: rows[0].avatar_mime || 'image/jpeg'
    };
}

async function deleteUser(id) {
    if (!usePg()) {
        const data = store.load();
        data.users = data.users.filter(u => u.id !== id);
        data.messages = data.messages.filter(
            m => m.senderId !== id && m.recipientId !== id
        );
        store.save(data);
        return true;
    }
    const { getPool } = require('./pg');
    await getPool().query('DELETE FROM users WHERE id = $1', [id]);
    return true;
}

async function findAllMessages() {
    if (!usePg()) {
        return store.load().messages;
    }
    const { getPool } = require('./pg');
    const { rows } = await getPool().query('SELECT * FROM messages ORDER BY created_at DESC');
    return rows.map(rowToMessage);
}

async function findMessageById(id) {
    if (!usePg()) {
        return store.load().messages.find(m => m.id === id) || null;
    }
    const { getPool } = require('./pg');
    const { rows } = await getPool().query('SELECT * FROM messages WHERE id = $1', [id]);
    return rows[0] ? rowToMessage(rows[0]) : null;
}

async function findMessagesForUser(userId, { type = 'all', read } = {}) {
    const all = await findAllMessages();
    let list = all.filter(m => m.senderId === userId || m.recipientId === userId);
    if (type === 'sent') list = list.filter(m => m.senderId === userId);
    else if (type === 'received') list = list.filter(m => m.recipientId === userId);
    if (read !== undefined) {
        const want = read === 'true' || read === true;
        list = list.filter(m => m.read === want);
    }
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return list;
}

async function createMessage(msg) {
    if (!usePg()) {
        const data = store.load();
        data.messages.push(msg);
        store.save(data);
        return msg;
    }
    const { getPool } = require('./pg');
    await getPool().query(
        `INSERT INTO messages (id, sender_id, recipient_id, sender_name, recipient_name, content, sender_phone, urgency, needed_datetime, read, needy_confirmed_at, donor_confirmed_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
            msg.id,
            msg.senderId,
            msg.recipientId,
            msg.senderName,
            msg.recipientName,
            msg.content,
            msg.senderPhone || '',
            msg.urgency || 'normal',
            msg.neededDateTime || null,
            !!msg.read,
            msg.needyConfirmedAt || null,
            msg.donorConfirmedAt || null,
            msg.createdAt || new Date().toISOString()
        ]
    );
    return msg;
}

async function updateMessage(id, partial) {
    if (!usePg()) {
        const data = store.load();
        const i = data.messages.findIndex(m => m.id === id);
        if (i === -1) return null;
        data.messages[i] = { ...data.messages[i], ...partial };
        store.save(data);
        return data.messages[i];
    }
    const map = {
        read: 'read',
        needyConfirmedAt: 'needy_confirmed_at',
        donorConfirmedAt: 'donor_confirmed_at'
    };
    const keys = Object.keys(partial).filter(k => map[k]);
    if (keys.length === 0) return findMessageById(id);
    const sets = [];
    const vals = [];
    let n = 1;
    keys.forEach(k => {
        sets.push(`${map[k]} = $${n}`);
        vals.push(partial[k]);
        n++;
    });
    vals.push(id);
    const { getPool } = require('./pg');
    await getPool().query(`UPDATE messages SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    return findMessageById(id);
}

async function deleteMessage(id) {
    if (!usePg()) {
        const data = store.load();
        const i = data.messages.findIndex(m => m.id === id);
        if (i === -1) return false;
        data.messages.splice(i, 1);
        store.save(data);
        return true;
    }
    const { getPool } = require('./pg');
    const r = await getPool().query('DELETE FROM messages WHERE id = $1', [id]);
    return r.rowCount > 0;
}

function startOfCalendarMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

/** بداية الأسبوع الحالي (الإثنين 00:00) بنفس منطقة زمن الخادم */
function startOfIsoWeekMonday(d) {
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
}

/**
 * عدد المتبرعين المسجّلين خلال الشهر الحالي والأسبوع الحالي (حسب created_at).
 * يعمل مع PostgreSQL ومع ملف JSON.
 */
async function getDonorRegistrationCounts() {
    const users = await findAllUsers();
    const now = new Date();
    const monthStart = startOfCalendarMonth(now);
    const weekStart = startOfIsoWeekMonday(now);
    let thisMonth = 0;
    let thisWeek = 0;
    for (const u of users) {
        const c = u.createdAt ? new Date(u.createdAt) : null;
        if (!c || Number.isNaN(c.getTime())) continue;
        if (c >= monthStart) thisMonth += 1;
        if (c >= weekStart) thisWeek += 1;
    }
    return { thisMonth, thisWeek };
}

async function upsertPushSubscription(userId, subscription) {
    const endpoint = subscription.endpoint;
    const p256dh = subscription.keys && subscription.keys.p256dh;
    const auth = subscription.keys && subscription.keys.auth;
    if (!endpoint || !p256dh || !auth) {
        throw new Error('Invalid push subscription');
    }
    if (!usePg()) {
        const data = store.load();
        if (!data.pushSubscriptions) data.pushSubscriptions = [];
        const row = {
            userId,
            endpoint,
            p256dh,
            auth,
            createdAt: new Date().toISOString()
        };
        const i = data.pushSubscriptions.findIndex(s => s.endpoint === endpoint);
        if (i >= 0) data.pushSubscriptions[i] = row;
        else data.pushSubscriptions.push(row);
        store.save(data);
        return;
    }
    const { getPool } = require('./pg');
    await getPool().query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (endpoint) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth`,
        [userId, endpoint, p256dh, auth]
    );
}

async function findPushSubscriptionsForUser(userId) {
    if (!usePg()) {
        const data = store.load();
        const list = data.pushSubscriptions || [];
        return list.filter(s => s.userId === userId);
    }
    const { getPool } = require('./pg');
    const { rows } = await getPool().query(
        'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
        [userId]
    );
    return rows;
}

async function deletePushSubscriptionByEndpoint(endpoint) {
    if (!usePg()) {
        const data = store.load();
        if (!data.pushSubscriptions) return;
        data.pushSubscriptions = data.pushSubscriptions.filter(s => s.endpoint !== endpoint);
        store.save(data);
        return;
    }
    const { getPool } = require('./pg');
    await getPool().query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

async function deletePushSubscriptionForUser(userId, endpoint) {
    if (!usePg()) {
        const data = store.load();
        if (!data.pushSubscriptions) return;
        data.pushSubscriptions = data.pushSubscriptions.filter(
            s => !(s.userId === userId && s.endpoint === endpoint)
        );
        store.save(data);
        return;
    }
    const { getPool } = require('./pg');
    await getPool().query(
        'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
        [userId, endpoint]
    );
}

async function bulkMarkRead(ids) {
    if (!ids.length) return 0;
    if (!usePg()) {
        const data = store.load();
        let c = 0;
        ids.forEach(id => {
            const m = data.messages.find(x => x.id === id);
            if (m) {
                m.read = true;
                c++;
            }
        });
        store.save(data);
        return c;
    }
    const { getPool } = require('./pg');
    const r = await getPool().query(
        `UPDATE messages SET read = true WHERE id = ANY($1::varchar[])`,
        [ids]
    );
    return r.rowCount;
}

module.exports = {
    initDataLayer,
    usePostgres: usePg,
    findAllUsers,
    findUserById,
    findUserByEmail,
    createUser,
    updateUser,
    setUserAvatarBlob,
    getAvatarBlobByUserId,
    deleteUser,
    findAllMessages,
    findMessageById,
    findMessagesForUser,
    createMessage,
    updateMessage,
    deleteMessage,
    bulkMarkRead,
    rowToUser,
    rowToMessage,
    getDonorRegistrationCounts,
    upsertPushSubscription,
    findPushSubscriptionsForUser,
    deletePushSubscriptionByEndpoint,
    deletePushSubscriptionForUser
};
