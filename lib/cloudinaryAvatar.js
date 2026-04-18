/**
 * تخزين صور الملف الشخصي على Cloudinary (مجاني ضمن الحصة) — دائم حتى بعد إعادة نشر Render.
 * أضف CLOUDINARY_URL من لوحة Cloudinary → Dashboard → API Keys (نسخ كامل السطر).
 */
const cloudinary = require('cloudinary').v2;

const FOLDER = process.env.CLOUDINARY_AVATAR_FOLDER || 'inqadh-hayah/avatars';

function isEnabled() {
    if (process.env.CLOUDINARY_URL) return true;
    return !!(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    );
}

function configure() {
    if (!isEnabled()) return;
    /** يقرأ الـ SDK قيمة CLOUDINARY_URL من process.env تلقائياً */
    if (process.env.CLOUDINARY_URL) {
        cloudinary.config({ secure: true });
    } else {
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET,
            secure: true
        });
    }
}

function safePublicId(userId) {
    return String(userId).replace(/[^a-zA-Z0-9_-]/g, '') || 'user';
}

/**
 * @returns {Promise<string>} رابط https دائم (secure_url)
 */
async function uploadBuffer(buffer, mimetype, userId) {
    configure();
    const dataUri = `data:${mimetype};base64,${buffer.toString('base64')}`;
    const pid = safePublicId(userId);
    const result = await cloudinary.uploader.upload(dataUri, {
        folder: FOLDER,
        public_id: pid,
        overwrite: true,
        resource_type: 'image',
        invalidate: true
    });
    return result.secure_url;
}

/** حذف الصورة من السحابة عند حذف الحساب (أو استبدال) */
async function destroyByUserId(userId) {
    if (!isEnabled()) return;
    configure();
    const pid = `${FOLDER}/${safePublicId(userId)}`;
    try {
        await cloudinary.uploader.destroy(pid, { resource_type: 'image', invalidate: true });
    } catch (_) {
        /* قد لا تكون موجودة */
    }
}

module.exports = {
    isEnabled,
    configure,
    uploadBuffer,
    destroyByUserId,
    FOLDER
};
