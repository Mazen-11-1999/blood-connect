const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const dataAccess = require('../lib/dataAccess');
const { getJwtSecret } = require('../lib/jwtSecret');
const { authenticateToken } = require('../middleware/auth');

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
        createdAt: user.createdAt
    };
}

router.post('/register', [
    body('fullName').notEmpty().withMessage('Full name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('bloodType').notEmpty().withMessage('Blood type is required'),
    body('governorate').notEmpty().withMessage('Governorate is required'),
    body('region').notEmpty().withMessage('Region is required'),
    body('age').optional().isInt({ min: 18, max: 80 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const {
            fullName, email, password, bloodType, governorate, region,
            phone, showPhone, age,
            hasHealthCondition, healthConditions, healthNotes
        } = req.body;

        const existing = await dataAccess.findUserByEmail(email);
        if (existing) {
            return res.status(400).json({ error: 'User already exists' });
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
            phone: phone || '',
            showPhone: !!showPhone,
            age: age != null ? parseInt(age, 10) : null,
            hasHealthCondition: !!hasHealthCondition,
            healthConditions: Array.isArray(healthConditions) ? healthConditions : [],
            healthNotes: healthNotes || null,
            isAvailable: true,
            lastDonation: null,
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
    body('region').optional().notEmpty()
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
            'age', 'hasHealthCondition', 'healthConditions', 'healthNotes', 'isAvailable', 'lastDonation'
        ];
        const updates = {};
        allowed.forEach(key => {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        });

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

router.delete('/account', authenticateToken, async (req, res) => {
    try {
        const user = await dataAccess.findUserById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        await dataAccess.deleteUser(req.userId);
        res.json({ message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ error: 'Failed to delete account' });
    }
});

module.exports = router;
