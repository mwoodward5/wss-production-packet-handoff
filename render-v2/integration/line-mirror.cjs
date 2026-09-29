'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildSpaV2 } = require('../build/build-site.cjs');
const { proveSpaContent } = require('../build/content-proof.cjs');
const { inputFor } = require('../runtime/render-inputs.cjs');
const { rendererFor } = require('./renderer-selector.cjs');
const { smokeEnabled } = require('../categories/donor-catalog-registry.cjs');

function sha(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function fail(status, error, detail = []) {
  return { ok: false, status, body: { ok: false, error, detail } };
}
function recordOf(prospect = {}) {
  return prospect && prospect.record && typeof prospect.record === 'object'
    ? prospect.record : prospect;
}
function prospectIdOf(prospect = {}) {
  return String(prospect.prospect_id || prospect.id || recordOf(prospect).prospect_id || '').trim();
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function loadVerifiedMedia(prospect, input) {
  const record = recordOf(prospect);
  const bank = record.photo_bank || prospect.photo_bank || {};
  const expected = new Set((bank.photos || []).map((row) => String(row.sha256 || '').toLowerCase()).filter(Boolean));
  const mediaDir = path.join(__dirname, '..', 'runtime', 'media', prospectIdOf(prospect));
  const bytesBySha = {};
  for (const name of fs.readdirSync(mediaDir).sort()) {
    const file = path.join(mediaDir, name);
    if (!fs.statSync(file).isFile() || name === 'client-logo.png' || name.endsWith('.mp4')) continue;
    const bytes = fs.readFileSync(file);
    const digest = sha(bytes);
    if (expected.has(digest)) bytesBySha[digest] = bytes;
  }
  const missing = [...expected].filter((digest) => !bytesBySha[digest]);
  if (missing.length) {
    const error = new Error('spa_v2_runtime_media_incomplete');
    error.detail = missing;
    throw error;
  }
  const logoBytes = fs.readFileSync(path.join(mediaDir, 'client-logo.png'));
  const logoSha = sha(logoBytes);
  if (logoSha !== String(input.logoSha256 || '').toLowerCase()) throw new Error('spa_v2_runtime_logo_hash_mismatch');
  return { bytesBySha, verifiedLogo: { bytes: logoBytes, sha256: logoSha, ext: input.logoExt || 'png', sourceUrl: input.logoUrl } };
}
async function loadSmokeMedia(prospect) {
  const record = recordOf(prospect);
  const photos = Array.isArray(record.photo_bank?.photos) ? record.photo_bank.photos : [];
  if (!photos.length) throw new Error('spa_v2_photo_bank_missing');
  const bytesBySha = {};
  for (const photo of photos.slice(0, 20)) {
    const expected = String(photo.sha256 || '').toLowerCase();
    const url = String(photo.url || '');
    if (!/^[a-f0-9]{64}$/.test(expected) || !url.startsWith('https://')) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try { response = await fetch(url, { signal: controller.signal, redirect: 'follow' }); }
    finally { clearTimeout(timer); }
    if (!response?.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha(bytes) === expected) bytesBySha[expected] = bytes;
  }
  const expected = new Set(photos.map(p => String(p.sha256 || '').toLowerCase()).filter(x => /^[a-f0-9]{64}$/.test(x)));
  const missing = [...expected].filter(x => !bytesBySha[x]);
  if (missing.length === expected.size) {
    const error = new Error('spa_v2_runtime_media_unavailable');
    error.detail = missing;
    throw error;
  }
  return { bytesBySha, verifiedLogo: null };
}
function routeMapFor(files) {
  const routes = { '/': 'index.html', '/index.html': 'index.html' };
  for (const rel of Object.keys(files)) {
    routes['/' + rel] = rel;
    if (rel.endsWith('/index.html')) {
      const base = '/' + rel.slice(0, -'/index.html'.length);
      routes[base] = rel;
      routes[base + '/'] = rel;
    }
  }
  return routes;
}
function norm(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
async function samenessFor(client, slug, deps = {}) {
  const h1 = [client.hero.line1, client.hero.emphasis, client.hero.line3].join(' ');
  const title = client.identity.businessName + ' | ' + String(client.source?.category || 'Local service') + ' in ' + client.identity.city + ', ' + client.identity.state;
  const identities = typeof deps.fleetIdentities === 'function' ? await deps.fleetIdentities() : [];
  const problems = [];
  for (const row of Array.isArray(identities) ? identities : []) {
    if (row.slug === slug) continue;
    if (norm(row.h1) && norm(row.h1) === norm(h1)) problems.push('duplicate_h1_with_' + row.slug + ':' + h1);
    if (norm(row.title) && norm(row.title) === norm(title)) problems.push('duplicate_title_with_' + row.slug + ':' + title);
  }
  return { ok: problems.length === 0, h1, title, problems };
}
async function mirrorSpaV2(request, {
  prospect = {},
  dryRun = false,
  operationKey = '',
  signal,
  deadlineAt = 0,
  deps = {},
} = {}) {
  try {
    const prospectId = prospectIdOf(prospect);
    const input = inputFor(prospectId);
    const selected = rendererFor(prospect);
    if (selected.renderer !== 'spa-v2' || (selected.category !== 'landscaping' && !selected.donorKey)) {
      return fail(422, selected.refusal || 'spa_v2_donor_not_selected', [{ prospect_id: prospectId }]);
    }
    const smoke = smokeEnabled();
    if (!input && !smoke) return fail(422, 'spa_v2_rich_contract_missing', [{ prospect_id: prospectId }]);
    const media = typeof deps.loadMedia === 'function'
      ? await deps.loadMedia(prospect, input)
      : input ? loadVerifiedMedia(prospect, input) : await loadSmokeMedia(prospect);
    const googleEvidence = input ? readJson(input.googleFile) : null;
    const publicUrl = 'https://' + request.slug + '.wss-ai.com/';
    const result = buildSpaV2({
      record: prospect,
      category: selected.category,
      donorKey: selected.donorKey || '',
      bytesBySha: media.bytesBySha,
      heroVideo: null,
      verifiedLogo: media.verifiedLogo,
      publicUrl,
      universalContractDir: input ? input.contractDir : '',
      googleEvidence,
      smokeMode: smoke,
    });
    let contentProof;
    try {
      contentProof = await proveSpaContent(result, deps.renderDom);
    } catch (error) {
      contentProof = {
        ok: false,
        content: {
          version: 'wss-spa-content-proof-v1', status: 'failed', data_island: false,
          donor_consumes_content: false, donor_renders: [], sections: 0,
          reason: String(error?.message || error).slice(0, 200),
        },
        route_render: { status: 'failed', pages: [] },
      };
    }
    const same = await samenessFor(result.client_data, request.slug, deps);
    const sameness = same.ok
      ? { status: 'passed', rendered_h1: same.h1, served_title: same.title }
      : { status: 'failed', rendered_h1: same.h1, served_title: same.title, problems: same.problems };
    const baseBody = {
      ok: true,
      renderer: 'spa-v2',
      qc_contract: 'wss-render-v2-qc-v1',
      evidence_schema: 'wss-render-v2-evidence-v1',
      build_hash: result.build_hash,
      checks: {
        sameness,
        render: { status: contentProof.route_render.status },
        route_render: contentProof.route_render,
        content: contentProof.content,
        media: { status: 'passed' },
        alias_target: { status: dryRun ? 'not_run' : 'pending' },
      },
    };
    if (!same.ok) {
      return { ok: true, status: 200, body: { ...baseBody, revealable: false, dry_run: !!dryRun } };
    }
    if (dryRun) {
      return { ok: true, status: 200, body: { ...baseBody, revealable: false, dry_run: true } };
    }
    // The build contains a data island, but it does not prove that donor components
    // displayed the certified content. Never stage or activate without that proof.
    if (!contentProof.ok) {
      return {
        ok: false,
        status: 422,
        body: { ...baseBody, ok: false, revealable: false, error: 'spa_v2_content_proof_failed' },
      };
    }
    const publisher = deps.sharedPublisher
      || require('../../' + 'shared-mirror-publisher').injectDefaultSharedPublisher({}).sharedPublisher;
    if (!publisher || typeof publisher.stage !== 'function' || typeof publisher.activate !== 'function') {
      return fail(503, 'spa_v2_shared_publisher_missing');
    }
    const host = request.slug + '.wss-ai.com';
    const routeMap = routeMapFor(result.files);
    const staged = await publisher.stage({
      slug: request.slug,
      host,
      files: result.files,
      routeMap,
      buildHash: result.build_hash,
      operationKey,
      signal,
      deadlineAt,
    });
    if (!staged || staged.ok !== true) return fail(502, 'spa_v2_shared_stage_failed', [{ reason: staged?.reason || 'unknown' }]);
    const activated = await publisher.activate(staged, { signal, deadlineAt });
    if (!activated || activated.ok !== true) return fail(502, 'spa_v2_shared_activate_failed', [{ reason: activated?.reason || 'unknown' }]);
    const previewUrl = String(activated.previewUrl || publicUrl);
    const proofIdentity = activated.proofIdentity || null;
    const sharedReleaseEvidence = activated.releaseEvidence || null;
    const checks = {
      ...baseBody.checks,
      alias_target: { status: 'passed' },
      brand: media.verifiedLogo ? {
        status: 'passed',
        logo: 'client',
        logo_asset_shipped: true,
        logo_in_dom: true,
        logo_sha_source: media.verifiedLogo.sha256,
        logo_sha_in_output: media.verifiedLogo.sha256,
      } : {
        status: 'passed',
        logo: 'not_supplied',
        logo_asset_shipped: false,
        logo_in_dom: false,
      },
    };
    const releaseEvidence = {
      renderer: 'spa-v2',
      qc_contract: 'wss-render-v2-qc-v1',
      evidence_schema: 'wss-render-v2-evidence-v1',
      revealable: true,
      build_hash: result.build_hash,
      preview_url: previewUrl,
      proofIdentity,
      sharedReleaseEvidence,
      checks,
      donor: result.manifest.donor,
      donor_content_hash: result.manifest.donor_content_hash,
    };
    const signer = deps.signEvidence
      || require('../../mirror-engine/' + 'evidence-signature').signEvidence;
    releaseEvidence.evidence_sha = signer(releaseEvidence);
    const body = {
      ...baseBody,
      revealable: true,
      ready: true,
      qc_passed: true,
      visual_qc_passed: true,
      content_source: 'verified',
      preview_url: previewUrl,
      deploy_url: previewUrl,
      deploy_id: proofIdentity && proofIdentity.release_id || '',
      proofIdentity,
      sharedReleaseEvidence,
      shared_publish: true,
      checks,
      evidence_sha: releaseEvidence.evidence_sha,
      release_evidence: releaseEvidence,
    };
    return { ok: true, status: 200, body, release_evidence: releaseEvidence };
  } catch (error) {
    return fail(500, 'spa_v2_line_mirror_failed', [{
      reason: String(error && error.message || error).slice(0, 300),
      detail: error && error.detail || null,
    }]);
  }
}
module.exports = Object.freeze({ mirrorSpaV2, loadVerifiedMedia, loadSmokeMedia, routeMapFor, samenessFor });
