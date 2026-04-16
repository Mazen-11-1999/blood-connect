/**
 * Web Push — إشعار المستلم حتى عند إغلاق التبويب (يتطلب بيانات/واي فاي؛ ليس بدون أي اتصال).
 */
const webpush = require('web-push');
const dataAccess = require('./dataAccess');

let vapidReady = false;

function ensureVapid() {
    if (vapidReady) return true;
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) return false;
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:support@localhost',
        pub,
        priv
    );
    vapidReady = true;
    return true;
}

function isConfigured() {
    return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * @param {object} message — بعد enrichMessage أو حقول content, senderName, recipientId, urgency, id
 */
async function notifyRecipientNewMessage(message) {
    if (!ensureVapid()) return;
    const recipientId = message.recipientId;
    if (!recipientId) return;

    const subs = await dataAccess.findPushSubscriptionsForUser(recipientId);
    if (!subs.length) return;

    const text = (message.content || message.message || '').trim();
    const urgent = message.urgency === 'urgent' || message.isUrgent;
    const title = urgent ? '🚨 طلب دم عاجل — إنقاذ حياة' : 'رسالة جديدة — إنقاذ حياة';
    const body = `${message.senderName || 'مستخدم'}: ${text.slice(0, 140)}${text.length > 140 ? '…' : ''}`;
    const payload = JSON.stringify({
        title,
        body,
        data: { messageId: message.id, openMessages: '1' }
    });

    for (const s of subs) {
        const sub = {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth }
        };
        try {
            await webpush.sendNotification(sub, payload, { TTL: 86_400 });
        } catch (err) {
            const code = err.statusCode;
            if (code === 404 || code === 410) {
                await dataAccess.deletePushSubscriptionByEndpoint(s.endpoint);
            } else {
                console.error('[web-push]', err.message || err);
            }
        }
    }
}

module.exports = {
    notifyRecipientNewMessage,
    isConfigured
};
