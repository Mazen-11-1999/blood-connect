const express = require('express');
const router = express.Router();
const { body, validationResult, query } = require('express-validator');
const dataAccess = require('../lib/dataAccess');
const { authenticateToken } = require('../middleware/auth');

function userToPublicDonor(user) {
    return {
        id: user.id,
        fullName: user.fullName,
        bloodType: user.bloodType,
        age: user.age,
        governorate: user.governorate,
        region: user.region,
        phone: user.showPhone ? user.phone : 'الرقم مخفي - استخدم الرسائل للتواصل',
        showPhone: user.showPhone,
        isAvailable: user.isAvailable !== false,
        lastDonation: user.lastDonation || null
    };
}

router.get('/stats/summary', async (req, res) => {
    try {
        const donors = await dataAccess.findAllUsers();
        const messages = await dataAccess.findAllMessages();
        const totalDonors = donors.length;
        const availableDonors = donors.filter(d => d.isAvailable !== false).length;

        const bloodTypeStats = {};
        const governorateStats = {};
        donors.forEach(donor => {
            bloodTypeStats[donor.bloodType] = (bloodTypeStats[donor.bloodType] || 0) + 1;
            governorateStats[donor.governorate] = (governorateStats[donor.governorate] || 0) + 1;
        });

        const totalMessages = messages.length;
        const successfulMatches = messages.filter(
            m => m.needyConfirmedAt && m.donorConfirmedAt
        ).length;

        res.json({
            totalDonors,
            availableDonors,
            unavailableDonors: totalDonors - availableDonors,
            bloodTypeDistribution: bloodTypeStats,
            governorateDistribution: governorateStats,
            totalMessages,
            successfulMatches
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ error: 'Failed to fetch donor statistics' });
    }
});

router.get('/heroes/list', async (req, res) => {
    try {
        const users = await dataAccess.findAllUsers();
        const messages = await dataAccess.findAllMessages();
        const heroes = users.map(u => {
            const msgs = messages.filter(
                m => m.senderId === u.id || m.recipientId === u.id
            );
            const successfulMatches = messages.filter(
                m =>
                    m.recipientId === u.id &&
                    m.needyConfirmedAt &&
                    m.donorConfirmedAt
            ).length;
            return {
                id: u.id,
                fullName: u.fullName,
                bloodType: u.bloodType,
                governorate: u.governorate,
                region: u.region,
                totalMessages: msgs.length,
                successfulMatches
            };
        });
        heroes.sort((a, b) => b.successfulMatches - a.successfulMatches);
        res.json({ heroes });
    } catch (error) {
        console.error('Get heroes list error:', error);
        res.status(500).json({ error: 'Failed to fetch heroes' });
    }
});

router.get('/', [
    query('bloodType').optional().isIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
    query('governorate').optional(),
    query('region').optional(),
    query('isAvailable').optional(),
    query('age').optional()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        let filtered = await dataAccess.findAllUsers();

        if (req.query.bloodType) {
            filtered = filtered.filter(d => d.bloodType === req.query.bloodType);
        }
        if (req.query.governorate) {
            const g = req.query.governorate.toLowerCase();
            filtered = filtered.filter(d => d.governorate && d.governorate.toLowerCase().includes(g));
        }
        if (req.query.region) {
            const r = req.query.region.toLowerCase();
            filtered = filtered.filter(d => d.region && d.region.toLowerCase().includes(r));
        }
        if (req.query.isAvailable !== undefined) {
            const want = req.query.isAvailable === 'true';
            filtered = filtered.filter(d => (d.isAvailable !== false) === want);
        }
        if (req.query.age) {
            const wantAge = parseInt(req.query.age, 10);
            filtered = filtered.filter(d => d.age === wantAge);
        }

        const publicDonors = filtered.map(userToPublicDonor);

        res.json({
            donors: publicDonors,
            total: publicDonors.length,
            filters: req.query
        });
    } catch (error) {
        console.error('Get donors error:', error);
        res.status(500).json({ error: 'Failed to fetch donors' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const donor = await dataAccess.findUserById(req.params.id);
        if (!donor) {
            return res.status(404).json({ error: 'Donor not found' });
        }
        res.json(userToPublicDonor(donor));
    } catch (error) {
        console.error('Get donor error:', error);
        res.status(500).json({ error: 'Failed to fetch donor' });
    }
});

router.post('/', (req, res) => {
    res.status(400).json({
        error: 'استخدم POST /api/auth/register لإنشاء حساب (بريد وكلمة مرور)'
    });
});

router.patch('/:id/availability', authenticateToken, [
    body('isAvailable').isBoolean()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        if (req.params.id !== req.userId) {
            return res.status(403).json({ error: 'You can only update your own availability' });
        }

        const user = await dataAccess.findUserById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'Donor not found' });
        }

        await dataAccess.updateUser(req.params.id, { isAvailable: req.body.isAvailable });
        const updated = await dataAccess.findUserById(req.params.id);

        res.json({
            message: 'Donor availability updated successfully',
            donor: {
                id: updated.id,
                fullName: updated.fullName,
                isAvailable: updated.isAvailable
            }
        });
    } catch (error) {
        console.error('Update availability error:', error);
        res.status(500).json({ error: 'Failed to update donor availability' });
    }
});

router.delete('/:id', authenticateToken, (req, res) => {
    if (req.params.id !== req.userId) {
        return res.status(403).json({ error: 'You can only delete your own account via DELETE /api/auth/account' });
    }
    return res.status(400).json({
        error: 'Use DELETE /api/auth/account to remove your account'
    });
});

module.exports = router;
