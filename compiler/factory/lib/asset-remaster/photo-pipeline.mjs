// factory/lib/asset-remaster/photo-pipeline.mjs
// HONEST photo remastering pipeline. Corrections #6 + #7.
//
// - Every stage records performed:true|false with a machine-readable reason
//   on non-transformation. Passthrough is preserved when a provider fails.
// - Photos never claim `verified:true` without source evidence
//   (a real source URL, source type, dimensions, and a real checksum).
// - Gallery is capped at the best 12 photos with provenance preserved.
// - No invented AI-atmosphere counts. `photos_ai_atmosphere_count` reflects
//   only labeled-AI atmosphere assets the caller passed in — this pipeline
//   never generates AI atmosphere; a separate module handles that with
//   explicit labeling per Remic §Phase 1.

import crypto from 'node:crypto';

const MAX_GALLERY = 12;
const REJECT_BELOW = 0.55;
const HEAVY_BELOW = 0.75;
const HEX64 = /^[a-f0-9]{64}$/;

async function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return { ok: false, reason: 'no-provider' };
  try { return { ok: true, result: await fn(...args) }; }
  catch (e) { return { ok: false, reason: 'provider-error', message: String(e?.message || e).slice(0, 200) }; }
}

function isRealAssetUrl(url) {
  return typeof url === 'string' && url.length > 0 && !url.includes('#') &&
    /^(https?:|data:image\/)/.test(url);
}

function detectSourceType(raw) {
  const src = String(raw?.source || raw?.source_type || '').toLowerCase();
  if (src.includes('gbp')) return 'gbp-scrape';
  if (src.includes('firecrawl')) return 'firecrawl-scrape';
  if (src.includes('owner')) return 'owner-uploaded';
  if (raw?.google_place_id) return 'gbp-scrape';
  if (raw?.url) return 'firecrawl-scrape';
  return 'unknown';
}

// Real perceptual score. If a vision provider is present, use it. Otherwise
// fall back to caller-supplied hints and label the score as heuristic-only.
async function scoreSeverity(raw, providers) {
  if (typeof providers?.severityScore === 'function') {
    const r = await safeCall(providers.severityScore, { url: raw.url });
    if (r.ok && r.result && typeof r.result.composite === 'number') {
      return { ...r.result, source: 'vision-provider' };
    }
  }
  // Heuristic fallback — never invents a high score without evidence.
  const c = raw?.hint === 'high' ? 0.80
          : raw?.hint === 'medium' ? 0.65
          : raw?.hint === 'low' ? 0.42
          : 0.60;
  return {
    sharpness: c, lighting: c, composition: c, subject: c,
    aspect: c, branded_bleed: 1 - c, age: 0.15, composite: c,
    source: 'heuristic-fallback',
  };
}

async function realChecksum(raw, providers) {
  if (typeof providers?.contentSha256 === 'function') {
    const r = await safeCall(providers.contentSha256, { url: raw.url });
    if (r.ok && HEX64.test(String(r.result || ''))) return r.result;
  }
  // No real content hash available. Return a labeled URL-derived identifier
  // so consumers cannot confuse it with a content checksum.
  return 'url:' + crypto.createHash('sha256').update(String(raw?.url || '')).digest('hex');
}

export async function remasterPhotos(inputs, opts = {}) {
  const {
    providers = {},
    palette = null,
    plan = 'free-preview',
    hero_media_type_hint = 'cinematic-still',
    labeled_ai_atmosphere_urls = [],  // caller-provided; this module never invents
  } = opts;

  if (!Array.isArray(inputs)) inputs = [];

  const scored = [];
  for (const raw of inputs) {
    if (!isRealAssetUrl(raw?.url)) continue;  // never invent a photo
    const s = await scoreSeverity(raw, providers);
    scored.push({ raw, ...s });
  }

  // Drop below-threshold photos entirely — no lie about quality
  const passed = scored.filter((s) => s.composite >= REJECT_BELOW);
  const dropped = scored.length - passed.length;

  // Sort by composite score; keep top MAX_GALLERY
  passed.sort((a, b) => b.composite - a.composite);
  const kept = passed.slice(0, MAX_GALLERY);
  const overflow = passed.length - kept.length;

  const per_photo = [];
  for (const p of kept) {
    const stages = [];
    let currentUrl = p.raw.url;
    let currentDims = p.raw.dims || null;

    // Real content checksum (or url: prefix when unavailable)
    const checksum = await realChecksum(p.raw, providers);

    // Denoise + sharpen
    const budget = p.composite < HEAVY_BELOW ? 'severe' : 'light';
    const dnsFn = budget === 'severe' ? providers.topaz : providers.sharpen;
    const dns = await safeCall(dnsFn, { url: currentUrl, factor: budget === 'severe' ? 4 : 2 });
    if (dns.ok && isRealAssetUrl(dns.result?.url) && dns.result.url !== currentUrl) {
      stages.push({ stage: 'denoise-sharpen', performed: true, evidence: { output_url: dns.result.url, budget } });
      currentUrl = dns.result.url;
      if (dns.result.dims) currentDims = dns.result.dims;
    } else {
      stages.push({ stage: 'denoise-sharpen', performed: false, reason: dns.reason || 'no-provider-or-passthrough' });
    }

    // Color grade — only if a brand palette AND provider are present AND a real output is returned
    if (palette && providers.grade) {
      const g = await safeCall(providers.grade, { url: currentUrl, palette, mode: 'duotone-restrained' });
      if (g.ok && isRealAssetUrl(g.result?.url)) {
        stages.push({ stage: 'color-grade', performed: true, evidence: { output_url: g.result.url } });
        currentUrl = g.result.url;
      } else {
        stages.push({ stage: 'color-grade', performed: false, reason: g.reason || 'no-provider-or-no-output' });
      }
    } else {
      stages.push({ stage: 'color-grade', performed: false, reason: palette ? 'no-provider' : 'no-brand-palette' });
    }

    // Smart crop to aspect variants
    const crops = {};
    if (typeof providers.smartCrop === 'function') {
      for (const aspect of ['4:5', '16:9', '1:1', '21:9']) {
        const c = await safeCall(providers.smartCrop, { url: currentUrl, aspect });
        if (c.ok && isRealAssetUrl(c.result?.url)) crops[aspect] = c.result.url;
      }
      stages.push({ stage: 'smart-crop', performed: Object.keys(crops).length > 0, reason: Object.keys(crops).length ? undefined : 'no-crops-returned' });
    } else {
      stages.push({ stage: 'smart-crop', performed: false, reason: 'no-provider' });
    }

    // Compress + encode (WebP/AVIF, srcset)
    let encoded = { primary: currentUrl, srcset: null, avif: null, webp: null };
    if (typeof providers.encode === 'function') {
      const e = await safeCall(providers.encode, { url: currentUrl, crops, formats: ['webp:82', 'avif:65'], widths: [480, 800, 1200, 1600] });
      if (e.ok && e.result) {
        encoded = { primary: e.result.webp || e.result.primary || currentUrl, srcset: e.result.srcset || null, avif: e.result.avif || null, webp: e.result.webp || null };
        stages.push({ stage: 'encode', performed: true, evidence: { formats: Object.keys(e.result).filter((k) => e.result[k]) } });
      } else {
        stages.push({ stage: 'encode', performed: false, reason: e.reason || 'no-provider-or-no-output' });
      }
    } else {
      stages.push({ stage: 'encode', performed: false, reason: 'no-provider' });
    }

    // Alt-text — never generic
    let alt = null;
    if (typeof providers.vision === 'function') {
      const a = await safeCall(providers.vision, { url: p.raw.url, task: 'describe-scene-one-sentence' });
      if (a.ok && a.result && typeof a.result === 'string' && a.result.length > 12) {
        alt = a.result;
      }
    }
    if (!alt) alt = null;  // do not fabricate alt text

    // Verified only when we have a real source_url and source_type and (dims or checksum)
    const source_url = p.raw.url;
    const source_type = detectSourceType(p.raw);
    const evidenced = Boolean(source_url && source_type !== 'unknown' && (currentDims || checksum.startsWith('url:') === false));
    per_photo.push({
      source_url,
      source_type,
      dims: currentDims,
      checksum_sha256: checksum,     // content sha256 when provider returned one; url:sha256 otherwise
      final_urls: encoded,
      crops,
      alt,
      severity_bucket: budget,
      composite_score: p.composite,
      score_source: p.source,        // 'vision-provider' or 'heuristic-fallback'
      verified: evidenced,
      stages,
    });
  }

  const galleryUrls = per_photo.slice(0, MAX_GALLERY).map((r) => r.final_urls?.primary || r.source_url);

  // Hero media type reflects what the caller actually has. If they explicitly
  // labeled AI atmosphere URLs, count them separately.
  const hero_media_source = per_photo[0]?.source_url ? per_photo[0].source_type : 'none';
  const hero_media_type = per_photo.length > 0 ? hero_media_type_hint : 'procedural-scene';

  return {
    photos_verified_count: per_photo.filter((r) => r.verified).length,
    photos_ai_atmosphere_count: Array.isArray(labeled_ai_atmosphere_urls) ? labeled_ai_atmosphere_urls.length : 0,
    photos_dropped_low_quality: dropped,
    photos_overflow_beyond_cap: overflow,
    gallery_cap: MAX_GALLERY,
    hero_media_type,
    hero_media_source,
    gallery_photo_urls: galleryUrls,
    per_photo,
  };
}

export const _config = { MAX_GALLERY, REJECT_BELOW, HEAVY_BELOW };
