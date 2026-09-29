'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { readTree, writeTree, treeHash } = require('./file-tree.cjs');
const { validate } = require('../contracts/donor-manifest.cjs');
const { assertClean } = require('../gates/donor-leak.cjs');

const ROOT = path.resolve(__dirname, '..');
const TOOLCHAIN = 'C:/wss-donor-port/evergreen-brilliance/node_modules';

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fileHashes(files) {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([rel, bytes]) => [rel, hash(bytes)])
  );
}

function assertInjectionSeams(files) {
  const index = files['index.html']?.toString('utf8') || '';
  if (!index.includes('<!--WSS_DATA_ISLAND-->') || !index.includes('<!--WSS_TRUST_INJECT-->')) {
    throw new Error('spa_injection_seam_missing');
  }
}
function residueScan(files, forbidden = []) {
  const hits = [];
  for (const [rel, bytes] of Object.entries(files)) {
    if (!/\.(?:html|js|css|json|txt|svg)$/i.test(rel)) continue;
    const text = bytes.toString('utf8').toLowerCase();
    for (const token of forbidden) {
      const needle = String(token || '').trim();
      if (needle.length >= 3 && text.includes(needle.toLowerCase())) hits.push({ rel, token: needle });
    }
  }
  return hits;
}

function ensureJunction(source) {
  const nodeModules = path.join(source, 'node_modules');
  if (fs.existsSync(nodeModules)) return { nodeModules, created: false };
  if (!fs.existsSync(TOOLCHAIN)) throw new Error('spa_toolchain_missing');
  fs.symlinkSync(TOOLCHAIN, nodeModules, 'junction');
  return { nodeModules, created: true };
}

function writeBundle(donorDir, manifest, files) {
  assertInjectionSeams(files);
  assertClean(files, manifest.leak_terms);
  const bundle = path.join(donorDir, 'bundle');
  fs.rmSync(bundle, { recursive: true, force: true });
  writeTree(bundle, files);
  manifest.bundle = { tree_sha256: treeHash(files), files: fileHashes(files) };
  validate(structuredClone(manifest), { category: manifest.category });
  fs.writeFileSync(path.join(donorDir, 'donor.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { bundle, manifest };
}
function compileCatalog(donorKey) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(donorKey)) throw new Error('spa_donor_key_invalid');
  const donorDir = path.join(ROOT, 'donors', 'catalog', donorKey);
  const source = path.join(donorDir, 'source');
  const packageFile = path.join(source, 'package.json');
  if (!fs.existsSync(packageFile) || !fs.existsSync(path.join(source, 'src'))) {
    throw new Error('spa_catalog_original_source_missing:' + donorKey);
  }
  const proofFile = path.join(donorDir, 'source-provenance.json');
  if (!fs.existsSync(proofFile)) throw new Error('spa_catalog_source_proof_missing');
  const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(donorDir, 'donor.json'), 'utf8'));
  if (proof.status !== 'SOURCE_CAPTURED' || proof.project_id !== manifest.source?.project_id ||
      proof.actual_commit !== manifest.source?.ref || !/^[a-f0-9]{40}$/i.test(proof.git_tree || '')) {
    throw new Error('spa_catalog_source_proof_mismatch');
  }
  if (!fs.existsSync(path.join(donorDir, 'mapping.cjs'))) throw new Error('spa_catalog_adapter_missing');
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  if (pkg.scripts?.build !== 'vite build') throw new Error('spa_catalog_build_script_requires_review');
  const npmCli = 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js';
  const run = cp.spawnSync(process.execPath, [npmCli, 'run', 'build', '--ignore-scripts'],
    { cwd: source, encoding: 'utf8', timeout: 180000, env: process.env });
  fs.writeFileSync(path.join(donorDir, 'compile.log'), (run.stdout || '') + (run.stderr || ''));
  if (run.status !== 0) throw new Error('spa_catalog_vite_build_failed');
  const files = readTree(path.join(source, 'dist'));
  const previous = manifest.bundle?.tree_sha256 || '';
  const { bundle } = writeBundle(donorDir, manifest, files);
  return { donorKey, category: manifest.category, bundle,
    previous_tree_sha256: previous, tree_sha256: manifest.bundle.tree_sha256,
    reproducible: previous === manifest.bundle.tree_sha256, files: Object.keys(files).length,
    compilation_only: true, runtime_approval_granted: false };
}

function compileLandscaping() {
  const category = 'landscaping';
  const donorDir = path.join(ROOT, 'donors', category);
  const source = path.join(donorDir, 'source');
  const dist = path.join(source, 'dist');
  const manifestPath = path.join(donorDir, 'donor.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  validate(structuredClone(manifest), { category });

  const junction = ensureJunction(source);
  try {
    fs.rmSync(dist, { recursive: true, force: true });
    const npmCli = 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js';
    const run = cp.spawnSync(process.execPath, [npmCli, 'run', 'build'], {
      cwd: source, encoding: 'utf8', env: process.env,
    });
    fs.writeFileSync(
      path.join(donorDir, 'compile.log'),
      (run.stdout || '') + (run.stderr || '') + (run.error ? '\n' + String(run.error) : '')
    );
    if (run.status !== 0) {
      const error = new Error('spa_vite_build_failed');
      error.detail = { status: run.status, signal: run.signal, error: run.error ? String(run.error) : '' };
      throw error;
    }
  } finally {
    if (junction.created) fs.rmSync(junction.nodeModules, { recursive: true, force: true });
  }
  const files = readTree(dist);
  const legacyForbidden = [
    'Greenfront Lawn & Landscape',
    'Birmingham, AL',
    'Meadowbrook',
    '205-603-4987',
    'greenfrontbham@gmail.com',
    'clienthub.getjobber.com',
    'Burns Landscaping',
    'burnslandscapinghouston.com',
  ];
  const residues = residueScan(files, legacyForbidden);
  if (residues.length) {
    const error = new Error('spa_bundle_donor_or_client_residue');
    error.detail = residues;
    throw error;
  }
  const previous = manifest.bundle?.tree_sha256 || '';
  const { bundle } = writeBundle(donorDir, manifest, files);
  return {
    category,
    bundle,
    previous_tree_sha256: previous,
    tree_sha256: manifest.bundle.tree_sha256,
    reproducible: !previous || previous === manifest.bundle.tree_sha256,
    files: Object.keys(files).length,
    fileHashes: manifest.bundle.files,
  };
}

function compile(target = 'landscaping') {
  const catalogDir = path.join(ROOT, 'donors', 'catalog', target);
  if (fs.existsSync(path.join(catalogDir, 'donor.json'))) return compileCatalog(target);
  if (target === 'landscaping') return compileLandscaping();
  throw new Error('spa_category_source_missing:' + target);
}
if (require.main === module) {
  const result = compile(process.argv[2] || 'landscaping');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = Object.freeze({
  compile,
  compileCatalog,
  compileLandscaping,
  residueScan,
  assertInjectionSeams,
});
