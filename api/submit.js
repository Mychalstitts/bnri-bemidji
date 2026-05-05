// /api/submit — Public endpoint. The RenewMyBlock.com contact forms POST here.
// No auth required — but rate-limited and field-validated.

import { addIntake } from './_lib/store.js';

const ALLOWED_PERSONAS = new Set([
  'contractor',
  'homeowner-build',
  'homeowner-buy',
  'homeowner-relocate',
  'investor-private',
  'investor-reit',
  'partner',
  'other',
]);

function clean(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

export default async function handler(req, res) {
  // Allow CORS for the public site to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  // Honeypot — if filled, silently accept and discard
  if (body.website && body.website.trim()) {
    return res.status(200).json({ ok: true });
  }

  const entry = {
    name: clean(body.name, 120),
    email: clean(body.email, 200),
    phone: clean(body.phone, 40),
    address: clean(body.address, 200),
    persona: ALLOWED_PERSONAS.has(body.persona) ? body.persona : 'other',
    need: clean(body.need, 2000),
    source: clean(body.source, 80) || 'Website',
    referrer: clean(req.headers['referer'] || '', 200),
    ua: clean(req.headers['user-agent'] || '', 200),
    ip: clean(req.headers['x-forwarded-for'] || '', 60),
  };

  if (!entry.name && !entry.email && !entry.phone) {
    return res.status(400).json({ error: 'Need at least name, email, or phone.' });
  }

  try {
    const record = await addIntake(entry);
    return res.status(201).json({ ok: true, id: record.id });
  } catch (e) {
    console.error('addIntake failed', e);
    return res.status(500).json({ error: 'Could not save submission. Please try again.' });
  }
}
