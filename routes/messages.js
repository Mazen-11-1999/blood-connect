const express = require('express');
const router = express.Router();
const { body, validationResult, query } = require('express-validator');
const dataAccess = require('../lib/dataAccess');
const { notifyRecipientNewMessage } = require('../lib/webPushService');
const { authenticateToken } = require('../middleware/auth');

function enrichMessage(msg) {
    const content = msg.content || msg.message || '';
    const urgency = msg.urgency || (msg.isUrgent ? 'urgent' : 'normal');
    const needyConfirmedAt = msg.needyConfirmedAt || null;
    const donorConfirmedAt = msg.donorConfirmedAt || null;
    return {
        ...msg,
        content,
        message: content,
        isUrgent: urgency === 'urgent',
        urgency,
        phone: msg.senderPhone || msg.phone || null,
        senderPhone: msg.senderPhone || msg.phone || '',
        needyConfirmedAt,
        donorConfirmedAt,
        helpComplete: !!(needyConfirmedAt && donorConfirmedAt)
    };
}

router.get('/conversation/:userId1/:userId2', async (req, res) => {
    try {
        const { userId1, userId2 } = req.params;
        const all = await dataAccess.findAllMessages();
        const conversation = all
            .filter(
                msg =>
                    (msg.senderId === userId1 && msg.recipientId === userId2) ||
                    (msg.senderId === userId2 && msg.recipientId === userId1)
            )
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
            .map(enrichMessage);

        res.json({
            conversation,
            totalMessages: conversation.length,
            participants: { userId1, userId2 }
        });
    } catch (error) {
        console.error('Get conversation error:', error);
        res.status(500).json({ error: 'Failed to fetch conversation' });
    }
});

router.get('/stats/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const all = await dataAccess.findAllMessages();
        const userMessages = all.filter(
            msg => msg.senderId === userId || msg.recipientId === userId
        );

        const sentMessages = userMessages.filter(msg => msg.senderId === userId);
        const receivedMessages = userMessages.filter(msg => msg.recipientId === userId);
        const unreadMessages = receivedMessages.filter(msg => !msg.read);
        const urgentMessages = userMessages.filter(msg => msg.urgency === 'urgent' || msg.isUrgent);

        res.json({
            totalMessages: userMessages.length,
            sentMessages: sentMessages.length,
            receivedMessages: receivedMessages.length,
            unreadMessages: unreadMessages.length,
            urgentMessages: urgentMessages.length
        });
    } catch (error) {
        console.error('Get message stats error:', error);
        res.status(500).json({ error: 'Failed to fetch message statistics' });
    }
});

router.get('/', [
    query('userId').notEmpty(),
    query('type').optional().isIn(['sent', 'received', 'all']),
    query('read').optional()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { userId, type = 'all', read } = req.query;
        const userMessages = await dataAccess.findMessagesForUser(userId, { type, read });
        const list = userMessages.map(enrichMessage);
        const unreadCount = list.filter(
            msg => !msg.read && msg.recipientId === userId
        ).length;

        res.json({
            messages: list,
            total: list.length,
            unreadCount
        });
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const message = await dataAccess.findMessageById(req.params.id);
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }
        res.json(enrichMessage(message));
    } catch (error) {
        console.error('Get message error:', error);
        res.status(500).json({ error: 'Failed to fetch message' });
    }
});

router.post('/', [
    body('senderId').notEmpty(),
    body('recipientId').notEmpty(),
    body('senderName').notEmpty(),
    body('recipientName').notEmpty(),
    body('content').optional(),
    body('message').optional()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const content = (req.body.content || req.body.message || '').trim();
        if (!content) {
            return res.status(400).json({ error: 'Message content is required' });
        }

        const urgency = (req.body.isUrgent === true || req.body.urgency === 'urgent')
            ? 'urgent'
            : 'normal';

        const senderPhone = (req.body.senderPhone || req.body.phone || '').trim();

        const newMessage = {
            id: Date.now().toString(),
            senderId: req.body.senderId,
            recipientId: req.body.recipientId,
            senderName: req.body.senderName,
            recipientName: req.body.recipientName,
            content,
            senderPhone,
            urgency,
            neededDateTime: req.body.neededDateTime || null,
            read: false,
            needyConfirmedAt: null,
            donorConfirmedAt: null,
            createdAt: new Date().toISOString()
        };

        await dataAccess.createMessage(newMessage);

        const enriched = enrichMessage(newMessage);
        setImmediate(() => {
            notifyRecipientNewMessage(enriched).catch(err =>
                console.error('Web Push notify:', err.message || err)
            );
        });

        res.status(201).json({
            message: 'Message sent successfully',
            data: enriched
        });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

/** المحتاج (مرسل الرسالة) يؤكد استلام المساعدة — يُفضّل بعد التبرع/الإتمام الفعلي */
router.patch('/:id/confirm-needy', authenticateToken, async (req, res) => {
    try {
        const existing = await dataAccess.findMessageById(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'الرسالة غير موجودة' });
        }
        if (existing.senderId !== req.userId) {
            return res.status(403).json({ error: 'فقط مُرسِل الطلب يمكنه هذا التأكيد' });
        }
        if (existing.needyConfirmedAt) {
            return res.status(400).json({ error: 'تم التأكيد مسبقاً' });
        }
        const updated = await dataAccess.updateMessage(req.params.id, {
            needyConfirmedAt: new Date().toISOString()
        });
        res.json({ success: true, data: enrichMessage(updated) });
    } catch (error) {
        console.error('confirm-needy error:', error);
        res.status(500).json({ error: 'فشل حفظ التأكيد' });
    }
});

/** المتبرع (مستلم الرسالة) يؤكد تنفيذ ما تعهّد به */
router.patch('/:id/confirm-donor', authenticateToken, async (req, res) => {
    try {
        const existing = await dataAccess.findMessageById(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'الرسالة غير موجودة' });
        }
        if (existing.recipientId !== req.userId) {
            return res.status(403).json({ error: 'فقط المتبرع المُخاطَب يمكنه هذا التأكيد' });
        }
        if (existing.donorConfirmedAt) {
            return res.status(400).json({ error: 'تم التأكيد مسبقاً' });
        }
        const updated = await dataAccess.updateMessage(req.params.id, {
            donorConfirmedAt: new Date().toISOString()
        });
        res.json({ success: true, data: enrichMessage(updated) });
    } catch (error) {
        console.error('confirm-donor error:', error);
        res.status(500).json({ error: 'فشل حفظ التأكيد' });
    }
});

router.patch('/mark-read/bulk', [
    body('messageIds').isArray(),
    body('messageIds.*').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { messageIds } = req.body;
        const markedCount = await dataAccess.bulkMarkRead(messageIds);

        res.json({
            message: `${markedCount} messages marked as read`,
            markedCount
        });
    } catch (error) {
        console.error('Bulk mark as read error:', error);
        res.status(500).json({ error: 'Failed to mark messages as read' });
    }
});

router.patch('/:id/read', async (req, res) => {
    try {
        const existing = await dataAccess.findMessageById(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Message not found' });
        }

        await dataAccess.updateMessage(req.params.id, { read: true });

        res.json({
            message: 'Message marked as read',
            messageId: req.params.id
        });
    } catch (error) {
        console.error('Mark message as read error:', error);
        res.status(500).json({ error: 'Failed to mark message as read' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const existing = await dataAccess.findMessageById(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Message not found' });
        }

        await dataAccess.deleteMessage(req.params.id);

        res.json({
            message: 'Message deleted successfully',
            deletedMessage: {
                id: existing.id,
                senderName: existing.senderName,
                content: existing.content
            }
        });
    } catch (error) {
        console.error('Delete message error:', error);
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

module.exports = router;
