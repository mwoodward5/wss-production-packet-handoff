import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BuildResponseInvalidError,
  validateBuildComplete,
} from '../../factory/lib/build-response-validator.mjs';

const ALLOWED_STATES = [
  'passed',
  'failed',
  'not-applicable',
  'needs-owner-input',
  'runtime-verification',
];

function validPayload() {
  return {
    schema_version: 'siteforge-build-complete-v1',
    build_id: 'build_test_1',
    prospect_id: 'prospect_test_1',
    idempotency_key: 'idempotency_test_1',
    renderer: 'siteforge-renderer-v8-snowflake@8.2.0',
    renderer_version: '8.2.0',
    authority_profile_version: 'authority-108-v1',
    truth_packet_version: 'siteforge-truth-packet-v1',
    qc_contract: 'siteforge-qc-v2-authority-108-plus-contamination',
    generation_fingerprint: 'a'.repeat(64),
    status: 'ready',
    preview_url: 'https://example.com/preview',
    report_url: 'https://example.com/report',
    qc_passed: true,
    visual_qc_passed: true,
    logo_provenance: {
      source: 'owner-uploaded',
      verified: true,
      stages_applied: ['background-removed', 'upscaled'],
    },
    media_provenance: {
      photos_verified_count: 3,
      photos_ai_atmosphere_count: 1,
      photos_dropped_low_quality: 2,
      gallery_photo_urls: ['https://example.com/photo.webp'],
    },
    optimization_manifest: {
      version: 'authority-108-v1',
      checks: Array.from({ length: 108 }, (_, index) => ({
        id: index + 1,
        category: `category-${(index % 9) + 1}`,
        label: `Authority check ${index + 1}`,
        state: ALLOWED_STATES[index % ALLOWED_STATES.length],
      })),
    },
    qc_summary: {
      authority_score: 108,
      authority_total: 108,
      hero_layers: 8,
      batch_hamming_min: 7,
    },
    completed_at: '2026-07-15T12:00:00.000Z',
  };
}

function expectInvalid(mutator, problemPattern) {
  const payload = validPayload();
  mutator(payload);
  assert.throws(
    () => validateBuildComplete(payload),
    (error) => {
      assert.ok(error instanceof BuildResponseInvalidError);
      assert.equal(error.code, 'BUILD_RESPONSE_CONTRACT_VIOLATION');
      assert.ok(error.problems.some((problem) => problemPattern.test(problem)), error.message);
      return true;
    },
  );
}

test('accepts the complete nested build-complete.v1 contract', () => {
  assert.equal(validateBuildComplete(validPayload()), true);
});

test('requires and validates logo provenance fields', () => {
  expectInvalid((payload) => delete payload.logo_provenance.source, /logo_provenance\.source/);
  expectInvalid((payload) => { payload.logo_provenance.source = 'unknown'; }, /logo_provenance\.source/);
  expectInvalid((payload) => { payload.logo_provenance.verified = 'yes'; }, /logo_provenance\.verified/);
  expectInvalid((payload) => delete payload.logo_provenance.stages_applied, /logo_provenance\.stages_applied/);
  expectInvalid((payload) => { payload.logo_provenance.stages_applied = ['invented-stage']; }, /stages_applied\[0\]/);
});

test('requires integer media counts and limits gallery URL entries', () => {
  expectInvalid((payload) => delete payload.media_provenance.photos_verified_count, /photos_verified_count/);
  expectInvalid((payload) => { payload.media_provenance.photos_ai_atmosphere_count = 1.5; }, /photos_ai_atmosphere_count/);
  expectInvalid((payload) => { payload.media_provenance.photos_dropped_low_quality = '2'; }, /photos_dropped_low_quality/);
  expectInvalid((payload) => {
    payload.media_provenance.gallery_photo_urls = Array.from({ length: 13 }, (_, index) => `https://example.com/${index}`);
  }, /at most 12 items/);
  expectInvalid((payload) => { payload.media_provenance.gallery_photo_urls = [42]; }, /gallery_photo_urls\[0\]/);
});

test('requires the authority-108 manifest version and exactly 108 checks', () => {
  expectInvalid((payload) => delete payload.optimization_manifest.version, /optimization_manifest\.version/);
  expectInvalid((payload) => { payload.optimization_manifest.version = 'authority-107-v1'; }, /optimization_manifest\.version/);
  expectInvalid((payload) => { payload.optimization_manifest.checks.pop(); }, /length 108/);
  expectInvalid((payload) => { payload.optimization_manifest.checks = {}; }, /checks must be an array/);
});

test('validates every authority check field', () => {
  expectInvalid((payload) => { payload.optimization_manifest.checks[0].id = 1.5; }, /checks\[0\]\.id/);
  expectInvalid((payload) => { payload.optimization_manifest.checks[0].id = 109; }, /checks\[0\]\.id/);
  expectInvalid((payload) => { payload.optimization_manifest.checks[0].category = '   '; }, /checks\[0\]\.category/);
  expectInvalid((payload) => { payload.optimization_manifest.checks[0].label = ''; }, /checks\[0\]\.label/);
  expectInvalid((payload) => { payload.optimization_manifest.checks[0].state = 'owner-input'; }, /checks\[0\]\.state/);
});

test('rejects duplicate optimization check ids', () => {
  expectInvalid((payload) => { payload.optimization_manifest.checks[107].id = 1; }, /duplicates check id 1/);
});

test('requires qc_summary contract fields when qc_summary is present', () => {
  for (const field of ['authority_score', 'authority_total', 'hero_layers', 'batch_hamming_min']) {
    expectInvalid((payload) => delete payload.qc_summary[field], new RegExp(`qc_summary\\.${field}`));
  }
  expectInvalid((payload) => { payload.qc_summary.authority_score = 109; }, /qc_summary\.authority_score/);
  expectInvalid((payload) => { payload.qc_summary.authority_total = 107; }, /qc_summary\.authority_total/);
  expectInvalid((payload) => { payload.qc_summary.hero_layers = 5; }, /qc_summary\.hero_layers/);
  expectInvalid((payload) => { payload.qc_summary.batch_hamming_min = 4; }, /qc_summary\.batch_hamming_min/);
  expectInvalid((payload) => { payload.qc_summary = null; }, /qc_summary must be an object/);

  const payload = validPayload();
  delete payload.qc_summary;
  assert.equal(validateBuildComplete(payload), true);
});
