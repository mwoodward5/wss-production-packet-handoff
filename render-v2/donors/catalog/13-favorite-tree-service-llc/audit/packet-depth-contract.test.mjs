import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import mapper from '../mapping.cjs';

// Structural unit-test tokens only. This is NOT a prospect, certified Genie
// packet, source receipt, or render fixture. No business claims are asserted.
const COPY = 'TEST-ONLY binding bytes; not a business description.';
const FILE = 'content/services/tree-removal.md';
function input() {
  return {
    facts: { name: '__TEST_ONLY__', city: '__TEST_ONLY__', state: '__TEST_ONLY__',
      phone: '__TEST_ONLY__', website: '__TEST_ONLY__', category: 'tree service' },
    services: [{ name: 'tree removal', description: COPY, file: FILE }],
    files: { 'content/home.md': COPY, 'content/about.md': COPY,
      [FILE]: '# tree removal\n\n' + COPY + '\n\n## Details\n\n' + COPY },
    manifest: { category: 'tree service' },
  };
}
const { mapDonor } = mapper;
function rejects(name, mutate, error = /donor_service_copy_unbound/) {
  test(name, () => { const value = input(); mutate(value); assert.throws(() => mapDonor(value), error); });
}
test('bound bytes map without inventing optional content or mutating input', () => {
  const value = input(); const before = JSON.stringify(value); const result = mapDonor(value);
  assert.equal(result.heroText.support, COPY); assert.equal(result.about, COPY);
  assert.equal(result.heroText.emphasis, value.services[0].name);
  assert.deepEqual(result.values, []); assert.equal(result.seasonalNote, '');
  assert.equal(JSON.stringify(value), before); assert.ok(Object.isFrozen(result));
});
rejects('missing service.file refuses', x => { delete x.services[0].file; });
rejects('missing file body refuses', x => { delete x.files[FILE]; });
rejects('mismatched file bytes refuse', x => { x.files[FILE] = COPY + ' altered'; });
rejects('a later matching paragraph cannot excuse a mismatched first paragraph', x => { x.files[FILE] = 'NOT THE SAME FIRST PARAGRAPH\n\n' + COPY; });
rejects('non-string file body refuses', x => { x.files[FILE] = { text: COPY }; });
rejects('inherited file body refuses', x => { x.files = Object.assign(Object.create({ [FILE]: COPY }), { 'content/home.md': COPY, 'content/about.md': COPY }); });
rejects('non-string file path refuses', x => { x.services[0].file = 1; });
rejects('wrong file prefix refuses', x => { x.services[0].file = 'content/home.md'; });
rejects('path traversal refuses', x => { x.services[0].file = 'content/services/../home.md'; x.files[x.services[0].file] = COPY; });
rejects('backslash file path refuses', x => { x.services[0].file = 'content/services/..\\home.md'; x.files[x.services[0].file] = COPY; });
rejects('non-markdown file refuses', x => { x.services[0].file = 'content/services/tree-removal.txt'; x.files[x.services[0].file] = COPY; });
rejects('leading paragraph spaces are not silently normalized', x => { x.files[FILE] = ' ' + COPY; });
rejects('trailing paragraph spaces are not silently normalized', x => { x.files[FILE] = COPY + ' '; });
rejects('internal CRLF is not silently changed to LF', x => { x.services[0].description = COPY + '\nSECOND LINE'; x.files[FILE] = COPY + '\r\nSECOND LINE'; });
rejects('every service must bind, not just the first', x => { x.services.push({ name: 'stump grinding', description: COPY }); });
rejects('missing about cannot silently reuse home', x => { delete x.files['content/about.md']; }, /donor_certified_copy_required/);
rejects('short about refuses', x => { x.files['content/about.md'] = 'short'; }, /donor_certified_copy_required/);
rejects('missing home refuses', x => { delete x.files['content/home.md']; }, /donor_certified_copy_required/);
rejects('wrong category refuses', x => { x.facts.category = 'general contracting'; }, /donor_wrong_trade/);
rejects('mismatched manifest category refuses', x => { x.manifest.category = 'landscaping'; }, /donor_wrong_trade/);
rejects('missing identity refuses', x => { delete x.facts.name; }, /donor_identity_required/);
rejects('empty services refuse', x => { x.services = []; }, /donor_services_required/);
rejects('null service refuses with contract error', x => { x.services = [null]; }, /donor_services_required/);
rejects('non-string service description refuses', x => { x.services[0].description = 7; }, /donor_services_required/);
for (const newline of ['\n', '\r\n']) {
  test('markdown heading and paragraph boundary accept ' + JSON.stringify(newline), () => {
    const x = input(); x.files[FILE] = '# tree removal' + newline + newline + COPY + newline;
    assert.doesNotThrow(() => mapDonor(x));
  });
  test('matching internal paragraph bytes accept ' + JSON.stringify(newline), () => {
    const x = input(); x.services[0].description = COPY + newline + 'SECOND TEST-ONLY LINE';
    x.files[FILE] = x.services[0].description + newline + newline + '## Details';
    assert.doesNotThrow(() => mapDonor(x));
  });
}
rejects('visually equivalent Unicode cannot hide changed bytes', x => {
  x.services[0].description = COPY + ' caf\u00e9'; x.files[FILE] = COPY + ' cafe\u0301';
});
test('manifest remains blocked and unique donor identity leak terms are covered', () => {
  const manifest = JSON.parse(readFileSync(new URL('../donor.json', import.meta.url), 'utf8'));
  assert.equal(manifest.runtime_eligible, false);
  assert.equal(manifest.client_bindings_verified, false);
  assert.equal(manifest.visual_parity_verified, false);
  for (const term of ['Favorite Tree Service, LLC', 'Favorite Tree Service',
    'favoritetreeservice.com', 'favoritetreeservice@aol.com']) {
    assert.ok(manifest.leak_terms.includes(term), 'Missing unique donor leak term: ' + term);
  }
});
