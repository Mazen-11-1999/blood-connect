const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendUrgentBloodRequestSms } = require('../lib/urgentSms');

const smsLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many SMS requests, please try again later' }
});

function twilioConfigured() {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}

function getTwilioClient() {
    if (!twilioConfigured()) return null;
    // eslint-disable-next-line global-require
    const twilio = require('twilio');
    return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

router.post('/send', smsLimiter, async (req, res) => {
    try {
        const { to, message, recipientName, urgency } = req.body;

        if (!to || !message) {
            return res.status(400).json({
                error: 'Phone number and message are required'
            });
        }

        const formattedPhone = to.startsWith('+') ? to : `+${to.replace(/^\+/, '')}`;
        let smsContent = message;
        if (recipientName && urgency) {
            smsContent = `🚨 طلب عاجل لـ ${recipientName}:\n\n${message}\n\nمنصة إنقاذ حياة`;
        }

        const client = getTwilioClient();
        if (!client) {
            console.log('[SMS mock] would send to', formattedPhone, smsContent.substring(0, 80));
            return res.json({
                success: true,
                mock: true,
                message: 'SMS simulated (configure Twilio in .env for real SMS)',
                to: formattedPhone
            });
        }

        const smsResult = await client.messages.create({
            body: smsContent,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: formattedPhone
        });

        res.json({
            success: true,
            message: 'SMS sent successfully',
            sid: smsResult.sid,
            to: formattedPhone
        });
    } catch (error) {
        console.error('SMS sending failed:', error);
        if (error.code === 21614) {
            return res.status(400).json({ error: 'Phone number is not verified for trial account' });
        }
        if (error.code === 21612) {
            return res.status(429).json({ error: 'SMS quota exceeded' });
        }
        res.status(500).json({
            error: 'Failed to send SMS',
            details: error.message
        });
    }
});

router.post('/urgent', smsLimiter, async (req, res) => {
    try {
        const { to, recipientName, bloodType, urgency, location } = req.body;

        if (!to || !recipientName || !bloodType) {
            return res.status(400).json({
                error: 'Phone number, recipient name, and blood type are required'
            });
        }

        const result = await sendUrgentBloodRequestSms({
            to,
            recipientName,
            bloodType,
            urgency: urgency || 'عاجل',
            location: location || 'غير محدد'
        });

        if (result.mock) {
            return res.json({
                success: true,
                mock: true,
                message: 'Urgent SMS simulated (configure Twilio in .env for real SMS)',
                urgency: 'high'
            });
        }

        if (!result.ok) {
            const status = result.code === 21614 || result.code === 21608 ? 400 : 500;
            return res.status(status).json({
                error: 'Failed to send urgent SMS',
                details: result.error || 'Unknown',
                code: result.code
            });
        }

        res.json({
            success: true,
            message: 'Urgent SMS sent successfully',
            sid: result.sid,
            urgency: 'high'
        });
    } catch (error) {
        console.error('Urgent SMS failed:', error);
        res.status(500).json({
            error: 'Failed to send urgent SMS',
            details: error.message
        });
    }
});

router.get('/status/:sid', async (req, res) => {
    try {
        const client = getTwilioClient();
        if (!client) {
            return res.json({
                sid: req.params.sid,
                status: 'mock',
                message: 'Twilio not configured'
            });
        }
        const message = await client.messages(req.params.sid).fetch();
        res.json({
            sid: message.sid,
            status: message.status,
            to: message.to,
            from: message.from,
            dateCreated: message.dateCreated,
            dateUpdated: message.dateUpdated
        });
    } catch (error) {
        console.error('SMS status failed:', error);
        res.status(500).json({ error: 'Failed to check SMS status', details: error.message });
    }
});

module.exports = router;
