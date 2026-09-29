'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validateRecord, certifiedVisitorFiles } = require('../contracts/genie-packet.cjs');
const { mapDonor } = require('../donors/catalog/03-mhb-build-llc/mapping.cjs');

// Sanitized from the certified Bespoke Design & Construction record
// lm-0bae1aca222b62397715a5b736155e88c5e45f9c in the local prospect DB.
// The packet had only content/home.md; no service files or depth channels.
const names = ['Whole House Renovation', 'Kitchen Remodeling', 'Bathroom Remodeling', 'Additions',
  'Exterior Projects', 'Bedroom Remodeling', 'Basement Finishing', 'Garage Conversions',
  'Major Remodeling', 'Aging in Place'];
const home = '# Bespoke Design & Construction\n\nBespoke Design & Construction offers Whole House Renovation, Kitchen Remodeling, Bathroom Remodeling, Additions, Exterior Projects, Bedroom Remodeling, Basement Finishing, Garage Conversions, Major Remodeling, Aging in Place in Northeast Ohio, OH.\n';
const sha = body => crypto.createHash('sha256').update(body, 'utf8').digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../donors/catalog/03-mhb-build-llc/donor.json'), 'utf8'));

function record(files = { 'content/home.md': home }) {
  return { prospect_id: 'lm-0bae1aca222b62397715a5b736155e88c5e45f9c', record: {
    genie_compiled_at: '2026-09-29T00:00:00Z',
    genie_canonical_packet: {
      ok: true, status: 'complete', version: 'intake-genie-v2',
      facts: { name: 'Bespoke Design & Construction', city: 'Northeast Ohio', state: 'OH',
        website: 'https://www.cobblestoneconstructionllc.com/', phone: '2164077494',
        category: 'general contracting', services_source: 'source_bound', services: names },
      content: { content_contract: { schema: 'CertifiedPracticePacket/v1', kind: 'certified_practice_packet',
        version: 1, builder_instructions: { public: false }, visitor_copy: {
          kind: 'visitor_copy', safety: { pass: true, violations: [] }, files,
          file_hashes: Object.fromEntries(Object.entries(files).map(([file, body]) => [file, sha(body)])),
        } } },
    },
  } };
}

test('real failing general-contractor packet still exposes the missing service-file wall', () => {
  const certified = validateRecord(record());
  assert.equal(certified.services.length, 10);
  assert.ok(certified.services.every(service => service.file === 'content/home.md'));
  assert.throws(() => mapDonor({ facts: certified.facts, services: certified.services,
    files: certified.files, manifest }), /construction_service_copy_unbound/);
});

test('each real service needs its own byte-bound markdown and a changed byte invalidates the file set', () => {
  const paragraph = home.split('\n\n')[1].trim();
  const files = { 'content/home.md': home };
  for (const [i, name] of names.entries()) files[`content/services/${String(i + 1).padStart(2, '0')}.md`] = `# ${name}\n\n${paragraph}\n`;
  const rec = record(files);
  const certified = validateRecord(rec);
  assert.deepEqual(certified.services.map(s => s.file), names.map((_, i) => `content/services/${String(i + 1).padStart(2, '0')}.md`));
  assert.doesNotThrow(() => mapDonor({ facts: certified.facts, services: certified.services,
    files: certified.files, manifest }));
  rec.record.genie_canonical_packet.content.content_contract.visitor_copy.files['content/services/01.md'] += 'x';
  assert.deepEqual(certifiedVisitorFiles(rec.record.genie_canonical_packet), {});
  assert.throws(() => validateRecord(rec), /genie_home_copy_missing/);
});

test('landscaping manifest declares only auditable native content channels', () => {
  const landscaping = JSON.parse(fs.readFileSync(path.join(__dirname, '../donors/landscaping/donor.json'), 'utf8'));
  for (const channel of ['services', 'faqs']) {
    assert.ok(Array.isArray(landscaping.content_render_targets[channel]) && landscaping.content_render_targets[channel].length,
      `${channel} must have a real render target`);
  }
  for (const channel of ['reviews', 'hours', 'areas']) {
    assert.equal(landscaping.content_render_targets[channel], undefined);
    assert.match(landscaping.content_channel_availability[channel], /^unavailable_/);
  }
});
