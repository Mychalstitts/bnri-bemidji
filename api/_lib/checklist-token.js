// HMAC-signed token for the customer-facing checklist page.
// Format: base64url(caseId|targetStage|expires) + "." + hex(hmac)
//
// Customer never sees the secret. The token encodes everything the server
// needs to validate the request and identify which case + which stage the
// customer is working on. Server re-computes the HMAC and rejects mismatches.

import crypto from 'node:crypto';

function b64urlEncode(s){
  return Buffer.from(s, 'utf8').toString('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64urlDecode(s){
  s = s.replace(/-/g,'+').replace(/_/g,'/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function hmacHex(value, secret){
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

/**
 * Mint a checklist token.
 * @param {string} caseId
 * @param {string} targetStage  the stage the customer is working toward
 * @param {number} ttlMs        token validity in ms (default 30 days)
 */
export function mintChecklistToken(caseId, targetStage, ttlMs = 30 * 24 * 60 * 60 * 1000) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET not configured');
  const expires = Date.now() + ttlMs;
  const payload = `${caseId}|${targetStage}|${expires}`;
  const sig = hmacHex(payload, secret);
  return `${b64urlEncode(payload)}.${sig}`;
}

/**
 * Verify and decode a checklist token.
 * Returns { caseId, targetStage, expires } if valid, null otherwise.
 */
export function verifyChecklistToken(token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const enc = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let payload;
  try { payload = b64urlDecode(enc); } catch { return null; }

  const expected = hmacHex(payload, secret);

  // Constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  const parts = payload.split('|');
  if (parts.length !== 3) return null;
  const [caseId, targetStage, expiresStr] = parts;
  const expires = parseInt(expiresStr, 10);
  if (!Number.isFinite(expires) || Date.now() > expires) return null;

  return { caseId, targetStage, expires };
}
