'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../donors/catalog/50-card-concrete-construction');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'donor.json'), 'utf8'));
const read = rel => fs.readFileSync(path.join(root, 'source/src', rel), 'utf8');

test('donor 50 declares the selector backed by client-bound service cards', () => {
  assert.deepEqual(manifest.content_render_targets.services, [{ path: '/', selector: '#services article' }]);
  assert.match(read('content/services.ts'), /SERVICES:\s*Service\[\]\s*=\s*BINDING\.services/);
  assert.match(read('lib/wss-bridge.ts'), /client\.services\.map/);
  const sections = read('components/site/sections.tsx');
  assert.match(sections, /<section id="services"/);
  assert.match(sections, /SERVICES\.map/);
  assert.match(sections, /<article/);
  assert.match(sections, /\{s\.name\}/);
});
