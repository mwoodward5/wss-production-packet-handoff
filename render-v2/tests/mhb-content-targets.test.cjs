'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'donors', 'catalog', '03-mhb-build-llc');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'donor.json'), 'utf8'));
const home = fs.readFileSync(path.join(root, 'source', 'src', 'pages', 'Index.tsx'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'source', 'src', 'lib', 'bridge.ts'), 'utf8');

test('MHB declares the native home services list rendered from the client island', () => {
  assert.equal(manifest.data_island_id, 'wss-client-data');
  assert.deepEqual(manifest.content_render_targets.services, [
    { path: '/', selector: "section.section:has(ol > li > a[href^='/services/'])" },
  ]);
  assert.match(home, /<section className="section">[\s\S]*?<ol className="lg:col-span-8 divide-y border-t border-b">[\s\S]*?services\.map/);
  assert.match(home, /<li key=\{s\.slug\}>[\s\S]*?<Link to=\{`\/services\/\$\{s\.slug\}`\}/);
  assert.match(bridge, /createBridge\(island\('wss-client-data'\)/);
});

test('MHB does not claim native proof for channels without stable targets', () => {
  for (const channel of ['faqs', 'reviews', 'hours', 'areas']) {
    assert.equal(manifest.content_render_targets[channel], undefined);
    assert.match(manifest.content_channel_availability[channel], /^unavailable_/);
  }
  assert.match(home, /\{faqs\.length > 0 && <section className="section border-t">/);
});
