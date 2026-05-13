// Storage layer using Upstash Redis (via Vercel integration)
// Falls back to in-memory if Redis is not configured.
//
// Setup:
//   Vercel Dashboard → Storage → Create → Upstash for Redis
//   Connect it to this project. The KV_* env vars will be auto-injected.

import { Redis } from '@upstash/redis';
import crypto from 'node:crypto';

let redis = null;
let redisAttempted = false;

async function getRedis() {
  if (redisAttempted) return redis;
  redisAttempted = true;

  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      redis = new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      });
    } catch (e) {
      console.warn('Failed to initialize Upstash Redis:', e.message);
    }
  }
  return redis;
}

// In-memory fallback (resets on cold start)
const mem = { intakes: [] };

const KEY = 'rmb:intakes';

function toRecord(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return null;
}

export async function addIntake(entry) {
  const record = {
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    status: 'new',
    notes: '',
    ...entry,
  };

  const store = await getRedis();
  if (store) {
    await store.lpush(KEY, JSON.stringify(record));
    await store.ltrim(KEY, 0, 999);
  } else {
    mem.intakes.unshift(record);
    if (mem.intakes.length > 1000) mem.intakes.length = 1000;
  }
  return record;
}

export async function listIntakes(limit = 100) {
  const store = await getRedis();
  if (store) {
    const raw = await store.lrange(KEY, 0, limit - 1);
    return raw.map(toRecord).filter(Boolean);
  }
  return mem.intakes.slice(0, limit);
}

export async function updateIntake(id, patch) {
  const store = await getRedis();
  if (store) {
    const raw = await store.lrange(KEY, 0, 999);
    const parsed = raw.map(toRecord).filter(Boolean);
    const idx = parsed.findIndex(r => r.id === id);
    if (idx < 0) return null;

    const updated = { ...parsed[idx], ...patch, updatedAt: new Date().toISOString() };
    parsed[idx] = updated;

    await store.del(KEY);
    if (parsed.length > 0) {
      const serialized = parsed.map(r => JSON.stringify(r));
      await store.rpush(KEY, ...serialized);
    }
    return updated;
  }

  // memory fallback
  const idx = mem.intakes.findIndex(r => r.id === id);
  if (idx < 0) return null;
  mem.intakes[idx] = { ...mem.intakes[idx], ...patch, updatedAt: new Date().toISOString() };
  return mem.intakes[idx];
}

export async function deleteIntake(id) {
  const store = await getRedis();
  if (store) {
    const raw = await store.lrange(KEY, 0, 999);
    const parsed = raw.map(toRecord).filter(Boolean);
    const remaining = parsed.filter(r => r.id !== id);

    await store.del(KEY);
    if (remaining.length > 0) {
      const serialized = remaining.map(r => JSON.stringify(r));
      await store.rpush(KEY, ...serialized);
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
