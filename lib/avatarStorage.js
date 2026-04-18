const fs = require('fs');
const path = require('path');

const AVATAR_DIR = path.join(__dirname, '..', 'uploads', 'avatars');
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function extFromMime(mimetype) {
    if (mimetype === 'image/jpeg') return '.jpg';
    if (mimetype === 'image/png') return '.png';
    if (mimetype === 'image/webp') return '.webp';
    return '.jpg';
}

function ensureAvatarDir() {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

/** يحذف أي ملف صورة سابق لهذا المستخدم (نفس المعرف بأي امتداد) — عند حذف الحساب */
async function removeStoredAvatarFiles(userId) {
    const base = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!base) return;
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
        const p = path.join(AVATAR_DIR, base + ext);
        try {
            await fs.promises.unlink(p);
        } catch (_) {
            /* لا يوجد ملف */
        }
    }
}

/** بعد رفع ملف جديد: يحذف امتدادات قديمة أخرى فقط ويُبقي الملف الحالي */
async function removeOtherAvatarFiles(userId, keepFilename) {
    const base = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!base || !keepFilename) return;
    const keep = path.basename(String(keepFilename));
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
        const fn = base + ext;
        if (fn === keep) continue;
        try {
            await fs.promises.unlink(path.join(AVATAR_DIR, fn));
        } catch (_) {
            /* */
        }
    }
}

function publicAvatarPath(filename) {
    return `/uploads/avatars/${filename}`;
}

/** حفظ من ذاكرة (multer.memoryStorage) للتطوير المحلي عندما لا يُضبط Cloudinary */
async function saveBufferToDisk(userId, buffer, mimetype) {
    ensureAvatarDir();
    const base = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
    const ext = extFromMime(mimetype);
    const filename = base + ext;
    const dest = path.join(AVATAR_DIR, filename);
    await fs.promises.writeFile(dest, buffer);
    return { filename, publicPath: publicAvatarPath(filename) };
}

module.exports = {
    AVATAR_DIR,
    MAX_BYTES,
    ALLOWED_MIMES,
    extFromMime,
    ensureAvatarDir,
    removeStoredAvatarFiles,
    removeOtherAvatarFiles,
    publicAvatarPath,
    saveBufferToDisk
};
