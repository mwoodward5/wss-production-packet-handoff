import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compilePacket, compileAuthenticatedHarvestPacket } = require('../api/compile-build-packet.js');
const intakeHandler = require('../api/intake-genie-compile.js');

function packet(source = 'https://sample-plumbing.example/services') {
  return {
    sources: { urls: ['https://sample-plumbing.example/'], observations: [
      { source, status: 'succeeded', extracted: { exactServices: 'Drain Cleaning' } },
    ] },
    business: { businessName: 'Sample Plumbing', category: 'Plumbing', city: 'Reno', state: 'NV',
      domainUrl: 'https://sample-plumbing.example/', exactServices: 'Drain Cleaning', mainServices: 'Drain Cleaning',
      servicesSource: 'source_observation' },
    goldenArtifacts: { exactServices: ['Drain Cleaning'], servicesSource: 'source_observation' },
    pagePlan: [{ title: 'Home', slug: '' }, { title: 'Drain Cleaning', slug: 'services/drain-cleaning' }],
  };
}

test('standalone structured extraction does not certify visitor service copy', () => {
  const compiled = compilePacket(packet());
  assert.deepEqual(compiled.compiled.services, []);
});

test('authenticated first-party extraction makes provisional pages with a publication lock', () => {
  const compiled = compileAuthenticatedHarvestPacket(packet());
  assert.equal(compiled.compiled.services.length, 1);
  assert.ok(compiled.compiled.productionLocks.some(lock => lock.key === 'provisional-service-proof' && lock.status === 'review'));
});

test('authenticated extraction still rejects a foreign service source', () => {
  const compiled = compileAuthenticatedHarvestPacket(packet('https://competitor-plumbing.example/services'));
  assert.deepEqual(compiled.compiled.services, []);
});

test('caller JSON cannot forge harvest trust', () => {
  const input = { ...packet(), authenticatedFirstPartyHarvest: true, _authenticatedFirstPartyHarvest: true };
  assert.deepEqual(compilePacket(input).compiled.services, []);
});

test('URL-first provisional services keep evidence below Ghost promotion threshold', () => {
  const website = 'https://sample-plumbing.example/';
  const extracted = { brandName: 'Sample Plumbing', city: 'Reno', state: 'NV', category: 'Plumbing',
    domainUrl: website, exactServices: 'Drain Cleaning' };
  const result = intakeHandler.compileCanonicalPacket(
    { website_url: website, prospect_hints: { name: 'Sample Plumbing', city: 'Reno', state: 'NV', category: 'Plumbing' } },
    { ok: true, sources: [website, `${website}services`], extracted,
      observations: [{ source: `${website}services`, status: 'succeeded', extracted }] },
  );
  assert.deepEqual(result.facts.services, ['Drain Cleaning']);
  assert.ok(result.packet2.compiled.productionLocks.some(lock => lock.key === 'provisional-service-proof'));
  const rows = [...result.service_evidence, ...result.evidence.filter(row => row.field === 'services')];
  assert.ok(rows.length >= 2);
  assert.ok(rows.every(row => row.verification_status === 'needs_review' && row.confidence < 0.8));
});
