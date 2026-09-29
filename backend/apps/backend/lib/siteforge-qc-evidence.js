"use strict";

const GATES = [
  ["heroMedia", "Hero media", ["hero_media", "heroMedia"]],
  ["businessIdentity", "Business identity", ["business_identity", "businessIdentity"]],
  ["map", "Satellite map and directions", ["map", "satellite_map", "address_map_directions"]],
  ["brand", "Logo and brand colors", ["brand", "logo_colors", "logo_and_colors"]],
  ["photos", "Real photo evidence", ["photos", "photo_evidence"]],
  ["internalTerms", "No internal terms exposed", ["internal_terms", "internal_terms_clean"]],
  ["socialMeta", "Social, meta, and favicon", ["social_meta", "social_meta_favicon"]],
  ["activationRail", "Activation rail", ["activation_rail", "launch_rail"]],
  ["checkout", "Checkout", ["checkout", "stripe_checkout"]],
  ["accessibility", "Accessibility and responsive layout", ["accessibility", "responsive", "accessibility_responsive"]],
];
const V8_RENDERERS = /siteforge-renderer-v8|wss[ -]?launch/i;

function sources(build = {}) {
  return [build, build.qc, build.qc_evidence, build.qcEvidence, build.release_gates, build.releaseGates].filter((v) => v && typeof v === "object");
}
function valueFor(all, keys) {
  for (const src of all) for (const key of keys) if (Object.prototype.hasOwnProperty.call(src, key)) return src[key];
  return undefined;
}
function passValue(value) {
  if (value && typeof value === "object") return value.passed === true || value.ok === true || value.status === "passed";
  return value === true || value === "passed" || value === "ok";
}
function evidenceValue(value) {
  if (!value || typeof value !== "object") return null;
  return value.evidence || value.url || value.detail || value.message || null;
}

function siteforgeQcEvidence(build = {}) {
  const all = sources(build);
  const renderer = String(valueFor(all, ["renderer", "runtime", "engine"]) || "");
  const rendererPassed = V8_RENDERERS.test(renderer);
  const gates = GATES.map(([key, label, aliases]) => {
    const raw = valueFor(all, aliases);
    const evidence = evidenceValue(raw);
    return { key, label, passed: passValue(raw) && !!evidence, evidence };
  });
  const declaredReleaseReady = valueFor(all, ["release_ready", "releaseReady"]);
  const passed = rendererPassed && gates.every((gate) => gate.passed) && declaredReleaseReady === true;
  return {
    renderer: renderer || null,
    rendererPassed,
    releaseReady: passed,
    declaredReleaseReady: declaredReleaseReady === true,
    outreachEligible: passed,
    gates,
    failedGates: [
      ...(rendererPassed ? [] : ["v8_wss_launch_runtime"]),
      ...gates.filter((gate) => !gate.passed).map((gate) => gate.key),
      ...(declaredReleaseReady === true ? [] : ["release_ready"]),
    ],
  };
}

module.exports = { GATES, siteforgeQcEvidence };
