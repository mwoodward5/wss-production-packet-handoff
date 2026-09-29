import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename, join } from 'node:path';
import { Script, createContext } from 'node:vm';
import * as crypto from 'node:crypto';
import { isIP } from 'node:net';

// Offline harness: no repository dependencies, credentials, providers or browser workers.
// Auth and source-archive implementations are outside this audit's read allowlist.
const baselineMode = process.argv.includes('--baseline');
const here = dirname(fileURLToPath(import.meta.url));
const root = baselineMode ? resolve(here, '../../baseline') : resolve(here, '..');
const allow = new Set(['api/firecrawl-intake.js', 'api/compile-build-packet.js', 'api/intake-genie-compile.js', 'api/send-intake-packet.js', 'index.html', 'tests/visitor-copy-contract.test.mjs']);
const read = path => { assert.ok(allow.has(path), `Read not allowed: ${path}`); return readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n'); };
const sources = Object.fromEntries([...allow].map(path => [path, read(path)]));
const deny = () => { throw new Error('Offline audit forbids network/provider/auth-route execution'); };
const shared = { URL, URLSearchParams, Buffer, TextEncoder, TextDecoder, AbortController,
  process: { env: Object.freeze({}) }, fetch: deny, setTimeout: deny, clearTimeout: () => {},
  console: { log: () => {}, warn: () => {}, error: () => {} } };
const cache = new Map();
const seams = {
  'firecrawl-intake': ['fallbackExtract','extractGoogleBusinessId','reviewHarvestExtraction','cleanupExtracted','extractExactServices','sanitizeServiceText','isServiceCodeContaminated','mergeResults'],
  'compile-build-packet': ['compilePacket','prepareQualityPacket','contentQualityReport','visitorCopySafetyViolations','normalizeBrightDataAudit','buildMapAndDirections','normalizeSiteUrl'],
  'intake-genie-compile': ['compileCanonicalPacket','semanticServices','observationSupportsValue','normalizePrivatePageSource','serviceCertificationState'],
  'send-intake-packet': ['attachmentDataForPacket','packetFiles'],
};
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const path = `api/${name}.js`, module = { exports: {} };
  cache.set(name, module.exports);
  function localRequire(id) {
    if (id === 'node:crypto') return crypto;
    if (id === 'node:net') return { isIP };
    if (id === 'node:dns') return { promises: { lookup: deny, resolve: deny } };
    if (id === './lib/provider-route-auth') return { requireProviderRouteAuth: deny };
    if (id === './lib/source-page-archive') return { archiveSourcePages: packet => packet.__auditArchive || {
      files: {}, pages: [], excluded: [], bytes: 0, publicationPolicy: 'private_review_only_test_double' } };
    if (id === './lib/source-editorial-worklist') return { buildSourceEditorialWorklist: () => ({ pages: [], excluded: [] }) };
    if (/^\.\/(?:firecrawl-intake|compile-build-packet)$/.test(id)) return load(basename(id));
    throw new Error(`Dependency not allowed in bounded audit: ${id}`);
  }
  const expose = seams[name].map(key => `${JSON.stringify(key)}: typeof ${key} === 'function' ? ${key} : undefined`).join(',');
  const context = createContext({ ...shared, module, exports: module.exports, require: localRequire });
  new Script(`${sources[path]}\n;module.exports.__audit = {${expose}};`, { filename: path }).runInContext(context, { timeout: 5000 });
  cache.set(name, module.exports);
  return module.exports;
}
const fire = load('firecrawl-intake'), compiler = load('compile-build-packet'), canonical = load('intake-genie-compile');
const F = fire.__audit, C = compiler.__audit, A = canonical.__audit, S = load('send-intake-packet').__audit;
function functionText(source, name, indent = '') {
  const start = source.indexOf(`${indent}function ${name}(`);
  assert.ok(start >= 0, `Missing function ${name}`);
  const end = source.indexOf(`\n${indent}}`, start) + indent.length + 2;
  assert.ok(end > start, `Missing end ${name}`);
  return source.slice(start, end).split('\n').map(line => line.startsWith(indent) ? line.slice(indent.length) : line).join('\n');
}
const uiNames = ['normalizeUrl','isPublicWebsiteCandidate','cleanWebsiteCandidate','contentQualityReport',
  'packetContentQualitySummary','compiledPackageScore','humanProofBuildScore','buildBrightDataQueryPlan'];
if (!baselineMode) uiNames.push('createIntakeQualityPolicy','packetQualityGateState','googleWriteReviewUrl');
const uiCode = uiNames.map(name => functionText(sources['index.html'],name,'    ')).join('\n');
const uiContext = createContext({ ...shared, readForm: () => ({}),
  flatPacketPath: value => value.replace(/\//g,'-'), wordCount: value => String(value || '').trim().split(/\s+/).filter(Boolean).length,
  isCompiledPacket: packet => Boolean(packet.compiled), uniqueValues: values => [...new Set(values)],
  splitLines: (...values) => values.flat().filter(Boolean).flatMap(value => String(value).split(/[\n;]/)),
  keywordWithMarket: (keyword, market) => `${keyword} ${market}`, inferSearchIntent: () => 'research',
});
new Script(uiCode + (baselineMode ? '' : '\nconst intakeQuality = createIntakeQualityPolicy();'), { filename: 'selected-index-functions.js' }).runInContext(uiContext);
const ui = name => (...args) => { uiContext.__args = args; return new Script(`${name}(...__args)`).runInContext(uiContext); };
const plain = value => JSON.parse(JSON.stringify(value));
const pid = 'ChIJmQEzmbfM5YgR8Jx2nonRAYE';
const origin = 'https://fixture-hvac.example';
const accepted = ['AC Repair','Heat Pump Installation','Air Conditioner Maintenance'];
test('article headings from a mixed lawn harvest cannot become services', () => {
  const sourceLabels = ['Lawn Care Programs', 'Lawn Mowing', 'Aeration & Seeding',
    '12 Lawn Care Myths Busted for National Lawn Care Month',
    'Myth #3: It’s Best to Water Your Lawn Every Day',
    '3 Steps to a Greener, Healthier Lawn', '3 Essential Fall Clean-Up Chores',
    'Fertilizer and Seeding Myths',
    'Reasons to Choose a Professional Lawn Care Company to Mow Your Lawn'];
  assert.deepEqual(plain(A.semanticServices(sourceLabels)),
    ['Lawn Care Programs', 'Lawn Mowing', 'Aeration & Seeding']);
  const p = packet();
  p.business.exactServices = sourceLabels.join('\n');
  p.goldenArtifacts.exactServices = sourceLabels;
  p.sources.observations = [observation(sourceLabels, {
    source: origin + '/',
    private_source: { markdown: sourceLabels.map(label => `## ${label}\nWe provide ${label.toLowerCase()}.`).join('\n') },
  })];
  const selected = C.prepareQualityPacket(p);
  assert.deepEqual(plain(selected.goldenArtifacts.exactServices),
    ['Lawn Care Programs', 'Lawn Mowing', 'Aeration & Seeding']);
  assert.ok(selected.review.intakeQuality.issues.some(row => row.rule === 'unaccepted_service_labels'));
});
test('raw harvested proof prose stays private instead of becoming selected claims', async () => {
  const p = packet();
  const body = { website_url: origin, urls: [origin], prospect_hints: {
    name: 'Fixture HVAC', city: 'Jacksonville', state: 'FL', category: 'hvac' } };
  const harvest = { sources: [origin], observations: p.sources.observations,
    extracted: { ...p.business, brandName: 'Fixture HVAC', finalPhone: p.business.phone,
      protectedArtifacts: '4.8 stars from 588 reviews; guaranteed results; article title' } };
  const result = await A.compileCanonicalPacket(body, harvest);
  assert.equal(result.ok, true, JSON.stringify(result.problems || []));
  assert.equal(result.packet2.business.protectedArtifacts, '');
  assert.deepEqual(plain(result.packet2.goldenArtifacts.protectedNotes), []);
  assert.match(JSON.stringify(result.packet2.sources), /4\.8 stars from 588 reviews/);
});
test('article checklist observations cannot certify visitor service pages', () => {
  const p = packet();
  p.business.exactServices = 'Lawn Mowing\nSod Bare Spots\nRepair Broken Lighting';
  p.goldenArtifacts.exactServices = ['Lawn Mowing', 'Sod Bare Spots', 'Repair Broken Lighting'];
  p.sources.observations = [
    observation(['Lawn Mowing'], { source: origin + '/', private_source: {
      markdown: '## Lawn Mowing\nWe provide lawn mowing.' } }),
    observation(['Sod Bare Spots', 'Repair Broken Lighting'], { source: origin + '/5-spring-lawn-tips',
      private_source: { markdown: '## Sod Bare Spots\nSod Bare Spots\n## Repair Broken Lighting\nRepair Broken Lighting' } }),
  ];
  assert.deepEqual(plain(C.prepareQualityPacket(p).goldenArtifacts.exactServices), ['Lawn Mowing']);
  assert.deepEqual(plain(A.serviceCertificationState({ website_url: origin },
    { exactServices: p.business.exactServices }, p.sources.observations).acceptedServices), ['Lawn Mowing']);
  const matchedLabel = observation(['Sod Bare Spots'], { source: origin + '/blog/sod-bare-spots' });
  assert.deepEqual(plain(A.serviceCertificationState({ website_url: origin },
    { exactServices: 'Sod Bare Spots' }, [matchedLabel]).acceptedServices), []);
  const servicePage = { ...matchedLabel, source: origin + '/services/sod-bare-spots' };
  assert.deepEqual(plain(A.serviceCertificationState({ website_url: origin },
    { exactServices: 'Sod Bare Spots' }, [servicePage]).acceptedServices), ['Sod Bare Spots']);
});
test('Okie promotional sentences stay out while a source-offered service survives', () => {
  const rejected = ['The Best Concrete Company in Oklahoma City', 'Concrete Company in OK',
    "We're Concrete Kings!", 'for a well-crafted and perfectly appointed wall or curb',
    'We love serving our local community with excellent concrete work'];
  assert.deepEqual(plain(A.semanticServices(rejected)), []);
  const real = ['Outdoor Services', 'Concrete Repairs and Maintenance'];
  const p = packet();
  p.business.exactServices = [...rejected, ...real].join('\n');
  p.goldenArtifacts.exactServices = [...rejected, ...real];
  p.sources.observations = [observation([...rejected, ...real], { source: origin + '/services',
    private_source: { markdown: real.map(name => `## ${name}\nWe provide ${name.toLowerCase()}.`).join('\n') } })];
  assert.deepEqual(plain(C.prepareQualityPacket(p).goldenArtifacts.exactServices), real);
});
test('direct API single cinematic selection emits one visitor route', async () => {
  const p = packet();
  const body = { website_url: origin, selectedTemplateId: 'single-cinematic-motion',
    prospect_hints: { name: 'Fixture HVAC', city: 'Jacksonville', state: 'FL', category: 'hvac' } };
  const result = await A.compileCanonicalPacket(body, { sources: [origin],
    observations: p.sources.observations,
    extracted: { ...p.business, brandName: 'Fixture HVAC', finalPhone: p.business.phone } });
  assert.equal(result.ok, true, JSON.stringify(result.problems || []));
  assert.equal(result.packet2.selectedTemplateId, 'single-cinematic-motion');
  assert.equal(result.packet2.templateFamily, 'Single-page cinematic scroll');
  assert.equal(result.packet2.selectedBuildLane, 'Single-page scroll build');
  assert.deepEqual(plain(result.packet2.pagePlan.map(page => page.slug)), ['']);
  assert.ok(result.packet2.compiled.contentQuality);
});
function observation(labels = accepted, options = {}) {
  return { source: `${origin}/services`, status: 'succeeded', extracted: { exactServices: labels.join('\n') },
    private_source: { markdown: labels.map(label => `## ${label}\nWe provide ${label.toLowerCase()} for local clients.`).join('\n') }, ...options };
}
function packet(overrides = {}) {
  return { business: { businessName: 'Fixture HVAC', category: 'hvac', city: 'Jacksonville', state: 'FL',
      domainUrl: origin, serviceArea: 'Jacksonville, FL; Orange Park, FL; Ponte Vedra, FL',
      email: 'service+jobs@fixture-hvac.example', phone: '(904) 555-0100', address: '101 Main Street, Jacksonville, FL',
      gbpPlaceId: pid, exactServices: accepted.join('\n'), mainServices: accepted.join('\n'), servicesSource: 'source_observation',
      ...overrides }, goldenArtifacts: { exactServices: [...accepted] },
    sources: { urls: [origin], observations: [observation()] }, pagePlan: [{ title: 'Home', slug: '' }, { title: 'Contact', slug: 'contact' }] };
}
// These same tests deliberately fail against the unchanged baseline.
test('image filename is not a contact email', () => {
  const result = F.fallbackExtract(origin, 'Email flags@2x.webp', {}, '', [], [], {});
  assert.equal(result.email || '', '');
});
test('escaped Place ID query/JSON tail is rejected, not truncated into a trusted ID', () => {
  assert.equal(F.extractGoogleBusinessId('', `query_place_id=${pid}%26query%3DFixture%22%7D`), '');
});
test('generated Lorem ipsum and image-email cannot receive an all-pass quality report', () => {
  const result = C.contentQualityReport({ 'content/home.md': 'Lorem ipsum. Email flags@2x.webp.' });
  assert.ok(result.reviewCount > 0);
});
test('Website label is not a primary domain', () => {
  assert.equal(ui('cleanWebsiteCandidate')('Website'), '');
});
test('generic and catalog headings are not business service labels', () => {
  assert.deepEqual(plain(A.semanticServices(['Service','Maintenance','Lorem ipsum repair','Heat Pumps','AC Repair'])), ['AC Repair']);
});

if (!baselineMode) {
  const Q = fire.intakeQuality;
  test('all allowed server modules and the complete main browser script parse', () => {
    for (const [path, source] of Object.entries(sources)) if (path.endsWith('.js')) new Script(source, { filename: path });
    const anchor = sources['index.html'].indexOf('    function normalizeUrl(');
    const start = sources['index.html'].lastIndexOf('<script', anchor);
    const end = sources['index.html'].lastIndexOf('</script>');
    new Script(sources['index.html'].slice(sources['index.html'].indexOf('>', start) + 1, end), { filename: 'index-main-script.js' });
  });
  test('browser and server policy factories are identical', () => {
    assert.equal(functionText(sources['index.html'], 'createIntakeQualityPolicy', '    '),
      functionText(sources['api/firecrawl-intake.js'], 'createIntakeQualityPolicy'));
  });
  test('nearby valid email/domain/phone inputs survive; missing optional facts stay absent', () => {
    for (const value of ['support@fixture-hvac.example', 'service+jobs@sub.fixture-hvac.example', "o'hara@fixture-hvac.example"]) assert.equal(Q.email(value), value);
    assert.equal(Q.website('https://www.fixture-hvac.example/contact'), 'https://www.fixture-hvac.example/contact');
    assert.equal(Q.phone('+1 (904) 555-0100 ext. 12'), '+1 (904) 555-0100 ext. 12');
    assert.equal(Q.facts({}).issues.length, 0);
    assert.equal(Q.emailFromText('<img src="flags@2x.webp"> Email service@fixture-hvac.example'), 'service@fixture-hvac.example');
  });
  test('malformed contact values fail closed without automatic prefix salvage', () => {
    for (const value of ['flags@2x.webp','hero@3x.png','a..b@fixture-hvac.example','a@localhost','a@fixture-hvac.example\r\nBcc: other@fixture-hvac.example']) assert.equal(Q.email(value), '');
    for (const value of ['https://website','Website','https://127.0.0.1','javascript:alert(1)','https://fixture-hvac.example\\tail']) assert.equal(Q.website(value), '');
    for (const value of [pid + '\\u0026query=tail', pid + '%26query=tail', pid + '"}', 'CID 1234567890','0x1:0x2']) assert.equal(Q.placeId(value), '');
    assert.equal(Q.placeId(pid), pid);
    assert.equal(Q.placeId('EiExampleOpaquePlaceId_123-ABC'), 'EiExampleOpaquePlaceId_123-ABC');
    assert.equal(F.extractGoogleBusinessId('', `query_place_id=${pid}&query=Fixture`), pid);
    assert.equal(F.extractGoogleBusinessId('', 'query_place_id=%E0%A4%A'), '');
  });
  test('83 service candidates are capped and generic/product labels are removed', () => {
    const labels = ['Service','Maintenance','Lorem ipsum repair','Heat Pumps','Air Conditioners',
      ...Array.from({ length: 83 }, (_, i) => `Duct Inspection Zone ${i + 1}`)];
    const result = Q.services(labels);
    assert.equal(result.length, 24);
    assert.ok(result.every(label => label.startsWith('Duct Inspection Zone')));
    assert.deepEqual(plain(Q.services(['Heat Pump Installation','Air Conditioner Maintenance','Community Fence Installation'])),
      ['Heat Pump Installation','Air Conditioner Maintenance','Community Fence Installation']);
    assert.equal(F.isServiceCodeContaminated('.service-card { display: grid; }'), true);
  });
  test('template testimonials are private observations, not extracted review claims', () => {
    const raw = { brandName: 'Fixture HVAC', exactServices: 'AC Repair', rating: 5, reviewCount: 100,
      reviewsBadgesNeeded: 'Lorem ipsum testimonial from John Doe' };
    const result = F.reviewHarvestExtraction(`${origin}/dt_testimonials/john-doe`, {}, raw, 'AC Repair\nLorem ipsum testimonial');
    assert.deepEqual(plain(result.extracted), {});
    assert.equal(result.privateReview.publication_policy, 'private_review_only');
    assert.match(result.privateReview.raw_fields.reviewsBadgesNeeded, /Lorem ipsum/);
    assert.equal(Q.demoSource(`${origin}/testimonials/actual-installation`), false);
    assert.equal(Q.demoSource(`${origin}/dt_testimonials/jane-doe/`), true);
  });
  test('unsupported and foreign-source service labels cannot enter visitor copy', () => {
    const p = packet({ exactServices: 'AC Repair\nSolar Installation' });
    p.goldenArtifacts.exactServices.push('Solar Installation');
    p.sources.observations.push(observation(['Solar Installation'], { source: 'https://unrelated.example/services' }));
    const result = compiler.compilePacket(p);
    assert.deepEqual(plain(result.compiled.contentContract.facts.services), accepted);
    assert.doesNotMatch(JSON.stringify(result.compiled.contentContract.visitor_copy.files), /Solar Installation/);
    assert.equal(result.compiled.contentQuality.status, "review");
    assert.equal(result.compiled.contentQuality.reviewCount, 0);
    assert.ok(result.compiled.contentQuality.inputIssues.some(row => row.rule === "unaccepted_service_labels"));
  });
  test('raw source text must agree with its extracted label when supplied', () => {
    const obs = observation(['Solar Installation'], { private_source: { markdown: 'We provide AC Repair only.' } });
    assert.equal(Q.observedService(obs, 'Solar Installation'), false);
    assert.equal(Q.observedService(observation(), 'AC Repair'), true);
    assert.equal(Q.sameSource('https://host.wixsite.com/tenant-a', 'https://host.wixsite.com/tenant-b/services'), false);
  });
  test('valid complete packet keeps valid NAP and short source-supported copy passing', () => {
    const result = compiler.compilePacket(packet());
    assert.equal(result.business.email, 'service+jobs@fixture-hvac.example');
    assert.equal(result.business.gbpPlaceId, pid);
    assert.equal(result.compiled.contentContract.visitor_copy.safety.pass, true);
    assert.equal(result.compiled.contentQuality.reviewCount, 0);
    assert.equal(result.compiled.contentQuality.validationVersion, Q.version);
  });
  test('malformed selected NAP is withheld from snapshot/copy and blocks readiness', () => {
    const input = packet({ email: 'flags@2x.webp', domainUrl: 'https://website', gbpPlaceId: pid + '\\u0026query=tail', address: 'Email flags@2x.webp' });
    const before = JSON.stringify(input), result = compiler.compilePacket(input);
    assert.equal(JSON.stringify(input), before, 'must not mutate caller');
    assert.equal(result.business.email, '');
    assert.equal(result.business.domainUrl, '');
    assert.equal(result.business.gbpPlaceId, '');
    assert.equal(result.business.address, '');
    assert.doesNotMatch(JSON.stringify(result.compiled.contentContract.facts), /flags@2x|https:\/\/website|u0026/);
    assert.equal(result.compiled.contentQuality.passCount, 0);
    assert.equal(result.compiled.contentQuality.status, 'block');
    assert.equal(result.readiness.preflight.status, 'blocked');
    assert.equal(result.compiled.contentContract.visitor_copy.safety.pass, false);
    assert.ok(result.sources.private_quality_review.rejected.some(row => row.value === 'flags@2x.webp'));
  });
  test('packet recipient is never substituted for the public contact email', () => {
    const p = packet({ email: '' }); p.review = { recipientEmail: 'owner@fixture-owner.example' };
    p.requirements = { recipientEmail: 'owner@fixture-owner.example' };
    const result = compiler.compilePacket(p);
    assert.doesNotMatch(JSON.stringify(result.compiled.contentContract), /owner@fixture-owner/);
  });
  test('old compiled identity/search artifacts do not override refreshed facts', () => {
    const p = packet(); p.compiled = { businessTs: 'https://website', brightDataQueryPlan: { queries: [{ query: 'all cities repeated' }] },
      searchOptimizationPlan: { primaryKeyword: 'unrelated product all cities' },
      localPresencePlan: { mapAndDirections: { googlePlaceId: 'malformed\\tail' } } };
    const result = compiler.compilePacket(p);
    assert.doesNotMatch(result.compiled.businessTs, /https:\/\/website/);
    assert.ok(result.compiled.brightDataQueryPlan.queries.every(row => !/all cities/.test(row.query)));
    assert.equal(result.compiled.localPresencePlan.mapAndDirections.googlePlaceId, pid);
  });

  test('private demo source archive is retained but excluded from visitor files and routes', () => {
    const p = packet(); const path = 'content/source/demo-review.md';
    p.__auditArchive = { files: { [path]: 'Lorem ipsum. Email flags@2x.webp.' },
      pages: [{ file: path, route: '/dt_testimonials/john-doe', url: `${origin}/dt_testimonials/john-doe`, title: 'John Doe' }],
      excluded: [], bytes: 43, publicationPolicy: 'private_review_only_test_double' };
    const result = compiler.compilePacket(p);
    assert.equal(result.compiled.contentFiles[path], p.__auditArchive.files[path]);
    assert.equal(result.compiled.contentContract.visitor_copy.files[path], undefined);
    assert.equal(result.pagePlan.some(page => /john-doe/.test(page.slug || '')), false);
    assert.equal(result.compiled.contentQuality.files.find(row => row.sourcePath === path).status, 'review');
  });
  test('queries use one market and accepted services, not free-form marketing paragraphs', () => {
    const p = packet(); p.requirements = { marketingPlan: 'Jacksonville Orange Park Ponte Vedra all cities repeated. Buy unrelated products.' };
    const result = compiler.compilePacket(p), queries = result.compiled.brightDataQueryPlan.queries;
    assert.ok(queries.length > 0 && queries.length <= 6);
    assert.ok(queries.every(row => !/Orange Park|Ponte Vedra|unrelated|repeated/.test(row.query)));
    assert.equal(new Set(queries.map(row => row.query)).size, queries.length);
    const uiPlan = ui('buildBrightDataQueryPlan')(p.business, {});
    assert.deepEqual(plain(uiPlan.queries.map(row => row.query)), plain(queries.map(row => row.query)));
    assert.equal(Q.queryTargets({ serviceArea: '' }, accepted).length, 0);
  });
  test('competitor domains are research observations, never confirmed competitor facts', () => {
    const p = packet(); p.brightDataAudit = { status: 'compiled', queries: [{ query: 'AC Repair Jacksonville', results: [] }],
      aggregate: { topCompetitorDomains: ['unrelated-shop.example', 'sports-news.example'] } };
    const result = compiler.compilePacket(p), audit = result.compiled.brightDataAudit;
    assert.deepEqual(plain(audit.aggregate.topCompetitorDomains), []);
    assert.deepEqual(plain(audit.research.competitorDomainObservations), ['unrelated-shop.example','sports-news.example']);
    assert.equal(audit.publicationPolicy, 'research_only_not_business_facts');
    assert.doesNotMatch(JSON.stringify(result.compiled.contentContract), /unrelated-shop|sports-news/);
  });
  test('long generated copy still fails quality on contamination and JSON is not counted as copy', () => {
    const files = { 'content/home.md': 'Useful service detail '.repeat(600) + ' Lorem ipsum Email flags@2x.webp.',
      'content/content-quality-report.json': JSON.stringify({ passCount: 999 }) };
    const result = ui('contentQualityReport')(files, packet().business, []);
    assert.equal(result.totalFiles, 1);
    assert.equal(result.passCount, 0);
    assert.equal(result.reviewCount, 1);
    assert.equal(result.status, 'block');
  });
  function scoredPacket() {
    const p = packet(); const files = Object.fromEntries(Array.from({ length: 36 }, (_, i) => [`content/page-${i}.md`, 'Useful service detail '.repeat(40)]));
    p.compiled = { contentFiles: files, contentQuality: { validationVersion: Q.version, status: 'pass', totalFiles: 36, totalWords: 4320, passCount: 36, reviewCount: 0,
      files: Object.keys(files).map(path => ({ sourcePath: path, status: 'pass' })) },
      manifest: {}, brand: {}, hero: {}, forms: {}, seo: {}, mapSdkContract: {}, visualSystemContract: {}, routeContentMap: [{ route: '/' }],
      preflight: { status: 'under_6_ready', buildGate: { mapGeoVerifiedWhenNeeded: true } } };
    p.readiness = { preflight: p.compiled.preflight, blockers: [] };
    return p;
  }
  test('100 coverage cannot conceal an existing map or production block', () => {
    const p = scoredPacket(); assert.equal(ui('compiledPackageScore')(p), 100);
    p.compiled.preflight.buildGate.mapGeoVerifiedWhenNeeded = false;
    assert.ok(ui('compiledPackageScore')(p) <= 74);
    assert.ok(ui('humanProofBuildScore')(p) <= 74);
    p.compiled.preflight.buildGate.mapGeoVerifiedWhenNeeded = true;
    p.productionLocks = [{ key: 'existing-gate', status: 'block' }];
    assert.ok(ui('compiledPackageScore')(p) <= 74);
  });
  test('stale all-pass counts cannot bypass new validation or contaminated actual bytes', () => {
    const p = scoredPacket(); delete p.compiled.contentQuality.validationVersion;
    assert.ok(ui('compiledPackageScore')(p) < 100);
    assert.equal(ui('packetContentQualitySummary')(p).reviewCount, 36);
    p.compiled.contentQuality.validationVersion = Q.version;
    p.compiled.contentFiles['content/page-0.md'] += ' Email flags@2x.webp.';
    assert.ok(ui('packetContentQualitySummary')(p).reviewCount > 0);
    assert.ok(ui('compiledPackageScore')(p) <= 74);
  });
  test('canonical selected malformed email and Place ID refuse certification', async () => {
    const p = packet();
    const body = { website_url: origin, urls: [origin], prospect_hints: { name: 'Fixture HVAC', city: 'Jacksonville', state: 'FL', category: 'hvac' } };
    const harvest = { sources: [origin], observations: p.sources.observations,
      extracted: { ...p.business, brandName: 'Fixture HVAC', finalPhone: p.business.phone, email: 'flags@2x.webp', gbpPlaceId: pid + '\\tail' } };
    const result = await A.compileCanonicalPacket(body, harvest);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(row => row.code === 'invalid_contact_or_identity_fact'));
  });
  test('browser write-review URL cannot include a malformed Place ID', () => {
    assert.equal(ui('googleWriteReviewUrl')({ gbpPlaceId: pid + '\\tail' }), '');
    assert.match(ui('googleWriteReviewUrl')({ gbpPlaceId: pid }), /placeid=ChIJ/);
  });
  // Negative-evidence and structured-only cases intentionally remain strict regressions.
  test('source negation must not certify an offered business service', () => {
    const obs = observation(['AC Repair'], { private_source: { markdown: 'We do not offer AC Repair.' } });
    assert.equal(Q.observedService(obs, 'AC Repair'), false);
  });
  test('structured source candidate stays provisional without visible copy proof', () => {
    const obs = observation(['Drain Cleaning'], { private_source: { markdown: '' } });
    assert.equal(Q.sourceServiceCandidate(obs, 'Drain Cleaning'), true);
    assert.equal(Q.observedService(obs, 'Drain Cleaning'), false);
    assert.equal(Q.sourceObservationService(obs, 'Drain Cleaning'), false);
    assert.equal(Q.sourceServiceCandidate({ ...obs, status: 'rejected' }, 'Drain Cleaning'), false);
  });
  test('a structured extraction alone cannot independently support its own claim', () => {
    const obs = observation(['AC Repair'], { private_source: { markdown: '' } });
    assert.equal(Q.observedService(obs, 'AC Repair'), false);
    assert.equal(Q.sourceObservationService(obs, 'AC Repair'), false);
  });
  test('nearby valid city-state modifiers remain paired', () => {
    assert.deepEqual(plain(Q.markets({ serviceArea: 'Jacksonville, FL; Orange Park, FL' })), ['Jacksonville, FL', 'Orange Park, FL']);
  });

  test('credential-shaped rejected values are withheld, including quoted keys and URL userinfo', () => {
    for (const value of ['{"token":"SYNTHETIC_TEST_VALUE"}', 'https://SYNTHETIC_TEST_VALUE@fixture-hvac.example/', 'api_key=SYNTHETIC_TEST_VALUE']) {
      assert.match(Q.privateValue(value), /withheld/);
      assert.doesNotMatch(Q.privateValue(value), /SYNTHETIC_TEST_VALUE/);
    }
  });
  test('protected golden notes cannot promote template testimonial claims', () => {
    const p = packet(); p.goldenArtifacts.protectedNotes = ['Lorem ipsum review', `${origin}/dt_testimonials/john-doe`, 'Use existing client photos'];
    const result = compiler.compilePacket(p);
    assert.deepEqual(plain(result.goldenArtifacts.protectedNotes), ['Use existing client photos']);
    assert.ok(result.sources.private_quality_review.rejected.some(row => row.field === 'protectedNotes'));
  });
  test('generated contacts and Place IDs are checked even when syntactically plausible', () => {
    assert.ok(Q.copyIssues('Email other@unrelated.example', { email: 'service@fixture-hvac.example' }).includes('unbound_contact_email_in_copy'));
    assert.ok(Q.copyIssues('Call (904) 555-0200', { phone: '(904) 555-0100' }).includes('unbound_phone_in_copy'));
    assert.ok(Q.copyIssues(`Place ID: ${pid}\\u0026tail`).includes('invalid_place_id_in_copy'));
    assert.deepEqual(plain(Q.copyIssues('Email service@fixture-hvac.example Call (904) 555-0100', { email: 'service@fixture-hvac.example', phone: '(904) 555-0100' })), []);
  });
  test('hidden or unclosed script text cannot be service evidence', () => {
    for (const markdown of ['<script>AC Repair</script>', '<script>AC Repair', '![AC Repair](https://fixture-hvac.example/photo.webp)']) {
      assert.equal(Q.observedService(observation(['AC Repair'], { private_source: { markdown } }), 'AC Repair'), false);
    }
  });
  test('canonical compile retains raw ratings as source observations, not customer proof', async () => {
    const p = packet();
    const body = { website_url: origin, urls: [origin], prospect_hints: { name: 'Fixture HVAC', city: 'Jacksonville', state: 'FL', category: 'hvac' } };
    const harvest = { sources: [origin], observations: p.sources.observations,
      extracted: { ...p.business, brandName: 'Fixture HVAC', finalPhone: p.business.phone, reviewCount: 100, rating: 5 } };
    const result = await A.compileCanonicalPacket(body, harvest);
    assert.equal(result.ok, true, JSON.stringify(result.problems || []));
    const findTrust = value => value && typeof value === 'object' ? (value.trust || Object.values(value).map(findTrust).find(Boolean)) : undefined;
    const trust = findTrust(result);
    assert.ok(trust, 'canonical trust object');
    assert.equal(trust.rating, null);
    assert.equal(trust.review_count, null);
    assert.match(JSON.stringify(result), /"reviewCount":100/);
  });
  // This owner-saved Gmail attachment is read only. The hash pins the exact smoke.
  const modernPath = 'C:\\Users\\Main\\Desktop\\WSS-Smoke-Integration-20260923\\modern-genie-snapshot.json';
  const modernBytes = readFileSync(modernPath);
  const modernSnapshot = JSON.parse(modernBytes.toString('utf8'));
  let modernCompiled;
  const compileModern = () => {
    if (!modernCompiled) {
      const archive = modernSnapshot.compiled.sourceContent;
      const files = Object.fromEntries(archive.pages.map(row => [row.file, modernSnapshot.compiled.contentFiles[row.file]]));
      modernCompiled = compiler.compilePacket({ ...modernSnapshot,
        __auditArchive: { files, pages: archive.pages, excluded: archive.excluded,
          bytes: archive.bytes, publicationPolicy: archive.publicationPolicy } });
    }
    return modernCompiled;
  };
  test('Modern regression fixture is the exact 1:39 PM Gmail snapshot', () => {
    assert.equal(statSync(modernPath).size, 926321);
    assert.equal(crypto.createHash('sha256').update(modernBytes).digest('hex'),
      'e9f50566ab502c819c6f123934702cc34fd1a6096d1f85fe601664a9e6591f51');
    assert.equal(modernSnapshot.goldenArtifacts.exactServices.length, 19);
    assert.equal(modernSnapshot.sources.observations.length, 19);
    assert.equal(modernSnapshot.compiled.contentQuality.visitor.totalFiles, 31);
  });
  test('Modern form, navigation and query fragments are not visitor service labels', () => {
    const fragments = modernSnapshot.goldenArtifacts.exactServices.filter(name =>
      /^(?:24\/7|Start with|Plumbing handled|Common service|Residential and commercial service|Selected:|Add a short note|One seamless|Electrical Modern)/i.test(name));
    assert.ok(fragments.length >= 8);
    for (const fragment of fragments) assert.equal(Q.serviceLabel(fragment), '', fragment);
    const queryObservation = modernSnapshot.sources.observations.find(row =>
      /[?&]service=/.test(row.source || '') && (row.private_source?.markdown || '').includes('Add a short note'));
    assert.ok(queryObservation);
    const harvested = F.extractExactServices(queryObservation.private_source.markdown);
    for (const fragment of fragments) assert.ok(!harvested.includes(fragment), fragment);
    assert.equal(Q.serviceLabel('AC Repair'), 'AC Repair');
    const gallery = modernSnapshot.sources.observations.find(row => (row.private_source?.markdown || '').includes('Real project work'));
    assert.ok(gallery);
    for (const caption of ['Electrical Installation', 'Residential Plumbing Rough-In']) {
      assert.equal(Q.observedService(gallery, caption), false);
      assert.equal(Q.sourceObservationService(gallery, caption), false);
    }
    const formOnly = { ...gallery, extracted: { exactServices: 'Maintenance Visit' } };
    assert.equal(Q.observedService(formOnly, 'Maintenance Visit'), false);
    assert.equal(Q.sourceObservationService(formOnly, 'Maintenance Visit'), false);
  });
  test('exact Modern fixture recomputes chromatic brand roles and map tokens', () => {
    const result = compileModern(), brand = result.compiled.brand, map = result.compiled.mapSdkContract.brand;
    assert.equal(modernSnapshot.compiled.brand.gradientCss, 'linear-gradient(135deg, #111111, #000000)');
    assert.equal(brand.roles.primary.hex, '#BD2632');
    assert.equal(brand.gradientCss, 'linear-gradient(135deg, #BD2632, #881B24)');
    assert.deepEqual(plain(map), { night: '#0B2344', slate: '#16263B', steel: '#586779',
      bone: '#FFFFFF', ember: '#BD2632' });
  });
  test('Modern stale selected JSON and logo remain QA review while private source stays archived', () => {
    const result = compileModern(), report = result.compiled.contentQuality;
    assert.ok(report.inputIssues.length >= 9);
    assert.equal(report.inputIssues.filter(row => row.scope === 'private_source' && row.rule === 'service_labels_withheld').length, 6);
    assert.ok(result.sources.private_quality_review.previous_issues.some(row => row.rule === 'unaccepted_service_labels' && !row.scope));
    assert.ok(report.inputIssues.some(row => row.rule === 'unaccepted_service_labels' && row.scope === 'service_selection'));
    assert.ok(report.inputIssues.some(row => row.rule === 'unverified_proof_note' && row.scope === 'proof_selection'));
    assert.equal(report.status, 'review');
    assert.equal(result.compiled.contentContract.visitor_copy.safety.pass, true);
    const serviceByName = Object.fromEntries(result.compiled.services.map(service => [service.name, service]));
    assert.equal(serviceByName['Heating & Cooling'].providerName, 'Modern Mechanical Contractors');
    assert.equal(serviceByName['Electrical repairs'].providerName, 'Modern Mechanical Contractors');
    assert.equal(serviceByName['Plumbing services'], undefined, 'affiliate is not a client offering');
    assert.equal(result.compiled.contentFiles['content/services/plumbing-services.md'], undefined);
    assert.doesNotMatch(result.compiled.contentFiles['content/home.md'], /Modern Mechanical Contractors offers[^\n]*plumbing/i);
    assert.deepEqual(plain(result.compiled.widget.fields.find(row => row.name === 'service').options),
      plain(result.compiled.services.map(row => row.name)));
    assert.deepEqual(plain(result.compiled.forms.fields.find(row => row.name === 'service').options),
      plain(result.compiled.services.map(row => row.name)));
    assert.doesNotMatch(JSON.stringify(result.compiled.hero) + JSON.stringify(result.compiled.faqs)
      + JSON.stringify(result.compiled.pages), /Add a short note|Selected: Commercial Unit Replacement/);
    assert.doesNotMatch(JSON.stringify(result.compiled.seoAssetLayer.answerEngine), /Modern Mechanical Contractors[^"]*plumbing services/i);
    assert.ok(report.totalFiles >= 12);
    assert.equal(report.passCount, report.totalFiles);
    assert.equal(report.reviewCount, 0);
    assert.ok(report.inputIssues.some(row => row.rule === 'machine_fragment_withheld'));
    assert.ok(report.visitor.files.every(row => !row.reasons.includes('machine_fragment_withheld')));
    assert.equal(report.sourceArchive.totalFiles, 19);
    assert.ok(report.sourceArchive.files.every(row => row.kind === 'source_archive'));
    assert.ok(report.visitor.files.every(row => !row.reasons.includes('must_avoid_residue')));
    assert.ok(report.visitor.files.every(row => row.status === 'pass'));
    for (const fragment of modernSnapshot.goldenArtifacts.exactServices.filter(name =>
      /^(?:24\/7|Start with|Plumbing handled|Common service|Selected:|Add a short note|One seamless|Electrical Modern|Modern Mechanical)/i.test(name))) {
      assert.ok(!result.compiled.services.some(service => service.name === fragment), fragment);
    }
  });
  test('withheld editorial text still marks the public file when it survives', () => {
    const p = packet();
    p.review = { intakeQuality: { issues: [{ field: 'mustInclude', rule: 'machine_fragment_withheld',
      severity: 'review', scope: 'editorial_selection' }] } };
    p.sources.private_quality_review = { rejected: [{ section: 'requirements', field: 'mustInclude',
      value: 'Valid selected note\n{"private":"machine fragment"}' }] };
    const report = C.contentQualityReport({
      'content/home.md': 'Public copy has {"private":"machine fragment"} in it.',
      'content/about.md': 'Clean public copy.'
    }, p, {});
    assert.equal(report.status, 'review');
    assert.equal(report.passCount, 1);
    assert.deepEqual(plain(report.visitor.files.find(row => row.sourcePath === 'content/home.md').reasons), ['machine_fragment_withheld']);
    assert.equal(report.visitor.files.find(row => row.sourcePath === 'content/about.md').status, 'pass');
    const unknown = C.contentQualityReport({ 'content/about.md': 'Clean public copy.' },
      { ...p, sources: {} }, {});
    assert.equal(unknown.reviewCount, 1, 'missing private original fails closed');
  });
  test('source-verified service survives without admitting query, gallery or unobserved labels', () => {
    const result = compileModern(), names = result.compiled.services.map(service => service.name);
    assert.ok(names.includes('Heating & Cooling'));
    assert.ok(names.includes('Electrical repairs'));
    assert.ok(!names.includes('Plumbing services'), 'affiliate is private source context');
    assert.ok(!names.includes('Electrical Installation'), 'gallery-only caption');
    assert.ok(!names.includes('Residential Plumbing Rough-In'), 'gallery-only caption');
    assert.ok(!names.some(name => /Selected:|Add a short note|24\/7|Modern Mechanical Contractors/.test(name)));
    assert.ok(!result.compiled.contentFiles['content/blog/plumbing-services-guide.md'], 'affiliate does not get a mechanical-company blog');
  });
  test('authenticated Modern replay keeps form and gallery junk out of provisional services', () => {
    const archive = modernSnapshot.compiled.sourceContent;
    const files = Object.fromEntries(archive.pages.map(row => [row.file, modernSnapshot.compiled.contentFiles[row.file]]));
    const replay = { ...modernSnapshot, __auditArchive: { files, pages: archive.pages,
      excluded: archive.excluded, bytes: archive.bytes, publicationPolicy: archive.publicationPolicy } };
    const result = compiler.compileAuthenticatedHarvestPacket(replay);
    assert.deepEqual(plain(result.compiled.services.map(row => row.name)),
      plain(compileModern().compiled.services.map(row => row.name)));
    assert.ok(!result.compiled.services.some(row => /Selected:|Add a short note|24\/7|Electrical Installation/.test(row.name)));
  });
  test('source-recorded credential and review survive recompile and export while stale proof is withheld', () => {
    const p = packet();
    p.sources.observations.push({ source: origin + '/license', status: 'succeeded',
      private_source: { markdown: '# Credentials\nTN Electrical License #123456\nNATE Certified technician' } });
    p.sources.observations.push({ source: 'https://reviews.example/review/one', status: 'succeeded',
      private_source: { markdown: 'A Real Customer: Prompt and careful electrical repair.\n4.8 stars from 12 reviews' } });
    p.sources.proofEvidence = [
      { kind: 'licenses', value: 'TN Electrical License #123456', sourceUrl: origin + '/license' },
      { kind: 'certifications', value: 'NATE Certified technician', sourceUrl: origin + '/license' },
      { kind: 'licenses', value: 'Fake license #999999', sourceUrl: origin + '/license' }
    ];
    p.compiled = { trust: { certifications: ['Unverified certificate'], licenses: ['License 123'] },
      reviews: { aggregate: { rating: 4.8, count: 12, evidenceText: '4.8 stars from 12 reviews',
          sourceUrl: 'https://reviews.example/review/one' },
        items: [
          { text: 'Prompt and careful electrical repair.', author: 'A Real Customer',
            sourceUrl: 'https://reviews.example/review/one' },
          { text: 'Unverified glowing statement.', author: 'Invented Person', sourceUrl: origin + '/license' }
        ] } };
    const result = compiler.compilePacket(p), again = compiler.compilePacket(result);
    for (const candidate of [result, again]) {
      assert.deepEqual(plain(candidate.compiled.trust.licenses.map(row => row.value)), ['TN Electrical License #123456']);
      assert.deepEqual(plain(candidate.compiled.trust.certifications.map(row => row.value)), ['NATE Certified technician']);
      assert.deepEqual(plain(candidate.compiled.reviews.items.map(row => row.text)), ['Prompt and careful electrical repair.']);
      assert.equal(candidate.compiled.reviews.aggregate.count, 12);
      const attachments = S.attachmentDataForPacket(candidate);
      assert.equal(attachments.trust.licenses[0].value, 'TN Electrical License #123456');
      assert.equal(attachments.reviews.items[0].author, 'A Real Customer');
      const snapshot = JSON.parse(S.packetFiles(candidate, 'fixture', [])['fixture/snapshot.json']);
      assert.equal(snapshot.compiled.trust.certifications[0].value, 'NATE Certified technician');
      assert.equal(snapshot.compiled.reviews.items[0].text, 'Prompt and careful electrical repair.');
    }
  });
  test('Modern concatenated trust note cannot become credential, badge, review or schema proof', () => {
    const blob = modernSnapshot.compiled.trust.certifications[0];
    assert.ok(blob.length > 2000);
    assert.match(blob, /license earned in 2005/i);
    assert.match(blob, /Request Service/);
    const result = compileModern();
    assert.ok(result.sources.private_quality_review.rejected.some(row => row.field === 'protectedNotes'));
    assert.ok(result.compiled.contentQuality.inputIssues.some(row => row.rule === 'unverified_proof_note'));
    assert.deepEqual(plain(result.compiled.trust.certifications), []);
    assert.deepEqual(plain(result.compiled.trust.licenses), []);
    assert.deepEqual(plain(result.compiled.reviews.items), []);
    assert.doesNotMatch(JSON.stringify(result.compiled.seoAssetLayer), /license earned in 2005/i);
    const exported = S.packetFiles(modernSnapshot, "modern", []);
    const exportedSnapshot = JSON.parse(exported["modern/snapshot.json"]);
    const exportedGolden = JSON.parse(exported["modern/golden-artifacts.json"]);
    assert.deepEqual(plain(exportedSnapshot.compiled.trust.certifications), []);
    assert.deepEqual(plain(exportedSnapshot.compiled.reviews.items), []);
    assert.ok(!exportedGolden.protectedNotes.some(note => note === blob));
    for (const attachment of [S.attachmentDataForPacket(modernSnapshot), S.attachmentDataForPacket(result)]) {
      assert.deepEqual(plain(attachment.trust.certifications), []);
      assert.deepEqual(plain(attachment.trust.licenses), []);
      assert.deepEqual(plain(attachment.reviews.items), []);
      assert.doesNotMatch(JSON.stringify(attachment.trust) + JSON.stringify(attachment.reviews), /license earned in 2005/i);
    }
  });
  test('Modern must-avoid prose does not ban service area, but an explicit phrase still blocks', () => {
    const p = packet();
    p.requirements = { mustAvoid: modernSnapshot.requirements.mustAvoid + '\nSecret banned slogan' };
    const clean = C.visitorCopySafetyViolations({ 'content/service-areas.md': 'We serve the local service area.' }, {}, p);
    const banned = C.visitorCopySafetyViolations({ 'content/service-areas.md': 'We serve the local service area. Secret banned slogan.' }, {}, p);
    assert.ok(!clean.some(row => row.rule === 'must_avoid_residue'));
    assert.ok(banned.some(row => row.rule === 'must_avoid_residue'));
    const unsupported = C.visitorCopySafetyViolations({ 'content/home.md': 'We are licensed and guaranteed.' }, {}, p);
    assert.ok(unsupported.some(row => row.rule === 'unsupported_high_risk_claim'));
  });
  test('private source block cannot mark unrelated clean visitor copy', () => {
    const p = packet();
    p.review = { intakeQuality: { issues: [{ field: 'source', rule: 'source_diagnostic', severity: 'block', scope: 'private_source' }] } };
    const result = compiler.compilePacket(p);
    assert.equal(result.compiled.contentQuality.status, 'pass');
    assert.ok(result.compiled.contentQuality.visitor.files.every(row => row.status === 'pass'));
  });
  test('clean recompile discards stale derived trust and reviews without a source proof record', () => {
    const p = packet();
    p.compiled = { trust: { certifications: ['Unverified certificate'], licenses: ['License 123'], notes: ['5 stars'] },
      reviews: { aggregate: { rating: 5, count: 99 }, items: [{ quote: 'Unverified quote' }] } };
    const result = compiler.compilePacket(p);
    assert.deepEqual(plain(result.compiled.trust.certifications), []);
    assert.deepEqual(plain(result.compiled.trust.licenses), []);
    assert.deepEqual(plain(result.compiled.reviews.items), []);
    assert.deepEqual(plain(result.compiled.reviews.aggregate), {});
    assert.equal(result.compiled.contentQuality.status, 'pass');
  });
  test('research observations survive re-normalization without becoming first-pass business recommendations', () => {
    const p = packet(); p.brightDataAudit = { aggregate: { topCompetitorDomains: ['unrelated.example'] }, firstPassRecommendations: { pageTitles: [{ title: 'unrelated service' }] } };
    const first = compiler.compilePacket(p), second = compiler.compilePacket(first);
    assert.deepEqual(plain(second.compiled.brightDataAudit.research.competitorDomainObservations), ['unrelated.example']);
    assert.doesNotMatch(JSON.stringify(second.compiled.brightDataAudit.firstPassRecommendations), /unrelated service/);
  });
}

// Execute the existing visitor-copy assertions unchanged in the same closed harness.
// Only their explicit source-evidence fixtures changed; no assertion is weakened.
if (!baselineMode) {
  const legacyPath = 'tests/visitor-copy-contract.test.mjs';
  const legacyUrl = new URL('visitor-copy-contract.test.mjs', import.meta.url).href;
  let context;
  const compileInLegacyRealm = packet => {
    context.__serialized = JSON.stringify(compiler.compilePacket(packet));
    return new Script('JSON.parse(__serialized)').runInContext(context);
  };
  context = createContext({ ...shared, test, assert, dirname, join, fileURLToPath, createHash: crypto.createHash,
    createRequire: () => path => {
      assert.equal(resolve(path), resolve(root, 'api/compile-build-packet.js'));
      return { compilePacket: compileInLegacyRealm };
    },
  });
  const source = sources[legacyPath].replace(/^import[^\n]*\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(legacyUrl));
  new Script(source, { filename: legacyPath }).runInContext(context, { timeout: 5000 });
}
