'use strict';
// Mapper mechanism probes use existing donor-reference text only.
// They are NOT certified Genie packets, real-prospect fixtures, or render proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const manifest = JSON.parse(read('donor.json'));
const { mapDonor, trade } = require('./mapping.cjs');
const reference = read('source/public/llms.txt');
const copy = reference.split(/\r?\n/).find(line => line.startsWith('Circle C Contracting installs'));
const name = reference.match(/\bExcavation\b/)[0];
const file = 'content/services/excavation.md';
function probe() {
  const slot = key => manifest.content_slots.find(row => row.slot === key).value;
  return { facts: { name: manifest.name, city: slot('location_city'), state: slot('location_region'),
    phone: slot('phone'), website: manifest.source.repository, category: 'excavation' },
    // website is the known source repository, not a claimed prospect website.
    services: [{ name, description: copy, file }], manifest,
    files: { 'content/home.md': '# Reference\n\n' + copy,
      'content/about.md': '# Reference\n\n' + copy, [file]: '# ' + name + '\n\n' + copy } };
}
test('source-reference mapper probe retains exact extracted copy; no invented depth', () => {
  const result = mapDonor(probe());
  assert.equal(result.heroText.support, copy); assert.equal(result.serviceIntro, copy);
  assert.equal(result.about, copy); assert.deepEqual(result.values, []);
  assert.equal(result.seasonalNote, ''); assert.equal(result.ctaBody, '');
});
for (const [label, change] of [
  ['missing binding', p => delete p.services[0].file],
  ['home fallback', p => p.services[0].file = 'content/home.md'],
  ['non-markdown', p => { p.services[0].file = 'content/services/excavation.json'; p.files[p.services[0].file] = copy; }],
  ['traversal', p => { p.services[0].file = 'content/services/../about.md'; p.files[p.services[0].file] = copy; }],
  ['missing file', p => delete p.files[file]],
  ['missing file map', p => delete p.files],
  ['inherited file', p => p.files = Object.create(p.files)],
  ['non-string file', p => p.files[file] = { text: copy }],
  ['changed description byte', p => p.services[0].description = copy.replace('installs', 'Installs')],
  ['changed markdown byte', p => p.files[file] = p.files[file].replace('installs', 'Installs')],
  ['heading-only markdown', p => p.files[file] = '# ' + name],
]) test('rejects ' + label, () => {
  const p = probe(); change(p);
  assert.throws(() => mapDonor(p), /donor_service_copy_unbound/);
});
test('excavation trade and identity gates stay closed', () => {
  const p = probe(); p.facts.category = 'general contracting';
  assert.throws(() => mapDonor(p), /donor_wrong_trade/);
  p.facts.category = 'excavation'; p.manifest = { ...manifest, category: 'landscaping' };
  assert.throws(() => mapDonor(p), /donor_wrong_trade/);
  p.manifest = manifest; p.services.push({ ...p.services[0], name: 'unsupported-test-only' });
  assert.throws(() => mapDonor(p), /donor_services_unsupported/);
  p.services.pop(); delete p.facts.phone;
  assert.throws(() => mapDonor(p), /donor_identity_required/);
});
test('manifest declares existing native selectors without claiming proof', () => {
  const expected = { services: '#services article', about: '#why p', faqs: '#faq',
    reviews: '#reviews', hours: '#contact .space-y-4 > p', areas: '#area ul' };
  assert.equal(manifest.data_island_id, 'wss-client-data');
  for (const [channel, selector] of Object.entries(expected))
    assert.deepEqual(manifest.content_render_targets[channel], [{ path: '/', selector }]);
  assert.equal(manifest.runtime_eligible, false); assert.equal(manifest.client_bindings_verified, false);
  assert.equal(manifest.visual_parity_verified, false); assert.equal(manifest.category, 'excavation');
  assert.equal(manifest.content_render_targets.process, undefined);
  assert.match(manifest.content_channel_availability.process, /^unavailable_/);
  assert.match(read('source/src/components/site/Services.tsx'), /client\.services\.map/);
  assert.match(read('source/src/components/site/Services.tsx'), /<article/);
  assert.match(read('source/src/components/site/WhyUs.tsx'), /plan\?\.content\?\.about \|\| client\.content\.about/);
  assert.match(read('source/src/components/site/Contact.tsx'), /<div className="space-y-4">/);
  assert.match(read('source/src/components/site/Contact.tsx'), /typeof client\.trust\.hours\?\.text === 'string' && <p /);
});
test('absent native optional channels stay omitted', () => {
  const app = read('source/src/wss/App.tsx');
  assert.match(app, /if \(!client\.content\.faqs\.length\) return null/);
  assert.match(app, /if \(!reviews\.length && \(aggregate\?\.rating == null \|\| aggregate\?\.count == null\)\) return null/);
  assert.match(read('source/src/components/site/ServiceArea.tsx'), /if \(!towns\.length\) return null/);
  assert.match(read('source/src/components/site/FieldConditions.tsx'), /if \(!client\.content\.seasonalNote\) return null/);
});
test('donor-reference inputs cannot masquerade as a certified packet', () => {
  const { validateRecord } = require(path.join(root, 'contracts/genie-packet.cjs'));
  assert.throws(() => validateRecord(probe()), /genie_packet_missing/);
});
test('pinned bundle hashes match and expanded residue scan is clean', () => {
  const { readTree, treeHash } = require(path.join(root, 'build/file-tree.cjs'));
  const { scan } = require(path.join(root, 'gates/donor-leak.cjs'));
  const bundle = readTree(path.join(__dirname, 'bundle'));
  assert.equal(treeHash(bundle), manifest.bundle.tree_sha256);
  for (const [file, sha] of Object.entries(manifest.bundle.files))
    assert.equal(crypto.createHash('sha256').update(bundle[file]).digest('hex'), sha);
  assert.ok(manifest.leak_terms.includes('circle-c-contracting.com'));
  assert.ok(manifest.leak_terms.includes('Onawa')); assert.ok(manifest.leak_terms.includes('(712) 420-9512'));
  assert.deepEqual(scan(bundle, manifest.leak_terms), { ok: true, hits: [] });
});
test('static route/mobile guards remain present; not browser proof', () => {
  const app = read('source/src/wss/App.tsx');
  assert.match(app, /client\.services\.find\(s => s\.href === route\)/);
  assert.match(app, /richService\?\.longDescMd \|\| service\.description/);
  assert.match(app, /Page not found/);
  assert.match(read('source/src/components/site/Nav.tsx'), /aria-expanded=\{open\}/);
  assert.match(read('source/src/components/site/StickyMobileCTA.tsx'), /safe-area-inset-bottom/);
  assert.match(read('source/src/components/site/Hero.tsx'), /prefers-reduced-motion: reduce/);
  assert.deepEqual(manifest.breakpoints, [1440, 768, 390]);
});
test('documents shared service-baseline incompatibility without bypassing it', () => {
  const { emptyChannel } = require(path.join(root, 'build/content-proof.cjs'));
  const p = probe(); const baseline = emptyChannel({ services: p.services, content: {}, source: { category: 'excavation' } }, 'services');
  assert.equal(baseline.services.every(s => trade.test(s.name)), false);
});
