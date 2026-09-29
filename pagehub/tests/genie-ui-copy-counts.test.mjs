import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';

const html = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8');
function functionText(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, `Missing ${name}`);
  const end = html.indexOf('\n    }', start);
  assert.ok(end > start, `Missing end of ${name}`);
  return html.slice(start, end + 6);
}
const context = createContext({
  intakeQuality: { version: 'test', facts: () => ({ issues: [] }), copyIssues: () => [] },
  flatPacketPath: path => path.replaceAll('/', '-'),
  wordCount: content => content.trim().split(/\s+/).length
});
new Script(`${functionText('packetCopyCounts')}\n${functionText('packetContentQualitySummary')}`).runInContext(context);

test('UI counts separate visitor copy from raw private archive', () => {
  const files = [
    { sourcePath: 'content/home.md', kind: 'generated_copy', status: 'review', wordCount: 932 },
    { sourcePath: 'content/source/home.md', kind: 'source_archive', status: 'review', wordCount: 26256 }
  ];
  const counts = context.packetCopyCounts({ files, totalFiles: 2, totalWords: 27188 });
  assert.deepEqual(JSON.parse(JSON.stringify(counts)), {
    visitorFiles: 1, visitorWords: 932, archiveFiles: 1, archiveWords: 26256,
    packetFiles: 2, packetWords: 27188
  });
  const packet = { business: {}, compiled: { contentQuality: {
    files, totalFiles: 2, totalWords: 27188, validationVersion: 'test', status: 'review'
  }, contentFiles: { 'content/home.md': 'visitor copy', 'content/source/home.md': 'raw source text' } } };
  const summary = context.packetContentQualitySummary(packet);
  assert.equal(summary.totalFiles, 1);
  assert.equal(summary.totalWords, 2);
});
