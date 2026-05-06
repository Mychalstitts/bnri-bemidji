// /api/intakes — Admin endpoint. GET to list, PATCH to update status/notes, DELETE to remove.
// Requires valid session cookie.

import { verifySession } from './_lib/auth.js';
import { listIntakes, updateIntake, deleteIntake } from './_lib/store.js';

export default async function handler(req, res) {
  if (!verifySession(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
      const items = await listIntakes(limit);
      return res.status(200).json({ items });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const patch = {};
      if (body.status) patch.status = String(body.status).slice(0, 40);
      if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 4000);
      if (body.persona) patch.persona = String(body.persona).slice(0, 40);
      if (body.stage) patch.stage = String(body.stage).slice(0, 40);
      // journey: array of {id, done, doneAt, by} — cap at 50 items
      if (Array.isArray(body.journey)) {
        patch.journey = body.journey.slice(0, 50).map(j => ({
          id: String(j.id || '').slice(0, 40),
          done: !!j.done,
          doneAt: j.doneAt ? String(j.doneAt).slice(0, 40) : undefined
        })).filter(j => j.id);
      }
      // activities: array of {id, at, type, text} — cap at 200
      if (Array.isArray(body.activities)) {
        patch.activities = body.activities.slice(0, 200).map(a => ({
          id: String(a.id || '').slice(0, 40),
          at: String(a.at || new Date().toISOString()).slice(0, 40),
          type: String(a.type || 'note').slice(0, 20),
          text: String(a.text || '').slice(0, 2000)
        })).filter(a => a.id);
      }
      // links: object of free-form contact-record references — clamp string sizes
      if (body.links && typeof body.links === 'object') {
        const L = {};
        for (const k of Object.keys(body.links).slice(0, 30)) {
          const v = body.links[k];
          if (v == null) { L[k] = null; continue; }
          if (typeof v === 'string') L[k] = v.slice(0, 200);
          else if (typeof v === 'number' || typeof v === 'boolean') L[k] = v;
          else if (typeof v === 'object') {
            const sub = {};
            for (const kk of Object.keys(v).slice(0, 20)) {
              const vv = v[kk];
              if (typeof vv === 'string') sub[kk] = vv.slice(0, 200);
              else if (typeof vv === 'number' || typeof vv === 'boolean') sub[kk] = vv;
              else if (vv == null) sub[kk] = null;
            }
            L[k] = sub;
          }
        }
        patch.links = L;
      }
      const updated = await updateIntake(id, patch);
      if (!updated) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ ok: true, item: updated });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id || (req.body && req.body.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const ok = await deleteIntake(id);
      return res.status(ok ? 200 : 404).json({ ok });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
