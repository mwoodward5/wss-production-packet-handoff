"use strict";

/**
 * lib/client-surface.js — THE MISSING PRODUCER.
 *
 * lib/mirror-engine/engine.js has read `request.client_surface` since the theme
 * layer shipped, and lib/mirror-engine/theme.js decideMode() has had a dark
 * branch since the same day. Measured 2026-08-11 with a repo-wide search: the
 * ONLY two mentions of `client_surface` in the whole backend were that read and
 * a literal in scripts/theme-engine-dryrun-proof.js. Nothing wrote it. So every
 * production build took `no_measurement_default_light`, and the dark branch was
 * unreachable code wearing a passing unit test.
 *
 * That is the difference between "light is the default" — which is what the
 * owner asked for and what 95.2% of the measured fleet is — and "light is the
 * only thing that can happen", which is what we actually shipped. A plumber
 * whose own site is black got a white mirror and no one could tell you why.
 *
 * This module is the read half. The write half is
 * `scripts/measure-fleet-surfaces.js --persist`, which stores the measurement
 * it already computes onto `record.client_surface`.
 *
 * WHAT IT REFUSES, AND WHY EACH REFUSAL IS A REAL CASE
 *
 *   · no measurement            → null. The engine then says it DEFAULTED to
 *                                 light rather than measuring it, which is the
 *                                 truthful report and already implemented.
 *   · basis "hero-only"         → passed through unchanged; decideMode itself
 *                                 refuses it as grounds for dark. A dark
 *                                 photographic hero is not a dark website —
 *                                 judging by the hero called 20 of 42 white
 *                                 client sites "dark".
 *   · a reading of an error page → dropped. A Cloudflare interstitial is a
 *                                 white page, and it measured 99.7% bright on
 *                                 Northland. `chars` is carried by the measurer
 *                                 for exactly this reason; under 200 characters
 *                                 of text is not a website we have seen.
 *   · older than MAX_AGE_DAYS   → dropped. Businesses redesign. A two-year-old
 *                                 reading is a guess with a timestamp on it,
 *                                 and the whole point of this file is to stop
 *                                 guessing at colour.
 *   · anything malformed        → dropped, never repaired. The request schema
 *                                 is `additionalProperties:false`; a field we
 *                                 invent here is a 400 at build time, which is
 *                                 a worse failure than defaulting to light.
 */

/** A measurement older than this is not evidence about the site as it is now. */
const MAX_AGE_DAYS = 120;

const MODES = new Set(["light", "dark", "mid"]);
const BASES = new Set(["paper", "hero-only"]);

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const share = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? Number(v.toFixed(4)) : null);
const hex6 = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v || "")) ? String(v).toLowerCase() : null);

/**
 * normalizeClientSurface(raw, { now }) -> { surface, reason }
 *
 * `surface` is a schema-valid client_surface object or null. `reason` always
 * says which it was and why, because a silent null here is indistinguishable
 * from "their site is white" three layers downstream.
 */
function normalizeClientSurface(raw, { now = Date.now(), maxAgeDays = MAX_AGE_DAYS } = {}) {
  if (!isObject(raw)) return { surface: null, reason: "no_measurement" };

  const mode = String(raw.mode || "").toLowerCase();
  if (!MODES.has(mode)) return { surface: null, reason: `mode_not_recognised:${mode || "empty"}` };

  const basis = String(raw.basis || "").toLowerCase();
  if (!BASES.has(basis)) return { surface: null, reason: `basis_not_recognised:${basis || "empty"}` };

  // A measurement of a bot wall or a blank shell is not a measurement of their
  // site. The measurer already records how much text it saw; use it.
  const chars = Number(raw.chars);
  if (Number.isFinite(chars) && chars < 200) {
    return { surface: null, reason: `page_had_no_content:${chars}_chars` };
  }

  const measuredAt = String(raw.measured_at || "");
  if (!measuredAt) return { surface: null, reason: "no_measured_at" };
  const t = Date.parse(measuredAt);
  if (!Number.isFinite(t)) return { surface: null, reason: `measured_at_unparseable:${measuredAt.slice(0, 32)}` };
  const ageDays = (now - t) / 86400000;
  if (ageDays > maxAgeDays) {
    return { surface: null, reason: `measurement_stale:${Math.round(ageDays)}d_over_${maxAgeDays}d` };
  }

  // Only the keys the schema names, and only when they are well-formed. The
  // schema is additionalProperties:false — a stray key is a 400, not a warning.
  const out = { mode, basis, measured_at: new Date(t).toISOString() };
  const bright = share(raw.brightShare);
  const dark = share(raw.darkShare);
  const surfaceHex = hex6(raw.surface);
  if (bright !== null) out.brightShare = bright;
  if (dark !== null) out.darkShare = dark;
  if (surfaceHex) out.surface = surfaceHex;

  return {
    surface: out,
    reason: `measured_${mode}_from_${basis}${ageDays >= 1 ? `_${Math.round(ageDays)}d_ago` : "_today"}`,
  };
}

/**
 * clientSurfaceOf(prospect) -> { surface, reason }
 *
 * The one reader both build lanes call, for the same reason both lanes call
 * resolveSignupConfig and verifiedBrandOf: two lanes that assemble the same
 * field by hand is how the sign-up panel went missing from every mirror.
 */
function clientSurfaceOf(prospect = {}, opts = {}) {
  const record = isObject(prospect.record) ? prospect.record : {};
  const candidates = [
    prospect.client_surface,
    record.client_surface,
    isObject(record.build_ready) && isObject(record.build_ready.mirror_request)
      ? record.build_ready.mirror_request.client_surface
      : null,
  ];
  for (const c of candidates) {
    const got = normalizeClientSurface(c, opts);
    if (got.surface) return got;
  }
  // Report the FIRST candidate's reason — "stale" and "never measured" are
  // different operational problems and the caller has to be able to tell them
  // apart in a build report.
  return normalizeClientSurface(candidates.find(isObject) || null, opts);
}

module.exports = { clientSurfaceOf, normalizeClientSurface, MAX_AGE_DAYS };
