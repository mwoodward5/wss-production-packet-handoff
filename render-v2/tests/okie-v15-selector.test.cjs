'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { rendererFor } = require('../integration/renderer-selector.cjs');
const { validateRecord } = require('../contracts/genie-packet.cjs');
const { mapDonor: mapEl } = require('../donors/catalog/06-el-construction/mapping.cjs');

// These names and excerpts came from the fresh URL-only Okie v15 compile.
// "Decorative Services" is observed on the source site, but donor 06's
// runtime rejects headings that omit concrete-trade words.
const names = ['Commercial concrete and ADA Ramps', 'Decorative Services', 'Concrete Repairs and Maintenance'];
const files = {
  'content/home.md': '# Okie Concrete\n\nOkie Concrete offers Commercial concrete and ADA Ramps, Decorative Services, Concrete Repairs and Maintenance in Oklahoma City, US.\n',
  'content/services/commercial-concrete-and-ada-ramps.md': '# Commercial concrete and ADA Ramps\n\nAre you a local small business owner?  Hey!  Us too!\n',
  'content/services/decorative-services.md': '# Decorative Services\n\nUntreated concrete surfaces tend to be porous and have a basic and bland appearance. Luckily, there are so many applications and processes that can be applied to improve the appearance and even further preserve your custom concrete, preventing cracks and stains. From exposed aggregate, to acid washes, staining or stamping, Okie Concrete is here to pave the way for your gorgeous homestead to become exactly what you envision.\n',
  'content/services/concrete-repairs-and-maintenance.md': '# Concrete Repairs and Maintenance\n\nNo material is ever truly maintenance free. Though concrete is certainly low maintenance, waxing or sealing every few years can extend the life and beauty of your surface. Talk to us about cleaning, sealing or repairing old broken concrete.\n',
};
const file_hashes = Object.fromEntries(Object.entries(files).map(([file, body]) =>
  [file, crypto.createHash('sha256').update(body, 'utf8').digest('hex')]));
const record = JSON.parse(fs.readFileSync(path.join(__dirname, '../evidence/recent-candidates.json'), 'utf8'))
  .find(row => row.prospect_id === 'lm-8e907f26211e418e46303e383063f5af60b5f81f').record;
const packet = {
  ok: true, status: 'complete', version: 'intake-genie-v2',
  facts: { name: 'Okie Concrete', city: 'Oklahoma City', state: 'US', website: 'https://okieconcrete.com/',
    phone: '405-407-1133', category: 'concrete', services_source: 'source_bound', services: names },
  sources: { observations: [
    { source: 'https://okieconcrete.com/', extracted: { exactServices: names.slice(1) } },
    { source: 'https://okieconcrete.com/commercial-concrete-and-ada-ramps', extracted: { exactServices: names.slice(0, 1) } },
  ] },
  content: { content_contract: { schema: 'CertifiedPracticePacket/v1', kind: 'certified_practice_packet',
    version: 1, builder_instructions: { public: false }, visitor_copy: {
      kind: 'visitor_copy', files, file_hashes, safety: { pass: true, violations: [] },
    } } },
};

test('fresh Okie service packet skips runtime-incompatible and unprovable donors', () => {
  const priorSends = process.env.GHOST_AGENCY_LINE_LIVE_SENDS;
  const priorSmoke = process.env.GHOST_AGENCY_SANDBOX_AUTOSEND;
  process.env.GHOST_AGENCY_LINE_LIVE_SENDS = '0';
  process.env.GHOST_AGENCY_SANDBOX_AUTOSEND = 'true';
  try {
    const prospect = { ...record, genie_canonical_packet: packet };
    const certified = validateRecord(prospect);
    assert.equal(certified.services.length, 3);
    assert.deepEqual(Object.keys(certified.files).sort(), Object.keys(files).sort());
    const el = JSON.parse(fs.readFileSync(path.join(__dirname, '../donors/catalog/06-el-construction/donor.json'), 'utf8'));
    assert.throws(() => mapEl({ facts: certified.facts, services: certified.services, files: certified.files, manifest: el }),
      /donor_wrong_trade/);
    assert.deepEqual(rendererFor(prospect), { renderer: 'spa-v2', category: 'concrete', donorKey: '50-card-concrete-construction' });
  } finally {
    if (priorSends === undefined) delete process.env.GHOST_AGENCY_LINE_LIVE_SENDS;
    else process.env.GHOST_AGENCY_LINE_LIVE_SENDS = priorSends;
    if (priorSmoke === undefined) delete process.env.GHOST_AGENCY_SANDBOX_AUTOSEND;
    else process.env.GHOST_AGENCY_SANDBOX_AUTOSEND = priorSmoke;
  }
});
