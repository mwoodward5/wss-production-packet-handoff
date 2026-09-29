'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'donors', 'landscaping');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'donor.json'), 'utf8'));

test('landscaping smoke manifest names native targets and marks unbound channels unavailable', () => {
  const expected = { services: 'section#services', faqs: 'section#faq' };
  const source = [
    fs.readFileSync(path.join(root, 'source', 'src', 'pages', 'Index.tsx'), 'utf8'),
    fs.readFileSync(path.join(root, 'source', 'src', 'components', 'TrustModules.tsx'), 'utf8'),
  ].join('\n');
  for (const [channel, selector] of Object.entries(expected)) {
    assert.deepEqual(manifest.content_render_targets[channel], [{ path: '/', selector }]);
    assert.ok(source.includes(`id="${selector.slice(8)}"`), `${channel} selector exists in the donor source`);
  }
  assert.equal(manifest.content_channel_availability.hours, 'unavailable_until_source_bound_render');
  assert.equal(manifest.content_channel_availability.areas, 'unavailable_until_source_bound_render');
  assert.equal(manifest.content_channel_availability.reviews, 'unavailable_until_source_bound_render');
  assert.equal(manifest.content_render_targets.hours, undefined);
  assert.equal(manifest.content_render_targets.areas, undefined);
  assert.equal(manifest.content_render_targets.reviews, undefined);
});

test('shipped landscaping bundle carries no source donor hours or area identity', () => {
  const bundleDir = path.join(root, 'bundle');
  for (const file of fs.readdirSync(bundleDir)) {
    if (!/\.(?:js|html)$/.test(file)) continue;
    const bytes = fs.readFileSync(path.join(bundleDir, file), 'utf8');
    for (const value of ['Greenfront Lawn & Landscape', 'Birmingham, AL', 'Meadowbrook', 'Mon–Fri · 6 AM – 5 PM']) {
      assert.ok(!bytes.includes(value), `${file} leaked donor-specific ${value}`);
    }
  }
});
