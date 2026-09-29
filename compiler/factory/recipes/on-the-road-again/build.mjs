#!/usr/bin/env node
// Real end-to-end V8 build recipe for the anchor project.
// Correction #9: no fabricated golden proof. This script produces a
// build-complete.v1 document whose status reflects real evidence.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { runBuild } from '../../lib/build-runtime.mjs';
import { remasterLogo } from '../../lib/asset-remaster/logo-pipeline.mjs';
import { remasterPhotos } from '../../lib/asset-remaster/photo-pipeline.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const truthPath = args.truth || path.join(REPO, 'factory/recipes/on-the-road-again/truth-packet.json');
  const outPath = args.out || '/tmp/otra-build.json';

  const truth = JSON.parse(readFileSync(truthPath, 'utf8'));

  // Real assets pass — will land at performed:false since the audit could
  // not surface photo/logo URLs. That is the correct honest result.
  const logo = await remasterLogo({
    rawUrl: truth.logos?.[0]?.url || null,
    rawDims: null,
    source: truth.logos?.[0]?.source || null,
    businessName: truth.business_name,
    hint: null,
  }, { plan: 'free-preview', brandVerified: false });

  const photos = await remasterPhotos(truth.photos || [], {
    plan: 'free-preview',
    hero_media_type_hint: 'cinematic-still',
    labeled_ai_atmosphere_urls: [],
  });

  const req = {
    schema_version: 'siteforge-build-request-v1',
    idempotency_key: crypto.randomUUID(),
    prospect_id: truth.prospect_id,
    truth_packet: {
      business_name: truth.business_name,
      city: truth.city || 'Unknown',
      state: truth.state || 'Unknown',
      vertical: truth.vertical,
      services: (truth.services || []).map((s) => s.name),
      hours: truth.hours || [],
      service_area_cities: truth.service_area_cities || [],
      license_credentials: truth.license_credentials || [],
      phone_e164: truth.phone_e164,
      email: truth.email,
      website_url: truth.website_url,
      google_place_id: truth.google_place_id,
    },
    assets: { logo, photos },
    plan_tier: 'free-preview',
  };

  // Provider that reports back an honest build result — visual_qc_passed:false
  // when evidence is missing (photos_verified_count === 0 or logo not verified),
  // qc_passed:false when any evidence gap remains.
  const providers = {
    runPremier: async (ctx) => {
      const gaps = (truth.evidence_gaps || []).length;
      const evidencedPhotos = photos.photos_verified_count > 0;
      const evidencedLogo = logo.verified === true;
      const qc_passed = gaps === 0 && evidencedPhotos && evidencedLogo;
      return {
        build_id: `build_${Date.now()}`,
        prospect_id: ctx.prospect_id,
        preview_url: `https://siteforge.example.com/preview/${ctx.build_id}`,
        preview_url_owner_only: true,
        report_url: `https://siteforge.example.com/report/${ctx.build_id}`,
        report_token: crypto.randomUUID(),
        qc_passed,
        visual_qc_passed: evidencedPhotos && evidencedLogo,
        qc_summary: {
          overall: qc_passed ? 'pass' : 'fail',
          evidence_gaps: truth.evidence_gaps || [],
          photos_verified_count: photos.photos_verified_count,
          logo_verified: evidencedLogo,
          notes: qc_passed
            ? 'ready-for-owner-review'
            : 'blocked: owner-input required for phone/address/hours/reviews/logos/photos before public render',
        },
        logo_provenance: {
          verified: logo.verified,
          source: logo.source,
          stages: logo.stages,
          final_url: logo.final_url,
          final_format: logo.final_format,
          delta_e_to_brand: logo.delta_e_to_brand,
        },
        media_provenance: {
          photos_verified_count: photos.photos_verified_count,
          photos_ai_atmosphere_count: photos.photos_ai_atmosphere_count,
          photos_dropped_low_quality: photos.photos_dropped_low_quality,
          photos_overflow_beyond_cap: photos.photos_overflow_beyond_cap,
          gallery_cap: photos.gallery_cap,
          hero_media_type: photos.hero_media_type,
          hero_media_source: photos.hero_media_source,
          gallery_photo_urls: photos.gallery_photo_urls,
          per_photo: photos.per_photo,
        },
        optimization_manifest: {
          contract: 'siteforge-qc-v2-authority-108-plus-contamination',
          checks: Array.from({ length: 108 }, (_, i) => ({
            id: `authority-${(i + 1).toString().padStart(3, '0')}`,
            status: 'owner-input',
            evidence: null,
          })),
          summary_pass: 0,
          summary_owner_input: 108,
          summary_fail: 0,
        },
        outputs: {
          preview_url: `https://siteforge.example.com/preview/${ctx.build_id}`,
          zip_url: null,
        },
        checkout: {
          plan_tier: 'free-preview',
          checkout_url: null,
        },
      };
    },
  };

  let payload;
  try {
    payload = await runBuild(req, { providers, minHamming: 5, maxRetries: 3 });
  } catch (e) {
    payload = {
      schema_version: 'siteforge-build-complete-v1',
      status: 'failed',
      error: { code: e.code || 'BUILD_ERROR', message: e.message, retriable: e.retriable ?? true },
    };
  }
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`status: ${payload.status}`);
  console.log(`qc_passed: ${payload.qc_passed}`);
  console.log(`generation_fingerprint: ${payload.generation_fingerprint}`);
}

main().catch((e) => { console.error(e); process.exit(2); });
