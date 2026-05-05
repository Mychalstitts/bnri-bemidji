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
      const { id, status, notes, persona } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      const patch = {};
      if (status) patch.status = String(status).slice(0, 40);
      if (typeof notes === 'string') patch.notes = notes.slice(0, 4000);
      if (persona) patch.persona = String(persona).slice(0, 40);
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
