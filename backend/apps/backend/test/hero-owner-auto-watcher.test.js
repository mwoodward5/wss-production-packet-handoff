'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const workerModule = require('../scripts/ads-station/hero-forge-worker.cjs');
const watcherModule = require('../scripts/hero-owner-auto-watcher.cjs');
const visualGate = require('../lib/hero-video-visual-gate');

const RAW = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const RAW_SHA = workerModule.sha256Hex(RAW);
const box = (type, payload) => {
  const bytes = Buffer.alloc(8 + payload.length);
  bytes.writeUInt32BE(bytes.length, 0);
  bytes.write(type, 4, 4, 'ascii');
  payload.copy(bytes, 8);
  return bytes;
};
const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isomavc1', 'latin1'));
const mvhdPayload = Buffer.alloc(20);
mvhdPayload.writeUInt32BE(1000, 12);
mvhdPayload.writeUInt32BE(4000, 16);
const tkhdPayload = Buffer.alloc(8);
tkhdPayload.writeUInt32BE(1280 * 65536, 0);
tkhdPayload.writeUInt32BE(720 * 65536, 4);
const hdlrPayload = Buffer.alloc(12);
hdlrPayload.write('vide', 8, 4, 'ascii');
const stsdPayload = Buffer.concat([Buffer.alloc(8), box('avc1', Buffer.alloc(0))]);
stsdPayload.writeUInt32BE(1, 4);
const stbl = box('stbl', box('stsd', stsdPayload));
const minf = box('minf', stbl);
const mdia = box('mdia', Buffer.concat([box('hdlr', hdlrPayload), minf]));
const trak = box('trak', Buffer.concat([box('tkhd', tkhdPayload), mdia]));
const moov = box('moov', Buffer.concat([box('mvhd', mvhdPayload), trak]));
const CLIP = Buffer.concat([ftyp, moov, box('mdat', Buffer.from('owner-watcher-client-clip'))]);
const CLIP_SHA = workerModule.sha256Hex(CLIP);
const OPTIMIZED = {
  sha256: 'b'.repeat(64),
  url_fingerprint: 'googleusercontent.example/Optimized/Asset',
  width: 1280,
  height: 720,
  prompt_sha256: 'c'.repeat(64),
};
const ARTIFACT = workerModule.approvedArtifactFrom({
  sourceSha256: RAW_SHA,
  sourceUrl: 'https://client.example/work/job.jpg',
  clipSha256: CLIP_SHA,
  optimizedAsset: OPTIMIZED,
});

function makeReviewRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-owner-watcher-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeReceipt(root, overrides = {}) {
  const jobId = overrides.job_id || 'hrj_owner_watcher';
  const jobDir = path.join(root, jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  const clipPath = overrides.clip_path || path.join(jobDir, `${CLIP_SHA}.mp4`);
  if (!overrides.skip_clip) fs.writeFileSync(clipPath, CLIP);
  const receiptPath = path.join(jobDir, `${CLIP_SHA}.json`);
  fs.writeFileSync(receiptPath, JSON.stringify({
    job_id: jobId,
    prospect_id: 'wss-test-owner-watcher',
    source_sha256: RAW_SHA,
    source_url: 'https://client.example/work/job.jpg',
    clip_sha256: CLIP_SHA,
    clip_path: clipPath,
    approved_artifact: ARTIFACT,
    optimized_asset: OPTIMIZED,
    status: 'awaiting_review',
    generation_revision: 1,
    ...overrides,
  }));
  return receiptPath;
}

function makeWatcher({
  root,
  apiImpl,
  env = {},
  logs = [],
  nowImpl,
  visualGateImpl = async () => ({ ok: true }),
  visualAttesterImpl = async (entry) => ({ ok: true, receipt: entry.raw }),
}) {
  let workerOptions;
  const watcher = watcherModule.createOwnerApprovalWatcher({
    env: {
      GHOST_AGENCY_API_URL: 'https://ghost.wss-ai.com',
      GHOST_AGENCY_ADMIN_TOKEN: 'owner-test-token',
      GHOST_AGENCY_HERO_WORKER_TOKEN: 'distinct-worker-test-token',
      GHOST_AGENCY_HERO_OWNER_WATCHER: '1',
      HERO_FORGE_REVIEW_DIR: root,
      ...env,
    },
    logImpl: (...args) => logs.push(args.join(' ')),
    ...(nowImpl ? { nowImpl } : {}),
    visualAttesterImpl,
    visualGateImpl,
    workerFactory: (options) => {
      workerOptions = options;
      return workerModule.createWorker({ ...options, apiImpl });
    },
  });
  return { watcher, getWorkerOptions: () => workerOptions, logs };
}

test('automatic approval fails closed without an independent visual attestation', async (t) => {
  const root = makeReviewRoot(t);
  writeReceipt(root);
  let calls = 0;
  const h = makeWatcher({
    root,
    visualGateImpl: visualGate.verifyVisualGateReceipt,
    apiImpl: async () => { calls += 1; return { ok: true, status: 200, body: { ok: true } }; },
  });
  const result = await h.watcher.scanOnce();
  assert.equal(result.approved, 0);
  assert.equal(result.failed, 1);
  assert.equal(calls, 0);
  assert.deepEqual(h.logs, ['approval refusals 1 hero_visual_gate_secret_required']);
});

test('only an exact signed visual identity pass reaches automatic approval', async (t) => {
  const root = makeReviewRoot(t);
  const secret = 'visual-gate-test-secret-that-is-at-least-32-bytes';
  const receiptPath = writeReceipt(root);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  receipt.visual_gate = visualGate.signVisualGateAttestation(receipt, {
    verdict: 'passed',
    evaluator: 'independent_visual_gate',
    checked_at: new Date().toISOString(),
  }, secret);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  let calls = 0;
  const h = makeWatcher({
    root,
    env: { GHOST_AGENCY_HERO_VISUAL_GATE_SECRET: secret },
    visualGateImpl: visualGate.verifyVisualGateReceipt,
    apiImpl: async () => { calls += 1; return { ok: true, status: 200, body: { ok: true, job: { status: 'queued' } } }; },
  });
  const result = await h.watcher.scanOnce();
  assert.equal(result.approved, 1);
  assert.equal(result.failed, 0);
  assert.equal(calls, 1);
});

test('watcher attests first, verifies that exact receipt, then approves', async (t) => {
  const root = makeReviewRoot(t);
  const secret = 'visual-gate-test-secret-that-is-at-least-32-bytes';
  writeReceipt(root);
  const order = [];
  const h = makeWatcher({
    root,
    env: { GHOST_AGENCY_HERO_VISUAL_GATE_SECRET: secret },
    visualAttesterImpl: async (entry) => {
      order.push('attest');
      const receipt = {
        ...entry.raw,
        visual_gate: visualGate.signVisualGateAttestation(entry.raw, {
          verdict: 'passed',
          evaluator: 'wss_local_ffmpeg_identity_v1',
          checked_at: new Date().toISOString(),
        }, secret),
      };
      return { ok: true, receipt };
    },
    visualGateImpl: async (receipt, options) => {
      order.push('verify');
      return visualGate.verifyVisualGateReceipt(receipt, options);
    },
    apiImpl: async () => {
      order.push('approve');
      return { ok: true, status: 200, body: { ok: true, job: { status: 'queued' } } };
    },
  });
  const result = await h.watcher.scanOnce();
  assert.equal(result.approved, 1);
  assert.deepEqual(order, ['attest', 'verify', 'approve']);
});

test('visual approval signature cannot be replayed onto changed clip identity', () => {
  const secret = 'visual-gate-test-secret-that-is-at-least-32-bytes';
  const receipt = {
    job_id: 'hrj_visual_replay',
    prospect_id: 'wss-visual-replay',
    generation_revision: 1,
    source_sha256: RAW_SHA,
    clip_sha256: CLIP_SHA,
  };
  receipt.visual_gate = visualGate.signVisualGateAttestation(receipt, {
    verdict: 'passed',
    evaluator: 'independent_visual_gate',
    checked_at: new Date().toISOString(),
  }, secret);
  const changed = { ...receipt, clip_sha256: 'f'.repeat(64) };
  assert.equal(visualGate.verifyVisualGateReceipt(changed, { secret }).reason, 'hero_visual_gate_signature_invalid');
});

test('exact verified receipt gets one owner-only approval and never calls worker operations', async (t) => {
  const root = makeReviewRoot(t);
  const receiptPath = writeReceipt(root);
  const requests = [];
  const h = makeWatcher({
    root,
    apiImpl: async (pathname, request, authKind) => {
      requests.push({ pathname, request, authKind });
      return { ok: true, status: 200, body: { ok: true, job: { status: 'queued' } } };
    },
  });

  const first = await h.watcher.scanOnce();
  const second = await h.watcher.scanOnce();
  assert.deepEqual(first, { disabled: false, found: 1, approved: 1, failed: 0, skipped: 0 });
  assert.deepEqual(second, { disabled: false, found: 1, approved: 0, failed: 0, skipped: 1 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, '/api/admin/hero-reel');
  assert.equal(requests[0].authKind, 'owner');
  assert.equal(requests[0].request.headers.authorization, 'Bearer owner-test-token');
  assert.equal(requests[0].request.headers['x-ghost-hero-worker-token'], undefined);
  assert.deepEqual(JSON.parse(requests[0].request.body), {
    job_id: 'hrj_owner_watcher',
    action: 'approve',
    clip_sha256: CLIP_SHA,
    approved_by: watcherModule.APPROVED_BY,
    approved_at: JSON.parse(fs.readFileSync(receiptPath, 'utf8')).approved_at,
    generation_revision: 1,
  });
  assert.equal(Object.hasOwn(h.getWorkerOptions().env, 'GHOST_AGENCY_HERO_WORKER_TOKEN'), false);
  assert.equal(h.getWorkerOptions().allowOwnerApproval, true);
});

test('Practice watcher approves only its exact job receipt', async (t) => {
  const root = makeReviewRoot(t);
  const practiceReceipt = writeReceipt(root, { job_id: 'hrj_practice_exact' });
  const unrelatedReceipt = writeReceipt(root, { job_id: 'hrj_unrelated_live' });
  const approved = [];
  const h = makeWatcher({
    root,
    env: {
      GHOST_AGENCY_HERO_OWNER_PRACTICE_ONLY: '1',
      GHOST_AGENCY_HERO_OWNER_PRACTICE_JOB_ID: 'hrj_practice_exact',
    },
    apiImpl: async (_pathname, request) => {
      approved.push(JSON.parse(request.body).job_id);
      return { ok: true, status: 200, body: { ok: true, job: { status: 'queued' } } };
    },
  });
  const result = await h.watcher.scanOnce();
  assert.deepEqual(result, { disabled: false, found: 1, approved: 1, failed: 0, skipped: 0 });
  assert.deepEqual(approved, ['hrj_practice_exact']);
  assert.equal(JSON.parse(fs.readFileSync(practiceReceipt, 'utf8')).approved, true);
  assert.equal(JSON.parse(fs.readFileSync(unrelatedReceipt, 'utf8')).approved, undefined);
});

test('Practice watcher fails before construction when its exact job id is absent', () => {
  let constructed = 0;
  assert.throws(() => watcherModule.createOwnerApprovalWatcher({
    env: {
      GHOST_AGENCY_HERO_OWNER_WATCHER: '1',
      GHOST_AGENCY_HERO_OWNER_PRACTICE_ONLY: '1',
      GHOST_AGENCY_ADMIN_TOKEN: 'owner-test-token',
    },
    workerFactory: () => { constructed += 1; return {}; },
  }), /hero_owner_practice_job_id_required/);
  assert.equal(constructed, 0);
});

test('watcher defaults off and only an explicit opt-in enables it', () => {
  let constructed = 0;
  const watcher = watcherModule.createOwnerApprovalWatcher({
    env: {},
    workerFactory: () => { constructed += 1; throw new Error('must not construct'); },
  });
  assert.equal(watcher.disabled, true);
  assert.equal(watcherModule.watcherEnabled({}), false);
  assert.equal(watcherModule.watcherEnabled({ GHOST_AGENCY_HERO_AUTO_APPROVE: '1' }), false);
  assert.equal(watcherModule.watcherEnabled({ GHOST_AGENCY_HERO_OWNER_WATCHER: 'true' }), false);
  assert.equal(watcherModule.watcherEnabled({ GHOST_AGENCY_HERO_OWNER_WATCHER: '1' }), true);
  assert.equal(watcherModule.watcherEnabled({
    GHOST_AGENCY_HERO_OWNER_WATCHER: '1',
    GHOST_AGENCY_HERO_AUTO_APPROVE: '0',
  }), false);
  assert.equal(constructed, 0);
});

test('kill switches prevent scanning and worker creation', async () => {
  let constructed = 0;
  const watcher = watcherModule.createOwnerApprovalWatcher({
    env: { GHOST_AGENCY_HERO_AUTO_APPROVE: '0' },
    workerFactory: () => { constructed += 1; throw new Error('must not construct'); },
  });
  assert.equal(watcher.disabled, true);
  assert.equal(constructed, 0);
  assert.deepEqual(await watcher.scanOnce(), { disabled: true, found: 0, approved: 0, failed: 0, skipped: 0 });

  const secondary = watcherModule.createOwnerApprovalWatcher({
    env: { GHOST_AGENCY_HERO_OWNER_WATCHER: '0' },
    workerFactory: () => { constructed += 1; throw new Error('must not construct'); },
  });
  assert.equal(secondary.disabled, true);
  assert.equal(constructed, 0);
});

test('missing or equal admin credential fails before owner worker construction', () => {
  let constructed = 0;
  const workerFactory = () => { constructed += 1; throw new Error('must not construct'); };
  assert.throws(
    () => watcherModule.createOwnerApprovalWatcher({
      env: { GHOST_AGENCY_HERO_OWNER_WATCHER: '1' },
      workerFactory,
    }),
    { code: 'GHOST_AGENCY_ADMIN_TOKEN_required_for_approval' },
  );
  assert.throws(
    () => watcherModule.createOwnerApprovalWatcher({
      env: {
        GHOST_AGENCY_HERO_OWNER_WATCHER: '1',
        GHOST_AGENCY_ADMIN_TOKEN: 'same-token',
        GHOST_AGENCY_HERO_WORKER_TOKEN: 'same-token',
      },
      workerFactory,
    }),
    { code: 'hero_worker_token_must_differ_from_admin' },
  );
  assert.equal(constructed, 0);
});

test('outside and invalid receipts never reach the owner approval API', async (t) => {
  const root = makeReviewRoot(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-owner-outside-test-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  writeReceipt(outside, { job_id: 'outside_job' });
  const outsideClip = path.join(outside, 'foreign.mp4');
  fs.writeFileSync(outsideClip, CLIP);
  writeReceipt(root, { job_id: 'inside_bad_clip', clip_path: outsideClip, skip_clip: true });
  const malformedDir = path.join(root, 'malformed');
  fs.mkdirSync(malformedDir);
  fs.writeFileSync(path.join(malformedDir, 'bad.json'), '{not-json');
  let calls = 0;
  const h = makeWatcher({
    root,
    apiImpl: async () => { calls += 1; return { ok: true, status: 200, body: { ok: true } }; },
  });

  const result = await h.watcher.scanOnce();
  assert.equal(result.found, 1, 'only the inside parseable receipt is presented to the strict verifier');
  assert.equal(result.approved, 0);
  assert.equal(result.failed, 1);
  assert.equal(calls, 0, 'clip path confinement fails before any API request');
  assert.deepEqual(h.logs, ['approval refusals 1 review_clip_path_refused']);
});

test('transport failure after local marking retries the same receipt, then stays idempotent', async (t) => {
  const root = makeReviewRoot(t);
  writeReceipt(root);
  let calls = 0;
  let now = 1_800_000_000_000;
  const logs = [];
  const h = makeWatcher({
    root,
    logs,
    nowImpl: () => now,
    apiImpl: async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503, body: { error: 'temporary' } };
      return { ok: true, status: 200, body: { ok: true, reused: calls > 2, job: { status: 'queued' } } };
    },
  });

  assert.equal((await h.watcher.scanOnce()).failed, 1);
  now += 30_000;
  assert.equal((await h.watcher.scanOnce()).approved, 1);
  assert.equal((await h.watcher.scanOnce()).skipped, 1);
  assert.equal(calls, 2);
  assert.deepEqual(logs, ['approval refusals 1 review_approval_failed']);
  assert.doesNotMatch(logs.join(' '), /owner-test-token|distinct-worker-test-token|hrj_owner_watcher|wss-test-owner-watcher/);
});

test('a 101st receipt is reached on tick two instead of starving behind successful receipts', async (t) => {
  const root = makeReviewRoot(t);
  for (let index = 1; index <= 101; index += 1) {
    writeReceipt(root, { job_id: `hrj_bulk_${String(index).padStart(3, '0')}` });
  }
  const approvedJobs = [];
  const h = makeWatcher({
    root,
    apiImpl: async (_pathname, request) => {
      approvedJobs.push(JSON.parse(request.body).job_id);
      return { ok: true, status: 200, body: { ok: true, job: { status: 'queued' } } };
    },
  });

  const first = await h.watcher.scanOnce();
  const second = await h.watcher.scanOnce();
  assert.equal(first.found, 101);
  assert.equal(first.approved, 100);
  assert.equal(second.approved, 1);
  assert.equal(second.skipped, 100);
  assert.equal(approvedJobs.length, 101);
  assert.equal(approvedJobs.at(-1), 'hrj_bulk_101');
});

test('failed receipts are capped and rotation still reaches valid work behind them', async (t) => {
  const root = makeReviewRoot(t);
  for (let index = 1; index <= 102; index += 1) {
    writeReceipt(root, { job_id: `hrj_rotate_${String(index).padStart(3, '0')}` });
  }
  const callsByTick = [0, 0];
  let tick = 0;
  let validReached = false;
  const h = makeWatcher({
    root,
    apiImpl: async (_pathname, request) => {
      callsByTick[tick] += 1;
      const jobId = JSON.parse(request.body).job_id;
      if (jobId === 'hrj_rotate_102') {
        validReached = true;
        return { ok: true, status: 200, body: { ok: true, job: { status: 'queued' } } };
      }
      return { ok: false, status: 409, body: { error: 'approval_state_conflict' } };
    },
  });

  const first = await h.watcher.scanOnce();
  tick = 1;
  const second = await h.watcher.scanOnce();
  assert.equal(first.failed, 100);
  assert.equal(second.approved, 1);
  assert.equal(callsByTick[0], 100);
  assert.equal(callsByTick[1], 2);
  assert.equal(validReached, true, 'the rotating second tick reaches receipt 102');
});

test('cooldown stops stale repeats while a newly arrived valid receipt runs immediately', async (t) => {
  const root = makeReviewRoot(t);
  writeReceipt(root, { job_id: 'hrj_cooldown_001' });
  const callsByTick = [[], []];
  let tick = 0;
  const h = makeWatcher({
    root,
    nowImpl: () => 1_800_000_000_000,
    apiImpl: async (_pathname, request) => {
      const jobId = JSON.parse(request.body).job_id;
      callsByTick[tick].push(jobId);
      if (jobId === 'hrj_cooldown_002') {
        return { ok: true, status: 200, body: { ok: true, job: { status: 'queued' } } };
      }
      return { ok: false, status: 409, body: { error: 'approval_state_conflict' } };
    },
  });

  assert.equal((await h.watcher.scanOnce()).failed, 1);
  writeReceipt(root, { job_id: 'hrj_cooldown_002' });
  tick = 1;
  const second = await h.watcher.scanOnce();
  assert.deepEqual(callsByTick[0], ['hrj_cooldown_001']);
  assert.deepEqual(callsByTick[1], ['hrj_cooldown_002']);
  assert.equal(second.approved, 1);
  assert.equal(second.skipped, 1);
});

test('polling stays in the required one-to-two-second window', () => {
  assert.equal(watcherModule.parsePollMs([], {}), 1500);
  assert.equal(watcherModule.parsePollMs(['--poll-ms=1']), 1000);
  assert.equal(watcherModule.parsePollMs(['--poll-ms', '9999']), 2000);
});
