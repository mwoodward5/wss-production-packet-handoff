'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mirrorSpaV2, loadVerifiedMedia } = require('../integration/line-mirror.cjs');
const { inputFor } = require('../runtime/render-inputs.cjs');

const ROOT = path.resolve(__dirname, '..');
const prospect = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/burns-record.json'), 'utf8').replace(/^\uFEFF/, ''));
const request = {
  slug: 'wss-test-burns-landscaping-houston',
  facts: { business_name: 'Burns Landscaping', city: 'Houston', state: 'TX', industry: 'landscaping' },
};
test('spa-v2 line dry-run is deterministic and non-revealable', async () => {
  const out = await mirrorSpaV2(request, {
    prospect,
    dryRun: true,
    deps: { fleetIdentities: async () => [] },
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.renderer, 'spa-v2');
  assert.equal(out.body.revealable, false);
  assert.equal(out.body.build_hash, 'f4de464043e7364c9162fd6984a78567690208d29e048a547f931f74ef7d8609');
  assert.equal(out.body.checks.content.status, 'failed');
  assert.equal(out.body.checks.route_render.status, 'failed');
});

test('spa-v2 line refuses to publish without rendered content proof', async () => {
  const seen = {};
  const publisher = {
    stage: async (input) => {
      seen.stage = input;
      return {
        ok: true,
        previewUrl: 'https://wss-test-burns-landscaping-houston.wss-ai.com/',
        proofIdentity: { site_id: 'site-v2', release_id: 'release-v2', build_hash: input.buildHash },
      };
    },
    activate: async (staged) => {
      seen.activate = staged;
      return {
        ok: true,
        previewUrl: staged.previewUrl,
        proofIdentity: staged.proofIdentity,
        releaseEvidence: {
          evidence_schema: 'shared-site-release-evidence-v1',
          state: 'active',
          site_id: staged.proofIdentity.site_id,
          release_id: staged.proofIdentity.release_id,
          build_hash: staged.proofIdentity.build_hash,
          canonical_host: 'wss-test-burns-landscaping-houston.wss-ai.com',
        },
      };
    },
  };
  const out = await mirrorSpaV2(request, {
    prospect,
    dryRun: false,
    operationKey: 'test-spa-v2',
    deps: {
      fleetIdentities: async () => [],
      sharedPublisher: publisher,
      signEvidence: () => 'b'.repeat(64),
    },
  });
  assert.equal(out.status, 422);
  assert.equal(out.body.revealable, false);
  assert.equal(out.body.renderer, 'spa-v2');
  assert.equal(out.body.build_hash, 'f4de464043e7364c9162fd6984a78567690208d29e048a547f931f74ef7d8609');
  assert.equal(out.body.error, 'spa_v2_content_proof_failed');
  assert.equal(out.body.checks.content.status, 'failed');
  assert.equal(seen.stage, undefined);
  assert.equal(seen.activate, undefined);
});
