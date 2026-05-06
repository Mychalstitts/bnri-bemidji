// Storage abstraction. Uses Vercel KV when configured, falls back to in-memory
// (warning: in-memory loses data on cold start — fine for testing only).
//
// To enable persistent storage:
//   1. In Vercel project: Storage → Create → KV
//   2. The integration auto-injects KV_REST_API_URL and KV_REST_API_TOKEN env vars
//   3. Redeploy

import crypto from 'node:crypto';

let kv = null;
let kvAttempted = false;

async function getKv() {
  if (kvAttempted) return kv;
  kvAttempted = true;
  try {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const mod = await import('@vercel/kv');
      kv = mod.kv;
    }
  } catch (e) {
    console.warn('Vercel KV not available — using in-memory fallback.', e.message);
  }
  return kv;
}

// In-memory fallback (per-instance — does not persist across cold starts)
const mem = { intakes: [] };

const KEY = 'rmb:intakes';

export async function addIntake(entry) {
  const record = {
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    status: 'new',
    notes: '',
    ...entry,
  };

  const store = await getKv();
  if (store) {
    // store as a list (lpush)
    await store.lpush(KEY, JSON.stringify(record));
    await store.ltrim(KEY, 0, 999); // cap at 1000
  } else {
    mem.intakes.unshift(record);
    if (mem.intakes.length > 1000) mem.intakes.length = 1000;
  }
  return record;
}

export async function listIntakes(limit = 100) {
  const store = await getKv();
  if (store) {
    const raw = await store.lrange(KEY, 0, limit - 1);
    return raw
      .map(s => { try { return JSON.parse(s); } catch { return null; } })
      .filter(Boolean);
  }
  return mem.intakes.slice(0, limit);
}

export async function updateIntake(id, patch) {
  const store = await getKv();
  if (store) {
    const raw = await store.lrange(KEY, 0, 999);
    const parsed = raw.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    const idx = parsed.findIndex(r => r.id === id);
    if (idx < 0) return null;
    const updated = { ...parsed[idx], ...patch, updatedAt: new Date().toISOString() };
    parsed[idx] = updated;
    // rewrite list
    await store.del(KEY);
    if (parsed.length > 0) {
      await store.rpush(KEY, ...parsed.map(r => JSON.stringify(r)));
    }
    return updated;
  }
  const idx = mem.intakes.findIndex(r => r.id === id);
  if (idx < 0) return null;
  mem.intakes[idx] = { ...mem.intakes[idx], ...patch, updatedAt: new Date().toISOString() };
  return mem.intakes[idx];
}

export async function deleteIntake(id) {
  const store = await getKv();
  if (store) {
    const raw = await store.lrange(KEY, 0, 999);
    const parsed = raw.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    const remaining = parsed.filter(r => r.id !== id);
    await store.del(KEY);
    if (remaining.length > 0) {
      await store.rpush(KEY, ...remaining.map(r => JSON.stringify(r)));
    }
    return true;
  }
  const idx = mem.intakes.findIndex(r => r.id === id);
  if (idx >= 0) {
    mem.intakes.splice(idx, 1);
    return true;
  }
  return false;
}
