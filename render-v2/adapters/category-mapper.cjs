'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { mapLandscaping } = require('../donors/landscaping/mapping.cjs');

function mapCategory(category, input = {}) {
  const manifest = input.manifest || {};
  if (category === 'landscaping' && !manifest.key) return mapLandscaping(input);
  const key = String(manifest.key || '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) {
    throw new Error('spa_v2_donor_mapping_key_invalid');
  }
  if (manifest.category !== category) {
    throw new Error('spa_v2_donor_mapping_category_mismatch');
  }
  const filename = path.join(__dirname, '..', 'donors', 'catalog', key, 'mapping.cjs');
  if (!fs.existsSync(filename)) {
    throw new Error('spa_v2_donor_mapping_missing:' + key);
  }
  const adapter = require(filename);
  if (typeof adapter.mapDonor !== 'function') {
    throw new Error('spa_v2_donor_mapping_export_missing:' + key);
  }
  // Project-specific mapping is mandatory; generic copy cannot stand in for it.
  return adapter.mapDonor(input);
}
module.exports = Object.freeze({ mapCategory });
