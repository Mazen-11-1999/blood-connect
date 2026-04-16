const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const dataAccess = require('../lib/dataAccess');

/** المفتاح العام لاشتراك المتصفح (آمن نشره) */
router.get('/vapid-public-key', (req, res) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
        return res.json({ publicKey: null, configured: false });
    }
    res.json({ publicKey, configured: true });
});

router.post(
    '/subscribe',
    authenticateToken,
    [
        body('subscription.endpoint').notEmpty(),
        body('subscription.keys.p256dh').notEmpty(),
        body('subscription.keys.auth').notEmpty()
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }
            await dataAccess.upsertPushSubscription(req.userId, req.body.subscription);
            res.json({ success: true });
        } catch (error) {
            console.error('push subscribe:', error);
            res.status(500).json({ error: 'Failed to save push subscription' });
        }
    }
);

router.delete('/subscribe', authenticateToken, async (req, res) => {
    try {
        const endpoint = req.body && req.body.endpoint;
        if (!endpoint) {
            return res.status(400).json({ error: 'endpoint required' });
        }
        await dataAccess.deletePushSubscriptionForUser(req.userId, endpoint);
        res.json({ success: true });
    } catch (error) {
        console.error('push unsubscribe:', error);
        res.status(500).json({ error: 'Failed to remove subscription' });
    }
});

module.exports = router;
