"use strict";

// test/donor-fingerprint.test.js — THE CLIENT'S VISUAL DNA, MEASURED AND DEFENDED.
//
// The owner's video review (2026-09, the Atlanta / Jeff Sullivan audit): WSS
// renders were converging — same hero composition, same red CTA treatment,
// same light-page system — while the client's own strong identity (blue/orange,
// a real logo, named specialties) was being flattened into the template. This
// file pins the two halves of lib/mirror-engine/donor-fingerprint.js:
//
//   1. EXTRACTION — the Hurricane Fence fixtures are the named case (they are
//      the #641 diagnostic: a WordPress site whose red #e31e24, real WebP logo
//      and named fence specialties all live in plain HTML).
//   2. SCORING — a faithful render scores high and certifies; a render that is
//      "the same template with the names swapped" falls below the floor,
//      refuses certification and asks for closer donor-fidelity mode.
//
// Plus the engine integration: the score rides the build report, never gates
// publication, and never moves the build hash (instrumentation first — the
// owner's explicit scope for this change).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "fixtures");
// GATE 4C: fixture clients must never be stamped into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-df-"));

const { extractBrandIdentity } = require("../lib/brand-extractor");
const fp = require("../lib/mirror-engine/donor-fingerprint");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const { mirror, REQUIRED_TRUTH_CHECKS } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const leadMiner = require("../lib/lead-miner");

const DISTILLED = fs.readFileSync(path.join(__dirname, "fixtures", "hurricane-fence-distilled.html"), "utf8");
const FULL = fs.readFileSync(path.join(__dirname, "fixtures", "hurricane-fence.html"), "utf8");
const SITE_URL = "https://www.hurricanefenceinc.com/";
const LOGO_URL = "https://www.hurricanefenceinc.com/wp-content/uploads/2026/05/screenshot.webp";

async function hurricaneFingerprint(html = DISTILLED) {
  const brandIdentity = await extractBrandIdentity({ html, baseUrl: SITE_URL });
  return fp.extractDonorFingerprint({ html, baseUrl: SITE_URL, brandIdentity });
}

// ===========================================================================
// EXTRACTION — the Hurricane Fence fixtures
// ===========================================================================

test("extraction: the logo candidate carries URL, dimensions and alt text", async () => {
  const f = await hurricaneFingerprint();
  assert.ok(f.logo_candidates.length >= 1, "the custom-logo <img> is a candidate");
  const logo = f.logo_candidates[0];
  assert.equal(logo.url, LOGO_URL);
  assert.equal(logo.width, 358);
  assert.equal(logo.height, 81);
  assert.match(logo.alt, /Hurricane Fence Company logo/, "alt text rides along for the render-time decision");
  assert.equal(logo.grade, "logo_class");
});

test("extraction: the palette is CONSUMED from brand-extractor, not re-derived", async () => {
  const f = await hurricaneFingerprint();
  assert.equal(f.palette.accent_color, "#E31E24", "the red the site declares");
  assert.equal(f.palette.background, "#FFFFFF");
  assert.equal(f.palette.mode, "light");
  assert.equal(f.palette.confidence, "MEDIUM");
});

test("extraction: hero motif — the distilled page is text-minimal, the full page is photo-led", async () => {
  const distilled = await hurricaneFingerprint(DISTILLED);
  assert.equal(distilled.hero_motif, "text-minimal");
  const full = await hurricaneFingerprint(FULL);
  assert.equal(full.hero_motif, "photo-led");
});

test("extraction: section ordering records the nav labels and the H1/H2 sequence", async () => {
  const f = await hurricaneFingerprint();
  assert.deepEqual(f.section_ordering.nav_labels, ["Residential", "Commercial", "Contact"]);
  assert.deepEqual(
    f.section_ordering.heading_sequence.map((h) => `${h.level}:${h.text}`),
    [
      "1:Quality Fences Since 1994",
      "2:Our Fencing Services",
      "2:Why Richmond Chooses Hurricane Fence",
    ],
  );
});

test("extraction: THE SERVICE NAMES SURVIVE — no collapsing into a generic umbrella", async () => {
  const f = await hurricaneFingerprint();
  const names = f.service_taxonomy.services.map((s) => s.name.toLowerCase());
  // The exact phrase list from the services section, as the client spells it.
  for (const named of ["wood privacy fences", "aluminum ornamental fencing", "chain link", "vinyl"]) {
    assert.ok(names.includes(named), `${named} must be its own service, not folded into a generic label`);
  }
  assert.ok(!names.includes("fencing services"), "the section heading is not a service");
  assert.ok(!names.includes("our fencing services"), "the H2 is not a service");
});

test("extraction: the full capture's named specialties and condensed headings", async () => {
  const f = await hurricaneFingerprint(FULL);
  const names = f.service_taxonomy.services.map((s) => s.name);
  for (const named of ["Aluminum Fence", "Vinyl Fence", "Chain-Link Fence", "Composite Fence", "Automatic Gates"]) {
    assert.ok(names.includes(named), `${named} harvested from the real page`);
  }
  assert.equal(f.service_taxonomy.naming_pattern, "named_specialties");
  // font-weight:1000, letter-spacing:-3px, uppercase on the h1 — a condensed voice.
  assert.equal(f.typography.heading_weight_pattern, "condensed");
  assert.ok(f.typography.heading_scale >= 3, `heading scale measured (${f.typography.heading_scale})`);
});

test("extraction: proof inventory — JSON-LD rating on the full page, honest absence on the distilled", async () => {
  const full = await hurricaneFingerprint(FULL);
  assert.equal(full.proof_inventory.reviews.displayed, true);
  assert.equal(full.proof_inventory.reviews.rating, 4.8);
  assert.equal(full.proof_inventory.reviews.count, 605);
  assert.equal(full.proof_inventory.reviews.source, "jsonld_aggregate_rating");
  assert.ok(full.proof_inventory.project_photos >= 10, "content photos counted");
  assert.ok(full.proof_inventory.certifications.includes("licensed"));
  assert.ok(full.proof_inventory.certifications.includes("bonded"));
  assert.equal(full.proof_inventory.years_in_business.since, 1994);

  const distilled = await hurricaneFingerprint(DISTILLED);
  assert.equal(distilled.proof_inventory.reviews.displayed, false, "the distilled page displays no rating — absence is a real answer");
  assert.equal(distilled.proof_inventory.years_in_business.since, 1994);
});

test("extraction: CTA structure — quote-dominant distilled, phone-dominant on the real page", async () => {
  const distilled = await hurricaneFingerprint(DISTILLED);
  assert.equal(distilled.cta_structure.dominant, "quote-dominant", "'Get a Free Estimate' with no tel: link and no form");
  const full = await hurricaneFingerprint(FULL);
  assert.equal(full.cta_structure.dominant, "phone-dominant", "the real page carries nine tel: links");
});

// ===========================================================================
// LOGO DETECTION — the candidate ladder
// ===========================================================================

test("logo detection: schema.org logo declarations are candidates, ranked by grade", () => {
  const html = [
    "<script type=\"application/ld+json\">",
    JSON.stringify({ "@type": "LocalBusiness", name: "Metro Concrete", logo: { "@type": "ImageObject", url: "https://metroconcrete.example.com/logo.png" } }),
    "</script>",
    "<header><img src=\"https://metroconcrete.example.com/logo.png\" class=\"site-logo\" alt=\"Metro Concrete logo\"></header>",
  ].join("");
  const candidates = fp.logoCandidates(html, "https://metroconcrete.example.com/");
  assert.equal(candidates[0].grade, "logo_class");
  assert.ok(candidates.some((c) => c.url === "https://metroconcrete.example.com/logo.png"));
  // The schema-only shape (no <img>) still yields the declared mark.
  const schemaOnly = fp.schemaLogoUrls(html);
  assert.deepEqual(schemaOnly, ["https://metroconcrete.example.com/logo.png"]);
});

test("logo detection: tracking pixels, data: URIs and non-https srcs are never candidates", () => {
  const html = [
    "<header>",
    "<img width=\"1\" height=\"1\" src=\"https://x.example.com/pixel.gif\" class=\"logo\" alt=\"logo\">",
    "<img src=\"data:image/png;base64,AAAA\" class=\"logo\" alt=\"logo\">",
    "<img src=\"http://insecure.example.com/logo.png\" class=\"logo\" alt=\"logo\">",
    "<img width=\"200\" height=\"60\" src=\"/img/brand.png\" class=\"logo\" alt=\"brand\">",
    "</header>",
  ].join("");
  const candidates = fp.logoCandidates(html, "https://www.example.com/");
  assert.equal(candidates.length, 1, "only the real, https, non-pixel image survives");
  assert.equal(candidates[0].url, "https://www.example.com/img/brand.png");
});

// ===========================================================================
// SCORING — high/low, taxonomy retention, palette proximity, N/A fairness
// ===========================================================================

const FAITHFUL_TEXT = [
  "Hurricane Fence Company — Richmond VA",
  "4.8 stars from 605 reviews",
  "Aluminum Fence Vinyl Fence Wood Fence Chain-Link Fence Composite Fence",
  "Automatic Gates Data Center Fencing Temporary and Event Fencing",
  "family owned, licensed, bonded and insured — since 1994",
].join("\n");

const TEMPLATE_TEXT = [
  "Fencing Services", // the generic umbrella that ate the named specialties
  "Quality Fencing Solutions for Virginia",
  "Call today for a free quote",
].join("\n");

test("score: a faithful render certifies — the client's own logo, colour, names and proof", async () => {
  const f = await hurricaneFingerprint(FULL);
  const verdict = fp.scoreDonorFingerprint({
    fingerprint: f,
    logo_used: true,
    render_accent: "#E31E24",
    hero_first_party: true,
    built_text: FAITHFUL_TEXT,
    built_reviews_visible: true,
  });
  assert.equal(verdict.status, "passed");
  assert.ok(verdict.score >= 80, `expected >= 80, got ${verdict.score}`);
  assert.equal(verdict.certified, true);
  assert.equal(verdict.components.palette_proximity.delta_e, 0, "the client's own accent is distance zero");
  assert.ok(verdict.components.taxonomy_retention.retained_full >= 5, "the named specialties appear by name");
});

test("score: the same template with names swapped falls below the floor and refuses certification", async () => {
  const f = await hurricaneFingerprint(FULL);
  const verdict = fp.scoreDonorFingerprint({
    fingerprint: f,
    logo_used: false,           // a text wordmark, not the client's mark
    render_accent: "#E8A530",   // the donor template's gold, not the client's red
    hero_first_party: false,    // generic stock hero
    built_text: TEMPLATE_TEXT,  // "Fencing Services" ate every named specialty
    built_reviews_visible: false,
  });
  assert.equal(verdict.status, "below_floor");
  assert.ok(verdict.score < fp.DONOR_FINGERPRINT_FLOOR, `expected < ${fp.DONOR_FINGERPRINT_FLOOR}, got ${verdict.score}`);
  assert.equal(verdict.certified, false);
  assert.equal(verdict.recommended_mode, "closer_donor_fidelity");
  assert.match(verdict.warning, /same template with the names swapped/);
  // Every component tells its part of the story.
  assert.equal(verdict.components.logo_used.score, 0);
  assert.equal(verdict.components.palette_proximity.score, 0, "gold is a stranger to red");
  assert.ok(verdict.components.palette_proximity.delta_e >= 60);
  assert.equal(verdict.components.taxonomy_retention.retained_full, 0, "'Fencing Services' matches no named service");
  assert.equal(verdict.components.proof_retention.elements.reviews.kept, false);
});

test("taxonomy retention: named specialties by name — the collapse is the failure", () => {
  // The concrete case from the owner's review: three named services must not
  // be satisfied by one generic label.
  const fingerprint = {
    version: 1,
    logo_candidates: [],
    palette: {},
    service_taxonomy: {
      naming_pattern: "named_specialties",
      services: [
        { name: "Stamped Concrete", source: "heading" },
        { name: "Concrete Driveways", source: "heading" },
        { name: "Concrete Patios", source: "heading" },
      ],
    },
    proof_inventory: {},
  };
  const generic = fp.scoreDonorFingerprint({ fingerprint, built_text: "Concrete Services — we do it all. Free quotes." });
  assert.equal(generic.status, "below_floor");
  assert.equal(generic.components.taxonomy_retention.retained_full, 0);
  assert.equal(generic.components.taxonomy_retention.retained_partial, 0, "an umbrella label is not a partial match");

  const named = fp.scoreDonorFingerprint({
    fingerprint,
    built_text: "Stamped Concrete, Concrete Driveways and Concrete Patios by Metro Concrete",
  });
  assert.equal(named.components.taxonomy_retention.ratio, 1, "all three by name");
  assert.equal(named.score, 100, "with logo/palette/hero/proof not applicable, taxonomy alone certifies");
});

test("taxonomy retention: partial credit when most content words survive", () => {
  const verdict = fp.phraseScoreInText("We install stamped concrete patios and walkways", "Stamped Concrete Patios");
  assert.equal(verdict, "full", "phrase present by name");
  assert.equal(fp.phraseScoreInText("stamped concrete overlays", "Stamped Concrete Patios"), "partial", "2 of 3 content words");
  assert.equal(fp.phraseScoreInText("kitchen remodeling", "Stamped Concrete Patios"), "absent");
});

test("palette proximity: perceptual distance bands, not byte equality", () => {
  const sameFamily = fp.paletteProximityScore("#E31E24", "#D6202A");
  assert.equal(sameFamily.score, 1, "a contrast-nudged accent is still the client's colour");
  const stranger = fp.paletteProximityScore("#E31E24", "#0C449A");
  assert.equal(stranger.score, 0, "red vs blue");
  const mid = fp.paletteProximityScore("#E31E24", "#B03030");
  assert.ok(mid.score > 0 && mid.score < 1, `the falloff is graded (${mid.score} at delta-E ${mid.delta_e})`);
  assert.equal(fp.paletteProximityScore("#E31E24", "").score, 0, "no shipped accent is a zero, not a pass");
});

test("score: absent donor signals are not applicable — wealth is not fidelity", () => {
  const plain = fp.scoreDonorFingerprint({
    fingerprint: {
      version: 1,
      logo_candidates: [], // no logo published
      palette: {},          // no measurable accent
      service_taxonomy: { naming_pattern: "named_specialties", services: [{ name: "Handyman Services", source: "nav" }] },
      proof_inventory: {},  // no reviews, no certs, no years claim
      hero_motif: "text-minimal",
    },
    logo_used: false,
    render_accent: "",
    built_text: "Handyman Services",
  });
  assert.deepEqual(plain.weights_applied, { taxonomy_retention: 25 }, "only the applicable weight counts");
  assert.equal(plain.score, 100, "a plain client whose one service is named scores full fidelity");

  const sparse = fp.scoreDonorFingerprint({ fingerprint: { version: 1, palette: {}, proof_inventory: {} } });
  assert.equal(sparse.status, "not_applicable");
  assert.equal(sparse.score, null);
});

// ===========================================================================
// TRANSPORT — schema floor + engine-side tolerance
// ===========================================================================

test("transport: the fingerprint clears the mirror-request schema", async () => {
  const f = await hurricaneFingerprint(FULL);
  const carried = fp.fingerprintForRequest({ ...f, prospect_id: "hurricane-fence-richmond" });
  const verdict = checkMirrorRequest({
    slug: "hurricane-fence-richmond",
    donor: "fencing-sterling",
    facts: { business_name: "Hurricane Fence", industry: "fencing", city: "Richmond", state: "VA" },
    donor_fingerprint: carried,
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.body || {}).slice(0, 600));
  assert.equal(carried.prospect_id, "hurricane-fence-richmond");
});

test("transport: junk normalizes to null, malformed fields drop field-by-field", () => {
  assert.equal(fp.normalizeDonorFingerprint(null), null);
  assert.equal(fp.normalizeDonorFingerprint({ logo_candidates: [{ url: "http://not-https.example.com/x.png" }], palette: { accent_color: "red" } }), null);
  const cleaned = fp.normalizeDonorFingerprint({
    logo_candidates: [{ url: "https://ok.example.com/a.png", width: 120, height: 40, alt: "A", grade: "logo_class" }, { url: "javascript:alert(1)" }],
    palette: { accent_color: "#e31e24", mode: "light", confidence: "HIGH" },
    hero_motif: "nonsense", // an unknown enum degrades to "unknown", never a 400
  });
  assert.equal(cleaned.hero_motif, "unknown");
  assert.equal(cleaned.logo_candidates.length, 1);
  assert.equal(cleaned.palette.accent_color, "#E31E24");
});

test("miner seam: donor fingerprint extraction is default-on and kill-switchable", () => {
  assert.equal(leadMiner.donorFingerprintEnabled({}), true);
  assert.equal(leadMiner.donorFingerprintEnabled({ GHOST_AGENCY_DONOR_FINGERPRINT: "1" }), true);
  assert.equal(leadMiner.donorFingerprintEnabled({ GHOST_AGENCY_DONOR_FINGERPRINT: "0" }), false);
});

// ===========================================================================
// ENGINE INTEGRATION — the score rides the report, never the gate, never the hash
// ===========================================================================

function baseRequest() {
  return {
    slug: "wss-test-hurricane-fence-fp",
    donor: "mirror-donor",
    facts: {
      business_name: "Hurricane Fence",
      industry: "fencing",
      city: "Richmond",
      state: "VA",
      phone: "(804) 555-0142",
    },
  };
}

test("engine: the dry-run manifest carries donor_fingerprint_score and the check evidence", async () => {
  const request = baseRequest();
  request.donor_fingerprint = fp.fingerprintForRequest({
    version: 1,
    logo_candidates: [{ url: LOGO_URL, width: 358, height: 81, alt: "Hurricane Fence logo", grade: "logo_class" }],
    palette: { accent_color: "#E31E24", secondary_color: "", background: "#FFFFFF", mode: "light", confidence: "MEDIUM" },
    hero_motif: "text-minimal",
    service_taxonomy: { naming_pattern: "named_specialties", services: [{ name: "Fencing", source: "nav" }] },
    proof_inventory: { reviews: { displayed: false, rating: null, count: null, source: "none" }, project_photos: 0, certifications: [], years_in_business: { displayed: false, claim: "", since: null } },
    cta_structure: { dominant: "quote-dominant", signals: { tel_links: 0, forms: 0, quote_ctas: 1 } },
  });
  const res = await mirror(request, { dryRun: true, registry: createRegistry() });
  assert.equal(res.status, 200, JSON.stringify(res.body || {}).slice(0, 400));
  assert.equal(typeof res.body.donor_fingerprint_score, "number", "the score is visible in the build report");
  const check = res.body.checks.donor_fingerprint;
  assert.ok(check, "checks.donor_fingerprint carries the audit evidence");
  assert.equal(check.floor, fp.DONOR_FINGERPRINT_FLOOR);
  assert.ok(["passed", "below_floor"].includes(check.status));
  assert.deepEqual(check.components.taxonomy_retention.matches, [{ name: "Fencing", match: "full" }]);
  // revealable stays governed by the truth checks alone.
  assert.equal(res.body.revealable, false, "a dry run is never revealable, fingerprint or not");
});

test("engine: carrying a fingerprint NEVER moves the build hash (instrumentation only)", async () => {
  const withFp = baseRequest();
  withFp.donor_fingerprint = fp.fingerprintForRequest({
    version: 1,
    logo_candidates: [{ url: LOGO_URL, width: 358, height: 81, alt: "x", grade: "logo_class" }],
    palette: { accent_color: "#E31E24", mode: "light", confidence: "MEDIUM" },
    hero_motif: "photo-led",
    service_taxonomy: { naming_pattern: "named_specialties", services: [{ name: "Wood Fence", source: "heading" }] },
    proof_inventory: { reviews: { displayed: true, rating: 4.8, count: 605, source: "jsonld_aggregate_rating" }, project_photos: 5, certifications: ["licensed"], years_in_business: { displayed: true, claim: "Since 1994", since: 1994 } },
    cta_structure: { dominant: "phone-dominant", signals: { tel_links: 9, forms: 0, quote_ctas: 5 } },
  });
  // Separate registries: identical bytes would otherwise memo-replay.
  const plain = await mirror(baseRequest(), { dryRun: true, registry: createRegistry() });
  const scored = await mirror(JSON.parse(JSON.stringify(withFp)), { dryRun: true, registry: createRegistry() });
  assert.equal(plain.status, 200);
  assert.equal(scored.status, 200);
  assert.equal(scored.body.build_hash, plain.body.build_hash, "the fingerprint changes no output byte and no hash");
  assert.equal(typeof scored.body.donor_fingerprint_score, "number");
  assert.equal(plain.body.donor_fingerprint_score, null, "no fingerprint, honestly null — not a zero");
});

test("engine: a below-floor build warns at the release gate and flies a polish flag — never a block", async () => {
  const calls = [];
  const captured = {};
  const deps = {
    ensureProject: async () => "prj_stub_df",
    resolveAliasDeployment: async () => ({ found: false, reason: "alias_not_found" }),
    uploadFiles: async (files) => ({ manifest: Object.keys(files).map((f) => ({ file: f })), uploaded: 1, deduped: Object.keys(files).length - 1 }),
    createDeployment: async () => ({ id: "dpl_stub_df", url: "stub.vercel.app", readyState: "QUEUED" }),
    waitReady: async () => ({ readyState: "READY" }),
    byteDiff: async () => ({ clean: true, checked: 1, mismatches: [] }),
    deepLinkCheck: async () => ({ clean: true, failures: [] }),
    attachAlias: async ({ slug }) => ({ alias: `https://${slug}.wss-ai.com` }),
    aliasTargetCheck: async ({ deployId }) => ({ clean: true, deploymentId: deployId }),
    renderCheck: async () => ({ status: "passed", problems: [], video: { present: true, readyState: 4, paused: false } }),
    renderAudit: async () => ({ status: "passed", problems: [], pages: [{ path: "/", h1: "Hurricane Fence" }], collisions: [], missing_hash_targets: [], prose: [] }),
    withSpaRewrite: (files) => { captured.files = files; return files; },
  };
  const request = baseRequest();
  request.donor_fingerprint = fp.fingerprintForRequest({
    version: 1,
    // Everything the client had, and the template build will lose.
    logo_candidates: [{ url: LOGO_URL, width: 358, height: 81, alt: "Hurricane Fence logo", grade: "logo_class" }],
    palette: { accent_color: "#E31E24", mode: "light", confidence: "MEDIUM" },
    hero_motif: "photo-led",
    service_taxonomy: { naming_pattern: "named_specialties", services: [{ name: "Wood privacy fences", source: "prose_list" }, { name: "Aluminum ornamental fencing", source: "prose_list" }, { name: "Chain link", source: "prose_list" }, { name: "Vinyl", source: "prose_list" }] },
    proof_inventory: { reviews: { displayed: true, rating: 4.8, count: 605, source: "jsonld_aggregate_rating" }, project_photos: 3, certifications: ["licensed", "insured"], years_in_business: { displayed: true, claim: "Since 1994", since: 1994 } },
    cta_structure: { dominant: "quote-dominant", signals: { tel_links: 0, forms: 0, quote_ctas: 1 } },
  });

  const realWarn = console.warn;
  console.warn = (line) => { calls.push(line); };
  let res;
  try {
    res = await mirror(request, { registry: createRegistry(), deps });
  } finally {
    console.warn = realWarn;
  }
  assert.equal(res.status, 200, JSON.stringify(res.body || {}).slice(0, 400));
  assert.ok(res.body.donor_fingerprint_score < fp.DONOR_FINGERPRINT_FLOOR, `expected a below-floor score, got ${res.body.donor_fingerprint_score}`);
  assert.equal(res.body.checks.donor_fingerprint.status, "below_floor");
  assert.equal(res.body.checks.donor_fingerprint.recommended_mode, "closer_donor_fidelity");
  // The polish flag an operator reads in the build audit.
  const flag = (res.body.polish_flags || []).find((f) => f.name === "donor_fingerprint_below_floor");
  assert.ok(flag, `polish flags: ${JSON.stringify(res.body.polish_flags)}`);
  assert.equal(flag.status, "below_floor");
  // The release-gate warning, as one structured log line.
  const warned = calls.map((c) => String(c)).find((c) => c.includes("donor_fingerprint_below_floor"));
  assert.ok(warned, "the release gate logged the warning");
  const parsed = JSON.parse(warned);
  assert.equal(parsed.slug, request.slug);
  assert.equal(parsed.floor, fp.DONOR_FINGERPRINT_FLOOR);
  assert.equal(parsed.recommended_mode, "closer_donor_fidelity");
  // INSTRUMENTATION FIRST: the build still published — revealable is computed
  // from the truth checks, and donor_fingerprint is not one of them.
  assert.ok(!REQUIRED_TRUTH_CHECKS.includes("donor_fingerprint"), "the score can never gate a build");
  assert.ok(res.body.preview_url || res.body.deploy_url, "the below-floor build still published");
});

test("engine: no fingerprint on the request — the check says skipped, the build is unchanged", async () => {
  const res = await mirror(baseRequest(), { dryRun: true, registry: createRegistry() });
  assert.equal(res.status, 200);
  assert.equal(res.body.donor_fingerprint_score, null);
  assert.equal(res.body.checks.donor_fingerprint.status, "skipped");
  assert.match(res.body.checks.donor_fingerprint.reason, /no_donor_fingerprint_on_request/);
  assert.deepEqual((res.body.polish_flags || []).filter((f) => f.name.startsWith("donor_fingerprint")), []);
});
