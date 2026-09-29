'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const donor = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'donors', name, 'donor.json'), 'utf8'));

test('landscaping smoke manifest declares only rendered client-bound channels', () => {
  const manifest = donor('landscaping');
  const home = fs.readFileSync(path.join(__dirname, '..', 'donors', 'landscaping', 'source', 'src', 'pages', 'Index.tsx'), 'utf8');
  assert.deepEqual(Object.keys(manifest.content_render_targets).sort(), ['faqs', 'services']);
  assert.deepEqual(manifest.content_render_targets.services, [{ path: '/', selector: 'section#services' }]);
  assert.deepEqual(manifest.content_render_targets.faqs, [{ path: '/', selector: 'section#faq' }]);
  assert.match(home, /clientData\.services\.map/);
  assert.match(home, /const faqs = clientData\.faqs/);
  assert.doesNotMatch(home, /<TrustSection\b/);
  for (const channel of ['reviews', 'hours', 'areas']) {
    assert.match(manifest.content_channel_availability[channel], /^unavailable_/);
    assert.equal(manifest.content_render_targets[channel], undefined);
  }
});

test('drywall donor stays restricted to its actual trade', () => {
  const manifest = donor('catalog/15-american-drywall-plaster-llc');
  const { mapDonor } = require('../donors/catalog/15-american-drywall-plaster-llc/mapping.cjs');
  const facts = { name: 'Bespoke Design & Construction', city: 'Tulsa', state: 'OK', phone: '555-0100', website: 'https://example.test', category: 'general contracting' };
  assert.equal(manifest.category, 'general contractor');
  assert.throws(() => mapDonor({ facts, services: [], files: {}, manifest }), /donor_category_mismatch/);
  assert.throws(() => mapDonor({ facts: { ...facts, category: manifest.category }, services: [{ name: 'Kitchen remodeling' }], files: {}, manifest }), /donor_wrong_trade/);
});

test('MHB general-construction donor retains category-family mapping and service-file gate', () => {
  const manifest = donor('catalog/03-mhb-build-llc');
  const { mapDonor } = require('../donors/catalog/03-mhb-build-llc/mapping.cjs');
  assert.equal(manifest.category, 'general contractor');
  const facts = { name: 'Bespoke Design & Construction', city: 'Tulsa', state: 'OK', phone: '555-0100', website: 'https://example.test', category: 'general contracting' };
  assert.throws(() => mapDonor({ facts, services: [{ name: 'Custom construction', description: 'Verified work description' }], files: {}, manifest }), /construction_service_copy_unbound/);
});
