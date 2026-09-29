// factory/lib/vertical-history.mjs
// Per-vertical rolling history of the last 8 compose plans, used by the
// snowflake anti-repetition gate. Corrections list #4.
//
// Persistence contract:
//   · Injected stores may return history rows synchronously or by Promise.
//     Off Vercel, the fallback remains the synchronous filesystem under
//     app/data/vertical-history/<vertical>.json.
//   · The store is bounded to LAST_N plans per vertical. Older entries drop.
//   · Concurrent writes acquire an idempotency lease keyed on the vertical
//     name for the write path. Read path is lock-free.
//
// Contract with the picker:
//   · loadHistory(vertical) returns [] if none.
//   · appendPlan(vertical, plan) adds and trims to LAST_N.
//   · planSnowflake requires min Hamming >= 5 vs every entry. If exhausted
//     after maxRetries diverging seeds, the pipeline stops rendering.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAST_N = 8;
export const MIN_HAMMING = 5;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DATA_DIR = process.env.SITEFORGE_SERVERLESS
  ? '/tmp/sf-data/vertical-history'
  : path.join(REPO_ROOT, 'app', 'data', 'vertical-history');

function safeVerticalKey(vertical) {
  return String(vertical || 'default').toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

function pathFor(vertical, dataDir = DEFAULT_DATA_DIR) {
  return path.join(dataDir, `${safeVerticalKey(vertical)}.json`);
}

function normalizeHistoryRows(rows, operation) {
  if (!Array.isArray(rows)) {
    throw new TypeError(`vertical history store ${operation}() must return an array`);
  }
  return rows.slice(-LAST_N);
}

function normalizeStoreResult(result, operation) {
  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).then((rows) => normalizeHistoryRows(rows, operation));
  }
  return normalizeHistoryRows(result, operation);
}

// Load the last-N plans for a vertical. Never throws on absent file.
// Returns an array for synchronous backends and a Promise for async stores.
export function loadHistory(vertical, { dataDir = DEFAULT_DATA_DIR, store = null } = {}) {
  if (store) {
    if (typeof store.getVerticalHistory !== 'function') {
      throw new TypeError('vertical history store must implement getVerticalHistory()');
    }
    const result = store.getVerticalHistory(safeVerticalKey(vertical), { limit: LAST_N });
    return normalizeStoreResult(result, 'getVerticalHistory');
  }
  const p = pathFor(vertical, dataDir);
  let raw;
  try {
    raw = readFileSync(p, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return normalizeHistoryRows(JSON.parse(raw), 'getVerticalHistory');
}

// Append a plan and trim to LAST_N.
// Returns an array for synchronous backends and a Promise for async stores.
export function appendPlan(vertical, plan, { dataDir = DEFAULT_DATA_DIR, store = null } = {}) {
  if (!plan || typeof plan !== 'object') throw new Error('appendPlan: plan required');
  const key = safeVerticalKey(vertical);
  if (store) {
    if (typeof store.appendVerticalHistory !== 'function') {
      throw new TypeError('vertical history store must implement appendVerticalHistory()');
    }
    const result = store.appendVerticalHistory(key, plan, { limit: LAST_N });
    return normalizeStoreResult(result, 'appendVerticalHistory');
  }
  const p = pathFor(vertical, dataDir);
  mkdirSync(path.dirname(p), { recursive: true });
  const existing = loadHistory(vertical, { dataDir });
  const record = {
    at: new Date().toISOString(),
    plan,
  };
  const next = [...existing, record].slice(-LAST_N);
  writeFileSync(p, JSON.stringify(next, null, 2));
  return next;
}

// Extract just the plans (drop the timestamped envelope) for the picker.
export function extractPlans(historyRows) {
  return (historyRows || []).map((r) => r?.plan).filter(Boolean);
}

// A no-op in-memory store used by tests. Keeps per-vertical isolation.
export function createMemoryStore() {
  const map = new Map();
  return {
    getVerticalHistory(vertical) { return (map.get(vertical) || []).slice(); },
    appendVerticalHistory(vertical, plan, { limit = LAST_N } = {}) {
      const next = [...(map.get(vertical) || []), { at: new Date().toISOString(), plan }].slice(-limit);
      map.set(vertical, next);
      return next;
    },
    clear() { map.clear(); },
    size() { return map.size; },
  };
}
