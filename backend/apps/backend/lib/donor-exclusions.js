"use strict";

/**
 * lib/donor-exclusions.js — LINE-CAMPAIGN donor exclusions (the "bad apples"
 * list).
 *
 * Owner directive (2026-08-31): nationwide all-trades campaigns run on a donor
 * roster of ~10-12 templates, and two of them are suspected of triggering
 * deep template-specific failures — tattoo-aurelia (the ONLY tattoo donor)
 * and medspa-luma (the ONLY med spa donor). Both are turned OFF for the
 * fresh all-trades campaign lane.
 *
 * SCOPE — donor SELECTION for line campaigns only, never the built dist:
 *   - lib/lead-miner.js outreachDonors()/resolveBuildableDonor(): the mining
 *     stage-0 gate and the line's donorFor() both stop naming an excluded
 *     donor.
 *   - lib/buildable-verticals.js buildableVerticals(): a vertical whose every
 *     in-service donor is excluded is flagged donorExcluded, which drops it
 *     from the automatic all-trades rotation (lib/line-quota.js
 *     openVerticalNames) exactly like an outreach-retired vertical.
 *   It is deliberately NOT read by lib/mirror-engine/donor.js resolveDonor():
 *   an existing tattoo/med-spa customer's rebuild keeps working, the same law
 *   as `retired_for_outreach` — closed to new campaigns, still buildable.
 *
 * REFUSAL CAUSE — DONOR_EXCLUSION_CAUSE:
 *   When a vertical's ONLY donor is on this list, a pick in that vertical is
 *   refused at admission — BEFORE any Intake Genie compile spend — with the
 *   terminal cause donor_unavailable_for_vertical, riding the same quarantine
 *   metadata path as pick_name_implausible (durable rejected row + refill
 *   exclusion). A line pick is never built without a donor.
 *
 * OVERRIDE — GHOST_AGENCY_DONOR_EXCLUSIONS:
 *   When set, it REPLACES the default list (comma-, space- or
 *   semicolon-separated donor ids), so an operator can drop one default or
 *   add another in one place. Set it to "none" to re-include every donor —
 *   the escape hatch for an owner-named diagnostic run.
 */

const DONOR_EXCLUSION_CAUSE = "donor_unavailable_for_vertical";
const GHOST_AGENCY_DONOR_EXCLUSIONS_ENV = "GHOST_AGENCY_DONOR_EXCLUSIONS";

// The two suspected bad apples. Donor ids are donors-clean directory names —
// the same identity as the BOILERPLATE.json `name` field.
const DEFAULT_DONOR_EXCLUSIONS = Object.freeze(["tattoo-aurelia", "medspa-luma"]);

const NONE_TOKENS = new Set(["none", "off", "-", "*"]);

/**
 * donorExclusions(env) -> Set<string>
 * The frozen-by-convention exclusion set for THIS process environment.
 * Unset/empty env -> the DEFAULT_DONOR_EXCLUSIONS; "none" -> empty set
 * (every donor re-included); anything else -> the explicit list.
 */
function donorExclusions(env = process.env) {
  const raw = String((env && env[GHOST_AGENCY_DONOR_EXCLUSIONS_ENV]) ?? "").trim();
  if (NONE_TOKENS.has(raw.toLowerCase())) return new Set();
  const ids = raw
    ? raw.split(/[\s,;]+/).map((id) => id.trim()).filter(Boolean)
    : [...DEFAULT_DONOR_EXCLUSIONS];
  return new Set(ids.map((id) => String(id).toLowerCase()));
}

/** isDonorExcluded(donorId, env) -> boolean — case-insensitive id match. */
function isDonorExcluded(donorId, env = process.env) {
  const wanted = String(donorId ?? "").trim().toLowerCase();
  if (!wanted) return false;
  return donorExclusions(env).has(wanted);
}

module.exports = {
  DONOR_EXCLUSION_CAUSE,
  GHOST_AGENCY_DONOR_EXCLUSIONS_ENV,
  DEFAULT_DONOR_EXCLUSIONS,
  donorExclusions,
  isDonorExcluded,
};
