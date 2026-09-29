const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { compilePacket } = require('../api/compile-build-packet.js');

function packet(selected, observations) {
  const domainUrl = 'https://example-fence.test/';
  return {
    business: { businessName: 'Example Fence', domainUrl, exactServices: selected.join('\n') },
    goldenArtifacts: { exactServices: selected, protectedNotes: [] },
    pagePlan: [{ title: 'Home', slug: '' }],
    sources: { urls: [domainUrl], observations: observations.map(markdown => ({
      source: domainUrl, status: 'succeeded',
      extracted: { exactServices: selected.join('\n') },
      private_source: { markdown },
    })) },
  };
}

function firstBodyParagraph(markdown) {
  return markdown.split(/\r?\n\s*\r?\n/).find(p => p.trim() && !p.trimStart().startsWith('#'));
}

test('generic certified services bind their emitted Markdown byte for byte', () => {
  const input = packet(['Fence Installation', 'Gate Repair'], [
    '# Fence Installation\nExample Fence offers fence installation.\n\n# Gate Repair\nExample Fence offers gate repair.',
  ]);
  const result = compilePacket(input);
  assert.equal(result.compiled.services.length, 2);
  for (const service of result.compiled.services) {
    const expectedPath = `content/services/${service.slug}.md`;
    const body = result.compiled.contentFiles[expectedPath];
    assert.equal(service.file, expectedPath);
    assert.equal(service.longDescMd, body);
    assert.equal(service.description, firstBodyParagraph(body));
    assert.equal(service.contentSha256, createHash('sha256').update(body, 'utf8').digest('hex'));
    assert.match(service.description, /^Example Fence offers /);
  }
  assert.equal(result.compiled.contentContract.facts.services.length, 2);
});

test('unproved selected service gets neither service row nor file binding', () => {
  const result = compilePacket(packet(['Fence Installation', 'Roof Repair'], [
    '# Fence Installation\nExample Fence offers fence installation.',
  ]));
  assert.deepEqual(result.compiled.services.map(service => service.name), ['Fence Installation']);
  assert.equal(result.compiled.contentFiles['content/services/roof-repair.md'], undefined);
  assert.ok(result.compiled.services.every(service => service.file && service.description && service.contentSha256));
  assert.deepEqual(result.compiled.contentContract.facts.services, ['Fence Installation']);
});
