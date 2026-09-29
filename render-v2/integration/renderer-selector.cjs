'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildSpaV2 } = require('../build/build-site.cjs');
const { resolveCategory, catalog, donorsFor, smokeEnabled } = require('../categories/donor-catalog-registry.cjs');
const { toClientSiteData } = require('../adapters/genie-to-client.cjs');
const SPA = Object.freeze({ landscaping: 'landscaping' });
function categoryOf(prospect = {}) {
  const record = prospect && prospect.record && typeof prospect.record === 'object' ? prospect.record : prospect;
  const certified = record?.genie_canonical_packet?.facts?.category;
  return String(certified || prospect.industry || prospect.vertical || prospect.category ||
    record?.industry || record?.vertical || '').trim().toLowerCase();
}
function seedOf(prospect = {}) {
  return String(prospect.prospect_id || prospect.id || prospect.domain ||
    prospect.website || prospect.record?.prospect_id || prospect.record?.domain || '');
}
function manifestFor(key) {
  const file = path.join(__dirname, '..', 'donors', 'catalog', key, 'donor.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function compatibleDonor(category, prospect) {
  const keys = [...donorsFor(category, { smoke: smokeEnabled() })];
  if (!keys.length) return null;
  const digest = crypto.createHash('sha256').update(seedOf(prospect) || category).digest();
  const start = digest.readUInt32BE(0) % keys.length;
  for (let offset = 0; offset < keys.length; offset++) {
    const key = keys[(start + offset) % keys.length];
    try {
      const manifest = manifestFor(key);
      const client = toClientSiteData(prospect, manifest, { heroVideo: false });
      // A compatible mapping still cannot pass the native content proof if it
      // declares no target for certified services. Skip that donor up front.
      if (client.services.length && (!Array.isArray(manifest.content_render_targets?.services)
        || !manifest.content_render_targets.services.length
        || String(manifest.content_channel_availability?.services || '').startsWith('unavailable'))) continue;
      return key;
    } catch {}
  }
  return null;
}
function rendererFor(prospect = {}) {
  const raw = categoryOf(prospect);
  const category = resolveCategory(raw) || raw;
  // Keep the original as fallback. Use an adapted donor only when its full
  // client mapping accepts this certified prospect in the current lane.
  if (category === 'landscaping') {
    const donorKey = prospect?.record?.genie_canonical_packet || prospect?.genie_canonical_packet
      ? compatibleDonor(category, prospect) : null;
    return donorKey ? { renderer: 'spa-v2', category, donorKey } : { renderer: 'spa-v2', category };
  }
  const candidates = donorsFor(category, { smoke: smokeEnabled() });
  if (!candidates.length) return { renderer: 'legacy-html', category };
  const donorKey = compatibleDonor(category, prospect);
  return donorKey
    ? { renderer: 'spa-v2', category, donorKey }
    : { renderer: 'spa-v2', category, donorKey: null, refusal: 'spa_v2_no_compatible_donor' };
}
function buildIfSpaV2(args = {}) {
  const record = args.record || args.prospect || {};
  const route = rendererFor(record);
  if (route.renderer !== 'spa-v2') return null;
  if (route.category !== 'landscaping' && !route.donorKey) {
    const error = new Error(route.refusal || 'spa_v2_no_compatible_donor');
    error.code = error.message;
    throw error;
  }
  const { smokeEnabled } = require('../categories/donor-catalog-registry.cjs');
  return buildSpaV2({ ...args, record, category: route.category,
    donorKey: route.donorKey || '', smokeMode: smokeEnabled() });
}
module.exports = Object.freeze({ SPA, catalog, categoryOf, seedOf, rendererFor, buildIfSpaV2 });
