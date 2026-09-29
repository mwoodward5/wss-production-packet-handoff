"use strict";

// Lightweight source of truth for the native Mirror release identity. Keep
// this module dependency-free so read-only surfaces can verify a release
// without loading SiteForge providers or store wiring.
module.exports = Object.freeze({
  MIRROR_ENGINE_RENDERER: "mirror-engine@v1",
  MIRROR_ENGINE_QC_CONTRACT: "mirror-engine-qc-v1",
  MIRROR_ENGINE_EVIDENCE_SCHEMA: "mirror-engine-release-evidence-v1",
});
