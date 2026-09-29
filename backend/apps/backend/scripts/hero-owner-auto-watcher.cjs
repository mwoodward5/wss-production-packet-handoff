'use strict';

/**
 * Owner-only companion for the Ads Station hero worker.
 *
 * The worker writes a locally verified receipt after remaster + animation. This
 * process watches only that configured receipt directory and hands each exact
 * receipt path back to the worker module's existing owner verifier. It never
 * claims, renews, settles, uploads, rebuilds, or sends anything itself.
 *
 * Run:  npm run hero:owner-watcher
 * Stop: Ctrl+C
 * Explicit opt-in: GHOST_AGENCY_HERO_OWNER_WATCHER=1
 * Every other value, including unset, keeps this process disabled.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createWorker } = require('./ads-station/hero-forge-worker.cjs');
const { attestVisualGateReceipt } = require('../lib/hero-video-visual-attester');
const { verifyVisualGateReceipt } = require('../lib/hero-video-visual-gate');

const DEFAULT_POLL_MS = 1_500;
const MIN_POLL_MS = 1_000;
const MAX_POLL_MS = 2_000;
const MAX_RECEIPT_BYTES = 256 * 1024;
const MAX_ATTEMPTS_PER_TICK = 100;
const INITIAL_RETRY_MS = 30_000;
const MAX_RETRY_MS = 10 * 60 * 1000;
const APPROVED_BY = 'factory_verified';
const SHA256_RE = /^[a-f0-9]{64}$/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function watcherEnabled(env = process.env) {
  return clean(env.GHOST_AGENCY_HERO_OWNER_WATCHER) === '1'
    && clean(env.GHOST_AGENCY_HERO_AUTO_APPROVE) !== '0';
}

function sameCredential(left, right) {
  const a = crypto.createHash('sha256').update(String(left || ''), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(right || ''), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Build the only environment the owner-mode worker may see. The worker token
 * is checked for a dangerous collision, then deliberately not copied.
 */
function ownerApprovalEnv(env = process.env) {
  const adminToken = clean(env.GHOST_AGENCY_ADMIN_TOKEN);
  if (!adminToken) throw codedError('GHOST_AGENCY_ADMIN_TOKEN_required_for_approval');
  const workerToken = clean(env.GHOST_AGENCY_HERO_WORKER_TOKEN);
  if (workerToken && sameCredential(workerToken, adminToken)) {
    throw codedError('hero_worker_token_must_differ_from_admin');
  }

  const approved = { GHOST_AGENCY_ADMIN_TOKEN: adminToken };
  for (const name of ['GHOST_AGENCY_API_URL', 'GHOST_BASE', 'HERO_FORGE_REVIEW_DIR']) {
    const value = clean(env[name]);
    if (value) approved[name] = value;
  }
  return approved;
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function stableReceiptKey(receiptPath, raw) {
  return [
    process.platform === 'win32' ? receiptPath.toLowerCase() : receiptPath,
    clean(raw.job_id),
    Number(raw.generation_revision) || 1,
    clean(raw.clip_sha256).toLowerCase(),
  ].join('|');
}

function shallowReceipt(raw) {
  return raw
    && typeof raw === 'object'
    && !Array.isArray(raw)
    && raw.status === 'awaiting_review'
    && clean(raw.job_id)
    && SHA256_RE.test(clean(raw.clip_sha256))
    && clean(raw.clip_path)
    && raw.approved_artifact
    && typeof raw.approved_artifact === 'object'
    && raw.optimized_asset
    && typeof raw.optimized_asset === 'object';
}

async function readReceipt(receiptPath, realRoot, fsPromises = fs.promises) {
  try {
    const stat = await fsPromises.lstat(receiptPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_RECEIPT_BYTES) return null;
    const realReceipt = await fsPromises.realpath(receiptPath);
    if (!pathIsInside(realRoot, realReceipt)) return null;
    const raw = JSON.parse(await fsPromises.readFile(realReceipt, 'utf8'));
    if (!shallowReceipt(raw)) return null;
    return { path: realReceipt, raw, key: stableReceiptKey(realReceipt, raw) };
  } catch {
    return null;
  }
}

/** Enumerate exactly reviewRoot/<job>/<receipt>.json, never symlink traversal. */
async function findAwaitingReceipts(reviewRoot, options = {}) {
  const fsPromises = options.fsPromises || fs.promises;
  const resolved = path.resolve(reviewRoot || '');
  const configuredStat = await fsPromises.lstat(resolved).catch(() => null);
  if (!configuredStat || !configuredStat.isDirectory() || configuredStat.isSymbolicLink()) return [];
  const realRoot = await fsPromises.realpath(resolved).catch(() => '');
  if (!realRoot) return [];
  const rootStat = await fsPromises.lstat(realRoot).catch(() => null);
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) return [];

  const jobEntries = await fsPromises.readdir(realRoot, { withFileTypes: true }).catch(() => []);
  const receipts = [];
  for (const jobEntry of jobEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!jobEntry.isDirectory() || jobEntry.isSymbolicLink()) continue;
    const jobDir = path.join(realRoot, jobEntry.name);
    const files = await fsPromises.readdir(jobDir, { withFileTypes: true }).catch(() => []);
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!file.isFile() || file.isSymbolicLink() || !file.name.toLowerCase().endsWith('.json')) continue;
      const receipt = await readReceipt(path.join(jobDir, file.name), realRoot, fsPromises);
      if (receipt) receipts.push(receipt);
    }
  }
  return receipts;
}

function safeErrorCode(error) {
  const code = clean(error && error.code).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80);
  return code || 'approval_failed';
}

function createOwnerApprovalWatcher(options = {}) {
  const env = options.env || process.env;
  const writeLog = options.logImpl || (() => {});
  if (!watcherEnabled(env)) {
    return {
      disabled: true,
      pollMs: DEFAULT_POLL_MS,
      scanOnce: async () => ({ disabled: true, found: 0, approved: 0, failed: 0, skipped: 0 }),
    };
  }
  const practiceOnly = clean(env.GHOST_AGENCY_HERO_OWNER_PRACTICE_ONLY) === '1';
  const practiceJobId = clean(env.GHOST_AGENCY_HERO_OWNER_PRACTICE_JOB_ID);
  if (practiceOnly && !practiceJobId) throw codedError('hero_owner_practice_job_id_required');

  const safeEnv = ownerApprovalEnv(env);
  const workerFactory = options.workerFactory || createWorker;
  const worker = workerFactory({
    ...(options.workerOptions || {}),
    env: safeEnv,
    allowOwnerApproval: true,
  });
  if (!worker || typeof worker.approveReview !== 'function') throw codedError('owner_approval_api_unavailable');
  if (!worker.config || !worker.config.adminToken) throw codedError('GHOST_AGENCY_ADMIN_TOKEN_required_for_approval');
  if (worker.config.workerToken) throw codedError('worker_token_retained_by_owner_watcher');

  const reviewDir = path.resolve(worker.config.reviewDir || '');
  const successful = new Set();
  const failures = new Map();
  const pollMs = parsePollMs(options.argv || [], env);
  const nowMs = options.nowImpl || Date.now;
  const visualAttester = options.visualAttesterImpl || attestVisualGateReceipt;
  const visualGate = options.visualGateImpl || verifyVisualGateReceipt;
  const visualGateSecret = clean(env.GHOST_AGENCY_HERO_VISUAL_GATE_SECRET);
  let nextReceiptIndex = 0;

  async function scanOnce() {
    const foundReceipts = await (options.findReceiptsImpl || findAwaitingReceipts)(reviewDir);
    const receipts = practiceJobId
      ? foundReceipts.filter((receipt) => clean(receipt?.raw?.job_id) === practiceJobId)
      : foundReceipts;
    const summary = { disabled: false, found: receipts.length, approved: 0, failed: 0, skipped: 0 };
    const present = new Set(receipts.map((receipt) => receipt.key));
    for (const key of successful) if (!present.has(key)) successful.delete(key);
    for (const key of failures.keys()) if (!present.has(key)) failures.delete(key);
    if (!receipts.length) {
      nextReceiptIndex = 0;
      return summary;
    }

    // Deliberately sequential: owner approval concurrency is always one. The
    // rotating cursor bounds calls without letting a permanently stale receipt
    // at the front of the directory starve later valid work.
    let cursor = nextReceiptIndex % receipts.length;
    let visited = 0;
    let attempted = 0;
    let firstFailureCode = '';
    while (visited < receipts.length && attempted < MAX_ATTEMPTS_PER_TICK) {
      const receipt = receipts[cursor];
      cursor = (cursor + 1) % receipts.length;
      visited += 1;
      if (successful.has(receipt.key)) {
        summary.skipped += 1;
        continue;
      }
      const priorFailure = failures.get(receipt.key);
      if (priorFailure && priorFailure.nextAt > nowMs()) {
        summary.skipped += 1;
        continue;
      }
      attempted += 1;
      try {
        const attested = await visualAttester(receipt, {
          ...(options.visualAttesterOptions || {}),
          env,
          secret: visualGateSecret,
          reviewRoot: reviewDir,
          nowMs,
        });
        if (!attested || attested.ok !== true || !attested.receipt) {
          throw codedError(clean(attested?.reason) || 'hero_visual_attestation_failed');
        }
        const gate = await visualGate(attested.receipt, { secret: visualGateSecret, nowMs });
        if (!gate || gate.ok !== true) throw codedError(clean(gate?.reason) || 'hero_visual_gate_failed');
        await worker.approveReview(receipt.path, APPROVED_BY, attested.receipt.clip_sha256);
        successful.add(receipt.key);
        failures.delete(receipt.key);
        summary.approved += 1;
      } catch (error) {
        summary.failed += 1;
        const attempts = (priorFailure && priorFailure.attempts || 0) + 1;
        const retryMs = Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * (2 ** Math.min(attempts - 1, 20)));
        failures.set(receipt.key, { attempts, nextAt: nowMs() + retryMs });
        if (!firstFailureCode) firstFailureCode = safeErrorCode(error);
      }
    }
    nextReceiptIndex = cursor;
    if (summary.failed) writeLog('approval refusals', String(summary.failed), firstFailureCode);
    return summary;
  }

  return { disabled: false, pollMs, reviewDir, scanOnce };
}

function parsePollMs(argv = [], env = process.env) {
  const equals = argv.find((arg) => arg.startsWith('--poll-ms='));
  const index = argv.indexOf('--poll-ms');
  const raw = equals
    ? equals.slice('--poll-ms='.length)
    : (index >= 0 ? argv[index + 1] : env.GHOST_AGENCY_HERO_OWNER_WATCHER_POLL_MS);
  const parsed = Number(raw || DEFAULT_POLL_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_POLL_MS;
  return Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, Math.round(parsed)));
}

async function runWatcherLoop(watcher, options = {}) {
  if (watcher.disabled) return watcher.scanOnce();
  const once = options.once === true;
  const wait = options.sleepImpl || sleep;
  for (;;) {
    const result = await watcher.scanOnce();
    if (once) return result;
    await wait(watcher.pollMs);
  }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const writeLog = (...args) => console.log(`[hero-owner-watcher ${new Date().toISOString().slice(11, 19)}]`, ...args);
  const watcher = createOwnerApprovalWatcher({ env, argv, logImpl: writeLog });
  if (watcher.disabled) {
    writeLog('disabled');
    return;
  }
  writeLog('watcher up');
  const result = await runWatcherLoop(watcher, { once: argv.includes('--once') });
  if (argv.includes('--once')) writeLog('scan', JSON.stringify(result));
  return result;
}

module.exports = {
  APPROVED_BY,
  DEFAULT_POLL_MS,
  createOwnerApprovalWatcher,
  findAwaitingReceipts,
  ownerApprovalEnv,
  parsePollMs,
  runWatcherLoop,
  watcherEnabled,
};

if (require.main === module) {
  main().catch((error) => {
    console.error('FATAL', safeErrorCode(error));
    process.exitCode = 1;
  });
}
