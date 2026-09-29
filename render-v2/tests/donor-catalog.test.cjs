'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../categories/donor-catalog.json');
const { bundleFor } = require('../build/build-site.cjs');
const { eligible, pickDonor, resolveCategory } = require('../categories/donor-catalog-registry.cjs');
const { mapCategory } = require('../adapters/category-mapper.cjs');

test('all 46 generic reconstructions are refused by the real bundle loader', () => {
  for (const row of catalog.donors) {
    assert.throws(() => bundleFor(row.vertical, row.key), /spa_v2_donor_not_adapted/);
    assert.equal(pickDonor(row.vertical, 'proof'), null);
  }
});
test('a bare ready flag cannot authorize a scaffold', () => {
  const row = { ...catalog.donors[0], runtime_eligible: true };
  assert.equal(eligible(row), false);
  assert.equal(eligible({ ...row, implementation_status: 'WSS_ADAPTED' }), false);
});
test('category normalization never changes the letters in landscaping', () => {
  assert.equal(resolveCategory(' landscaping '), 'landscaping');
  assert.equal(resolveCategory('dental orthodontics'), null);
});
test('adapted catalog uses project-specific mapping and never generic prose', () => {
  const fs = require('node:fs'), path = require('node:path');
  const adapted = catalog.donors.filter(row => row.implementation_status === 'WSS_ADAPTED');
  assert.ok(adapted.length >= 34);
  for (const row of adapted) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'donors', 'catalog', row.key, 'mapping.cjs')), row.key);
  }
  assert.throws(() => mapCategory('roofing', { manifest: { key: 'missing-donor', category: 'roofing' } }),
    /spa_v2_donor_mapping_missing/);
});
