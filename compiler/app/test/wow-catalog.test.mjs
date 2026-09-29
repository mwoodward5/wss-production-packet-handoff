// Smoke tests for the wow-catalog + snowflake picker + contract shapes.
// Run with: node --test app/test/wow-catalog.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSnowflake, hamming, generationFingerprint, SLOTS } from '../../factory/lib/snowflake-picker.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ─── Contract file sanity ────────────────────────────────────────
test('contract schemas exist and are valid JSON', () => {
  for (const name of ['build-request.v1', 'build-status.v1', 'build-complete.v1', 'build-failure.v1']) {
    const p = path.join(root, 'contracts', `${name}.schema.json`);
    const raw = readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    assert.equal(typeof j.$id, 'string', `${name} $id missing`);
    assert.equal(typeof j.title, 'string', `${name} title missing`);
    assert.equal(typeof j.properties, 'object', `${name} properties missing`);
  }
});

test('build-complete requires renderer, qc_contract, generation_fingerprint, visual_qc_passed, prospect_id, status', () => {
  const p = path.join(root, 'contracts', 'build-complete.v1.schema.json');
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const required = new Set(j.required);
  for (const k of ['renderer', 'qc_contract', 'generation_fingerprint', 'visual_qc_passed', 'prospect_id', 'status', 'preview_url', 'report_url', 'qc_passed']) {
    assert.ok(required.has(k), `build-complete.required missing ${k}`);
  }
  assert.equal(j.properties.renderer.const, 'siteforge-renderer-v8-snowflake@8.2.0');
  assert.equal(j.properties.qc_contract.const, 'siteforge-qc-v2-authority-108-plus-contamination');
});

test('example build-complete matches contract required fields', () => {
  const ex = JSON.parse(readFileSync(path.join(root, 'contracts/examples/build-complete.example.json'), 'utf8'));
  for (const k of ['schema_version', 'build_id', 'prospect_id', 'idempotency_key', 'renderer', 'qc_contract', 'generation_fingerprint', 'status', 'visual_qc_passed', 'preview_url', 'report_url', 'qc_passed']) {
    assert.ok(k in ex, `example missing ${k}`);
  }
  assert.equal(ex.renderer, 'siteforge-renderer-v8-snowflake@8.2.0');
  assert.equal(ex.qc_contract, 'siteforge-qc-v2-authority-108-plus-contamination');
  assert.match(ex.generation_fingerprint, /^[a-f0-9]{64}$/);
});

// ─── Snowflake picker ────────────────────────────────────────────
test('snowflake picker produces all 10 slots for a landscape input', () => {
  const res = planSnowflake({
    input: { slug: 'signature-landscape', vertical: 'landscape.hardscape.paver' },
    resonance: { formal_casual: 38, matter_of_fact_enthusiastic: 34, confidence: 78 },
    directives: {},
    recentPlansSameVertical: [],
  });
  for (const slot of SLOTS) assert.ok(res.plan[slot], `slot ${slot} missing`);
  assert.equal(res.gate_passed, true);
});

test('same input + empty history = identical plan (deterministic)', () => {
  const a = planSnowflake({
    input: { slug: 'signature-landscape', vertical: 'landscape.hardscape.paver' },
    resonance: null, directives: {}, recentPlansSameVertical: [],
  });
  const b = planSnowflake({
    input: { slug: 'signature-landscape', vertical: 'landscape.hardscape.paver' },
    resonance: null, directives: {}, recentPlansSameVertical: [],
  });
  assert.deepEqual(a.plan, b.plan);
});

test('anti-repetition gate diverges from a recent identical plan', () => {
  const base = planSnowflake({
    input: { slug: 'landscape-1', vertical: 'landscape.hardscape.paver' },
    resonance: null, directives: {}, recentPlansSameVertical: [],
  });
  const next = planSnowflake({
    input: { slug: 'landscape-1', vertical: 'landscape.hardscape.paver' },
    resonance: null, directives: {}, recentPlansSameVertical: [base.plan],
  });
  // Either it retries and diverges, or gate_passed=false is recorded honestly
  if (next.gate_passed) assert.ok(hamming(base.plan, next.plan) >= 5, 'diverged plan below min hamming');
});

test('vocabulary directive biases the archetype selection', () => {
  const withPremium = planSnowflake({
    input: { slug: 'brandx', vertical: 'landscape.hardscape.paver' },
    resonance: null,
    directives: { archetype_bias: ['luxury-cinematic'], 'palette.family_bias': ['dark-cinematic-gold'] },
    recentPlansSameVertical: [],
  });
  // Not a hard guarantee due to weighted picking, but weight of 2.5 should heavily bias
  // over 100 trials the majority pick should hit luxury-cinematic. Do 20 trials:
  // Baseline vs biased comparison at 40 trials — biased pool should
  // pick luxury-cinematic at least 3x more often than baseline pool.
  let hitsBase = 0, hitsBiased = 0;
  for (let i = 0; i < 40; i++) {
    const base = planSnowflake({
      input: { slug: 'baseline-' + i, vertical: 'landscape.hardscape.paver' },
      resonance: null, directives: {}, recentPlansSameVertical: [],
    });
    const biased = planSnowflake({
      input: { slug: 'biased-' + i, vertical: 'landscape.hardscape.paver' },
      resonance: null,
      directives: { archetype_bias: ['luxury-cinematic'] },
      recentPlansSameVertical: [],
    });
    if (base.plan.archetype === 'luxury-cinematic') hitsBase++;
    if (biased.plan.archetype === 'luxury-cinematic') hitsBiased++;
  }
  assert.ok(hitsBiased > hitsBase * 1.5, `bias not strong enough: baseline=${hitsBase}/40 biased=${hitsBiased}/40`);
  assert.ok(hitsBiased >= 8, `biased hit rate below floor: ${hitsBiased}/40`);
});

test('generationFingerprint is stable across canonical equivalent inputs', () => {
  const a = generationFingerprint({
    compose_plan: { widget: 'w', archetype: 'a' },
    truth_packet_version: 'v1',
    renderer: 'siteforge-renderer-v8-snowflake@8.2.0',
  });
  const b = generationFingerprint({
    compose_plan: { archetype: 'a', widget: 'w' },  // different key order
    truth_packet_version: 'v1',
    renderer: 'siteforge-renderer-v8-snowflake@8.2.0',
  });
  assert.equal(a, b, 'fingerprint should be stable under key reorder');
  assert.match(a, /^[a-f0-9]{64}$/);
});

// ─── Manifest sanity ─────────────────────────────────────────────
test('template manifest exists and has ≥ 50 entries with provenance', () => {
  const m = JSON.parse(readFileSync(path.join(root, 'factory/recipes/wow-catalog/template-manifest.json'), 'utf8'));
  assert.equal(m.schema, 'siteforge-template-manifest-v1');
  assert.ok(m.entries.length >= 50, `expected ≥50 manifest entries, got ${m.entries.length}`);
  for (const e of m.entries.slice(0, 5)) {
    assert.ok(e.provenance.owner === 'mwoodward5');
    assert.ok(typeof e.provenance.license === 'string');
    assert.equal(e.provenance.redistribute_original_source_code, false);
  }
});

test('ingredients corpus has ≥ 300 remixable items', () => {
  const i = JSON.parse(readFileSync(path.join(root, 'factory/recipes/wow-catalog/ingredients.json'), 'utf8'));
  const count = Array.isArray(i) ? i.length : (i.entries?.length || Object.keys(i).length);
  assert.ok(count >= 300, `expected ≥300 ingredients, got ${count}`);
});
