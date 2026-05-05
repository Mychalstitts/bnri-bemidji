// /api/login — Verify the shared concierge passcode and set a signed session cookie.
//
// ENV VARS (set in Vercel project settings):
//   CONCIERGE_PASSWORD   The shared admin passcode (required)
//   SESSION_SECRET       Random string used to sign the cookie (required, min 32 chars)
//
// On successful login, sets `rmb_session` cookie (HttpOnly, Secure, SameSite=Lax) for 12 hours.

import crypto from 'node:crypto';

function sign(value, secret) {
  const hmac = crypto.createHmac('sha256', secret).update(value).digest('hex');
  return `${value}.${hmac}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { CONCIERGE_PASSWORD, SESSION_SECRET } = process.env;

  if (!CONCIERGE_PASSWORD || !SESSION_SECRET) {
    return res.status(500).json({
      error: 'Server not configured. Admin must set CONCIERGE_PASSWORD and SESSION_SECRET env vars in Vercel.'
    });
  }

  const password = (req.body && req.body.password) || '';

  // Constant-time comparison
  const a = Buffer.from(password.padEnd(CONCIERGE_PASSWORD.length, '\0'));
  const b = Buffer.from(CONCIERGE_PASSWORD);
  const valid =
    a.length === b.length &&
    crypto.timingSafeEqual(a.subarray(0, b.length), b);

  if (!valid) {
    // Tiny delay to slow brute force
    await new Promise(r => setTimeout(r, 400));
    return res.status(401).json({ error: 'Incorrect passcode.' });
  }

  // Build session token: payload = expiry timestamp (ms)
  const expires = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
  const token = sign(String(expires), SESSION_SECRET);

  res.setHeader(
    'Set-Cookie',
    `rmb_session=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${12 * 60 * 60}`
  );

  return res.status(200).json({ ok: true });
}
