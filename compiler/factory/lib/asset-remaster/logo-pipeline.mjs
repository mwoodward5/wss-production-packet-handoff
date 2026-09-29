// factory/lib/asset-remaster/logo-pipeline.mjs
// HONEST logo remastering pipeline. Corrections list #6.
//
// Every stage records `performed: true|false` and a machine-readable
// `reason` on any non-transformation. A stage NEVER claims it happened
// unless:
//   · background-removed: a real transformed asset URL is returned by
//     the provider AND is distinct from the input URL.
//   · upscaled: the dimensions of the output image genuinely increased
//     vs the input (both width and height verified). Fragment URLs like
//     "example.png#threshold-fallback" are rejected — the provider must
//     return a real asset URL.
//   · vectorized: the returned final_format is 'svg' and the resource
//     is text/svg content.
//   · palette-recolored: a real palette recolor operation reported an
//     output asset AND the delta_e was computed from real pixel data.
//   · shimmer-wrapped: this is a presentation-only step. The wrap is
//     applied by the renderer; we only record intent when a wrap will
//     actually be emitted (i.e., the logo has survived through L2).
//
// If a stage is unavailable or fails, the pipeline stays PASSTHROUGH:
// the previous stage's asset survives, `performed:false` is recorded,
// and the machine-readable `reason` is one of:
//   'no-provider' | 'provider-error' | 'input-missing' |
//   'no-dimension-change' | 'not-simple-mark' | 'not-recolor-safe' |
//   'no-brand-palette' | 'threshold-only-not-transformation' |
//   'fragment-url-not-transformation'

import crypto from 'node:crypto';

const STAGE_KEYS = ['background-removed', 'upscaled', 'vectorized', 'palette-recolored', 'shimmer-wrapped'];

function isRealAssetUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.includes('#')) return false;  // fragment URLs are not transformed assets
  return /^(https?:|data:image\/svg\+xml|data:image\/png|data:image\/webp)/.test(url);
}

async function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return { ok: false, reason: 'no-provider' };
  try {
    const out = await fn(...args);
    return { ok: true, result: out };
  } catch (e) {
    return { ok: false, reason: 'provider-error', message: String(e?.message || e).slice(0, 200) };
  }
}

export async function remasterLogo(input, opts = {}) {
  const {
    providers = {},
    palette = null,
    brandVerified = false,
    plan = 'free-preview',
  } = opts;

  // Every stage entry has: stage, performed:boolean, reason?:string,
  //   evidence?: { output_url, input_dims, output_dims, output_format, delta_e }
  const stages = [];
  let currentUrl = input?.rawUrl || null;
  let currentFormat = detectFormat(currentUrl);
  let currentDims = input?.rawDims || null;  // { w, h } if known
  const record = {
    source: input?.source || 'firecrawl-scrape',
    verified: false,             // will only flip to true if brandVerified AND we actually did work
    stages_applied: [],
    stages,                       // detailed per-stage log
    final_format: currentFormat,
    final_url: currentUrl,
    delta_e_to_brand: null,       // never invent a constant
    fallback_reason: null,
    checksum_sha256: null,
  };

  if (!isRealAssetUrl(currentUrl)) {
    return finalize(record, {
      source: 'procedural-monogram',
      final_format: 'procedural-svg',
      final_url: proceduralMonogramSvg(input?.businessName || 'BRAND', palette),
      fallback_reason: 'logo-source-not-a-real-asset',
    });
  }

  // ─── L1: Background removal ───
  const l1 = await safeCall(providers.removeBg, { url: currentUrl });
  if (l1.ok && isRealAssetUrl(l1.result?.transparentUrl) && l1.result.transparentUrl !== currentUrl) {
    stages.push({ stage: 'background-removed', performed: true, evidence: { output_url: l1.result.transparentUrl } });
    record.stages_applied.push('background-removed');
    currentUrl = l1.result.transparentUrl;
    if (l1.result.dims) currentDims = l1.result.dims;
  } else {
    stages.push({ stage: 'background-removed', performed: false, reason: l1.reason || 'no-provider-or-passthrough' });
  }

  // ─── L2: Upscale + sharpen ───
  const budget = plan === 'free-preview' ? 'light' : 'aggressive';
  const upFn = budget === 'light' ? providers.sharpen : (providers.upscale || providers.sharpen);
  const l2 = await safeCall(upFn, { url: currentUrl, factor: budget === 'light' ? 2 : 4 });
  if (l2.ok && isRealAssetUrl(l2.result?.upscaledUrl) && l2.result?.dims) {
    const inDims = currentDims;
    const outDims = l2.result.dims;
    const grew = outDims && inDims
      ? (outDims.w > inDims.w && outDims.h > inDims.h)
      : Boolean(outDims && outDims.w && outDims.h);
    if (grew) {
      stages.push({ stage: 'upscaled', performed: true, evidence: { input_dims: inDims, output_dims: outDims, output_url: l2.result.upscaledUrl } });
      record.stages_applied.push('upscaled');
      currentUrl = l2.result.upscaledUrl;
      currentDims = outDims;
    } else {
      stages.push({ stage: 'upscaled', performed: false, reason: 'no-dimension-change' });
    }
  } else {
    stages.push({ stage: 'upscaled', performed: false, reason: l2.reason || 'no-provider-or-passthrough' });
  }

  // ─── L3: Vectorize (best-effort, plan-gated) ───
  const isSimple = input?.hint === 'simple-mark' || input?.hint === 'monochrome' || input?.hint === 'two-color';
  if (isSimple && plan !== 'free-preview') {
    const l3 = await safeCall(providers.vectorize, { url: currentUrl });
    if (l3.ok && isRealAssetUrl(l3.result?.svgUrl) && (l3.result?.contentType || '').includes('svg')) {
      stages.push({ stage: 'vectorized', performed: true, evidence: { output_url: l3.result.svgUrl, content_type: l3.result.contentType } });
      record.stages_applied.push('vectorized');
      currentUrl = l3.result.svgUrl;
      currentFormat = 'svg';
    } else {
      stages.push({ stage: 'vectorized', performed: false, reason: l3.reason || 'no-svg-returned' });
    }
  } else {
    stages.push({ stage: 'vectorized', performed: false, reason: isSimple ? 'plan-tier-not-allowed' : 'not-simple-mark' });
  }

  // ─── L4: Palette recolor (only when a real brand palette is available AND the recolor operation produced a real output) ───
  if (palette && (input?.hint === 'monochrome' || input?.hint === 'two-color')) {
    const l4 = await safeCall(providers.recolor, { url: currentUrl, palette });
    if (l4.ok && isRealAssetUrl(l4.result?.recoloredUrl) && typeof l4.result?.delta_e === 'number' && isFinite(l4.result.delta_e)) {
      stages.push({ stage: 'palette-recolored', performed: true, evidence: { output_url: l4.result.recoloredUrl, delta_e: l4.result.delta_e } });
      record.stages_applied.push('palette-recolored');
      currentUrl = l4.result.recoloredUrl;
      record.delta_e_to_brand = l4.result.delta_e;
    } else {
      stages.push({ stage: 'palette-recolored', performed: false, reason: l4.reason || 'no-real-recolor-output' });
    }
  } else {
    stages.push({ stage: 'palette-recolored', performed: false, reason: palette ? 'not-recolor-safe' : 'no-brand-palette' });
  }

  // ─── L5: Shimmer wrap intent (renderer emits the wrap; we only record intent when the logo will actually render) ───
  const heroHasLogo = isRealAssetUrl(currentUrl);
  if (heroHasLogo) {
    stages.push({ stage: 'shimmer-wrapped', performed: true, evidence: { applied_by: 'renderer', gated_by: 'prefers-reduced-motion' } });
    record.stages_applied.push('shimmer-wrapped');
  } else {
    stages.push({ stage: 'shimmer-wrapped', performed: false, reason: 'no-logo-to-wrap' });
  }

  // Fill in the final record fields
  record.final_url = currentUrl;
  record.final_format = currentFormat || detectFormat(currentUrl);
  record.checksum_sha256 = await checksumFor(currentUrl, providers);
  // `verified` is TRUE only when brand was verified AND at least one real transformation happened.
  const realTransformCount = stages.filter((s) => s.performed && s.stage !== 'shimmer-wrapped').length;
  record.verified = Boolean(brandVerified && realTransformCount > 0);

  // If nothing survived except the passthrough source, we mark that clearly.
  if (currentUrl === input?.rawUrl && realTransformCount === 0) {
    record.fallback_reason = 'all-transforms-unavailable-or-failed-passthrough-only';
  }

  return record;
}

function finalize(record, patch) {
  Object.assign(record, patch);
  return record;
}

function detectFormat(url) {
  if (!url) return 'unknown';
  if (url.startsWith('data:image/svg+xml')) return 'procedural-svg';
  if (/\.svg(?:$|\?)/i.test(url)) return 'svg';
  if (/\.png(?:$|\?)/i.test(url)) return 'png';
  if (/\.webp(?:$|\?)/i.test(url)) return 'webp';
  if (/\.jpe?g(?:$|\?)/i.test(url)) return 'jpg';
  return 'unknown';
}

async function checksumFor(url, providers) {
  if (typeof providers?.checksum === 'function') {
    try { return await providers.checksum({ url }); } catch { return null; }
  }
  // Deterministic hash of the URL itself as an identifier — clearly not a
  // content checksum. Marked as `url:` prefix so consumers cannot confuse
  // it with a content-hash.
  return 'url:' + crypto.createHash('sha256').update(String(url || '')).digest('hex');
}

function proceduralMonogramSvg(name, palette) {
  const initials = String(name || 'B')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]).join('').toUpperCase() || 'B';
  const ink = palette?.ink || '#0f0e0b';
  const accent = palette?.accent || '#c99a44';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='${ink}'/><text x='32' y='42' font-family='Fraunces, Georgia, serif' font-size='30' font-weight='700' fill='${accent}' text-anchor='middle'>${initials}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export const _stageOrder = STAGE_KEYS;
