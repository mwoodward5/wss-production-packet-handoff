"use strict";

const CONTRACTS = Object.freeze([
  Object.freeze({
    renderer: "mirror-engine@v1",
    qc_contract: "mirror-engine-qc-v1",
    evidence_schema: "mirror-engine-release-evidence-v1",
  }),
  Object.freeze({
    renderer: "spa-v2",
    qc_contract: "wss-render-v2-qc-v1",
    evidence_schema: "wss-render-v2-evidence-v1",
  }),
]);

function contractFor(value = {}) {
  return CONTRACTS.find((c) => (
    value.renderer === c.renderer
    && value.qc_contract === c.qc_contract
    && value.evidence_schema === c.evidence_schema
  )) || null;
}

function rendererKnown(renderer = "") {
  return CONTRACTS.some((c) => c.renderer === renderer);
}

module.exports = Object.freeze({ CONTRACTS, contractFor, rendererKnown });
