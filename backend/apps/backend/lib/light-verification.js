"use strict";

// lib/light-verification.js — GHOST_AGENCY_LIGHT_VERIFICATION.
//
// OWNER DIRECTIVE, 2026-09-01: the post-build browser verification is "too
// heavy — another chef in the kitchen." The factory TRUSTS the build and ships.
// The heavy browser policing is killed behind ONE reversible switch:
//
//   GHOST_AGENCY_LIGHT_VERIFICATION unset or "1"  -> LIGHT (the new default)
//   GHOST_AGENCY_LIGHT_VERIFICATION "0"           -> FULL (the exact old law)
//
// LIGHT mode skips, in the mirror build path only:
//   · the engine's post-deploy browser passes — checks.render (renderCheck)
//     and checks.route_render (renderAudit, including the per-channel
//     empty-baseline second renders and the parallel/recovery audit chain),
//   · the Line's post-build render gate (lib/render-gate.js runRenderGate —
//     the 12-fact browser read of the deployed page),
//   · the content floor's donor-native pixel proof (contentFloorReport's
//     per-channel target/baseline visibility evidence).
//
// LIGHT mode KEEPS every cheap, non-browser guarantee:
//   · request schema validation (mirror-engine/validate.js),
//   · the identity_scan donor-leak detection (string matching over the built
//     files — no browser),
//   · fleet-identity recording and the sameness bytes half,
//   · release confirmation (signed release evidence, alias/shared-CAS proof),
//   · the content floor's channel accounting on the RESOLVED content — a row
//     with NO verified services/reviews/hours/faqs/areas/about still refuses.
//     Light mode skips proving PIXEL-LEVEL visibility, never substance.
//
// Every build marks its mode ("light" | "full") on the manifest, the build
// result and the durable row, so a light site is auditable later and flipping
// the env back to "0" restores full verification byte-for-byte.

const GHOST_AGENCY_LIGHT_VERIFICATION_ENV = "GHOST_AGENCY_LIGHT_VERIFICATION";

/**
 * True when light verification is on. Read at CALL time, never cached, so a
 * test (or an operator) can flip the env between calls and the next build
 * obeys. Only the exact string "0" restores full verification — the default
 * (unset, "1", or any typo) is LIGHT ON per the owner directive.
 *
 * `env` is an OVERRIDE, not a replacement: this is a factory-level switch, so
 * a caller handing in a partial env object (the line's injectable `deps.env`)
 * only takes ownership of the switch by actually DEFINING the key — anything
 * else falls through to the process env. That keeps a test env like
 * `{ GHOST_AGENCY_HERO_AUTOLINE: "0" }` from silently re-defaulting
 * verification for the whole row.
 */
function lightVerificationEnabled(env = process.env) {
  const owned = env && Object.prototype.hasOwnProperty.call(env, GHOST_AGENCY_LIGHT_VERIFICATION_ENV);
  const raw = owned
    ? env[GHOST_AGENCY_LIGHT_VERIFICATION_ENV]
    : process.env[GHOST_AGENCY_LIGHT_VERIFICATION_ENV];
  return String(raw ?? "1") !== "0";
}

/** The mode string stamped on manifests, build results and rows. */
function verificationMode(env = process.env) {
  return lightVerificationEnabled(env) ? "light" : "full";
}

module.exports = {
  GHOST_AGENCY_LIGHT_VERIFICATION_ENV,
  lightVerificationEnabled,
  verificationMode,
};
