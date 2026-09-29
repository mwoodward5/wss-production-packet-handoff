import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runBuild } from '../../factory/lib/build-runtime.mjs';
import {
  appendPlan,
  createMemoryStore,
  LAST_N,
  loadHistory,
} from '../../factory/lib/vertical-history.mjs';

test('factory history preserves sync stores and adapts async stores with an eight-row cap', async () => {
  const memory = createMemoryStore();
  const syncAppend = appendPlan('Roofing', { id: 'sync' }, { store: memory });
  const syncLoad = loadHistory('Roofing', { store: memory });

  assert.ok(Array.isArray(syncAppend));
  assert.ok(Array.isArray(syncLoad));
  assert.equal(syncLoad[0].plan.id, 'sync');

  const calls = [];
  const sourceRows = Array.from({ length: LAST_N + 2 }, (_, id) => ({
    at: new Date(id).toISOString(),
    plan: { id },
  }));
  const asyncStore = {
    async getVerticalHistory(vertical, options) {
      calls.push(['get', vertical, options.limit]);
      return sourceRows;
    },
    async appendVerticalHistory(vertical, plan, options) {
      calls.push(['append', vertical, options.limit]);
      return [...sourceRows, { at: new Date().toISOString(), plan }];
    },
  };

  const asyncLoad = loadHistory('Roofing / CA', { store: asyncStore });
  assert.equal(typeof asyncLoad.then, 'function');
  assert.deepEqual((await asyncLoad).map((row) => row.plan.id), [2, 3, 4, 5, 6, 7, 8, 9]);

  const appended = await appendPlan('Roofing / CA', { id: 'async' }, { store: asyncStore });
  assert.equal(appended.length, LAST_N);
  assert.equal(appended.at(-1).plan.id, 'async');
  assert.deepEqual(calls, [
    ['get', 'roofing___ca', LAST_N],
    ['append', 'roofing___ca', LAST_N],
  ]);
});

test('factory filesystem history remains synchronous, isolated, and capped', (t) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'siteforge-factory-history-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));

  let roofingRows;
  for (let id = 0; id < LAST_N + 2; id += 1) {
    roofingRows = appendPlan('roofing', { id }, { dataDir });
  }
  const hvacRows = appendPlan('hvac', { id: 'hvac' }, { dataDir });

  assert.ok(Array.isArray(roofingRows));
  assert.ok(Array.isArray(hvacRows));
  assert.deepEqual(loadHistory('roofing', { dataDir }).map((row) => row.plan.id), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(loadHistory('hvac', { dataDir }).map((row) => row.plan.id), ['hvac']);
});

test('runBuild loads async history before planning and awaits append after render', async () => {
  const events = [];
  let storedPlan;
  const store = {
    async getVerticalHistory(vertical, { limit }) {
      events.push(`load:${vertical}:${limit}:start`);
      await Promise.resolve();
      events.push('load:end');
      return [];
    },
    async appendVerticalHistory(vertical, plan, { limit }) {
      events.push(`append:${vertical}:${limit}:start`);
      await Promise.resolve();
      storedPlan = plan;
      events.push('append:end');
      return [{ at: new Date().toISOString(), plan }];
    },
  };

  const payload = await runBuild(validRequest('Roofing'), {
    providers: {
      store,
      runPremier: async (context) => {
        events.push('render');
        return stubPremierResult(context);
      },
    },
  });

  assert.deepEqual(events, [
    `load:roofing:${LAST_N}:start`,
    'load:end',
    'render',
    `append:roofing:${LAST_N}:start`,
    'append:end',
  ]);
  assert.deepEqual(storedPlan, payload.compose_plan);
});

test('runBuild fails closed when async history loading fails', async () => {
  const failure = new Error('history read failed');
  let rendered = false;
  let appended = false;

  await assert.rejects(
    runBuild(validRequest(), {
      providers: {
        store: {
          async getVerticalHistory() {
            throw failure;
          },
          async appendVerticalHistory() {
            appended = true;
            return [];
          },
        },
        async runPremier() {
          rendered = true;
          return {};
        },
      },
    }),
    (error) => error === failure,
  );

  assert.equal(rendered, false);
  assert.equal(appended, false);
});

test('runBuild does not append history when rendering fails', async () => {
  const failure = new Error('render failed');
  let appended = false;

  await assert.rejects(
    runBuild(validRequest(), {
      providers: {
        store: {
          async getVerticalHistory() {
            return [];
          },
          async appendVerticalHistory() {
            appended = true;
            return [];
          },
        },
        async runPremier() {
          throw failure;
        },
      },
    }),
    (error) => error === failure,
  );

  assert.equal(appended, false);
});

test('runBuild fails closed when async history append fails', async () => {
  const failure = new Error('history write failed');
  let rendered = false;

  await assert.rejects(
    runBuild(validRequest(), {
      providers: {
        store: {
          async getVerticalHistory() {
            return [];
          },
          async appendVerticalHistory() {
            throw failure;
          },
        },
        async runPremier(context) {
          rendered = true;
          return stubPremierResult(context);
        },
      },
    }),
    (error) => error === failure,
  );

  assert.equal(rendered, true);
});

test('runBuild finalizes one native reservation and releases it when rendering fails', async () => {
  const calls = [];
  const nativeStore = {
    async reserveVerticalPlan(vertical, selectPlan, options) {
      calls.push(['reserve', vertical, options.idempotencyKey]);
      return {
        reservation_id: 'native-reservation',
        selection: await selectPlan([]),
      };
    },
    async finalizeVerticalPlan(vertical, reservationId, options) {
      calls.push(['finalize', vertical, reservationId, options.limit]);
      return [];
    },
    async releaseVerticalPlan(vertical, reservationId) {
      calls.push(['release', vertical, reservationId]);
      return true;
    },
  };

  await runBuild(validRequest(), {
    providers: {
      store: nativeStore,
      runPremier: async (context) => stubPremierResult(context),
    },
  });
  assert.deepEqual(calls, [
    ['reserve', 'roofing', 'idem_async_history'],
    ['finalize', 'roofing', 'native-reservation', LAST_N],
  ]);

  calls.length = 0;
  await assert.rejects(
    runBuild(validRequest(), {
      providers: {
        store: nativeStore,
        runPremier: async () => { throw new Error('renderer failed'); },
      },
    }),
    /renderer failed/,
  );
  assert.deepEqual(calls, [
    ['reserve', 'roofing', 'idem_async_history'],
    ['release', 'roofing', 'native-reservation'],
  ]);

  calls.length = 0;
  await assert.rejects(
    runBuild(validRequest(), {
      providers: {
        store: nativeStore,
        runPremier: async () => ({}),
      },
    }),
  );
  assert.deepEqual(calls, [
    ['reserve', 'roofing', 'idem_async_history'],
    ['release', 'roofing', 'native-reservation'],
  ]);
});

test('runBuild renews a native reservation while a paid render is still running', async () => {
  const calls = [];
  let signalRenewed;
  const renewed = new Promise((resolve) => { signalRenewed = resolve; });
  const store = {
    async reserveVerticalPlan(vertical, selectPlan) {
      return {
        reservation_id: 'renewed-reservation',
        selection: await selectPlan([]),
      };
    },
    async renewVerticalPlan(vertical, reservationId, options) {
      calls.push(['renew', vertical, reservationId, options.ttlMs]);
      signalRenewed();
      return { reservation_id: reservationId };
    },
    async finalizeVerticalPlan(vertical, reservationId) {
      calls.push(['finalize', vertical, reservationId]);
      return [];
    },
    async releaseVerticalPlan(vertical, reservationId) {
      calls.push(['release', vertical, reservationId]);
      return true;
    },
  };

  await runBuild(validRequest(), {
    reservationRenewIntervalMs: 5,
    providers: {
      store,
      runPremier: async (context) => {
        await renewed;
        return stubPremierResult(context);
      },
    },
  });

  assert.ok(calls.some(([name]) => name === 'renew'));
  assert.ok(calls.some(([name]) => name === 'finalize'));
  assert.ok(!calls.some(([name]) => name === 'release'));
});

test('runBuild fails closed and releases the reservation when heartbeat renewal is lost', async () => {
  const failure = new Error('reservation heartbeat lost');
  const calls = [];
  let signalAttempted;
  const attempted = new Promise((resolve) => { signalAttempted = resolve; });
  const store = {
    async reserveVerticalPlan(vertical, selectPlan) {
      return {
        reservation_id: 'lost-reservation',
        selection: await selectPlan([]),
      };
    },
    async renewVerticalPlan(vertical, reservationId) {
      calls.push(['renew', vertical, reservationId]);
      signalAttempted();
      throw failure;
    },
    async finalizeVerticalPlan(vertical, reservationId) {
      calls.push(['finalize', vertical, reservationId]);
      return [];
    },
    async releaseVerticalPlan(vertical, reservationId) {
      calls.push(['release', vertical, reservationId]);
      return true;
    },
  };

  await assert.rejects(
    runBuild(validRequest(), {
      reservationRenewIntervalMs: 5,
      providers: {
        store,
        runPremier: async (context) => {
          await attempted;
          return stubPremierResult(context);
        },
      },
    }),
    (error) => error === failure,
  );

  assert.deepEqual(calls, [
    ['renew', 'roofing', 'lost-reservation'],
    ['release', 'roofing', 'lost-reservation'],
  ]);
});

function validRequest(vertical = 'roofing') {
  return {
    idempotency_key: 'idem_async_history',
    prospect_id: 'prosp_async_history',
    truth_packet: {
      business_name: 'Async Roofing',
      city: 'Austin',
      state: 'TX',
      vertical,
      services: ['inspection', 'repair'],
    },
    assets: { logo: null, photos: [] },
    plan_tier: 'free-preview',
  };
}

function stubPremierResult(context) {
  return {
    build_id: context.build_id,
    prospect_id: context.prospect_id,
    preview_url: 'https://example.com/preview',
    preview_url_owner_only: true,
    report_url: 'https://example.com/report',
    report_token: 'report_token',
    qc_passed: false,
    visual_qc_passed: false,
    qc_summary: {
      authority_score: 0,
      authority_total: 108,
      hero_layers: 6,
      batch_hamming_min: 5,
    },
    logo_provenance: {
      source: 'fallback-textmark',
      verified: false,
      stages_applied: [],
    },
    media_provenance: {
      photos_verified_count: 0,
      photos_ai_atmosphere_count: 0,
      photos_dropped_low_quality: 0,
    },
    optimization_manifest: {
      version: 'authority-108-v1',
      checks: Array.from({ length: 108 }, (_, index) => ({
        id: index + 1,
        category: 'fixture',
        label: `Authority fixture check ${index + 1}`,
        state: 'needs-owner-input',
      })),
    },
    outputs: {},
    checkout: {},
  };
}
