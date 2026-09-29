import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Q = require('../api/firecrawl-intake.js').intakeQuality;
const { compilePacket } = require('../api/compile-build-packet.js');
const html = readFileSync(resolve(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const begin = html.indexOf('    function buildPacket() {');
const end = html.indexOf('\n    function pick(', begin);
assert.ok(begin >= 0 && end > begin, 'UI buildPacket function must be available');
const buildPacketSource = html.slice(begin, end);

function uiPacket(form) {
  const state = { evidence: [], notes: [], sourceObservations: [],
    sourceAssets: { logos: [], images: [], social: [] }, uploadedFiles: [] };
  const ctx = createContext({
    Date, state, intakeQuality: Q, ADMIN_PACKET_RECIPIENT: 'woodwardsoftware+intake@gmail.com',
    readForm: () => form, scores: () => ({}), blockerList: () => [],
    adjustedScore: () => 100, inferTemplate: () => ({
      id: 'single-cinematic-motion', name: 'Single Cinematic Motion', family: 'Single-page',
    }),
    pagePlanFromForm: () => [{ title: 'Home', slug: '' }],
    buildAssetQa: () => ({}), buildProductionLocks: () => ({}),
    buildCompiledOutput: () => ({ preflight: { status: 'under_6_ready' }, manifest: { files: [] } }),
    buildRemixContract: () => ({}), uniqueValues: values => [...new Set(values)],
    sourceUrlsFromData: () => [], extractPalette: () => [],
    splitLines: value => String(value || '').split(/\r?\n|;/).map(s => s.trim()).filter(Boolean),
    pick: (data, keys) => Object.fromEntries(keys.map(key => [key, data[key]])),
    packetBrandFromData: () => ({}),
  });
  new Script(buildPacketSource).runInContext(ctx);
  return JSON.parse(JSON.stringify(new Script('buildPacket()').runInContext(ctx)));
}

test('UI protects only explicit protected input, never selected services or generic notes', () => {
  const exactServices = 'Commercial electrical repairs\nResidential and commercial electrical repairs\nHeating & Cooling';
  const form = { businessName: 'Modern Mechanical Contractors', websiteUrl: 'https://moderntn.com/',
    exactServices, mainServices: exactServices, protectedArtifacts: '',
    mustInclude: 'Use a concise Home section.', mustAvoid: 'No stock photos.',
    meetingNotes: 'Draft editorial guidance.', siteType: 'Single-scroll website' };
  const packet = uiPacket(form);
  assert.deepEqual(packet.goldenArtifacts.exactServices, exactServices.split('\n'));
  assert.deepEqual(packet.goldenArtifacts.protectedNotes, []);
  assert.equal(packet.business.protectedArtifacts, '');
  const explicit = uiPacket({ ...form, protectedArtifacts: 'Keep the approved warranty wording.' });
  assert.deepEqual(explicit.goldenArtifacts.protectedNotes, ['Keep the approved warranty wording.']);
  assert.equal(explicit.business.protectedArtifacts, 'Keep the approved warranty wording.');
});

const freshPath = 'C:/Users/Main/Desktop/WSS-Smoke-Integration-20260923/modern-final-prepatch-ui-input.json';
test('actual 19-observation Modern UI selection compiles exactly three owned services', {
  skip: !existsSync(freshPath),
}, () => {
  const saved = JSON.parse(readFileSync(freshPath, 'utf8'));
  assert.equal(saved.sourceObservations.length, 19);
  const selected = saved.form.exactServices.split(/\r?\n/).filter(Boolean);
  assert.deepEqual(selected, [
    'Commercial electrical repairs',
    'Residential and commercial electrical repairs',
    'Heating & Cooling',
  ]);
  const packet = structuredClone(saved.packet);
  packet.sources.observations = saved.sourceObservations;
  packet.goldenArtifacts.exactServices = selected;
  packet.goldenArtifacts.protectedNotes = uiPacket({
    ...saved.form, protectedArtifacts: '',
  }).goldenArtifacts.protectedNotes;
  packet.business.exactServices = saved.form.exactServices;
  packet.business.mainServices = saved.form.mainServices;
  packet.business.protectedArtifacts = '';
  const compiled = compilePacket(packet);
  assert.equal(compiled.compiled.contentQuality.status, 'pass');
  assert.equal(compiled.compiled.contentQuality.visitor.passCount,
    compiled.compiled.contentQuality.visitor.totalFiles);
  assert.deepEqual(compiled.compiled.manifest.routes, ['/']);
  assert.deepEqual(compiled.pagePlan.map(row => row.title), ['Home']);
  assert.deepEqual(compiled.compiled.services.map(row => row.name), selected);
  assert.deepEqual(compiled.compiled.contentContract.facts.services, selected);
  assert.ok(compiled.compiled.services.every(row => row.providerName === 'Modern Mechanical Contractors'));
  assert.equal(compiled.goldenArtifacts.protectedNotes.length, 0);
  assert.ok(!compiled.compiled.services.some(row => /plumbing|electrical repairs$/i.test(row.name)
    && row.name === 'Electrical repairs'));
});

function packetFor(businessName, domainUrl, selected, observations) {
  return {
    selectedTemplateId: 'single-cinematic-motion', templateFamily: 'Single-page',
    business: { businessName, domainUrl, exactServices: selected.join('\n'), serviceArea: 'Local area' },
    goldenArtifacts: { exactServices: selected, protectedNotes: [] },
    requirements: { siteType: 'Single-scroll website' },
    pagePlan: [{ title: 'Home', slug: '' }],
    sources: { urls: [domainUrl], observations },
  };
}

test('unrelated fence selection excludes unselected and unproved labels', () => {
  const url = 'https://clearfence.example/';
  const observations = [
    { source: url, status: 'succeeded',
      extracted: { exactServices: 'Fence Installation\nGate Repair\nUnproved Roof Repair' },
      private_source: { markdown: '# Fence Installation\n# Gate Repair\nA visible fence company source.' } },
    { source: 'https://otherfence.example/', status: 'succeeded',
      extracted: { exactServices: 'Roof Repair' }, private_source: { markdown: '# Roof Repair' } },
  ];
  const selected = ['Fence Installation', 'Unproved Roof Repair'];
  const compiled = compilePacket(packetFor('Clear Fence', url, selected, observations));
  assert.deepEqual(compiled.compiled.services.map(row => row.name), ['Fence Installation']);
  assert.deepEqual(compiled.compiled.contentContract.facts.services, ['Fence Installation']);
  assert.ok(!compiled.compiled.services.some(row => row.name === 'Gate Repair'));
});

test('independently proven observed service remains available when no exact selection exists', () => {
  const url = 'https://beaconelectric.example/';
  const observations = [
    { source: url, status: 'succeeded', extracted: { exactServices: 'Electrical repairs' },
      private_source: { markdown: '# Electrical repairs\nWe perform electrical repairs.' } },
    { source: 'https://other-electric.example/', status: 'succeeded',
      extracted: { exactServices: 'Panel upgrades' }, private_source: { markdown: '# Panel upgrades' } },
  ];
  const compiled = compilePacket(packetFor('Beacon Electric', url, [], observations));
  assert.deepEqual(compiled.compiled.services.map(row => row.name), ['Electrical repairs']);
  assert.deepEqual(compiled.compiled.contentContract.facts.services, ['Electrical repairs']);
});
