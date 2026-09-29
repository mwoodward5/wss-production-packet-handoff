import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Script, createContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(import.meta.url);
const Q = require('../api/firecrawl-intake.js').intakeQuality;
const { compilePacket } = require('../api/compile-build-packet.js');
const html = readFileSync(resolve(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
function extract(name) {
  const start = html.indexOf('    function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = html.indexOf('\n    }', start);
  assert.ok(end > start, name);
  return html.slice(start, end + 6);
}
let form = {};
let rows = [];
const state = { sourceObservations: [] };
const ctx = createContext({
  URL, window: { location: { href: 'https://intake.example/' } }, intakeQuality: Q, state,
  readForm: () => form, $$: () => rows, $: () => ({ innerHTML: '' }),
  templateById: id => ({ family: id.startsWith('single-') ? 'Single-page' : 'Premier multi-page' }),
  slugify: value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  splitLines: (...values) => values.flatMap(value => String(value || '').split(/\n|;/)).map(s => s.trim()).filter(Boolean),
  cleanWebsiteCandidate: value => value || '',
  isGoogleBusinessUrl: () => false, normalizeMapMode: value => value || '',
  paletteSummary: () => '',
  registrableDomain: value => { try { return new URL(value).hostname; } catch { return ''; } },
});
const functions = ['singlePageSelection', 'pagePlanFromForm', 'logoCandidateUrl',
  'bestLogoCandidate', 'affiliateProviderOnPage', 'qualifiedHarvestSelection', 'mapExtracted'];
new Script(functions.map(extract).join('\n')).runInContext(ctx);
const ui = name => (...args) => JSON.parse(JSON.stringify(new Script(
  name + '(...__args)').runInContext(Object.assign(ctx, { __args: args }))));

const home = { title: 'Home', slug: '' };
const modern = 'https://moderntn.com/';
const dotLabel = 'Heating ' + String.fromCharCode(0xb7) + ' Cooling ' + String.fromCharCode(0xb7) + ' Electrical';
const own = {
  source: modern, status: 'succeeded',
  extracted: { exactServices: 'Heating & Cooling\nElectrical repairs\nCommercial electrical repairs\nHeating · Cooling · Electrical\nHeating & Cooling Repair\nHeating & Cooling Replacement\nResidential Electrical Repairs' },
  private_source: { markdown: '# Heating & Cooling\nModern Mechanical Contractors offers Heating & Cooling service.\n# Electrical repairs\nModern Mechanical Contractors offers Electrical repairs.\n# Commercial electrical repairs\nModern Mechanical Contractors offers Commercial electrical repairs.\n# Heating · Cooling · Electrical\nCall for service.' },
};
const affiliate = {
  source: modern + 'plumbing', status: 'succeeded',
  extracted: { exactServices: 'Plumbing services' },
  private_source: { markdown: '# Plumbing services\nPlumbing services by Modern Plumbing Systems\n' +
    'This shared site makes it easy to get started. **Modern Plumbing Systems** handles your plumbing request, estimate, and service.\n' +
    'Affiliated companies ┬╖ Separate service providers' },
};
const extraction = {
  brandName: 'Modern Mechanical Contractors', domainUrl: modern,
  exactServices: 'Heating & Cooling Repair\nHeating & Cooling Replacement\nResidential Electrical Repairs\nPlumbing services\nModern Mechanical Contractors\nSelected: HVAC Repair',
  protectedArtifacts: 'Licensed provider\n{"knowsAbout":["Heating"]}\nPlumbing handled by Modern Plumbing Systems',
  mustInclude: 'Social profiles found: https://example.com/\",\"hasMap\":\"https://maps.example/',
  logoCandidates: [
    "Selected #0 because it is visible, located in the header, and matches the brand name",
    modern + 'assets/modern-mechanical-official.png',
  ],
};
test('single scroll emits Home only despite default rows and page brief', () => {
  form = { websiteUrl: modern, siteType: 'Single-scroll website',
    selectedTemplateId: 'single-cinematic-motion', pagesNeeded: 'Services\nGallery\nContact' };
  rows = [{ querySelector: selector => ({ value: selector === '[data-page-title]' ? 'Services' : 'services' }) }];
  assert.deepEqual(ui('pagePlanFromForm')(), [{ ...home, order: 1 }]);
  form.selectedTemplateId = 'premier-trust-credentials';
  assert.equal(ui('pagePlanFromForm')().length, 2);
});
test('Modern fresh harvest selects visible own labels and keeps affiliate, junk and proof private', () => {
  form = { websiteUrl: modern, businessName: extraction.brandName };
  state.sourceObservations = [own, affiliate];
  const selected = ui('mapExtracted')(extraction);
  assert.deepEqual(selected.exactServices.split('\n'), ['Heating & Cooling', 'Electrical repairs', 'Commercial electrical repairs']);
  assert.equal(selected.mustInclude, '');
  assert.equal(selected.protectedArtifacts, '');
  assert.equal(selected.logoLink, modern + 'assets/modern-mechanical-official.png');
  assert.equal(ui('logoCandidateUrl')(extraction.logoCandidates[0], modern), '');
  assert.equal(state.sourceObservations[1].private_source.markdown.includes('Modern Plumbing Systems'), true);
});
test('unrelated fence harvest cannot borrow competitor services or malformed logos', () => {
  form = { websiteUrl: 'https://clearfence.test/', businessName: 'Clear Fence' };
  state.sourceObservations = [
    { source: 'https://clearfence.test/', extracted: { exactServices: 'Fence Installation' },
      private_source: { markdown: '# Fence Installation\nClear Fence offers Fence Installation for local homes. We install fences.' } },
    { source: 'https://other-fence.test/', extracted: { exactServices: 'Gate Repair' },
      private_source: { markdown: '# Gate Repair' } },
  ];
  const selected = ui('mapExtracted')({ brandName: 'Clear Fence',
    domainUrl: 'https://clearfence.test/', exactServices: 'Fence Installation\nGate Repair',
    logoCandidates: ['Selected logo in header'] });
  assert.equal(selected.exactServices, 'Fence Installation');
  assert.equal(selected.logoLink, '');
});
test('backend collapses saved routes and retains strict service QA and affiliate attribution', () => {
  const packet = {
    selectedTemplateId: 'single-cinematic-motion', templateFamily: 'Single-page',
    business: { businessName: extraction.brandName, domainUrl: modern, serviceArea: 'Nashville, TN',
      exactServices: 'Heating & Cooling Repair\nElectrical repairs\nPlumbing services\n' + dotLabel },
    brand: { logoLink: 'https://moderntn.com/Selected%20#0%20because%20visible' },
    requirements: { siteType: 'Single-scroll website', mustInclude: '{"hasMap":"junk"}\nUse visible section copy.' },
    goldenArtifacts: { exactServices: ['Heating & Cooling Repair', 'Electrical repairs', 'Plumbing services', dotLabel], protectedNotes: [] },
    sources: { urls: [modern], observations: [own, affiliate] },
    assetQa: { logoCandidates: ['https://moderntn.com/Selected%20#0%20because%20visible',
      modern + 'assets/modern-mechanical-official.png'] },
    pagePlan: [home, { title: 'Services', slug: 'services' }, { title: 'Contact', slug: 'contact' }],
    compiled: { pages: [home, { title: 'Services', slug: 'services' }] },
  };
  const result = compilePacket(packet);
  assert.deepEqual(result.pagePlan.map(p => p.slug), ['']);
  assert.deepEqual(result.compiled.manifest.routes, ['/']);
  assert.equal(result.compiled.preflight.contentGate.routeCount, 1);
  assert.equal(result.readiness.preflight.contentGate.routeCount, 1);
  assert.equal(result.compiled.proofSummary.routeCount, 1);
  assert.deepEqual(result.compiled.visitorPagePlan.map(p => p.slug), ['']);
  assert.deepEqual(result.compiled.pages.map(p => p.slug), ['']);
  assert.ok(!result.compiled.services.some(s => s.name === 'Heating & Cooling Repair'));
  assert.ok(!result.compiled.services.some(s => s.name === 'Plumbing services'));
  assert.ok(!result.compiled.services.some(s => s.name === dotLabel));
  assert.ok(!result.compiled.services.some(s => s.name === 'Commercial electrical repairs'));
  assert.ok(!Object.keys(result.compiled.contentFiles).some(path => path.includes('heating-cooling-electrical')));
  assert.ok(!result.compiled.contentFiles['content/services/plumbing-services.md']);
  assert.equal(result.compiled.services.length, result.compiled.contentContract.facts.services.length);
  assert.ok(result.review.intakeQuality.issues.some(i => i.rule === 'unaccepted_service_labels'));
  assert.ok(result.review.intakeQuality.issues.some(i => i.rule === 'machine_fragment_withheld'));
  assert.ok(result.review.intakeQuality.issues.some(i => i.rule === 'malformed_logo_withheld'));
  assert.equal(result.requirements.mustInclude, 'Use visible section copy.');
  assert.equal(result.goldenArtifacts.protectedNotes.length, 0);
  assert.equal(result.sources.observations.length, 2);
});
const freshPath = 'C:\\Users\\Main\\Desktop\\WSS-Smoke-Integration-20260923\\modern-fresh-email-snapshot.json';
test('exact mailed Modern evidence replays to owned services and one route after fresh UI selection', {
  skip: !existsSync(freshPath),
}, () => {
  const saved = JSON.parse(readFileSync(freshPath, 'utf8'));
  form = { websiteUrl: 'https://moderntn.com/', businessName: saved.business.businessName };
  state.sourceObservations = saved.sources.observations;
  const selection = ui('mapExtracted')({
    ...saved.business, brandName: saved.business.businessName,
    mustInclude: saved.requirements.mustInclude,
    logoCandidates: saved.sources.logos,
  });
  assert.equal(selection.protectedArtifacts, '');
  assert.equal(selection.mustInclude, '');
  assert.ok(!selection.exactServices.toLowerCase().includes('plumbing'), selection.exactServices);
  const input = {
    ...saved,
    business: { ...saved.business, exactServices: selection.exactServices,
      mainServices: selection.mainServices, protectedArtifacts: '' },
    brand: { ...saved.brand, logoLink: selection.logoLink },
    requirements: { ...saved.requirements, mustInclude: '' },
    goldenArtifacts: { ...saved.goldenArtifacts, exactServices: selection.exactServices.split('\n'), protectedNotes: [] },
  };
  const result = compilePacket(input);
  assert.deepEqual(result.compiled.manifest.routes, ['/']);
  assert.equal(result.compiled.proofSummary.routeCount, 1);
  assert.deepEqual(result.pagePlan.map(row => row.title), ['Home']);
  assert.equal(result.goldenArtifacts.protectedNotes.length, 0);
  assert.equal(result.compiled.services.length, result.compiled.contentContract.facts.services.length);
  assert.ok(result.compiled.services.every(row => row.providerName === saved.business.businessName));
  assert.ok(!result.compiled.services.some(row => /[\u00b7\u2022]/u.test(row.name)));
  assert.ok(result.sources.observations.length >= 19);
  assert.equal(result.compiled.contentQuality.status, 'pass', JSON.stringify(result.compiled.contentQuality.inputIssues));
  assert.ok(result.compiled.contentQuality.visitor.totalFiles > 0);
  assert.equal(result.compiled.contentQuality.visitor.passCount, result.compiled.contentQuality.visitor.totalFiles);
  assert.ok(!result.review.intakeQuality.issues.some(row => row.rule === 'unaccepted_service_labels' || row.rule === 'malformed_logo_withheld'));
  assert.ok(result.sources.private_quality_review.previous_issues.some(row => row.rule === 'unaccepted_service_labels'));
  assert.ok(result.sources.private_quality_review.rejected.some(row => row.rule === 'malformed_logo_candidate'));
});
