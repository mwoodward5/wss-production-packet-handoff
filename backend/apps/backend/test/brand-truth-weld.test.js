"use strict";

// ---------------------------------------------------------------------------
// THE SITE AND THE EMAIL MUST NEVER DISAGREE ABOUT THE CLIENT'S COLOUR.
//
// Three divergences let them (recon 2026-08-20, the 2026-08-03 family):
//   1. lib/email.js preferred the flat record.brand_color — historically a
//      scraped CTA colour — over the verified accent.
//   2. lib/email/adapt-email-v2.cjs read brand_evidence.accent directly,
//      while the legacy composer's verifiedBrandOf reads
//      mirror_request.brand.accent FIRST.
//   3. Neither email path could see the SHIPPED accent at all: when the
//      engine's site-chrome-vs-logo arbitration dressed the mirror in the
//      site's colour, that decision lived only inside
//      release_evidence.checks.brand and nothing wrote it back to the record.
//
// These pin the weld that closes all three: checks.brand carries the exact
// shipped hex (accent_hex), brandTruthFromEvidence distils it into a durable
// record.brand_truth at the build persistence points, and verifiedBrandOf —
// the declared single reader — prefers that truth ahead of every stored
// measurement.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { brandTruthFromEvidence, verifiedBrandOf } = require("../lib/prospects");

// ---------------------------------------------------------------------------
// 1. DISTILLING THE DECISION OUT OF THE ENGINE'S EVIDENCE
// ---------------------------------------------------------------------------

test("evidence with no brand check distils to null, never to a guessed colour", () => {
  assert.equal(brandTruthFromEvidence(null), null);
  assert.equal(brandTruthFromEvidence("not-an-object"), null);
  assert.equal(brandTruthFromEvidence({}), null);
  assert.equal(brandTruthFromEvidence({ checks: {} }), null);
  // A brand check that recorded no shipped hex (pre-weld manifest, refused
  // build) is the same honest nothing.
  assert.equal(brandTruthFromEvidence({ checks: { brand: { status: "unbranded", accent: "donor-default" } } }), null);
  // Junk in accent_hex is refused, not passed through.
  assert.equal(brandTruthFromEvidence({ checks: { brand: { accent_hex: "tomato" } } }), null);
});

test("accent_hex is the truth, and the arbitration's verdict names the source", () => {
  const truth = brandTruthFromEvidence({
    checks: {
      brand: {
        accent_hex: "#0B5CAB",
        accent_origin: "site_chrome_over_logo(site #0B5CAB vs logo #C53F34, hue_gap 155°)",
        accent_decision: { winner: "site_chrome", site: "#0B5CAB", logo: "#C53F34", hue_gap: 155 },
        secondary_accent: "#C53F34",
      },
    },
  }, { decidedAt: "2026-08-20T00:00:00.000Z" });
  assert.deepEqual(truth, {
    accent: "#0B5CAB",
    source: "accent_decision:site_chrome",
    decided_at: "2026-08-20T00:00:00.000Z",
    secondary_accent: "#C53F34",
  });
});

test("without an arbitration record the origin string is the source, and no secondary is invented", () => {
  const truth = brandTruthFromEvidence({
    checks: { brand: { accent_hex: "#c8102e", accent_origin: "measured_from_logo(png-js, share 0.38)" } },
  }, { decidedAt: "2026-08-20T00:00:00.000Z" });
  assert.deepEqual(truth, {
    accent: "#c8102e",
    source: "measured_from_logo(png-js, share 0.38)",
    decided_at: "2026-08-20T00:00:00.000Z",
  });
});

test("pre-accent_hex evidence still yields the winner's hex from accent_decision", () => {
  // Manifests written before checks.brand.accent_hex existed name the winning
  // hex inside accent_decision — those rows must not be orphaned.
  const siteWin = brandTruthFromEvidence({
    checks: { brand: { accent_decision: { winner: "site_chrome", site: "#0B5CAB", logo: "#C53F34" } } },
  });
  assert.equal(siteWin.accent, "#0B5CAB");
  const logoWin = brandTruthFromEvidence({
    checks: { brand: { accent_decision: { winner: "logo", site: "#EEEEEE", logo: "#C53F34" } } },
  });
  assert.equal(logoWin.accent, "#C53F34");
});

test("decided_at is stamped even when the caller supplies none", () => {
  const truth = brandTruthFromEvidence({ checks: { brand: { accent_hex: "#123456" } } });
  assert.ok(!Number.isNaN(Date.parse(truth.decided_at)), `not a timestamp: ${truth.decided_at}`);
});

// ---------------------------------------------------------------------------
// 2. THE SINGLE READER PREFERS THE SHIPPED TRUTH
// ---------------------------------------------------------------------------

const CONTRACT_RECORD = () => ({
  build_ready: {
    mirror_request: {
      brand: {
        logo: "https://client.example.com/logo.png",
        logo_sha256: "a".repeat(64),
        accent: "#C53F34",
        accent_source: "https://client.example.com/logo.png",
      },
    },
    brand_evidence: { logo_url: "https://client.example.com/logo.png", accent: "#C53F34" },
  },
});

test("record.brand_truth outranks the contract's measured accent — the mirror's own colour wins", () => {
  const record = { ...CONTRACT_RECORD(), brand_truth: { accent: "#0B5CAB", source: "accent_decision:site_chrome" } };
  const brand = verifiedBrandOf({ record });
  assert.equal(brand.accent, "#0B5CAB");
  // Only the NUMBER is upgraded: the logo and its verified provenance stand,
  // because a decision label is not a file the denylist can run over.
  assert.equal(brand.logo, "https://client.example.com/logo.png");
  assert.equal(brand.accent_source, "https://client.example.com/logo.png");
});

test("record.brand_truth outranks the flat brand_color on a contract-less row", () => {
  const record = { brand_color: "#4169E1", brand_truth: { accent: "#0B5CAB" } };
  assert.equal(verifiedBrandOf({ record }).accent, "#0B5CAB");
});

test("a junk brand_truth is ignored and the verified contract accent stands", () => {
  const record = { ...CONTRACT_RECORD(), brand_truth: { accent: "tomato" } };
  assert.equal(verifiedBrandOf({ record }).accent, "#C53F34");
  const absent = CONTRACT_RECORD();
  assert.equal(verifiedBrandOf({ record: absent }).accent, "#C53F34");
});

test("the legacy flat fallback is unchanged when no truth and no contract exist", () => {
  // The pinned behavior from test/mined-brand-reaches-build.test.js, restated
  // here because this weld reordered the reads around it.
  assert.equal(verifiedBrandOf({ record: { brand_color: "#123456" } }).accent, "#123456");
});

// ---------------------------------------------------------------------------
// 3. THE V2 ADAPTER READS THROUGH THE SAME SINGLE READER
// ---------------------------------------------------------------------------

const { toProspectEmailData } = require("../lib/email/adapt-email-v2.cjs");

test("adapt-email-v2 wears mirror_request.brand.accent ahead of brand_evidence — the canonical order", () => {
  // The two contract blocks disagree; verifiedBrandOf's order (request first)
  // must decide, exactly as it does for the legacy composer. Divergence 2.
  const data = toProspectEmailData({
    business_name: "Split Contract Roofing",
    build_ready: {
      mirror_request: { brand: { logo: "https://client.example.com/logo.png", accent: "#C53F34" } },
      brand_evidence: { logo_url: "https://client.example.com/logo.png", accent: "#E67E22" },
    },
  });
  assert.equal(data.business.accentColor, "#C53F34");
});

test("adapt-email-v2 wears the shipped brand_truth ahead of every stored measurement", () => {
  const data = toProspectEmailData({
    business_name: "Family Heating",
    brand_truth: { accent: "#0B5CAB", source: "accent_decision:site_chrome" },
    build_ready: {
      mirror_request: { brand: { logo: "https://client.example.com/logo.png", accent: "#C53F34" } },
      brand_evidence: { logo_url: "https://client.example.com/logo.png", accent: "#C53F34" },
    },
  });
  assert.equal(data.business.accentColor, "#0B5CAB");
});

test("adapt-email-v2 keeps its brand_evidence last resort for a contract with an accent but no logo", () => {
  // verifiedBrandOf's contract loop skips a contract that names no logo; the
  // adapter's direct read survives ONLY for that hole.
  const data = toProspectEmailData({
    business_name: "Logoless Plumbing",
    build_ready: { brand_evidence: { accent: "#D44520" } },
  });
  assert.equal(data.business.accentColor, "#D44520");
});

// ---------------------------------------------------------------------------
// 4. THE LINE LANE'S RECORD PATCH MAKES THE TRUTH DURABLE
// ---------------------------------------------------------------------------

const { mirrorRecordPatch } = require("../lib/line-adapters");

const LINE_EVIDENCE = (brand) => ({
  renderer: "mirror-engine@v1",
  qc_contract: "mirror-qc@v1",
  evidence_schema: "mirror-release-evidence@v1",
  evidence_sha: "e".repeat(64),
  build_hash: "f".repeat(64),
  content_source: "verified",
  generation_fingerprint: `mirror-engine:${"f".repeat(64)}`,
  release_evidence: { build_hash: "f".repeat(64), checks: brand ? { brand } : {} },
});

test("a passing gate stamps record.brand_truth from the build's own evidence", () => {
  const { record } = mirrorRecordPatch(
    { record: { business_name: "Texas Best Fence" } },
    "https://wss-test-texas-best-fence.wss-ai.com/",
    {},
    LINE_EVIDENCE({
      accent_hex: "#0B5CAB",
      accent_decision: { winner: "site_chrome", site: "#0B5CAB", logo: "#C53F34" },
      secondary_accent: "#C53F34",
    }),
  );
  assert.equal(record.brand_truth.accent, "#0B5CAB");
  assert.equal(record.brand_truth.source, "accent_decision:site_chrome");
  assert.equal(record.brand_truth.secondary_accent, "#C53F34");
  assert.ok(record.brand_truth.decided_at, "the decision is dated");
});

test("evidence with no shipped hex keeps the truth an earlier build persisted", () => {
  const prior = { accent: "#0B5CAB", source: "accent_decision:site_chrome", decided_at: "2026-08-19T00:00:00.000Z" };
  const { record } = mirrorRecordPatch(
    { record: { business_name: "Texas Best Fence", brand_truth: prior } },
    "https://wss-test-texas-best-fence.wss-ai.com/",
    {},
    LINE_EVIDENCE(null),
  );
  assert.deepEqual(record.brand_truth, prior, "an evidence-less rebuild must not erase the shipped truth");
});
