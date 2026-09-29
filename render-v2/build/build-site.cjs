'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readTree, treeHash } = require('./file-tree.cjs');
const { validate: validateDonor } = require('../contracts/donor-manifest.cjs');
const { toClientSiteData } = require('../adapters/genie-to-client.cjs');
const { applyUniversalContract } = require('../adapters/universal-contract.cjs');
const { select: selectTrust } = require('../adapters/trust-adapter.cjs');
const { buildClientMedia } = require('./copy-client-media.cjs');
const { metadata, safeJson, esc } = require('./metadata.cjs');
const { assertClean: assertDonorClean } = require('../gates/donor-leak.cjs');

const ROOT = path.resolve(__dirname, '..');

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function bundleFor(category, donorKey = '', { smoke = false } = {}) {
  const { rowFor } = require('../categories/donor-catalog-registry.cjs');
  const row = donorKey ? rowFor(donorKey, { smoke }) : null;
  if (donorKey && !row) throw new Error('spa_v2_donor_not_adapted:' + donorKey);
  if (!donorKey && category !== 'landscaping') throw new Error('spa_v2_donor_key_required');
  if (row && row.vertical !== category) throw new Error('spa_v2_donor_category_mismatch');
  const donorDir = donorKey
    ? path.join(ROOT, 'donors', 'catalog', donorKey)
    : path.join(ROOT, 'donors', category);
  const manifest = validateDonor(
    JSON.parse(fs.readFileSync(path.join(donorDir, 'donor.json'), 'utf8')),
    { category,
      expectedProjectId: row ? row.project_id : 'bac7c069-3279-4616-a0ee-e4e447042003',
      expectedRef: row ? row.source_commit : 'ecd99943844c7b92edd3898521ea29bcced88457' }
  );
  if (!manifest.bundle) throw new Error('spa_bundle_manifest_missing');
  if (row && manifest.bundle.tree_sha256 !== row.bundle) throw new Error('spa_catalog_bundle_pin_mismatch');
  const bundle = readTree(path.join(donorDir, 'bundle'));
  const actualTree = treeHash(bundle);
  if (actualTree !== manifest.bundle.tree_sha256) throw new Error('spa_bundle_tree_hash_mismatch');
  for (const [rel, expected] of Object.entries(manifest.bundle.files || {})) {
    const bytes = bundle[rel];
    if (!bytes) throw new Error('spa_bundle_file_missing:' + rel);
    if (hash(bytes) !== expected) throw new Error('spa_bundle_file_hash_mismatch:' + rel);
  }
  return { donorDir, manifest, bundle };
}

function renderIndex(templateBytes, client, trustPlan, options = {}) {
  let html = templateBytes.toString('utf8');
  const meta = metadata(client, options);
  const island = '<script id="wss-client-data" type="application/json">' + safeJson(client) + '<\/script>';
  const sitePlanIsland = options.sitePlan ? '<script id="wss-site-plan" type="application/json">' + safeJson(options.sitePlan) + '<\/script>' : '';
  const trustCss = trustPlan.css ? '<style data-wss-trust-kit>' + trustPlan.css + '<\/style>' : '';
  const trustJs = trustPlan.js || '';

  html = html.replace(/__WSS_TITLE__/g, esc(meta.title));
  html = html.replace(/__WSS_DESCRIPTION__/g, esc(meta.description));
  html = html.replace('<!--WSS_HEAD_INJECT-->', meta.head + (trustCss ? '\n' + trustCss : ''));
  html = html.replace('<!--WSS_DATA_ISLAND-->', island + sitePlanIsland);
  html = html.replace('<!--WSS_TRUST_INJECT-->', trustJs);

  if (/__WSS_|WSS_(?:HEAD|DATA|TRUST)_INJECT/.test(html)) throw new Error('spa_template_placeholder_remaining');
  if (!html.includes('id="wss-client-data"')) throw new Error('spa_data_island_missing_after_render');
  return { html: Buffer.from(html, 'utf8'), meta };
}

function serviceRouteFiles(client, indexBytes) {
  const out = {};
  for (const service of client.services) {
    if (!service.href) continue;
    const slug = service.href.replace(/^\/+|\/+$/g, '');
    if (!slug || slug.includes('..')) throw new Error('spa_service_route_invalid:' + service.href);
    out[slug + '/index.html'] = indexBytes;
  }
  return out;
}

function manifestRouteFiles(manifest, indexBytes) {
  const out = {};
  for (const route of manifest.routes || []) {
    const raw = typeof route === 'string' ? route : route?.path;
    const slug = String(raw || '').replace(/^\/+|\/+$/g, '');
    if (!slug || !/^[a-z0-9][a-z0-9/-]*$/i.test(slug)) continue;
    out[slug + '/index.html'] = indexBytes;
  }
  return out;
}

function contentProofContract(manifest) {
  const targets = manifest.content_render_targets || {};
  return Object.freeze({
    version: 'wss-spa-content-proof-v1',
    data_island_id: String(manifest.data_island_id || 'wss-client-data'),
    render_targets: Object.fromEntries(Object.entries(targets).map(([channel, rows]) => [
      channel,
      (Array.isArray(rows) ? rows : []).map((row) => ({
        path: String(row?.path || '/'), selector: String(row?.selector || ''),
      })).filter((row) => row.selector),
    ])),
    channel_availability: { ...(manifest.content_channel_availability || {}) },
  });
}

function buildSpaV2({
  record,
  category = 'landscaping',
  donorKey = '',
  bytesBySha,
  heroVideo = null,
  verifiedLogo = null,
  publicUrl = '',
  releaseContext = {},
  universalContractDir = '',
  googleEvidence = null,
  smokeMode = false,
} = {}) {
  const { manifest: donorManifest, bundle } = bundleFor(category, donorKey, { smoke: smokeMode });
  assertDonorClean(bundle, donorManifest.leak_terms);
  let client = toClientSiteData(record, donorManifest, { heroVideo: !!heroVideo, verifiedLogo: !!verifiedLogo });
  let sitePlan = null;
  if (universalContractDir) { const enriched = applyUniversalContract(client, universalContractDir, { google: googleEvidence, verifiedLogo: !!verifiedLogo, donorManifest }); client = enriched.client; sitePlan = enriched.sitePlan; }
  const trustPlan = selectTrust(client, donorManifest);
  if (client.trustModules.join('|') !== trustPlan.ids.join('|')) throw new Error('spa_trust_plan_nondeterministic');

  const media = buildClientMedia(client, { bytesBySha, heroVideo, verifiedLogo });
  const files = { ...bundle, ...media.files };

  const rendered = renderIndex(bundle['index.html'], client, trustPlan, { publicUrl, sitePlan });
  files['index.html'] = rendered.html;
  Object.assign(files, serviceRouteFiles(client, rendered.html));
  Object.assign(files, manifestRouteFiles(donorManifest, rendered.html));
  if (sitePlan?.pages) for (const page of sitePlan.pages) { const slug=String(page.slug||'').replace(/^\/+|\/+$/g,''); if(slug&&!slug.includes('..')) files[slug+'/index.html']=rendered.html; }

  const buildHash = treeHash(files);
  const fileHashes = Object.fromEntries(Object.entries(files).sort(([a],[b]) => a.localeCompare(b))
    .map(([rel, bytes]) => [rel, hash(bytes)]));

  const manifest = Object.freeze({
    renderer: 'spa-v2',
    renderer_version: 'wss-render-v2@0.1.0',
    donor: donorManifest.name,
    donor_key: donorKey || donorManifest.key || donorManifest.category,
    donor_category: donorManifest.category,
    donor_content_hash: donorManifest.bundle.tree_sha256,
    source_design: donorManifest.source,
    qc_contract: 'wss-render-v2-qc-v1',
    evidence_schema: 'wss-render-v2-evidence-v1',
    build_hash: buildHash,
    client_data_sha256: hash(Buffer.from(safeJson(client), 'utf8')),
    source_packet_sha256: client.source.packetSha256,
    trust_modules: client.trustModules,
    routes: [...new Set(['/', ...(donorManifest.routes||[]).map(x=>typeof x==='string'?x:x?.path).filter(Boolean), ...client.services.filter(x => x.href).map(x => x.href), ...(sitePlan?.pages||[]).map(x=>x.slug?'/'+String(x.slug).replace(/^\/+|\/+$/g,''):'/')])],
    files: fileHashes,
    checks: {
      certified_packet: true,
      deterministic_media_mapping: true,
      immutable_spa_bundle: true,
      fleet_polish_bypassed: donorManifest.flags.fleet_polish === false,
      generic_mobile_polish_bypassed: donorManifest.flags.generic_mobile_polish === false,
      generic_theme_bypassed: donorManifest.flags.generic_theme_reconstruction === false,
      client_media_count: client.media.length,
      trust_module_count: client.trustModules.length,
      fonts: donorManifest.visual.fonts,
      expected_animations: donorManifest.visual.expected_animations,
      breakpoints: donorManifest.breakpoints,
    },
  });

  const releaseEvidence = Object.freeze({
    renderer: 'spa-v2',
    build_hash: buildHash,
    donor: donorManifest.name,
    donor_key: donorKey || donorManifest.key || donorManifest.category,
    donor_content_hash: donorManifest.bundle.tree_sha256,
    source_packet_sha256: client.source.packetSha256,
    release_id: releaseContext.release_id || null,
    site_id: releaseContext.site_id || null,
    prospect_id: client.source.prospectId,
    proof_scope: 'render-v2-build',
  });

  return Object.freeze({
    files,
    build_hash: buildHash,
    manifest,
    release_evidence: releaseEvidence,
    client_data: client,
    media_evidence: media.evidence,
    trust_plan: {
      ids: trustPlan.ids,
      visualCount: trustPlan.visualCount,
      moduleCount: trustPlan.moduleCount,
    },
    schema_graph: rendered.meta.schemaGraph,
    site_plan: sitePlan,
    content_proof_contract: contentProofContract(donorManifest),
  });
}

module.exports = Object.freeze({ buildSpaV2, bundleFor, renderIndex, serviceRouteFiles, manifestRouteFiles, contentProofContract });
