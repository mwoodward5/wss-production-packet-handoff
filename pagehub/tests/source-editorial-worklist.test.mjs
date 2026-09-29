import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { archiveSourcePages } = require('../api/lib/source-page-archive.js');
const { buildSourceEditorialWorklist } = require('../api/lib/source-editorial-worklist.js');

function packet(rows) {
  return { business: { domainUrl: 'https://airmastersjax.com/' }, sources: { observations: rows.map(([source, markdown]) => ({
    status: 'succeeded', source, private_source: { markdown, metadata: { title: source } }
  })) } };
}
test('indexes same-domain first-party source with provenance and classification', () => {
  const archive = archiveSourcePages(packet([
    ['https://airmastersjax.com/', 'Real home content'],
    ['https://www.airmastersjax.com/services/commercial-hvac', 'Commercial HVAC source content'],
    ['https://airmastersjax.com/about', 'About the company']
  ]));
  const result = buildSourceEditorialWorklist(archive, 'https://airmastersjax.com/');
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(result.candidates.map(row => row.kind), ['home', 'about', 'services']);
  assert.equal(result.candidates.find(row => row.kind === 'services').words, 4);
  assert.ok(result.candidates.every(row => row.sha256.length === 64 && row.file.startsWith('content/source-pages/')));
  assert.ok(result.candidates.every(row => !('text' in row) && row.publicationPolicy === 'private_editorial_planning_only'));
});
test('excludes demo, testimonials, boilerplate, and duplicate text', () => {
  const archive = archiveSourcePages(packet([
    ['https://airmastersjax.com/', 'Original real text'],
    ['https://airmastersjax.com/duplicate', 'Original real text'],
    ['https://airmastersjax.com/dt_testimonials/john-doe', 'Invented proof'],
    ['https://airmastersjax.com/privacy-policy', 'Privacy boilerplate'],
    ['https://airmastersjax.com/services', 'Service detail']
  ]));
  const result = buildSourceEditorialWorklist(archive, 'https://airmastersjax.com/');
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(new Set(result.excluded.map(row => row.reason)), new Set(['duplicate_source_hash', 'demo_or_testimonial_route', 'boilerplate_route']));
});
test('rejects cross-domain or tampered archive metadata without promoting text', () => {
  const archive = archiveSourcePages(packet([['https://airmastersjax.com/', 'Safe first-party text']]));
  archive.pages.push({ ...archive.pages[0], sourceUrl: 'https://other.example/page', route: '/page' });
  archive.pages.push({ ...archive.pages[0], sourceUrl: 'https://airmastersjax.com/changed', sha256: '0'.repeat(64) });
  const result = buildSourceEditorialWorklist(archive, 'https://airmastersjax.com/');
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(new Set(result.excluded.map(row => row.reason)), new Set(['outside_primary_domain', 'source_hash_mismatch']));
});
