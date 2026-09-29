import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compilePacket } = require('../api/compile-build-packet.js');

function fixture() {
  const base = 'https://fixture-hvac.example';
  return {
    business: { businessName: 'Fixture HVAC', domainUrl: base, category: 'hvac',
      serviceArea: 'Jacksonville, FL', email: 'hello@fixture-hvac.example',
      phone: '(904) 555-0100', exactServices: 'AC Repair' },
    goldenArtifacts: { exactServices: ['AC Repair'] },
    pagePlan: [{ title: 'Home', slug: '' }, { title: 'Services', slug: 'services' }],
    sources: { observations: [
      { source: `${base}/about`, status: 'succeeded', extracted: { exactServices: 'AC Repair' },
        private_source: { markdown: '# About\n\nWe provide AC Repair.\n\n' + 'Source-only research. '.repeat(1800),
          quality_review: { issues: [{ field: 'reviews', rule: 'template_demo_source', severity: 'review' }] } } },
      { source: `${base}/dt_testimonials/john-doe`, status: 'succeeded',
        private_source: { markdown: '# Demo review\n\nJohn Doe lorem ipsum.' } }
    ] }
  };
}

test('private source length and source diagnostics do not inflate visitor copy or its review count', () => {
  const compiled = compilePacket(fixture()).compiled;
  const quality = compiled.contentQuality;
  assert.equal(quality.schema, 'PublicCopyQuality/v3');
  assert.equal(quality.totalFiles, Object.keys(compiled.contentContract.visitor_copy.files).length);
  assert.equal(quality.totalWords, quality.visitor.totalWords);
  assert.ok(quality.sourceArchive.totalWords > quality.totalWords);
  assert.equal(quality.packetTotals.totalWords, quality.totalWords + quality.sourceArchive.totalWords);
  assert.equal(quality.packetTotals.totalFiles, quality.totalFiles + quality.sourceArchive.totalFiles);
  assert.equal(quality.reviewCount, 0);
  assert.ok(quality.inputIssues.some(issue => issue.rule === 'template_demo_source' && issue.scope === 'private_source'));
  assert.ok(quality.sourceArchive.files.every(row => row.status === 'review'));
  assert.equal(compiled.productionLocks.some(lock => lock.key === 'source-content-review'), true);
  assert.equal(compiled.sourceContent.editorialWorklist.candidates.length, 1);
  assert.ok(compiled.sourceContent.editorialWorklist.excluded.some(row => row.reason === 'demo_or_testimonial_route'));
  assert.equal(compiled.sourceContent.editorialWorklist.publicationPolicy, 'private_editorial_planning_only');
  assert.equal(compiled.preflight.contentGate.totalWords, quality.totalWords);
});

test('bad selected contact still blocks visitor quality and does not leak into visitor files', () => {
  const packet = fixture();
  packet.business.email = 'flags@2x.webp';
  const compiled = compilePacket(packet).compiled;
  assert.equal(compiled.contentQuality.status, 'block');
  assert.equal(compiled.contentQuality.passCount, 0);
  assert.doesNotMatch(JSON.stringify(compiled.contentContract.visitor_copy.files), /flags@2x\.webp/);
});

test('21 harvested pages remain private while a two-page visitor plan controls routes and sitemaps', () => {
  const packet = fixture();
  const base = packet.business.domainUrl;
  packet.sources.observations = Array.from({ length: 21 }, (_, index) => ({
    source: `${base}/research/page-${index + 1}`, status: 'succeeded',
    private_source: { markdown: `# Source ${index + 1}\n\nAC Repair research material.` }
  }));
  packet.compiled = { manifest: { routes: ['/stale-source-route'] },
    preflight: { counts: { routes: 99 } } };
  const result = compilePacket(packet);
  const compiled = result.compiled;
  assert.equal(result.pagePlan.length, 2);
  assert.equal(compiled.visitorPagePlan.length, 2);
  assert.equal(compiled.sourceRouteCandidates.length, 21);
  assert.equal(compiled.sourceContent.pages.length, 21);
  assert.equal(compiled.routeContentMap.length, 2);
  assert.equal(compiled.preflight.contentGate.routeCount, 2);
  assert.equal(compiled.preflight.counts.routes, 2);
  assert.deepEqual(compiled.manifest.routes, ['/', '/services']);
  assert.equal(compiled.searchOptimizationPlan.pageTargets.length, 2);
  assert.equal(compiled.postPublishValidation.checks.some(check => /stale-source-route|research\/page/.test(JSON.stringify(check))), false);
  assert.doesNotMatch(JSON.stringify(compiled.seoAssetLayer.sitemapsByName), /stale-source-route|research\/page/);
  assert.equal(packet.pagePlan.length, 2, 'the input plan is untouched');
});
