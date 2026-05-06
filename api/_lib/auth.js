// Shared session-verification helper for protected API routes.

import crypto from 'node:crypto';

function sign(value, secret) {
  const hmac = crypto.createHmac('sha256', secret).update(value).digest('hex');
  return `${value}.${hmac}`;
}

export function verifySession(req) {
  const { SESSION_SECRET } = process.env;
  if (!SESSION_SECRET) return false;

  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)rmb_session=([^;]+)/);
  if (!match) return false;

  const token = match[1];
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;

  const value = token.slice(0, dot);
  const expected = sign(value, SESSION_SECRET);

  // Constant-time compare
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;

  // Check expiry
  const expires = parseInt(value, 10);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;

  return true;
}
