"use strict";

// One-time visual identity freeze for durable Line builds.
//
// A build-ready MirrorRequest used to contain logo/accent/photos but no measured
// typography or content-surface posture. The engine therefore did the only
// truthful thing it could: keep donor fonts and default to light. Worse, doing a
// fresh design pass inside every retry would change the request/build hash and
// recreate the duplicate-deployment cost leak we just removed.
//
// This module measures the prospect's current site ONCE, immediately before the
// first frozen build, adds only measured/servable identity fields to the stored
// MirrorRequest, and persists that request with an updated_at CAS. Subsequent
// retries are byte-identical and make zero design-brief/provider calls.

const { buildDesignBrief } = require("./design-brief");
const { conditionalUpdate, select } = require("./store");

const PROSPECTS = "ghost_agency_prospects";

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

function hasFrozenVisualIdentity(request = {}) {
  const brand = objectOf(request.brand) || {};
  const fonts = objectOf(brand.fonts) || {};
  return Boolean(
    request.client_surface
    && (text(fonts.display) || text(fonts.body))
  );
}

function visualIdentityPatch(brief = {}) {
  const out = { brand: {}, client_surface: null, compactBrief: null };
  const source = text(brief.finalUrl || brief.url);
  const display = text(brief.fontDisplay);
  const body = text(brief.fontBody);
  const href = text(brief.fontHref);
  if ((display || body) && /^https:\/\/fonts\.googleapis\.com\//i.test(href)) {
    out.brand.fonts = {
      ...(display ? { display } : {}),
      ...(body ? { body } : {}),
      href,
      ...(source ? { source } : {}),
      provider: "google",
    };
  }
  if (/^#[0-9a-f]{6}$/i.test(text(brief.accent)) && /^https:\/\//i.test(source)) {
    out.brand.site_accent = text(brief.accent);
    out.brand.site_accent_source = source;
  }
  const visibleChars = Number(brief.measurements && brief.measurements.visibleTextChars);
  if (["light", "dark", "mid"].includes(text(brief.mode).toLowerCase())
    && /^#[0-9a-f]{6}$/i.test(text(brief.surface))
    && (!Number.isFinite(visibleChars) || visibleChars >= 200)) {
    // BRIGHT/DARK AREA SHARES travel with the reading. Without them the
    // cinematic-donor escape (theme.js decideMode: brightShare >= 0.72,
    // darkShare <= 0.18, basis "paper") can never fire — it reads exactly these
    // fields, and a freeze that omits them locks fencing-sterling (and every
    // other CINEMATIC_DARK_DONOR) dark even for a client whose own page is
    // measured 94% white. The shares come from the brief's measured section
    // backgrounds (design-brief surfaceShares), not the hero.
    const bright = Number(brief.measurements && brief.measurements.brightShare);
    const dark = Number(brief.measurements && brief.measurements.darkShare);
    out.client_surface = {
      mode: text(brief.mode).toLowerCase(),
      basis: "paper",
      surface: text(brief.surface).toLowerCase(),
      measured_at: new Date(brief.capturedAt || Date.now()).toISOString(),
      ...(Number.isFinite(bright) && bright >= 0 && bright <= 1 ? { brightShare: bright } : {}),
      ...(Number.isFinite(dark) && dark >= 0 && dark <= 1 ? { darkShare: dark } : {}),
    };
  }
  out.compactBrief = {
    version: text(brief.version),
    capturedAt: text(brief.capturedAt),
    finalUrl: source,
    mode: text(brief.mode),
    surface: text(brief.surface),
    accent: text(brief.accent),
    fontDisplay: display,
    fontBody: body,
    fontHref: href,
    typographyCharacter: text(brief.typographyCharacter),
    heroSlogan: brief.heroSlogan && typeof brief.heroSlogan === "object"
      ? { text: text(brief.heroSlogan.text), source: text(brief.heroSlogan.source) }
      : null,
  };
  return out;
}

function applyVisualIdentity(request = {}, patch = {}) {
  const next = JSON.parse(JSON.stringify(request));
  const brand = objectOf(next.brand) || {};
  next.brand = { ...brand, ...(patch.brand || {}) };
  if (patch.client_surface) next.client_surface = patch.client_surface;
  return next;
}

/**
 * THE UNMEASURABLE MARK, MEASURED WHERE THERE IS A REAL BROWSER.
 *
 * The miner found a header-grade logo and then had to set it down:
 * measureAccent decodes PNG in pure JS and shells out to ffmpeg for everything
 * else, and the miner runs where ffmpeg is not. Hurricane Fence Inc. is the
 * measured case — screenshot.webp (358x81, class custom-logo), refused by no
 * gate, unmeasurable by one decoder — and the record fell to a wordmark with an
 * empty colour while their red #e31e24 sat in `:root` in plain text.
 *
 * This freeze runs the design brief in Chromium BEFORE the first build, so it
 * is the one place that can both measure the client's site colour and re-attach
 * the mark that was set down. The rescue:
 *   · a brand whose logo has no accent and no accent_fallback gains
 *     accent_fallback from the brief's measured accent (same 0.6-confidence bar
 *     mirror-lane-build's briefAccentFallback applies);
 *   · a brand still wearing a WORDMARK gains the whole logo back from
 *     record.brand_evidence.unmeasured_logo — the URL, sha256 and format the
 *     miner persisted precisely so this moment could happen — with the brief's
 *     colour as its accent_fallback, so resolveBrandAssets (which still cannot
 *     decode the WebP in serverless) fills the accent from a measured colour
 *     instead of shipping the donor's.
 *
 * The logo always outranks the page and the engine re-verifies the bytes; the
 * fallback can only ever fill the hole the miner's decoder left. When the brief
 * has no confident accent, nothing is rescued: a wordmark that passes the brand
 * gate is never traded for a logo that fails it.
 */
function unmeasuredLogoPatch(prospect = {}, brief = {}, request = {}) {
  const brand = objectOf(request.brand) || {};
  const accent = /^#[0-9a-f]{6}$/i.test(text(brief.accent)) ? text(brief.accent).toUpperCase() : "";
  const conf = Number(brief.provenance && brief.provenance.accent && brief.provenance.accent.confidence) || 0;
  if (!accent || conf < 0.6) return {};
  const source = text(brief.finalUrl || brief.url);
  if (!/^https:\/\//i.test(source)) return {};
  const fallback = { accent_fallback: accent, accent_fallback_source: source };

  if (brand.logo) {
    if (text(brand.accent) || text(brand.accent_fallback)) return {}; // measured, or the miner already rescued it
    return fallback;
  }
  if (brand.mark) {
    const record = objectOf(prospect.record) || {};
    const evidence = objectOf(record.brand_evidence) || {};
    const held = objectOf(evidence.unmeasured_logo);
    const url = text(held && held.url);
    const sha256 = text(held && held.sha256).toLowerCase();
    if (!/^https:\/\//i.test(url) || !/^[0-9a-f]{64}$/.test(sha256)) return {};
    return {
      ...fallback,
      logo: url,
      logo_sha256: sha256,
    };
  }
  return {};
}

async function reloadFrozenRequest(prospectId, deps = {}) {
  const read = deps.select || select;
  if (!prospectId) return null;
  const loaded = await read(
    PROSPECTS,
    `?select=record,updated_at&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
  ).catch(() => null);
  const row = loaded && loaded.ok === true && Array.isArray(loaded.data) ? loaded.data[0] : null;
  const request = objectOf(row && row.record && row.record.build_ready && row.record.build_ready.mirror_request);
  return request ? JSON.parse(JSON.stringify(request)) : null;
}

async function freezeVisualIdentity(prospect = {}, request = {}, options = {}) {
  if (!objectOf(request) || hasFrozenVisualIdentity(request)) {
    return { request, measured: false, reason: hasFrozenVisualIdentity(request) ? "already_frozen" : "request_invalid" };
  }
  const website = text(request.facts && request.facts.current_website);
  if (!/^https:\/\//i.test(website)) return { request, measured: false, reason: "no_current_website" };

  const measure = options.buildDesignBrief || buildDesignBrief;
  // BUDGET. This is a headless capture of a THIRD-PARTY site running inside a
  // phase that must finish in ~250s, and the design brief honours neither an
  // abort signal nor a deadline — its per-navigation timeout is the only lever
  // that exists. Four sequential navigations at the 45s default is 180s spent
  // before the build proper even starts, which is most of the reason no build
  // ever finished. Fail-soft in both directions: with no budget we skip and say
  // so (a named reason, not silence), and no brief simply means donor
  // typography — the fallback this path already takes when a site is unreadable.
  const remainingMs = Number(options.deadlineAt) > 0 ? Number(options.deadlineAt) - Date.now() : Infinity;
  if (remainingMs < 90_000) {
    return { request, measured: false, reason: "design_brief_skipped_no_budget" };
  }
  let result;
  try {
    result = await measure(website, {
      vision: false,
      crops: false,
      fonts: true,
      businessName: text(request.facts && request.facts.business_name),
      timeoutMs: 12_000,
    });
  } catch (error) {
    return { request, measured: false, reason: `design_brief_threw:${text(error && error.message).slice(0, 100)}` };
  }
  if (!result || result.ok !== true || !objectOf(result.brief)) {
    return { request, measured: false, reason: text(result && result.reason) || "design_brief_unavailable" };
  }

  const patch = visualIdentityPatch(result.brief);
  const logoPatch = unmeasuredLogoPatch(prospect, result.brief, request);
  const next = applyVisualIdentity(request, { ...patch, brand: { ...patch.brand, ...logoPatch } });
  const changed = JSON.stringify(next) !== JSON.stringify(request);
  if (!changed) return { request, measured: true, reason: "no_servable_identity_fields", brief: patch.compactBrief };

  const prospectId = text(prospect.prospect_id || prospect.prospectId);
  const durableUpdatedAt = text(prospect.updated_at || prospect.durableUpdatedAt);
  const record = objectOf(prospect.record) || {};
  const buildReady = objectOf(record.build_ready) || {};
  const update = options.conditionalUpdate || conditionalUpdate;

  if (prospectId && durableUpdatedAt && typeof update === "function") {
    const at = new Date().toISOString();
    const written = await update(
      PROSPECTS,
      "prospect_id",
      prospectId,
      { updated_at: `eq.${durableUpdatedAt}` },
      {
        record: {
          ...record,
          build_ready: { ...buildReady, mirror_request: next },
          design_brief: patch.compactBrief,
        },
        updated_at: at,
      },
    ).catch(() => null);
    if (written && written.ok === true && written.updated === true) {
      return { request: next, measured: true, persisted: true, reason: "visual_identity_frozen", brief: patch.compactBrief };
    }

    // Another worker may have won the CAS. Prefer its already-frozen request;
    // never overwrite a newer prospect record just to save a design measurement.
    const current = await reloadFrozenRequest(prospectId, options);
    if (current && hasFrozenVisualIdentity(current)) {
      return { request: current, measured: false, persisted: true, reason: "visual_identity_race_reconciled" };
    }
  }

  // The build may still use the measured request for this attempt. Failure to
  // persist is fail-soft for appearance, never permission to weaken identity/QC.
  return { request: next, measured: true, persisted: false, reason: "visual_identity_measured_not_persisted", brief: patch.compactBrief };
}

module.exports = {
  objectOf,
  hasFrozenVisualIdentity,
  visualIdentityPatch,
  unmeasuredLogoPatch,
  applyVisualIdentity,
  reloadFrozenRequest,
  freezeVisualIdentity,
};
