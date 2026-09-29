import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const harvest = require('../api/firecrawl-intake.js');
const compile = require('../api/compile-build-packet.js');
const canonical = require('../api/intake-genie-compile.js');
const { archiveSourcePages } = require('../api/lib/source-page-archive.js');
const deep = harvest.deepHarvest;
const base = 'https://www.fixture.example/';
const longText = '# Long article\n\n' + 'Detailed source content. '.repeat(2500) + '\nEXACT ARTICLE END';
const pages = ['', 'blog', 'faq', 'financing', 'rebates', 'coupons-promotions', 'indoor-air-quality', 'career', 'about', 'contact', 'ac-repair', 'ac-install', 'maintenance', 'privacy-policy', 'booking', 'promotions'];
const articles = Array.from({ length: 10 }, (_, i) => 'blog/article-' + (i + 1));
const sitemapOnly = ['history', 'team', 'resources', 'testimonials'];
const link = slug => '<a href="https://fixture.example/' + slug + '/">Page</a>';
let captured;
test('30-page fixture: sitemap + apex navigation + one-hop articles; six concurrent scrapes', async () => {
  const original = globalThis.fetch; let active = 0; let peak = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url === base) return new Response(pages.map(link).join(''));
    if (url === base + 'sitemap.xml') return new Response('<urlset>' + sitemapOnly.map(p => '<url><loc>https://fixture.example/' + p + '/</loc></url>').join('') + '</urlset>');
    if (url === base + 'sitemap_index.xml' || url === base + 'wp-sitemap.xml') return new Response('', { status: 404 });
    if (url.endsWith('/v2/map')) return Response.json({ success: true, links: [] });
    if (url.endsWith('/v2/scrape')) {
      const requested = JSON.parse(options.body).url;
      const slug = new URL(requested).pathname.replace(/^\/|\/$/g, '');
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 3 + slug.length % 7)); active--;
      return Response.json({ success: true, data: { markdown: articles.includes(slug) ? longText : '# Fixture\n\nAC repair.', rawHtml: slug === 'blog' ? articles.map(link).join('') : '', links: [], json: { brandName: 'Fixture HVAC', exactServices: 'AC Repair' }, metadata: { title: 'Fixture HVAC', sourceURL: requested } } });
    }
    throw new Error('Unexpected fixture request: ' + url);
  };
  try { captured = await harvest.harvestSources({ urls: [base], apiKey: 'inert-test-key' }); }
  finally { globalThis.fetch = original; }
  assert.equal(captured.sources.length, 30);
  assert.equal(captured.coverage.counts.failed, 0);
  assert.deepEqual(captured.sources, [...captured.sources].sort());
  assert.ok(peak >= 6, 'pool must run at least six scrapes concurrently');
  assert.ok(captured.coverage.byte_budget.used <= 48 * 1024 * 1024);
  assert.equal(captured.observations.filter(row => row.private_source.markdown.includes('EXACT ARTICLE END')).length, 10);
});
test('no keyword filtering; external/private/protocol/asset exclusions; stable canonical URL', () => {
  assert.equal(deep.contentPageUrl('https://fixture.example/career/?utm_source=x#section', base), base + 'career');
  assert.equal(deep.contentPageUrl('/faq?z=2&a=1', base), base + 'faq?a=1&z=2');
  for (const bad of ['https://elsewhere.example/faq', 'http://127.0.0.1/', 'tel:3214445514', 'mailto:a@b.example', '/x.PDF', '/x.css', 'https://fixture.example:8080/a', 'javascript:alert(1)']) assert.equal(deep.contentPageUrl(bad, base), '', bad);
  assert.deepEqual(deep.pageLinks({ html: '<a href="/career">Careers</a><a href="/rebates">Rebates</a><a href="/x.png">Asset</a><script><a href="/fake">Hidden</a></script>' }, base), [base + 'career', base + 'rebates']);
});
test('XML entities and encoded paths remain valid', () => {
  assert.deepEqual(deep.locUrls('<urlset><url><loc>https://fixture.example/a%20b?x=1&amp;y=2</loc></url></urlset>'), ['https://fixture.example/a%20b?x=1&y=2']);
  assert.deepEqual(deep.locUrls('<sm:loc><![CDATA[https://fixture.example/x]]></sm:loc>'), ['https://fixture.example/x']);
});
test('byte ceiling rejects oversized streams rather than truncating silently', async () => {
  const budget = { used: 0, limit: 8 };
  await assert.rejects(deep.readResponseTextLimited(new Response('0123456789'), 8, 500, budget), /budget|limit/);
  assert.ok(budget.used <= budget.limit);
});
test('source archive preserves complete article tail and cannot enter certified visitor copy', () => {
  assert.ok(captured, 'harvest fixture must run first');
  const packet = { business: { businessName: 'Fixture HVAC', domainUrl: base, category: 'hvac', mainServices: 'AC Repair' }, sources: { urls: captured.sources, observations: captured.observations }, pagePlan: [{ title: 'Home', slug: '' }] };
  const output = compile.compilePacket(packet);
  assert.equal(output.compiled.sourceContent.pages.length, 30);
  const rows = output.compiled.sourceContent.pages.filter(row => row.route.startsWith('/blog/article-'));
  assert.equal(rows.length, 10);
  for (const row of rows) { assert.equal(output.compiled.contentFiles[row.file], longText); assert.equal(row.truncated, false); }
  assert.equal(output.pagePlan.length, 1, 'archived sources must not become visitor pages');
  assert.equal(output.compiled.sourceRouteCandidates.length, 30, 'source routes remain private candidates');
  assert.equal(packet.pagePlan.length, 1, 'input must not be mutated');
  assert.equal(Object.keys(output.compiled.contentContract.visitor_copy.files).filter(path => path.includes('/source-pages/')).length, 0);
  assert.ok(output.compiled.preflight.productionLocks.some(lock => lock.key === 'source-content-review' && lock.status === 'review'));
  assert.notEqual(output.readiness.status, 'under_6_ready');
});
test('archive deterministic regardless of incoming order; foreign observations rejected', () => {
  const packet = { business: { domainUrl: base }, sources: { observations: captured.observations } };
  const a = archiveSourcePages(packet);
  const b = archiveSourcePages({ ...packet, sources: { observations: [...captured.observations].reverse().concat({ source: 'https://foreign.example/', status: 'succeeded', private_source: { markdown: 'Foreign text' } }) } });
  assert.deepEqual(a, b);
});
test('canonical normalization retains >24k text end-to-end', () => {
  const output = canonical.compileCanonicalPacket({ website_url: base, prospect_hints: { name: 'Fixture HVAC', city: 'Orlando', state: 'FL', category: 'hvac' } }, captured);
  assert.equal(output.status, 'compiled');
  assert.equal(output.packet2.compiled.sourceContent.pages.length, 30);
  assert.equal(Object.values(output.packet2.compiled.contentFiles).filter(text => typeof text === 'string' && text.endsWith('EXACT ARTICLE END')).length, 10);
  assert.ok(output.source_coverage.byte_budget.used > 0);
});

test('40-page default enforces deterministic truncation above the cap', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url === base) return new Response(Array.from({ length: 44 }, (_, i) => link('page-' + String(i).padStart(2, '0'))).join(''));
    if (/sitemap/.test(url)) return new Response('', { status: 404 });
    if (url.endsWith('/v2/map')) return Response.json({ success: true, links: [] });
    if (url.endsWith('/v2/scrape')) return Response.json({ success: true, data: { markdown: 'Page content', metadata: { sourceURL: JSON.parse(options.body).url } } });
    throw new Error('Unexpected fixture request: ' + url);
  };
  try {
    const result = await harvest.harvestSources({ urls: [base], apiKey: 'inert-test-key' });
    assert.equal(deep.limits.maxUrls, 40); assert.equal(result.sources.length, 40);
    assert.equal(result.coverage.counts.truncated, 5);
    assert.deepEqual(result.coverage.attempted, [...result.coverage.attempted].sort());
  } finally { globalThis.fetch = original; }
});
test('unchanged UI compile endpoint can recover discarded observations from saved URLs', async () => {
  const oldHarvest = harvest.harvestSources;
  const oldToken = process.env.INTAKE_GENIE_TOKEN;
  process.env.INTAKE_GENIE_TOKEN = 'offline-ui-test';
  let called = 0; let result;
  harvest.harvestSources = async options => { called++; assert.deepEqual(options.urls, [base]); return captured; };
  const response = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { result = body; return this; } };
  try {
    await compile({ method: 'POST', headers: { authorization: 'Bearer offline-ui-test' }, body: { packet: { business: { domainUrl: base, businessName: 'Fixture HVAC', category: 'hvac' }, sources: { urls: [base] } } } }, response);
    assert.equal(response.statusCode, 200); assert.equal(called, 1);
    assert.equal(result.packet.compiled.sourceContent.pages.length, 30);
  } finally { harvest.harvestSources = oldHarvest; if (oldToken === undefined) delete process.env.INTAKE_GENIE_TOKEN; else process.env.INTAKE_GENIE_TOKEN = oldToken; }
});
