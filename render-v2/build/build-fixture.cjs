'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildSpaV2 } = require('./build-site.cjs');
const { writeTree } = require('./file-tree.cjs');

const ROOT = path.resolve(__dirname, '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function sha(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function buildFixture(recordPathArg) {
  const recordPath = path.resolve(ROOT, recordPathArg || 'fixtures/burns-record.json');
  const record = readJson(recordPath);
  const mediaDir = path.join(ROOT, 'fixtures', 'burns-media');
  const bytesBySha = {};
  for (const file of fs.readdirSync(mediaDir).sort()) {
    if (!/^photo-\d+\./.test(file)) continue;
    const bytes = fs.readFileSync(path.join(mediaDir, file));
    bytesBySha[sha(bytes)] = bytes;
  }
  const logoBytes = fs.readFileSync(path.join(mediaDir, 'client-logo.png'));
  const verifiedLogo = {
    bytes: logoBytes,
    sha256: sha(logoBytes),
    ext: 'png',
    sourceUrl: 'https://burnslandscapinghouston.com/airo-assets/images/logo/horizontal',
  };

  const result = buildSpaV2({
    record,
    category: 'landscaping',
    bytesBySha,
    heroVideo: null,
    verifiedLogo,
    universalContractDir: path.join(ROOT, 'evidence', 'burns-universal-contract'),
    googleEvidence: readJson(path.join(ROOT, 'evidence', 'burns-google-place-refreshed.json')),
    publicUrl: 'https://wss-test-burns-landscaping-houston.wss-ai.com/',
    releaseContext: { site_id: 'fixture-burns', release_id: 'fixture-burns-release' },
  });

  const outputDir = path.join(ROOT, 'evidence', 'burns-build');
  fs.rmSync(outputDir, { recursive: true, force: true });
  writeTree(outputDir, result.files);
  fs.writeFileSync(path.join(ROOT, 'evidence', 'burns-build-result.json'), JSON.stringify({
    build_hash: result.build_hash,
    manifest: result.manifest,
    release_evidence: result.release_evidence,
    media_evidence: result.media_evidence,
    trust_plan: result.trust_plan,
    client_data: result.client_data,
    schema_graph: result.schema_graph,
    site_plan: result.site_plan,
    site_plan: result.site_plan,
  }, null, 2));

  return {
    build_hash: result.build_hash,
    file_count: Object.keys(result.files).length,
    route_count: result.manifest.routes.length,
    media_count: result.media_evidence.filter(x => x.originalBytes).length,
    trust_modules: result.trust_plan.ids,
    output: outputDir,
  };
}

if (require.main === module) {
  const result = buildFixture(process.argv[2]);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = Object.freeze({ buildFixture });
