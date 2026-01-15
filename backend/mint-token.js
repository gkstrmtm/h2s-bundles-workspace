require('dotenv').config({ path: '.env.production.local' });
const crypto = require('crypto');

const secret = process.env.PORTAL_TOKEN_SECRET || process.env.SUPABASE_SERVICE_KEY;
console.log('Using Secret Length:', secret ? secret.length : 0);

function base64UrlEncode(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function issuePortalToken(sub, role, email) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub,
    role,
    email,
    iat: now,
    exp: now + 60 * 60 * 24 * 7,
  };

  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  const sigB64 = base64UrlEncode(sig);

  return `${payloadB64}.${sigB64}`;
}

const token = issuePortalToken('209e2343-130c-45a2-b526-062a11f7709e', 'pro', 'geraldbroome@gmail.com');
console.log('MINTED_TOKEN:', token);
