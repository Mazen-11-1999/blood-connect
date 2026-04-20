const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { body, validationResult } = require('express-validator');
const dataAccess = require('../lib/dataAccess');
const avatarStorage = require('../lib/avatarStorage');
const cloudinaryAvatar = require('../lib/cloudinaryAvatar');
const { getJwtSecret } = require('../lib/jwtSecret');
const { authenticateToken } = require('../middleware/auth');

const uploadAvatar = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: avatarStorage.MAX_BYTES },
    fileFilter: (req, file, cb) => {
        if (avatarStorage.ALLOWED_MIMES.has(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('نوع الملف غير مدعوم. استخدم JPEG أو PNG أو WebP'));
        }
    }
});

function normalizePhone(raw) {
    const input = String(raw || '').trim();
    if (!input) return '';

    // إزالة أي محارف غير رقمية مع الإبقاء على + في البداية إن وُجد.
    let s = input.replace(/[^\d+]/g, '');
    if (s.startsWith('00')) s = `+${s.slice(2)}`;

    // استخراج الأرقام فقط لبقية حالات التطبيع.
    const digits = s.replace(/\D/g, '');
    if (!digits) return '';

    // تطبيع شائع لليمن: 7XXXXXXXX -> +9677XXXXXXXX أو 0XXXXXXXXX -> +967XXXXXXXXX
    if (digits.startsWith('967')) return `+${digits}`;
    if (digits.startsWith('0')) return `+967${digits.slice(1)}`;
    if (digits.startsWith('7') && digits.length === 9) return `+967${digits}`;

    // احتياطي عام: رقم دولي مع +
    return `+${digits}`;
}

function publicUser(user) {
    return {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        bloodType: user.bloodType,
        age: user.age,
        governorate: user.governorate,
        region: user.region,
        phone: user.phone,
        showPhone: user.showPhone,
        hasHealthCondition: user.hasHealthCondition,
        healthConditions: user.healthConditions,
        healthNotes: user.healthNotes,
        isAvailable: user.isAvailable !== false,
        lastDonation: user.lastDonation || null,
        avatarUrl: user.avatarUrl || null,
        createdAt: user.createdAt
    };
}

/** عرض صورة الملف الشخصي المخزّنة في PostgreSQL — عام (لقوائم المتبرعين والواجهة) */
router.get('/avatar/:userId', async (req, res) => {
    try {
        const uid = req.params.userId != null ? String(req.params.userId) : '';
        if (!uid || uid.length > 96) {
            return res.status(400).end();
        }
        const blob = await dataAccess.getAvatarBlobByUserId(uid);
        if (!blob) {
            return res.status(404).end();
        }
        res.setHeader('Content-Type', blob.mime);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(blob.buffer);
    } catch (err) {
        console.error('Avatar serve error:', err);
        res.status(500).end();
    }
});

router.post('/register', [
    body('fullName').notEmpty().withMessage('Full name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('bloodType').notEmpty().withMessage('Blood type is required'),
    body('governorate').notEmpty().withMessage('Governorate is required'),
    body('region').notEmpty().withMessage('Region is required'),
    body('age').optional().isInt({ min: 18, max: 80 }),
    body('avatarUrl').optional({ checkFalsy: true }).isURL().withMessage('رابط الصورة غير صالح')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const {
            fullName, email, password, bloodType, governorate, region,
            phone, showPhone, age,
            hasHealthCondition, healthConditions, healthNotes,
            avatarUrl
        } = req.body;

        const existing = await dataAccess.findUserByEmail(email);
        if (existing) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const normalizedPhone = normalizePhone(phone);
        if (normalizedPhone) {
            const users = await dataAccess.findAllUsers();
            const phoneTaken = users.some(u => normalizePhone(u.phone) === normalizedPhone);
            if (phoneTaken) {
                return res.status(400).json({ error: 'رقم الهاتف مستخدم بالفعل بحساب آخر' });
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = {
            id: Date.now().toString(),
            fullName,
            email,
            password: hashedPassword,
            bloodType,
            governorate,
            region,
            phone: normalizedPhone,
            showPhone: !!showPhone,
            age: age != null ? parseInt(age, 10) : null,
            hasHealthCondition: !!hasHealthCondition,
            healthConditions: Array.isArray(healthConditions) ? healthConditions : [],
            healthNotes: healthNotes || null,
            isAvailable: true,
            lastDonation: null,
            avatarUrl: typeof avatarUrl === 'string' && avatarUrl.trim() ? avatarUrl.trim() : null,
            createdAt: new Date().toISOString()
        };

        await dataAccess.createUser(newUser);

        const token = jwt.sign(
            { userId: newUser.id, email: newUser.email },
            getJwtSecret(),
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: publicUser(newUser)
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

router.post('/login', [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;
        const user = await dataAccess.findUserByEmail(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email },
            getJwtSecret(),
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: publicUser(user)
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const user = await dataAccess.findUserById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(publicUser(user));
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: 'Failed to load profile' });
    }
});

router.put('/profile', authenticateToken, [
    body('fullName').optional().notEmpty(),
    body('bloodType').optional().notEmpty(),
    body('governorate').optional().notEmpty(),
    body('region').optional().notEmpty(),
    body('avatarUrl').optional({ checkFalsy: true }).isURL().withMessage('رابط الصورة غير صالح')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const user = await dataAccess.findUserById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const allowed = [
            'fullName', 'bloodType', 'governorate', 'region', 'phone', 'showPhone',
            'age', 'hasHealthCondition', 'healthConditions', 'healthNotes', 'isAvailable', 'lastDonation',
            'avatarUrl'
        ];
        const updates = {};
        allowed.forEach(key => {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        });

        if (updates.phone !== undefined) {
            const normalizedPhone = normalizePhone(updates.phone);
            updates.phone = normalizedPhone;
            if (normalizedPhone) {
                const users = await dataAccess.findAllUsers();
                const phoneTaken = users.some(
                    u => u.id !== req.userId && normalizePhone(u.phone) === normalizedPhone
                );
                if (phoneTaken) {
                    return res.status(400).json({ error: 'رقم الهاتف مستخدم بالفعل بحساب آخر' });
                }
            }
        }

        const updated = await dataAccess.updateUser(req.userId, updates);
        res.json({
            message: 'Profile updated successfully',
            user: publicUser(updated)
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Profile update failed' });
    }
});

/** رفع صورة العرض — Cloudinary إن وُجد، أو PostgreSQL BYTEA عند DATABASE_URL، وإلا مجلد uploads محلياً */
router.post(
    '/profile/avatar',
    authenticateToken,
    (req, res, next) => {
        uploadAvatar.single('avatar')(req, res, (err) => {
            if (err) {
                if (err instanceof multer.MulterError) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return res.status(400).json({ error: 'حجم الصورة يتجاوز ٢ ميجابايت' });
                    }
                    return res.status(400).json({ error: 'فشل استقبال الملف' });
                }
                return res.status(400).json({ error: err.message || 'فشل رفع الصورة' });
            }
            next();
        });
    },
    async (req, res) => {
        let localFilePath = null;
        try {
            if (!req.file || !req.file.buffer) {
                return res.status(400).json({ error: 'يرجى اختيار ملف صورة' });
            }

            if (cloudinaryAvatar.isEnabled()) {
                const secureUrl = await cloudinaryAvatar.uploadBuffer(
                    req.file.buffer,
                    req.file.mimetype,
                    req.userId
                );
                const updated = await dataAccess.updateUser(req.userId, { avatarUrl: secureUrl });
                if (!updated) {
                    await cloudinaryAvatar.destroyByUserId(req.userId);
                    return res.status(404).json({ error: 'User not found' });
                }
                await avatarStorage.removeStoredAvatarFiles(req.userId);
                return res.json({
                    message: 'تم حفظ الصورة بنجاح (تخزين سحابي دائم)',
                    user: publicUser(updated)
                });
            }

            if (dataAccess.usePostgres()) {
                const updated = await dataAccess.setUserAvatarBlob(
                    req.userId,
                    req.file.buffer,
                    req.file.mimetype
                );
                if (!updated) {
                    return res.status(404).json({ error: 'User not found' });
                }
                await avatarStorage.removeStoredAvatarFiles(req.userId);
                return res.json({
                    message: 'تم حفظ الصورة في قاعدة البيانات (تخزين دائم)',
                    user: publicUser(updated)
                });
            }

            const { filename, publicPath } = await avatarStorage.saveBufferToDisk(
                req.userId,
                req.file.buffer,
                req.file.mimetype
            );
            localFilePath = path.join(avatarStorage.AVATAR_DIR, filename);

            const updated = await dataAccess.updateUser(req.userId, { avatarUrl: publicPath });
            if (!updated) {
                await fs.unlink(localFilePath).catch(() => {});
                return res.status(404).json({ error: 'User not found' });
            }
            await avatarStorage.removeOtherAvatarFiles(req.userId, filename);
            res.json({
                message: 'تم حفظ الصورة بنجاح',
                user: publicUser(updated)
            });
        } catch (error) {
            console.error('Avatar upload error:', error);
            if (localFilePath) {
                await fs.unlink(localFilePath).catch(() => {});
            }
            if (cloudinaryAvatar.isEnabled()) {
                await cloudinaryAvatar.destroyByUserId(req.userId).catch(() => {});
            }
            res.status(500).json({ error: 'تعذر حفظ الصورة. حاول مرة أخرى.' });
        }
    }
);

router.delete('/account', authenticateToken, async (req, res) => {
    try {
        const user = await dataAccess.findUserById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const av = user.avatarUrl ? String(user.avatarUrl) : '';
        if (av.includes('res.cloudinary.com') || cloudinaryAvatar.isEnabled()) {
            await cloudinaryAvatar.destroyByUserId(req.userId);
        }
        await avatarStorage.removeStoredAvatarFiles(req.userId);
        await dataAccess.deleteUser(req.userId);
        res.json({ message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ error: 'Failed to delete account' });
    }
});

module.exports = router;
