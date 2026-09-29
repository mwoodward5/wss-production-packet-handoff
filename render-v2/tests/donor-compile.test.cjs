'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const catalog = require('../categories/donor-catalog.json');
const { compile } = require('../build/compile-spa.cjs');
const root = path.resolve(__dirname, '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('adapted donors are self-contained and unadapted shells still refuse', () => {
  for (const row of catalog.donors) {
    const dir = path.join(root, 'donors', 'catalog', row.key);
    const file = path.join(dir, 'donor.json');
    const before = sha(fs.readFileSync(file));
    if (row.implementation_status === 'WSS_ADAPTED') {
      assert.ok(fs.existsSync(path.join(dir, 'source')), row.key + ':source');
      assert.ok(fs.existsSync(path.join(dir, 'mapping.cjs')), row.key + ':mapping');
      assert.ok(fs.existsSync(path.join(dir, 'bundle', 'index.html')), row.key + ':bundle');
    } else {
      assert.throws(() => compile(row.key), /spa_catalog_(?:adapter|original_source)_missing|spa_catalog_vite_build_failed/);
    }
    assert.equal(sha(fs.readFileSync(file)), before, row.key);
  }
});
test('catalog paths cannot escape the donor root', () => {
  assert.throws(() => require('../build/compile-spa.cjs').compileCatalog('../landscaping'),
    /spa_donor_key_invalid/);
});
