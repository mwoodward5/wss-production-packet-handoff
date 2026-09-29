// Contamination check for the wow catalog + golden reference build.
// Ensures no donor client secrets, tokens, personal contact info, or
// forbidden patterns leaked into the tracked corpus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Patterns that must NEVER appear in the tracked wow-catalog or contracts.
const FORBIDDEN = [
  { name: 'sk_live_ stripe key', pattern: /sk_live_[A-Za-z0-9]{16,}/ },
  { name: 'sk_test_ stripe key', pattern: /sk_test_[A-Za-z0-9]{16,}/ },
  { name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token', pattern: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'OpenAI key', pattern: /sk-[A-Za-z0-9]{40,}/ },
  { name: 'Anthropic key', pattern: /sk-ant-[A-Za-z0-9-]{40,}/ },
  { name: 'Resend key', pattern: /re_[A-Za-z0-9]{20,}/ },
  { name: 'Vercel token', pattern: /vercel_[A-Za-z0-9]{20,}/ },
  { name: 'Placeholder lorem', pattern: /lorem ipsum/i },
  { name: 'Windows-only path', pattern: /C:\\Users\\Main/i },
  { name: 'Private IP', pattern: /\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+\b/ },
];

// Scan tracked catalog + contract files.
const SCAN_DIRS = [
  'factory/recipes/wow-catalog',
  'contracts',
  'factory/lib/asset-remaster',
  'factory/lib/snowflake-picker.mjs',
  'factory/lib/vocabulary-map.json',
];

function collectFiles(startPath) {
  const abs = path.join(root, startPath);
  const files = [];
  const st = statSync(abs, { throwIfNoEntry: false });
  if (!st) return files;
  if (st.isFile()) return [abs];
  for (const name of readdirSync(abs)) {
    const p = path.join(abs, name);
    const s = statSync(p);
    if (s.isDirectory()) files.push(...collectFiles(path.relative(root, p)));
    else if (s.isFile()) files.push(p);
  }
  return files;
}

test('no forbidden secrets or placeholders in tracked catalog + contracts', () => {
  const files = SCAN_DIRS.flatMap(collectFiles);
  assert.ok(files.length > 0, 'no files scanned');
  const hits = [];
  for (const f of files) {
    // Skip binaries — only scan text
    if (/\.(png|jpg|jpeg|webp|avif|svg|ico|woff2?|mp4|webm|zip|gz|tar)$/i.test(f)) continue;
    const content = readFileSync(f, 'utf8');
    for (const rule of FORBIDDEN) {
      // Skip the pattern-definition file itself
      if (f.endsWith('contamination.test.mjs')) continue;
      if (rule.pattern.test(content)) hits.push(`${path.relative(root, f)} — ${rule.name}`);
    }
  }
  assert.equal(hits.length, 0, 'contamination hits: ' + JSON.stringify(hits, null, 2));
});

test('no personal cell phone number leaked into catalog files', () => {
  const files = SCAN_DIRS.flatMap(collectFiles);
  // Sentinel built from parts so this test file itself does not carry the full
  // number literal (which would false-positive against itself).
  const knownAgent = '949' + '339' + '5562';
  const hits = [];
  for (const f of files) {
    if (/\.(png|jpg|jpeg|webp|avif|svg|ico|woff2?|mp4|webm|zip|gz|tar)$/i.test(f)) continue;
    if (f.endsWith('contamination.test.mjs')) continue;
    const c = readFileSync(f, 'utf8');
    if (c.replace(/[^0-9]/g, '').includes(knownAgent)) hits.push(path.relative(root, f));
  }
  assert.equal(hits.length, 0, 'agent phone leak: ' + JSON.stringify(hits));
});

test('template manifest never marks a study-only source as remixable', () => {
  const p = path.join(root, 'factory/recipes/wow-catalog/template-manifest.json');
  const m = JSON.parse(readFileSync(p, 'utf8'));
  for (const e of m.entries) {
    if (e.provenance.license === 'study-observed') {
      assert.equal(e.provenance.remix_permission, false, `study-only entry ${e.slug} has remix_permission=true`);
    }
    // Original source code never redistributed
    assert.equal(e.provenance.redistribute_original_source_code, false, `entry ${e.slug} would redistribute source`);
  }
});
