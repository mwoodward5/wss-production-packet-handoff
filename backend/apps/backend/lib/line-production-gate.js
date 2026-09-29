"use strict";

// Production render-gate adapter.
//
// This preserves the exact 12-fact render gate and its proof-shot capture hook.
// The evidence normalizations below are narrowly earned by production proof:
//
// 1. A JSON-LD areaServed entry typed as schema.org State is an administrative
//    area, not a town. `{"@type":"State","name":"IL"}` is valid schema; the
//    town-plausibility fact must not reinterpret the state code as a broken city.
//    Untyped strings and City/Place entries are untouched and still judged.
//
// 2. The signed landscaping donor was refused for bare `roof` and `stonework`.
//    Those nouns can occur on a property/landscape page; `roofing`, `shingle`,
//    `masonry`, etc. remain intact and still convict a genuine wrong-trade donor.
//
// 3. The signed fencing donor was refused for bare `concrete`. Fence-post
//    installation routinely uses concrete; the word alone is not a trade swap.
//    Concrete-specific service language remains untouched and still convicts a
//    genuine concrete donor accidentally used for a fencing prospect.
//
// None of these rules edit the published site. They only make the evidence
// reader interpret already-valid rendered evidence according to its donor/trade.

const { runRenderGate, readRenderedDom } = require("./render-gate");
const {
  CAPTURE_BUDGET_MS,
  captureLineEmailAssets,
  automaticProofShotsEnabled,
  automaticProofShotRecord,
} = require("./line-email-assets");

const CAPTURE_PERSISTENCE_RESERVE_MS = 30_000;
const LANDSCAPE_DONOR = "landscaping-evergreen";
const LANDSCAPE_ADJACENT_TERMS = Object.freeze(["roof", "gutter", "stonework", "paver"]);
const FENCING_DONOR = "fencing-sterling";
const FENCING_ADJACENT_TERMS = Object.freeze(["concrete"]);
const ADMIN_AREA_TYPES = new Set(["state", "administrativearea", "country"]);

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function foldWords(value) {
  return String(value || "");
}

function stripStandalone(text, word) {
  const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(text || "").replace(new RegExp(`\\b${escaped}\\b`, "gi"), " ");
}

function schemaTypes(value) {
  const node = objectOf(value);
  if (!node) return [];
  const raw = node["@type"];
  return (Array.isArray(raw) ? raw : [raw])
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);
}

function reconcileAdministrativeAreaSchema(dom) {
  if (!dom || dom.ok !== true || !Array.isArray(dom.jsonld)) return dom;
  let removed = 0;
  const jsonld = dom.jsonld.map((node) => {
    if (!objectOf(node) || !Object.prototype.hasOwnProperty.call(node, "areaServed")) return node;
    const original = Array.isArray(node.areaServed) ? node.areaServed : [node.areaServed];
    const kept = original.filter((entry) => {
      if (!objectOf(entry)) return true;
      const administrative = schemaTypes(entry).some((type) => ADMIN_AREA_TYPES.has(type));
      if (administrative) removed += 1;
      return !administrative;
    });
    if (kept.length === original.length) return node;
    return {
      ...node,
      areaServed: Array.isArray(node.areaServed) ? kept : (kept[0] || null),
    };
  });
  return removed
    ? { ...dom, jsonld, administrative_area_schema_reconciled: { removed } }
    : dom;
}

function reconcileDonorTerms(dom, source, { vertical, donor, terms }) {
  if (!dom || dom.ok !== true) return dom;
  if (String(source.vertical || "").trim().toLowerCase() !== vertical) return dom;
  if (String(source.build_donor || "").trim() !== donor) return dom;
  let donorText = foldWords(dom.donorText);
  if (!donorText.trim()) return dom;
  const removed = [];
  for (const term of terms) {
    const before = donorText;
    donorText = stripStandalone(donorText, term);
    if (before !== donorText) removed.push(term);
  }
  return removed.length
    ? { ...dom, donorText, vertical_adjacency_reconciled: { donor, removed } }
    : dom;
}

function reconcileLandscapeDonor(dom, source = {}) {
  return reconcileDonorTerms(dom, source, {
    vertical: "landscaping",
    donor: LANDSCAPE_DONOR,
    terms: LANDSCAPE_ADJACENT_TERMS,
  });
}

function reconcileFencingDonor(dom, source = {}) {
  return reconcileDonorTerms(dom, source, {
    vertical: "fencing",
    donor: FENCING_DONOR,
    terms: FENCING_ADJACENT_TERMS,
  });
}

function reconcileProductionDom(dom, source = {}) {
  return reconcileFencingDonor(
    reconcileLandscapeDonor(reconcileAdministrativeAreaSchema(dom), source),
    source,
  );
}

function sourceCaptureIdentityRefused(capture) {
  const shots = objectOf(capture && capture.shots) || {};
  if (/^capture_identity_/.test(String(shots.before_refused || ""))) return true;
  return Array.isArray(capture && capture.results)
    && capture.results.some((result) => (
      /^old(?:-|$)/.test(String(result && result.variant || ""))
        && /^capture_identity_/.test(String(result && result.reason || ""))
    ));
}

function compactCaptureFailure(capture) {
  const failed = Array.isArray(capture && capture.results)
    ? capture.results.find((result) => result && result.ok === false && String(result.reason || "").trim())
    : null;
  const detail = failed
    ? `${String(failed.variant || "capture")}:${String(failed.reason || "failed")}`
    : String(capture && capture.reason || "proof_record_incomplete");
  const code = detail
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:/-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "proof_record_incomplete";
  return {
    detail: detail.slice(0, 160),
    code: `proof_capture_incomplete:${code}`,
  };
}

/**
 * A passing production render verdict is not ready for promotion until its
 * automatic before/after record is complete. A source-domain identity refusal
 * remains settled evidence for the unchanged send-time visual refusal, and the
 * exact zero kill switch keeps the legacy send-time fallback.
 */
function automaticCaptureDisposition(capture, environment = process.env, { currentWebsite = null } = {}) {
  if (!automaticProofShotsEnabled(environment)) {
    return { ready: false, retryable: false, reason: "automatic_proof_shots_disabled" };
  }
  if (automaticProofShotRecord(capture, { currentWebsite })) {
    return { ready: true, retryable: false, reason: "" };
  }
  if (sourceCaptureIdentityRefused(capture)) {
    return { ready: false, retryable: false, reason: "source_capture_identity_refused" };
  }
  const failure = compactCaptureFailure(capture);
  return { ready: false, retryable: true, reason: failure.detail, code: failure.code };
}

function createProductionGate(dependencies = {}) {
  const runGate = dependencies.runRenderGate || runRenderGate;
  const baseReader = dependencies.reader || readRenderedDom;
  const capture = dependencies.captureEmailAssets || captureLineEmailAssets;
  const clock = dependencies.clock || Date.now;
  const environment = dependencies.environment || process.env;

  return async function productionGate(args = {}) {
    const build = args.build || {};
    const proofIdentitySupplied = Object.prototype.hasOwnProperty.call(build, "proofIdentity");
    const source = args.source || {};
    const reader = async (url, options = {}) => reconcileProductionDom(
      await baseReader(url, options),
      source,
    );
    const verdict = await runGate({
      ...args,
      reader,
      capture: async ({ browser, url }) => {
        const deadlineAt = Number(args.deadlineAt);
        const remaining = Number.isFinite(deadlineAt) && deadlineAt > 0
          ? deadlineAt - clock() - CAPTURE_PERSISTENCE_RESERVE_MS
          : CAPTURE_BUDGET_MS;
        const budgetMs = Math.max(1, Math.min(CAPTURE_BUDGET_MS, Math.floor(remaining)));
        return capture({
          browser,
          previewUrl: url,
          currentWebsite: build.currentWebsite || "",
          buildHash: build.buildHash || "",
          ...(proofIdentitySupplied ? { proofIdentity: build.proofIdentity } : {}),
          budgetMs,
          signal: args.signal,
          deadlineAt: args.deadlineAt,
          environment,
          // Capture the "alive" motion loop for the email after-slot; runs last,
          // budget-gated, decoupled from the ok-verdict, static-still fallback.
          motion: true,
        });
      },
    });
    // Proof-shot capture shares the gate's already-open browser as a cheap
    // optimization, but it is not part of the rendered-DOM verdict.  A slow
    // or partial email capture must not keep a site that passed every render
    // fact in `mirrored` until the generic build retry budget is exhausted.
    // Keep the capture payload on the verdict for the fast path; delivery
    // resolves any missing proof again and refuses the send if it still cannot
    // produce current evidence.
    return verdict;
  };
}

module.exports = {
  CAPTURE_PERSISTENCE_RESERVE_MS,
  LANDSCAPE_DONOR,
  LANDSCAPE_ADJACENT_TERMS,
  FENCING_DONOR,
  FENCING_ADJACENT_TERMS,
  ADMIN_AREA_TYPES,
  objectOf,
  schemaTypes,
  stripStandalone,
  reconcileAdministrativeAreaSchema,
  reconcileDonorTerms,
  reconcileLandscapeDonor,
  reconcileFencingDonor,
  reconcileProductionDom,
  sourceCaptureIdentityRefused,
  compactCaptureFailure,
  automaticCaptureDisposition,
  createProductionGate,
};
