/**
 * إرسال SMS طارئ للمتبرع — يُستدعى من الخادم فقط (رقم حقيقي من DB حتى لو كان مخفياً في API).
 */
function twilioConfigured() {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}

function getTwilioClient() {
    if (!twilioConfigured()) return null;
    // eslint-disable-next-line global-require
    const twilio = require('twilio');
    return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

/** توحيد الرقم إلى E.164 (محاذاة لمنطق الواجهة لأرقام اليمن) */
function toE164(phone) {
    if (!phone || typeof phone !== 'string') return null;
    let cleaned = phone.replace(/\s+/g, '').replace(/[()-]/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = '+967' + cleaned.substring(1);
    }
    if (/^7\d{8}$/.test(cleaned)) {
        cleaned = '+967' + cleaned;
    }
    if (!cleaned.startsWith('+')) {
        if (cleaned.startsWith('967')) cleaned = '+' + cleaned;
        else cleaned = '+967' + cleaned;
    }
    return cleaned;
}

function buildUrgentBody({ recipientName, bloodType, urgency, location }) {
    return (
        `🆘 طلب دم عاجل جداً\n\n` +
        `المتبرع: ${recipientName}\n` +
        `فصيلة الدم: ${bloodType}\n` +
        `الموقع: ${location || 'غير محدد'}\n` +
        `الإلحاح: ${urgency || 'عاجل'}\n\n` +
        `يرجى فتح التطبيق للرد على الطلب\n\n` +
        `منصة إنقاذ حياة`
    );
}

/**
 * @returns {Promise<{ ok: boolean, sid?: string, mock?: boolean, reason?: string, code?: number, error?: string }>}
 */
async function sendUrgentBloodRequestSms({ to, recipientName, bloodType, urgency, location }) {
    const phone = toE164(String(to).trim());
    if (!phone) {
        return { ok: false, reason: 'invalid_phone' };
    }

    const body = buildUrgentBody({ recipientName, bloodType, urgency, location });
    const client = getTwilioClient();

    if (!client) {
        console.log('[urgent SMS mock] would send to', phone, body.substring(0, 60) + '…');
        return { ok: true, mock: true };
    }

    try {
        const smsResult = await client.messages.create({
            body,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
        });
        return { ok: true, sid: smsResult.sid };
    } catch (err) {
        console.error('[urgent SMS]', err.code || '', err.message || err);
        return {
            ok: false,
            error: err.message,
            code: err.code
        };
    }
}

module.exports = {
    sendUrgentBloodRequestSms,
    toE164,
    twilioConfigured
};
