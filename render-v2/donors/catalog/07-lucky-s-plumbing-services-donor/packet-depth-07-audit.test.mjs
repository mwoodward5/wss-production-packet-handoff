import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import contract from '../../../contracts/genie-packet.cjs';
import adapter from '../../../adapters/genie-to-client.cjs';
import mapping from './mapping.cjs';

// Read-only audit of existing saved records. No constructed certified packets,
// writes, network calls, browser launches, source defaults, or live workers.
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../../..');
const read = rel => fs.readFileSync(path.join(dir, rel), 'utf8');
const manifest = JSON.parse(read('donor.json'));
const page = read('source/src/pages/Index.tsx');
const bridge = read('source/src/wss/bridge.ts');
const app = read('source/src/App.tsx');
const records = JSON.parse(fs.readFileSync(path.join(root, 'evidence/recent-candidates.json'), 'utf8').replace(/^\uFEFF/, ''));
const plumbing = records.filter(x => x.record?.genie_canonical_packet?.facts?.category === 'plumbing');
const real = plumbing.find(x => x.prospect_id === 'lm-6fcfc2cd441d49b1a26d4781c898add42f2b5ca8');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedTargets = {
  services: [{ path: '/', selector: 'section#services' }],
  about: [{ path: '/', selector: 'footer > .container > div:first-child > p' }],
  hours: [{ path: '/', selector: 'section#contact .divide-y' }],
  areas: [{ path: '/', selector: 'section#contact > div > div:last-child' }],
};

test('manifest names only source-backed stable home targets; readiness remains false', () => {
  assert.equal(manifest.category, 'plumbing');
  assert.equal(manifest.data_island_id, 'wss-client-data');
  assert.deepEqual(manifest.content_render_targets, expectedTargets);
  for (const key of ['runtime_eligible', 'client_bindings_verified', 'visual_parity_verified']) assert.equal(manifest[key], false);
  for (const key of ['faqs', 'reviews']) {
    assert.equal(manifest.content_render_targets[key], undefined);
    assert.ok(!String(manifest.content_channel_availability?.[key] || '').startsWith('unavailable'), 'do not bypass supplied-channel proof');
  }
});
test('services and about targets correspond to client-bound source, not JSON-island text', () => {
  assert.match(page, /<section id="services"/);
  assert.match(page, /client\.services\)\.map/);
  assert.match(page, /\{s\.desc\}/);
  assert.match(page, /const ABOUT = client\.content\.about/);
  assert.match(page.slice(page.indexOf('{/* FOOTER */}')), /<footer[\s\S]*?<div className="container[\s\S]*?<p[^>]*>\s*\{ABOUT\}/);
  assert.match(bridge, /getElementById\('wss-client-data'\)/);
});
test('hours and areas targets keep their containers when source channels are redacted', () => {
  assert.match(page, /<div className="mt-5 divide-y divide-border">\s*\{liveHours\.length/);
  assert.match(page, /Contact \{BUSINESS\} to confirm current availability/);
  assert.match(bridge, /hours: hoursRows\(client\.trust\.hours\)/);
  const contact = page.slice(page.indexOf('{/* CONTACT */}'), page.indexOf('{/* FAQ */}'));
  assert.match(contact, /<section id="contact"[\s\S]*?<div className="grid lg:grid-cols-12[\s\S]*?<div className="lg:col-span-7">/);
  assert.match(contact, /client\.trust\.areas\.length > 0/);
  assert.match(contact, /client\.trust\.areas\.join/);
});

test('real representative is pinned to its existing canonical packet hash', () => {
  assert.ok(real, 'saved Arvada Plumbing Co record is required');
  assert.equal(real.record.genie_canonical_packet.facts.website, 'https://arvadaplumbingco.com/');
  assert.equal(contract.packetHash(real.record.genie_canonical_packet), '0c38d64e793e5784bd5f6912532c6eccecebd66d6fd853c3b28e8d0c438c2d3c');
});
test('all nine real plumbing packets have verified visitor files but no service markdown', () => {
  assert.equal(plumbing.length, 9, 'saved evidence changed: re-audit before updating expectations');
  for (const x of plumbing) assert.deepEqual(Object.keys(contract.certifiedVisitorFiles(x.record.genie_canonical_packet)), ['content/home.md']);
});
test('eight real records validate but correctly fail donor service-file admission', () => {
  let passed = 0; const failures = [];
  for (const x of plumbing) {
    let c;
    try { c = contract.validateRecord(x); } catch (e) { failures.push({ code: e.code, path: e.path }); continue; }
    passed++;
    assert.ok(c.services.every(s => s.file === 'content/home.md'));
    assert.throws(() => mapping.mapDonor({ ...c, manifest }), /donor_service_unbound/);
  }
  assert.equal(passed, 8);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, 'genie_fact_missing');
});
test('mutating actual visitor bytes without re-signing hashes is rejected', () => {
  const changed = structuredClone(real);
  changed.record.genie_canonical_packet.content.content_contract.visitor_copy.files['content/home.md'] += '\n';
  assert.deepEqual(contract.certifiedVisitorFiles(changed.record.genie_canonical_packet), {});
  assert.throws(() => contract.validateRecord(changed), /genie_home_copy_missing/);
});
