'use strict';

/**
 * hero-image-selector.cjs
 * Node 20+, CommonJS, zero npm deps, node builtins only.
 *
 * Doctrine (verbatim from the owner):
 *   "pick some background shot with NO PEOPLE in it showing their work."
 *
 * Metadata-only scoring. No network calls. No pixel decoding.
 * Caller supplies width/height/bytes/mime/sourceContext/filename.
 */

/* ------------------------------------------------------------------ *
 * Regex law (single source of truth)
 * ------------------------------------------------------------------ */

const RE_LOGO = /logo|brand[-_ ]?mark|word[-_ ]?mark|emblem/i;
const RE_WORK_CONTEXT = /gallery|project|job|work|portfolio|recent|services|job[-_ ]?site|install|repair|truck|van|fleet|equipment/i;
const RE_HERO_CONTEXT = /homepage|home-page|hero|landing|banner/i;
const RE_GBP_CONTEXT = /(?:^|[^a-z0-9])(?:gbp|google[-_ ]?business(?:[-_ ]?profile)?|google[-_ ]?my[-_ ]?business|maps)(?:[^a-z0-9]|$)/i;
const RE_GBP_SOURCE = /^(?:gbp|google[-_ ]?business(?:[-_ ]?profile)?|google[-_ ]?my[-_ ]?business|maps)$/i;
const RE_SOCIAL_CONTEXT = /social|facebook|instagram|fb|ig|twitter|x-com|yelp/i;
const RE_PEOPLE_CONTEXT = /team|staff|about|crew-photo|employee/i;
const RE_PEOPLE_HINT = /team|staff|crew|owner|portrait|headshot|people|group|(?:^|[^a-z0-9])me(?:[^a-z0-9]|$)/i;
// These are marketing graphics, not photographs of the client's work. Keep
// this deliberately high-confidence: opaque camera filenames remain eligible,
// while an explicit anniversary/coupon/promotion label fails closed before an
// image generator can animate typography or a badge as though it were a scene.
const RE_PROMOTIONAL_GRAPHIC = /anniversar(?:y|ies)|(?:^|[^a-z0-9])(?:coupons?|promotions?|promotional|special[-_ ]?offers?|gift[-_ ]?cards?|sale[-_ ]?banners?|award[-_ ]?badges?)(?:[^a-z0-9]|$)/i;
const RE_IMAGE_MIME = /^image\//i;

// Extensions we accept as "an image" when mime is absent.
const IMAGE_EXT = new Set([
  'jpg', 'jpeg', 'jpe', 'jfif', 'png', 'webp', 'avif',
  'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'svg',
]);

const MAX_SCORE = 100;
const THUMB_BYTES = 30000;      // < 30KB known bytes => thumbnail cap
const THUMB_CAP = 40;
const MIN_EDGE = 400;           // icon-ish veto threshold
const GBP_MIN_WIDTH = 800;
const GBP_MIN_ASPECT = 1.15;

/* ------------------------------------------------------------------ *
 * Defensive coercion helpers — nothing below may throw
 * ------------------------------------------------------------------ */

function str(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** Finite positive integer-ish number, else null (unknown). */
function dim(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function isPlainObjectish(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function hasVerifiedNoPeopleEvidence(candidate) {
  const c = isPlainObjectish(candidate) ? candidate : {};
  return c.no_people === true || c.noPeople === true
    || c.people_free === true || c.peopleFree === true;
}

function hasVerifiedPeopleEvidence(candidate) {
  const c = isPlainObjectish(candidate) ? candidate : {};
  return c.contains_people === true || c.containsPeople === true
    || c.has_people === true || c.hasPeople === true
    || c.people_present === true || c.peoplePresent === true
    || c.faces_present === true || c.facesPresent === true
    || c.contains_recognizable_people === true || c.containsRecognizablePeople === true;
}

/** Everything a scorer needs, normalized and safe. */
function normalize(candidate) {
  const c = isPlainObjectish(candidate) ? candidate : {};
  const url = str(c.url);
  const filename = str(c.filename);
  const sourceContext = str(c.sourceContext);
  const source = str(c.source).trim().toLowerCase();
  const grade = str(c.grade).trim().toLowerCase();
  const mime = str(c.mime).trim().toLowerCase();
  const explicitKind = [
    c.kind, c.type, c.asset_type, c.assetType, c.asset_role, c.assetRole, c.role,
  ].map(str).join(' ').trim();

  // URL tail is a useful filename fallback (query/hash stripped).
  let urlTail = '';
  try {
    const noQuery = url.split('#')[0].split('?')[0];
    const parts = noQuery.split('/').filter(Boolean);
    urlTail = parts.length ? parts[parts.length - 1] : '';
    try { urlTail = decodeURIComponent(urlTail); } catch (_) { /* keep the exact URL tail */ }
  } catch (_) {
    urlTail = '';
  }

  const nameForMatch = `${filename} ${urlTail}`.trim();
  const ext = (() => {
    const target = filename || urlTail;
    const i = target.lastIndexOf('.');
    if (i < 0 || i === target.length - 1) return '';
    return target.slice(i + 1).toLowerCase();
  })();

  const bytes = (() => {
    const n = dim(c.bytes);
    return n === null ? null : n;
  })();

  return {
    url,
    filename,
    sourceContext,
    source,
    grade,
    mime,
    ext,
    nameForMatch,
    haystack: `${nameForMatch} ${sourceContext}`.trim(),
    width: dim(c.width),
    height: dim(c.height),
    bytes,
    isGbp: RE_GBP_SOURCE.test(source) || RE_GBP_CONTEXT.test(sourceContext),
    identityCritical: c.identity_critical === true || c.identityCritical === true,
    logoLike: c.logo_like === true || c.logoLike === true || c.is_logo === true
      || c.isLogo === true || c.brand_mark === true || c.brandMark === true
      || c.is_brand_mark === true || c.isBrandMark === true || RE_LOGO.test(explicitKind),
    gbpHeroEvidence: grade === 'hero' || (
      (c.photographic === true || c.is_photograph === true || c.isPhotograph === true)
      && (c.hero_suitable === true || c.heroSuitable === true)
    ),
    noPeopleVerified: hasVerifiedNoPeopleEvidence(c),
    peoplePresentVerified: hasVerifiedPeopleEvidence(c),
  };
}

/* ------------------------------------------------------------------ *
 * Hard vetoes
 * ------------------------------------------------------------------ */

/** @returns {string|null} veto reason, or null if the candidate survives. */
function veto(n) {
  // 1. A person/crew portrait explicitly preserved for identity belongs in an
  //    identity band, never in an automatically animated background.
  if (n.identityCritical) {
    return 'veto:identity-critical — identity portrait cannot become an animated hero background';
  }

  // An explicit pixel/classifier result is truth evidence. Filename silence is
  // not: only a positive people/faces signal may refuse an otherwise owned
  // photograph on this ground.
  if (n.peoplePresentVerified) {
    return 'veto:people-present — explicit people/faces evidence cannot become an animated hero background';
  }

  // 2. Likely logo: explicit signal/context OR logo-ish filename.
  if (n.logoLike || RE_LOGO.test(n.sourceContext) || RE_LOGO.test(n.nameForMatch)) {
    return 'veto:likely-logo — logo context or logo/brand-mark filename';
  }

  // 3. An explicitly named promotional graphic can be first-party and large,
  // yet it is not a photographic scene. Valley View's 25th-anniversary card
  // was 2048x1024 and otherwise outscored its real fleet photographs.
  if (RE_PROMOTIONAL_GRAPHIC.test(n.haystack)) {
    return 'veto:promotional-graphic — marketing artwork cannot become an animated hero background';
  }

  // 4. Not an image at all (mime present but non-image; or no mime and a
  //    known non-image extension).
  if (n.mime) {
    if (!RE_IMAGE_MIME.test(n.mime)) {
      return `veto:not-an-image — mime "${n.mime}" is not image/*`;
    }
  } else if (n.ext && !IMAGE_EXT.has(n.ext)) {
    return `veto:not-an-image — unknown mime and non-image extension ".${n.ext}"`;
  }

  // 5. Icon-ish: either known edge under 400px.
  if (n.width !== null && n.width < MIN_EDGE) {
    return `veto:too-small — width ${n.width} < ${MIN_EDGE}`;
  }
  if (n.height !== null && n.height < MIN_EDGE) {
    return `veto:too-small — height ${n.height} < ${MIN_EDGE}`;
  }

  // 6. Portrait orientation: heroes are wide.
  if (n.width !== null && n.height !== null && n.height > n.width) {
    return `veto:portrait — ${n.width}x${n.height} is taller than wide`;
  }

  // GBP media URLs are opaque. A place pin proves whose asset it is, but not
  // that the bytes are a photograph rather than a logo. Require the bank's
  // explicit hero grade (or equivalent explicit photo + hero flags) and real
  // landscape geometry. Unknown/square GBP media fails closed.
  if (n.isGbp) {
    if (!n.gbpHeroEvidence) {
      return 'veto:gbp-photo-unproven — GBP media lacks explicit photographic hero evidence';
    }
    if (
      n.width === null || n.height === null
      || n.width < GBP_MIN_WIDTH
      || n.width / n.height < GBP_MIN_ASPECT
    ) {
      return `veto:gbp-landscape-unproven — GBP media needs measured landscape geometry >= ${GBP_MIN_WIDTH}px`;
    }
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Scoring bands
 * ------------------------------------------------------------------ */

function scoreDimensions(n, reasons) {
  const w = n.width;
  if (w === null) {
    reasons.push('dimensions:+10 unknown dims (dimensionless source, not zeroed)');
    return 10;
  }
  if (w >= 1920) {
    reasons.push(`dimensions:+35 width ${w} >= 1920`);
    return 35;
  }
  if (w >= 1280) {
    reasons.push(`dimensions:+30 width ${w} >= 1280`);
    return 30;
  }
  if (w >= 1000) {
    reasons.push(`dimensions:+22 width ${w} >= 1000`);
    return 22;
  }
  if (w >= 800) {
    reasons.push(`dimensions:+12 width ${w} >= 800`);
    return 12;
  }
  reasons.push(`dimensions:+0 width ${w} below 800`);
  return 0;
}

function scoreAspect(n, reasons) {
  const { width: w, height: h } = n;
  if (w === null || h === null) {
    reasons.push('aspect:+8 unknown aspect ratio');
    return 8;
  }
  const ratio = w / h;

  // Square-ish band first so 1:1 never reads as "landscape".
  if (ratio < 1.15) {
    reasons.push(`aspect:+5 square-ish ${ratio.toFixed(2)}:1`);
    return 5;
  }
  // Cinematic sweet spot: 16:9 (1.777…) through 3:1.
  if (ratio >= 16 / 9 && ratio <= 3) {
    reasons.push(`aspect:+20 cinematic landscape ${ratio.toFixed(2)}:1 (16:9..3:1)`);
    return 20;
  }
  // Landscape, but outside the sweet spot: either ultra-wide (>3:1) or
  // in the 1.15..1.777 range (wider than 2:1 tall, not yet 16:9).
  reasons.push(`aspect:+12 landscape ${ratio.toFixed(2)}:1 outside 16:9..3:1`);
  return 12;
}

function scoreWorkContext(n, reasons) {
  const ctx = n.sourceContext;

  // People-focus context zeroes this band even if a work word co-occurs.
  if (RE_PEOPLE_CONTEXT.test(ctx)) {
    reasons.push(`work-context:+0 people-focused context "${ctx}"`);
    return 0;
  }
  if (RE_WORK_CONTEXT.test(n.haystack)) {
    reasons.push(`work-context:+25 work-showing context "${n.haystack}"`);
    return 25;
  }
  if (RE_HERO_CONTEXT.test(ctx)) {
    reasons.push(`work-context:+20 homepage/hero context "${ctx}"`);
    return 20;
  }
  if (RE_GBP_CONTEXT.test(ctx)) {
    reasons.push(`work-context:+15 gbp context "${ctx}"`);
    return 15;
  }
  if (RE_SOCIAL_CONTEXT.test(ctx)) {
    reasons.push(`work-context:+8 social context "${ctx}"`);
    return 8;
  }
  reasons.push(ctx
    ? `work-context:+8 unrecognized context "${ctx}"`
    : 'work-context:+8 unknown context');
  return 8;
}

function scoreNoPeople(n, reasons) {
  const nameHit = RE_PEOPLE_HINT.test(n.nameForMatch);
  const ctxConclusive = RE_PEOPLE_CONTEXT.test(n.sourceContext);

  if (n.noPeopleVerified) {
    reasons.push(n.isGbp
      ? 'no-people:+20 explicit GBP no-people evidence'
      : 'no-people:+20 explicit no-people evidence');
    return 20;
  }

  if (ctxConclusive) {
    reasons.push(`no-people:+0 conclusive people context "${n.sourceContext}"`);
    return 0;
  }
  if (nameHit) {
    reasons.push(`no-people:+0 people hint in name "${n.nameForMatch}"`);
    return 0;
  }
  if (n.isGbp) {
    reasons.push('no-people:+0 opaque GBP media has no explicit no-people evidence');
    return 0;
  }
  reasons.push('no-people:+0 no explicit no-people evidence');
  return 0;
}

function scoreBytes(n, reasons) {
  const b = n.bytes;
  if (b === null) {
    reasons.push('file-size:+3 unknown bytes');
    return 3;
  }
  if (b >= 300000) {
    reasons.push(`file-size:+10 ${b} bytes >= 300KB`);
    return 10;
  }
  if (b >= 120000) {
    reasons.push(`file-size:+6 ${b} bytes >= 120KB`);
    return 6;
  }
  if (b >= 40000) {
    reasons.push(`file-size:+3 ${b} bytes >= 40KB`);
    return 3;
  }
  reasons.push(`file-size:+0 ${b} bytes below 40KB`);
  return 0;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

function selectHeroImage(candidates, opts = {}) {
  const empty = { best: null, ranked: [], rejected: [] };

  let list;
  try {
    list = Array.isArray(candidates) ? candidates : [];
  } catch (_) {
    return empty;
  }
  if (list.length === 0) return empty;
  // candidate shape guard: a non-string url must never crash scoring —
  // coerce to string (numbers become labels, nulls become empty and vetoes win).
  list = list.map((c) => {
    try {
      if (!c || typeof c !== "object") return null;
      // string urls pass through BY REFERENCE (identity is contract); only a
      // non-string url gets the coercion clone.
      if (typeof c.url === "string") return c;
      return null; // non-string url is a data error, not a photo — drop it
    } catch (_) { return null; } // hostile accessors drop out, never crash the pick
  }).filter(Boolean);
  if (list.length === 0) return empty;

  const options = isPlainObjectish(opts) ? opts : {};
  const minScore = dim(options.minScore) === null ? 0 : dim(options.minScore);

  const ranked = [];
  const rejected = [];

  for (let i = 0; i < list.length; i += 1) {
    const original = list[i];
    let n;
    try {
      n = normalize(original);
    } catch (_) {
      rejected.push({ candidate: original, reason: 'veto:unreadable — candidate could not be normalized' });
      continue;
    }

    // A candidate with no usable identity is not selectable.
    if (!isPlainObjectish(original) || (!n.url && !n.filename)) {
      rejected.push({ candidate: original, reason: 'veto:invalid — missing url/filename or not an object' });
      continue;
    }

    let vetoReason = null;
    try {
      vetoReason = veto(n);
    } catch (_) {
      vetoReason = 'veto:unreadable — veto evaluation failed';
    }
    if (vetoReason) {
      rejected.push({ candidate: original, reason: vetoReason });
      continue;
    }

    const reasons = [];
    let dims = 0, aspect = 0, work = 0, people = 0, size = 0;
    try {
      dims = scoreDimensions(n, reasons);
      aspect = scoreAspect(n, reasons);
      work = scoreWorkContext(n, reasons);
      people = scoreNoPeople(n, reasons);
      size = scoreBytes(n, reasons);
    } catch (_) {
      reasons.push('scoring:partial — a band failed and contributed 0');
    }

    let score = dims + aspect + work + people + size;
    if (score > MAX_SCORE) score = MAX_SCORE;

    if (n.bytes !== null && n.bytes < THUMB_BYTES && score > THUMB_CAP) {
      reasons.push(`thumbnail-cap: ${n.bytes} bytes < 30KB, total capped ${score} -> ${THUMB_CAP}`);
      score = THUMB_CAP;
    }

    ranked.push({
      candidate: original,
      score,
      reasons,
      _i: i,
      _work: work,
      _dims: dims,
    });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b._work !== a._work) return b._work - a._work;
    if (b._dims !== a._dims) return b._dims - a._dims;
    return a._i - b._i;
  });

  const finalRanked = ranked.map((r) => ({
    candidate: r.candidate,
    score: r.score,
    reasons: r.reasons.slice(),
  }));

  let best = null;
  if (finalRanked.length > 0 && finalRanked[0].score >= minScore) {
    best = finalRanked[0].candidate;
  }

  return { best, ranked: finalRanked, rejected };
}

function selectionPolicy() {
  return {
    vetoes: ['logo', 'promotional-graphic', 'identity-critical', 'people-present', 'too-small', 'portrait', 'gbp-unproven'],
    doctrine: 'background shot, no people, showing their work',
    note: 'metadata-only scoring; no-people credit requires explicit evidence; opaque GBP media needs explicit hero-photo evidence',
  };
}

/* ------------------------------------------------------------------ *
 * Self-test
 * ------------------------------------------------------------------ */

function runTests() {
  let failures = 0;
  const check = (name, ok, detail) => {
    if (ok) {
      console.log(`PASS ${name}`);
    } else {
      failures += 1;
      console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };

  const urlOf = (r) => (r && r.candidate ? r.candidate.url : null);
  const rowFor = (res, url) => res.ranked.find((r) => urlOf(r) === url) || null;
  const rejFor = (res, url) =>
    res.rejected.find((r) => r.candidate && r.candidate.url === url) || null;

  // 1. Ordering: big gallery jpg > proven landscape GBP > square social.
  {
    const input = [
      { url: 'https://x.com/g/gallery-roof-1.jpg', width: 1920, height: 1080, bytes: 500000, mime: 'image/jpeg', sourceContext: 'gallery' },
      { url: 'https://x.com/gbp/photo-a.jpg', width: 1280, height: 720, bytes: 150000, mime: 'image/jpeg', source: 'gbp', sourceContext: 'gbp', grade: 'hero' },
      { url: 'https://x.com/s/insta-square.jpg', width: 1080, height: 1080, bytes: 200000, mime: 'image/jpeg', sourceContext: 'social' },
    ];
    const res = selectHeroImage(input);
    const order = res.ranked.map(urlOf);
    const ok =
      res.rejected.length === 0 &&
      res.ranked.length === 3 &&
      order[0] === input[0].url &&
      order[1] === input[1].url &&
      order[2] === input[2].url &&
      res.best === input[0] &&
      res.ranked[0].score > res.ranked[1].score &&
      res.ranked[1].score > res.ranked[2].score &&
      res.ranked[0].reasons.some((r) => /work-context:\+25/.test(r)) &&
      res.ranked[0].reasons.some((r) => /dimensions:\+35/.test(r)) &&
      res.ranked[0].reasons.some((r) => /aspect:\+20/.test(r)) &&
      res.ranked[1].reasons.some((r) => /work-context:\+15/.test(r)) &&
      res.ranked[2].reasons.some((r) => /aspect:\+5 square-ish/.test(r));
    check(
      'gallery-1920 > proven landscape GBP > social-square (order + reasons)',
      ok,
      `order=${JSON.stringify(order)} scores=${JSON.stringify(res.ranked.map((r) => r.score))}`
    );
  }

  // 2. Logo context vetoed despite huge dimensions.
  {
    const input = [
      { url: 'https://x.com/brand/mark.png', width: 4000, height: 3000, bytes: 900000, mime: 'image/png', sourceContext: 'logo' },
      { url: 'https://x.com/g/job-site.jpg', width: 1600, height: 900, bytes: 400000, mime: 'image/jpeg', sourceContext: 'gallery' },
    ];
    const res = selectHeroImage(input);
    const rej = rejFor(res, input[0].url);
    const ok =
      !!rej &&
      /likely-logo/.test(rej.reason) &&
      !rowFor(res, input[0].url) &&
      res.best === input[1] &&
      res.ranked.length === 1;
    check('4000x3000 logo-context REJECTED (veto beats dimensions)', ok, rej ? rej.reason : 'not rejected');
  }

  // 3. Portrait vetoed even with perfect context.
  {
    const input = [
      { url: 'https://x.com/g/portrait-job.jpg', width: 1080, height: 1920, bytes: 800000, mime: 'image/jpeg', sourceContext: 'gallery-project' },
    ];
    const res = selectHeroImage(input);
    const rej = rejFor(res, input[0].url);
    const ok = res.best === null && res.ranked.length === 0 && !!rej && /portrait/.test(rej.reason);
    check('portrait 1080x1920 REJECTED despite gallery context', ok, rej ? rej.reason : 'not rejected');
  }

  // 4. Dimensionless opaque GBP media fails closed.
  {
    const input = [{ url: 'https://x.com/gbp/no-dims.jpg', mime: 'image/jpeg', sourceContext: 'gbp' }];
    const res = selectHeroImage(input);
    const rejected = rejFor(res, input[0].url);
    const ok =
      res.best === null &&
      res.ranked.length === 0 &&
      !!rejected &&
      /gbp-photo-unproven/.test(rejected.reason);
    check('dimensionless opaque GBP media REJECTED', ok, rejected ? rejected.reason : 'not rejected');
  }

  // 5. team.jpg penalized, not vetoed, and loses to equal-dimension gallery.
  {
    const input = [
      { url: 'https://x.com/t/team.jpg', filename: 'team.jpg', width: 1920, height: 1080, bytes: 500000, mime: 'image/jpeg', sourceContext: 'team-page' },
      { url: 'https://x.com/g/gallery-shot.jpg', filename: 'gallery-shot.jpg', width: 1920, height: 1080, bytes: 500000, mime: 'image/jpeg', sourceContext: 'gallery' },
    ];
    const res = selectHeroImage(input);
    const team = rowFor(res, input[0].url);
    const gallery = rowFor(res, input[1].url);
    const ok =
      res.rejected.length === 0 &&
      !!team &&
      !!gallery &&
      team.reasons.some((r) => /no-people:\+0/.test(r)) &&
      team.reasons.some((r) => /work-context:\+0/.test(r)) &&
      team.score < gallery.score &&
      res.ranked[0].candidate === input[1] &&
      res.best === input[1];
    check(
      'team.jpg penalized but NOT vetoed, loses to equal-dim gallery',
      ok,
      team && gallery ? `team=${team.score} gallery=${gallery.score}` : 'missing rows'
    );
  }

  // 6. Garbage inputs never throw and yield best:null.
  {
    let ok = true;
    let detail = '';
    const garbage = [null, undefined, [], 'x', 42, {}, [null], [undefined], ['nope'], [{}], [{ url: 123 }], NaN];
    for (const g of garbage) {
      try {
        const res = selectHeroImage(g, null);
        if (!res || res.best !== null || !Array.isArray(res.ranked) || !Array.isArray(res.rejected)) {
          ok = false;
          detail = `bad shape for ${JSON.stringify(g)}`;
          break;
        }
      } catch (e) {
        ok = false;
        detail = `threw on ${JSON.stringify(g)}: ${e && e.message}`;
        break;
      }
    }
    check('garbage inputs -> best:null, never throws', ok, detail);
  }

  // 7. 500 candidates, deterministic across two runs, no candidate lost.
  {
    const contexts = ['gallery', 'gbp', 'social', 'homepage-hero', 'team-page', 'logo', 'services', ''];
    const widths = [1920, 1280, 1000, 800, 320, null, 2560];
    const input = [];
    for (let i = 0; i < 500; i += 1) {
      const w = widths[i % widths.length];
      const h = w === null ? null : Math.round(w / (i % 3 === 0 ? 16 / 9 : 4 / 3));
      input.push({
        url: `https://x.com/p/${i}.jpg`,
        filename: `${i % 11 === 0 ? 'crew-' : 'shot-'}${i}.jpg`,
        width: w,
        height: h,
        bytes: (i % 7) * 60000,
        mime: 'image/jpeg',
        sourceContext: contexts[i % contexts.length],
      });
    }
    const frozen = JSON.stringify(input);
    const a = selectHeroImage(input);
    const b = selectHeroImage(input);
    const keyOf = (res) => res.ranked.map((r) => `${r.candidate.url}:${r.score}`).join('|');
    const ok =
      keyOf(a) === keyOf(b) &&
      a.ranked.length + a.rejected.length === 500 &&
      JSON.stringify(input) === frozen &&
      a.best !== null;
    check(
      '500 candidates: deterministic order, full accounting, no mutation',
      ok,
      `ranked=${a.ranked.length} rejected=${a.rejected.length}`
    );
  }

  // 8. Policy shape.
  {
    const p = selectionPolicy();
    const ok =
      Array.isArray(p.vetoes) &&
      p.vetoes.join(',') === 'logo,promotional-graphic,identity-critical,people-present,too-small,portrait,gbp-unproven' &&
      p.doctrine === 'background shot, no people, showing their work' &&
      p.note === 'metadata-only scoring; no-people credit requires explicit evidence; opaque GBP media needs explicit hero-photo evidence';
    check('selectionPolicy() shape', ok, JSON.stringify(p));
  }

  // 10. Real Valley-style fleet photography beats a large anniversary card.
  {
    const input = [
      { url: 'https://valley.example/uploads/ValleyViewPlumbing-Van6-2880w.jpg', width: 1920, height: 1296, bytes: 253285, mime: 'image/jpeg', sourceContext: 'own_site' },
      { url: 'https://valley.example/uploads/25th-Anniversary-for-Valley-View-Plumbing-2160-x-1080-px-1.jpg', width: 2048, height: 1024, bytes: 188218, mime: 'image/jpeg', sourceContext: 'own_site' },
    ];
    const res = selectHeroImage(input);
    const promo = rejFor(res, input[1].url);
    const ok = res.best === input[0]
      && !!promo
      && /promotional-graphic/.test(promo.reason)
      && res.ranked.length === 1;
    check('fleet photo selected; anniversary graphic rejected', ok, promo ? promo.reason : 'promo not rejected');
  }

  // 11. Promo labels are decoded/plural-aware without rejecting a real place.
  {
    const promoUrls = [
      'https://x.com/Coupons.jpg',
      'https://x.com/special-offers.jpg',
      'https://x.com/25th%20Anniversary.jpg',
      'https://x.com/25thAnniversary.jpg',
    ];
    const real = { url: 'https://x.com/water-heater-install-Celebration-FL.jpg', width: 1600, height: 900, bytes: 300000, mime: 'image/jpeg', sourceContext: 'own_site' };
    const res = selectHeroImage([
      ...promoUrls.map((url) => ({ url, width: 1600, height: 900, bytes: 300000, mime: 'image/jpeg', sourceContext: 'own_site' })),
      real,
    ]);
    const ok = promoUrls.every((url) => /promotional-graphic/.test(rejFor(res, url)?.reason || ''))
      && res.best === real;
    check('encoded/plural promos rejected; Celebration FL work photo preserved', ok);
  }

  // 9. Thumbnail cap and small-edge veto.
  {
    const input = [
      { url: 'https://x.com/g/thumb.jpg', width: 1920, height: 1080, bytes: 12000, mime: 'image/jpeg', sourceContext: 'gallery' },
      { url: 'https://x.com/g/icon.png', width: 300, height: 300, bytes: 5000, mime: 'image/png', sourceContext: 'gallery' },
      { url: 'https://x.com/g/doc.pdf', bytes: 900000, mime: 'application/pdf', sourceContext: 'gallery' },
    ];
    const res = selectHeroImage(input);
    const thumb = rowFor(res, input[0].url);
    const icon = rejFor(res, input[1].url);
    const pdf = rejFor(res, input[2].url);
    const ok =
      !!thumb && thumb.score === 40 &&
      thumb.reasons.some((r) => /thumbnail-cap/.test(r)) &&
      !!icon && /too-small/.test(icon.reason) &&
      !!pdf && /not-an-image/.test(pdf.reason);
    check('thumbnail cap at 40, small-edge + non-image vetoes', ok, thumb ? `thumbScore=${thumb.score}` : 'no thumb row');
  }

  process.exit(failures === 0 ? 0 : 1);
}

module.exports = {
  hasVerifiedNoPeopleEvidence,
  hasVerifiedPeopleEvidence,
  selectHeroImage,
  selectionPolicy,
};

if (require.main === module && process.argv.includes('--test')) {
  runTests();
}
