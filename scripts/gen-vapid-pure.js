/**
 * توليد مفاتيح VAPID — نفس منطق web-push@3.x (انظر vapid-helper.js في الحزمة).
 * يتطلب Node 16+ (دعم base64url). بديل: npx web-push generate-vapid-keys
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateVAPIDKeys() {
    const curve = crypto.createECDH('prime256v1');
    curve.generateKeys();
    let publicKeyBuffer = curve.getPublicKey();
    let privateKeyBuffer = curve.getPrivateKey();
    if (privateKeyBuffer.length < 32) {
        const padding = Buffer.alloc(32 - privateKeyBuffer.length);
        padding.fill(0);
        privateKeyBuffer = Buffer.concat([padding, privateKeyBuffer]);
    }
    if (publicKeyBuffer.length < 65) {
        const padding = Buffer.alloc(65 - publicKeyBuffer.length);
        padding.fill(0);
        publicKeyBuffer = Buffer.concat([padding, publicKeyBuffer]);
    }
    return {
        publicKey: publicKeyBuffer.toString('base64url'),
        privateKey: privateKeyBuffer.toString('base64url')
    };
}

const keys = generateVAPIDKeys();
const lines =
    `# مفاتيح Web Push — انسخ إلى .env\n` +
    `VAPID_PUBLIC_KEY=${keys.publicKey}\n` +
    `VAPID_PRIVATE_KEY=${keys.privateKey}\n` +
    `VAPID_SUBJECT=mailto:support@localhost\n`;

const out = path.join(__dirname, '..', 'vapid-generated.env');
fs.writeFileSync(out, lines, 'utf8');
process.stdout.write(lines);
