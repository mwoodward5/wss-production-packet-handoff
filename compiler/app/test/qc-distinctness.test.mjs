import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  auditBatchDistinctness,
  checkBrandPaletteUse,
  checkDesignSignatureIntegrity,
  checkGeoIntegrity,
  checkGradeAReadiness,
  checkMediaDepth,
  runQualityAudit,
} from "../../qc-audit/qc.mjs";
import {
  isPublishableQc,
  PROJECT_PRECERTIFICATION_POLICY,
} from "../lib/engine-adapter.mjs";

function imageMarkup(prefix, count = 6, provenance = "business-site", aiLabel = "") {
  return Array.from({ length: count }, (_, index) => {
    const label = aiLabel ? ` data-ai-label="${aiLabel}"` : "";
    return `<figure><img src="https://media.example/${prefix}-${index + 1}.jpg" data-media-provenance="${provenance}"${label} alt="Project ${index + 1}"></figure>`;
  }).join("");
}

function fixtureSectionOrder(value) {
  return String(value || "").split(">").map((entry) => {
    const token = entry.trim().toLowerCase();
    if (["location", "area", "service-map"].includes(token)) return "map";
    return token;
  }).filter(Boolean);
}

function fixtureDesign({
  accent,
  accent2,
  display,
  body,
  order,
}) {
  const palette = {
    background: "#111418",
    surface: "#23282d",
    ink: "#fffaf1",
    muted: "#b7b9ba",
    accent,
    accent2,
  };
  const neutralTemperature = "slate";
  const paletteHash = crypto.createHash("sha256")
    .update([...Object.values(palette), neutralTemperature].join("|"))
    .digest("hex")
    .slice(0, 16);
  const fontPairId = `${display}-${body}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const sectionOrder = fixtureSectionOrder(order);
  const designId = `ds1-${crypto.createHash("sha256")
    .update([paletteHash, fontPairId, sectionOrder.join("|")].join("::"))
    .digest("hex")
    .slice(0, 20)}`;
  return {
    id: designId,
    paletteHash,
    fontPairId,
    sectionOrder,
    resolved: {
      design_signature: {
        id: designId,
        palette_hash: paletteHash,
        font_pair: fontPairId,
        section_order: sectionOrder,
      },
      palette_signature: paletteHash,
      brand_colors: [accent, accent2],
      palette,
      neutral_temperature: neutralTemperature,
      font_pair: `${display} / ${body}`,
      font_pair_id: fontPairId,
      section_order: sectionOrder,
    },
  };
}

function siteHtml({
  slug,
  accent = "#c44820",
  accent2 = "#195d67",
  display = "Fraunces",
  body = "Manrope",
  order = "hero>services>proof>gallery>location>cta",
  radius = 8,
  images = imageMarkup(slug),
  map = true,
  geo = true,
  usesBrand = true,
  actualOrder = order,
  headerMedia = "",
  design = fixtureDesign({ accent, accent2, display, body, order }),
}) {
  const schema = geo
    ? `{"@context":"https://schema.org","@type":"LocalBusiness","name":"${slug}","geo":{"@type":"GeoCoordinates","latitude":33.05,"longitude":-96.75}}`
    : `{"@context":"https://schema.org","@type":"LocalBusiness","name":"${slug}"}`;
  const mapHtml = map
    ? '<section class="geo-map" data-lat="33.05" data-lng="-96.75"><iframe src="https://www.google.com/maps?q=33.05,-96.75&output=embed"></iframe></section>'
    : "";
  const sectionMarkup = {
    services: '<section class="services"><article class="service-card">Service</article></section>',
    proof: '<section class="proof"><article class="review-card">Verified proof</article></section>',
    gallery: `<section class="gallery">${images}</section>`,
    map: mapHtml,
    process: '<section class="process"><ol><li>Step</li></ol></section>',
    faq: '<section class="faq"><details><summary>Question</summary><p>Answer</p></details></section>',
    cta: '<section class="cta"><a class="btn" href="#quote">Start</a></section>',
    "trust-strip": '<section class="trust-strip">Trust</section>',
    founder: '<section class="founder">Founder</section>',
  };
  const sections = fixtureSectionOrder(actualOrder).map((role) => sectionMarkup[role] || "").join("");
  return `<!doctype html><html><head><style>
    :root{--bg:#111418;--ink:#fffaf1;--panel:#23282d;--muted:#b7b9ba;--accent:${accent};--accent2:${accent2};--display:"${display}",serif;--body:"${body}",sans-serif}
    .btn{display:inline-flex;padding:${radius}px ${radius + 8}px;border-radius:${radius}px;text-transform:uppercase;${usesBrand ? "background:var(--accent);color:var(--ink)" : ""}}
    .service-card{display:grid;gap:${radius}px;padding:${radius + 4}px;border-radius:${radius + 2}px;${usesBrand ? "border-color:var(--accent2)" : ""}}
  </style><script type="application/ld+json">${schema}</script></head>
  <body data-design-signature="${design.id}" data-palette-signature="${design.paletteHash}" data-font-pair="${design.fontPairId}">
    ${headerMedia}
    <section class="hero hero-grid-${radius}" data-rendered-layout="layout-${radius}"><a class="btn" href="#quote">Start</a></section>
    <main data-section-sequence="${order.replaceAll(">", "|")}">${sections}</main>
  </body></html>`;
}

function createSite(batchDir, options = {}) {
  const slug = options.slug || "site";
  const dir = path.join(batchDir, slug);
  mkdirSync(dir, { recursive: true });
  const brandColors = options.brandColors || [options.accent || "#c44820", options.accent2 || "#195d67"];
  const design = fixtureDesign({
    accent: options.accent || "#c44820",
    accent2: options.accent2 || "#195d67",
    display: options.display || "Fraunces",
    body: options.body || "Manrope",
    order: options.order || "hero>services>proof>gallery>location>cta",
  });
  const packet = {
    slug,
    business: options.coords === false
      ? { name: slug, category: options.trade || "roofing" }
      : { name: slug, category: options.trade || "roofing", lat: 33.05, lng: -96.75 },
    source: { brandColors },
    media: { catalog: options.mediaCatalog || [] },
    visual_system: { resolved: { ...design.resolved, brand_colors: brandColors } },
  };
  if (options.batchId) packet.batch_id = options.batchId;
  if (options.releaseId) packet.release_id = options.releaseId;
  if (options.includeCanonicalTruth !== false) {
    packet.canonical_truth = { primary_vertical: options.trade || "roofing" };
  }
  writeFileSync(path.join(dir, "index.html"), siteHtml({ ...options, slug, design }));
  writeFileSync(path.join(dir, "packet.json"), JSON.stringify(packet));
  writeFileSync(path.join(dir, "brand.json"), JSON.stringify({ name: slug, colors: brandColors }));
  return dir;
}

function tempBatch() {
  return mkdtempSync(path.join(tmpdir(), "siteforge-qc-distinct-"));
}

function readinessOnlyPreCert(quality) {
  return {
    grade: "B",
    degraded: false,
    results: quality.results.map((item) => item.name === "grade-a-readiness"
      ? { ...item, pass: false, deferred: false }
      : { ...item, pass: true, deferred: false }),
  };
}

test("three rendered designs produce reportable, collision-free design signatures", async () => {
  const batch = tempBatch();
  createSite(batch, {
    slug: "roof-one",
    accent: "#c44820",
    accent2: "#195d67",
    display: "Fraunces",
    body: "Manrope",
    order: "hero>services>proof>gallery>location>cta",
    radius: 6,
  });
  createSite(batch, {
    slug: "roof-two",
    accent: "#80561c",
    accent2: "#254588",
    display: "Bodoni Moda",
    body: "Public Sans",
    order: "hero>proof>services>location>gallery>cta",
    radius: 13,
  });
  createSite(batch, {
    slug: "roof-three",
    accent: "#6d3b86",
    accent2: "#2f6c45",
    display: "Syne",
    body: "Source Sans 3",
    order: "hero>gallery>services>proof>location>cta",
    radius: 21,
  });

  const audit = await auditBatchDistinctness(batch);
  assert.equal(audit.site_count, 3);
  assert.equal(audit.distinct, true, JSON.stringify(audit.results, null, 2));
  assert.equal(audit.signatures.length, 3);
  assert.equal(new Set(audit.signatures.map((item) => item.palette_hash)).size, 3);
  assert.equal(new Set(audit.signatures.map((item) => item.font_pair)).size, 3);
  assert.equal(new Set(audit.signatures.map((item) => item.section_order)).size, 3);
});

test("current-site batch audit includes only the exact release and normalized trade cohort", async () => {
  const batch = tempBatch();
  const current = createSite(batch, {
    slug: "current-roofer",
    batchId: "roofing-release-7",
    trade: "Roofing",
    radius: 5,
  });
  createSite(batch, {
    slug: "matching-roofer-two",
    batchId: "roofing-release-7",
    trade: "roofing",
    radius: 12,
    accent: "#80561c",
    accent2: "#254588",
    display: "Bodoni Moda",
    body: "Public Sans",
    order: "hero>proof>services>gallery>location>cta",
  });
  createSite(batch, {
    slug: "matching-roofer-three",
    batchId: "roofing-release-7",
    trade: "roofing",
    radius: 20,
    accent: "#6d3b86",
    accent2: "#2f6c45",
    display: "Syne",
    body: "Source Sans 3",
    order: "hero>gallery>proof>services>location>cta",
  });
  // These adversarial directories deliberately collide with the current
  // design. If any enters the cohort it will block certification.
  createSite(batch, { slug: "old-no-identity", trade: "roofing", radius: 5 });
  createSite(batch, { slug: "wrong-batch", batchId: "roofing-release-6", trade: "roofing", radius: 5 });
  createSite(batch, { slug: "wrong-trade", batchId: "roofing-release-7", trade: "plumbing", radius: 5 });

  const audit = await auditBatchDistinctness(batch, current);
  assert.equal(audit.site_count, 3);
  assert.equal(audit.distinct, true, JSON.stringify(audit.results, null, 2));
  assert.deepEqual(
    audit.signatures.map((item) => item.slug).sort(),
    ["current-roofer", "matching-roofer-three", "matching-roofer-two"],
  );
  assert.deepEqual(audit.cohort.identity, { kind: "batch", id: "roofing-release-7" });
  assert.equal(audit.cohort.trade, "roofing");
});

test("one- and two-site cohorts stay honest pre-cert instead of failing every dedup check", async () => {
  const batch = tempBatch();
  const isolated = createSite(batch, {
    slug: "isolated-preview",
    trade: "roofing",
    includeCanonicalTruth: true,
  });
  const isolatedAudit = await auditBatchDistinctness(batch, isolated);
  assert.equal(isolatedAudit.site_count, 1);
  assert.equal(isolatedAudit.cohort.identity, null);

  const isolatedQuality = await runQualityAudit(isolated, batch);
  const standaloneV7 = new Map(isolatedQuality.results.map((item) => [item.name, item]));
  assert.equal(standaloneV7.get("media-plane-not-empty")?.pass, false);
  assert.equal(standaloneV7.get("hours-rendered-when-sourced")?.pass, true);
  assert.equal(standaloneV7.get("ai-imagery-labeled")?.pass, true);
  const dedupNames = new Set([
    "layout-signature-dedup",
    "grammar-dedup",
    "palette-dedup",
    "font-pair-dedup",
    "section-order-dedup",
    "image-dedup",
    "design-signatures",
  ]);
  assert.equal(isolatedQuality.results.some((item) => dedupNames.has(item.name)), false);
  assert.equal(isolatedQuality.results.find((item) => item.name === "batch-cohort-eligibility")?.pass, true);
  assert.equal(isolatedQuality.results.find((item) => item.name === "grade-a-readiness")?.pass, false);
  assert.equal(isPublishableQc(
    readinessOnlyPreCert(isolatedQuality),
    { policy: PROJECT_PRECERTIFICATION_POLICY },
  ), true);

  const twoBatch = tempBatch();
  const first = createSite(twoBatch, {
    slug: "release-preview-one",
    releaseId: "preview-release-two",
    trade: "roofing",
    radius: 5,
  });
  createSite(twoBatch, {
    slug: "release-preview-two",
    releaseId: "preview-release-two",
    trade: "roofing",
    radius: 12,
    accent: "#80561c",
    accent2: "#254588",
    display: "Bodoni Moda",
    body: "Public Sans",
    order: "hero>proof>services>gallery>location>cta",
  });
  createSite(twoBatch, {
    slug: "unrelated-history",
    releaseId: "old-release",
    trade: "roofing",
    radius: 5,
  });
  const duplicateVisualPass = {
    name: "visual-public-surface-scrub",
    pass: true,
    detail: "duplicate pass",
  };
  const duplicateVisualFail = {
    name: "visual-public-surface-scrub",
    pass: false,
    detail: "duplicate failure must dominate",
  };
  const twoQuality = await runQualityAudit(first, twoBatch, {
    visualResults: [duplicateVisualPass, duplicateVisualFail],
    v7Results: [],
  });
  const twoQualityReverse = await runQualityAudit(first, twoBatch, {
    visualResults: [duplicateVisualFail, duplicateVisualPass],
    v7Results: [],
  });
  for (const quality of [twoQuality, twoQualityReverse]) {
    const duplicateResults = quality.results.filter(
      (item) => item.name === "visual-public-surface-scrub",
    );
    assert.equal(duplicateResults.length, 1);
    assert.equal(duplicateResults[0].pass, false);
    assert.equal(
      quality.failed.some((item) => item.name === "visual-public-surface-scrub"),
      true,
    );
  }
  assert.equal(twoQuality.results.some((item) => dedupNames.has(item.name)), false);
  assert.match(
    twoQuality.results.find((item) => item.name === "batch-cohort-eligibility")?.detail || "",
    /^2 exact batch\/release \+ trade site/,
  );
  assert.equal(twoQuality.results.find((item) => item.name === "grade-a-readiness")?.pass, false);

  // Normalize unrelated fixture-only checks to passing evidence. The real
  // pre-cert contract must then accept readiness as the sole failure.
  assert.equal(isPublishableQc(
    readinessOnlyPreCert(twoQuality),
    { policy: PROJECT_PRECERTIFICATION_POLICY },
  ), true);
});

test("hard collisions fail every formerly synthetic batch dimension", async () => {
  const batch = tempBatch();
  const shared = {
    accent: "#c44820",
    accent2: "#195d67",
    display: "Fraunces",
    body: "Manrope",
    order: "hero>services>proof>gallery>location>cta",
    radius: 8,
    images: imageMarkup("same"),
  };
  createSite(batch, { ...shared, slug: "copy-one" });
  createSite(batch, { ...shared, slug: "copy-two" });
  createSite(batch, { ...shared, slug: "copy-three" });

  const audit = await auditBatchDistinctness(batch);
  for (const name of [
    "layout-signature-dedup",
    "grammar-dedup",
    "palette-dedup",
    "font-pair-dedup",
    "section-order-dedup",
    "image-dedup",
  ]) {
    const result = audit.results.find((item) => item.name === name);
    assert.equal(result?.pass, false, `${name} unexpectedly passed: ${result?.detail}`);
  }
});

test("media depth needs six real photos and never accepts labeled AI as customer proof", () => {
  const batch = tempBatch();
  const six = createSite(batch, { slug: "six-real" });
  assert.equal(checkMediaDepth(six).pass, true);

  const five = createSite(batch, { slug: "five-real", images: imageMarkup("five", 5) });
  assert.equal(checkMediaDepth(five).pass, false);

  const labeled = createSite(batch, {
    slug: "labeled-ai",
    images: imageMarkup("concept", 1, "ai-generated", "AI-generated concept media"),
  });
  assert.equal(checkMediaDepth(labeled).pass, false);

  const unlabeled = createSite(batch, {
    slug: "unlabeled-ai",
    images: imageMarkup("concept-unlabeled", 1, "ai-generated"),
  });
  const unlabeledResult = checkMediaDepth(unlabeled);
  assert.equal(unlabeledResult.pass, false);
  assert.equal(unlabeledResult.labeled_ai_count, 0);
});

test("media depth requires every verified available source photo when fewer than six exist", () => {
  const batch = tempBatch();
  const catalog = Array.from({ length: 3 }, (_, index) => ({
    kind: "photo",
    url: `https://media.example/limited-${index + 1}.jpg`,
    source: "business-site",
    proof_eligible: true,
    asset_identity: {
      sha256: String(index + 1).padStart(64, "0"),
      method: "content-sha256",
    },
  }));
  const complete = createSite(batch, {
    slug: "limited-complete",
    images: imageMarkup("limited", 3),
    mediaCatalog: catalog,
  });
  const completeResult = checkMediaDepth(complete);
  assert.equal(completeResult.pass, true, completeResult.detail);
  assert.equal(completeResult.verified_available_photo_count, 3);
  assert.equal(completeResult.verified_rendered_photo_count, 3);
  assert.equal(completeResult.target_photo_count, 3);

  const incomplete = createSite(batch, {
    slug: "limited-incomplete",
    images: `${imageMarkup("limited", 2)}${imageMarkup("unverified-extra", 1)}`,
    mediaCatalog: catalog,
    headerMedia: '<header class="hero"><div data-ai-media="true" data-ai-label="AI-generated ambiance — not job proof" data-media-source="ai-ambiance" data-media-role="ambiance" data-proof-eligible="false"><video><source src="https://media.example/limited-ai.mp4" type="video/mp4"></video><span class="media-disclosure">AI-generated ambiance — not job proof</span></div></header>',
  });
  const incompleteResult = checkMediaDepth(incomplete);
  assert.equal(incompleteResult.pass, false, incompleteResult.detail);
  assert.equal(incompleteResult.real_photo_count, 3);
  assert.equal(incompleteResult.verified_rendered_photo_count, 2);
  assert.equal(incompleteResult.labeled_ai_count, 1);
});

test("media depth counts only visible, explicitly disclosed AI header video", () => {
  const batch = tempBatch();
  const source = "https://media.example/ambiance.mp4";
  const owner = ({
    attributes = "",
    mediaAttributes = "",
    disclosure = '<span class="media-disclosure">AI-generated ambiance — not job proof</span>',
    wrapper = "header",
  } = {}) => `<${wrapper} class="hero"><div data-ai-media="true" data-media-source="ai-ambiance" data-media-role="ambiance" data-proof-eligible="false" ${attributes}><video ${mediaAttributes}><source src="${source}" type="video/mp4"></video>${disclosure}</div></${wrapper}>`;
  const labeled = createSite(batch, {
    slug: "labeled-ai-header",
    images: imageMarkup("five-header", 5),
    headerMedia: owner({ attributes: 'data-ai-label="AI-generated ambiance — not job proof"' }),
  });
  const labeledResult = checkMediaDepth(labeled);
  assert.equal(labeledResult.pass, false, labeledResult.detail);
  assert.equal(labeledResult.real_photo_count, 5);
  assert.equal(labeledResult.labeled_ai_count, 1);

  const hidden = createSite(batch, {
    slug: "hidden-ai-header",
    images: imageMarkup("five-hidden", 5),
    headerMedia: owner({ attributes: 'data-ai-label="AI-generated ambiance — not job proof" style="display:none"' }),
  });
  assert.equal(checkMediaDepth(hidden).pass, false);

  const unlabeled = createSite(batch, {
    slug: "unlabeled-ai-header",
    images: imageMarkup("five-unlabeled", 5),
    headerMedia: owner(),
  });
  assert.equal(checkMediaDepth(unlabeled).pass, false);

  const attributeOnly = createSite(batch, {
    slug: "attribute-only-ai-header",
    images: imageMarkup("five-attribute-only", 5),
    headerMedia: owner({
      attributes: 'data-ai-label="AI-generated ambiance — not job proof"',
      disclosure: "",
    }),
  });
  assert.equal(checkMediaDepth(attributeOnly).pass, false);

  const hiddenMedia = createSite(batch, {
    slug: "hidden-media-ai-header",
    images: imageMarkup("five-hidden-media", 5),
    headerMedia: owner({
      attributes: 'data-ai-label="AI-generated ambiance — not job proof"',
      mediaAttributes: 'style="display:none"',
    }),
  });
  assert.equal(checkMediaDepth(hiddenMedia).pass, false);

  const proofPlacement = createSite(batch, {
    slug: "proof-ai-header",
    images: imageMarkup("five-proof", 5),
    headerMedia: `<section class="proof">${owner({ attributes: 'data-ai-label="AI-generated ambiance — not job proof"' })}</section>`,
  });
  assert.equal(checkMediaDepth(proofPlacement).pass, false);

  const compoundGalleryPlacement = createSite(batch, {
    slug: "compound-gallery-ai-header",
    images: imageMarkup("five-compound-gallery", 5),
    headerMedia: `<section class="project-gallery">${owner({ attributes: 'data-ai-label="AI-generated ambiance — not job proof"' })}</section>`,
  });
  assert.equal(checkMediaDepth(compoundGalleryPlacement).pass, false);
});

test("brand gate proves extracted colors drive rendered accent tokens", () => {
  const batch = tempBatch();
  const branded = createSite(batch, {
    slug: "branded",
    accent: "#c44820",
    accent2: "#195d67",
    brandColors: ["#c44820", "#195d67"],
  });
  assert.equal(checkBrandPaletteUse(branded).pass, true);

  const ignored = createSite(batch, {
    slug: "ignored-brand",
    accent: "#c44820",
    accent2: "#195d67",
    brandColors: ["#6d3b86", "#2f6c45"],
  });
  const result = checkBrandPaletteUse(ignored);
  assert.equal(result.pass, false);
  assert.match(result.detail, /extracted brand colors used/);

  const declaredOnly = createSite(batch, {
    slug: "declared-but-unused",
    accent: "#c44820",
    accent2: "#195d67",
    brandColors: ["#c44820", "#195d67"],
    usesBrand: false,
  });
  assert.equal(checkBrandPaletteUse(declaredOnly).pass, false);
});

test("coordinates require both a rendered map and matching GeoCoordinates", () => {
  const batch = tempBatch();
  const mapped = createSite(batch, { slug: "mapped" });
  const mappedResult = checkGeoIntegrity(mapped);
  assert.equal(mappedResult.pass, true, mappedResult.detail);
  assert.equal(mappedResult.mapped, true);

  const noMap = createSite(batch, { slug: "no-map", map: false });
  assert.equal(checkGeoIntegrity(noMap).pass, false);

  const noCoordinates = createSite(batch, { slug: "no-coordinates", coords: false, map: false, geo: false });
  const optional = checkGeoIntegrity(noCoordinates);
  assert.equal(optional.pass, true);
  assert.equal(optional.mapped, false);
});

test("Grade A contract is conjunctive across distinct, branded, mapped, and supplied visual gates", async () => {
  const batch = tempBatch();
  const first = createSite(batch, { slug: "a", radius: 5, display: "Fraunces", body: "Manrope" });
  createSite(batch, {
    slug: "b",
    radius: 12,
    accent: "#80561c",
    accent2: "#254588",
    display: "Bodoni Moda",
    body: "Public Sans",
    order: "hero>proof>services>gallery>location>cta",
  });
  createSite(batch, {
    slug: "c",
    radius: 20,
    accent: "#6d3b86",
    accent2: "#2f6c45",
    display: "Syne",
    body: "Source Sans 3",
    order: "hero>gallery>proof>services>location>cta",
  });
  const batchAudit = await auditBatchDistinctness(batch);
  const brandUse = checkBrandPaletteUse(first);
  const geoIntegrity = checkGeoIntegrity(first);
  const visualResults = [
    { name: "visual-public-surface-scrub", pass: true },
    { name: "visual-no-fake-proof", pass: true },
    { name: "visual-conversion-rail", pass: true },
    { name: "visual-hero-geometry", pass: true },
    { name: "visual-composition-fingerprint-batch", pass: true },
    { name: "visual-rendered-uniqueness-batch", pass: true },
    { name: "visual-hero-anatomy-batch", pass: true },
    { name: "visual-hero-architecture-batch", pass: true },
    { name: "visual-layout-gravity-batch", pass: true },
    { name: "visual-media-behavior-batch", pass: true },
    { name: "visual-logo-identity-batch", pass: true },
    { name: "visual-rendered-media-manifests", pass: true },
    { name: "visual-service-media-honesty", pass: true },
    { name: "visual-provenance-restraint", pass: true },
    { name: "visual-copy-mechanics", pass: true },
    { name: "visual-gallery-grid-integrity", pass: true },
  ];
  const duplicateFailure = {
    name: "visual-public-surface-scrub",
    pass: false,
    detail: "duplicate failure must dominate",
  };
  assert.equal(checkGradeAReadiness({ batchAudit, brandUse, geoIntegrity }).pass, false);
  assert.equal(checkGradeAReadiness({ batchAudit, brandUse, geoIntegrity, visualResults }).pass, true);
  for (const duplicateVisualResults of [
    [...visualResults, duplicateFailure],
    [duplicateFailure, ...visualResults],
  ]) {
    const duplicateReadiness = checkGradeAReadiness({
      batchAudit,
      brandUse,
      geoIntegrity,
      visualResults: duplicateVisualResults,
    });
    assert.equal(duplicateReadiness.pass, false);
    assert.equal(
      duplicateReadiness.criteria.visual_checks["visual-public-surface-scrub"],
      false,
    );
  }
  assert.equal(checkGradeAReadiness({ batchAudit: null, brandUse, geoIntegrity }).pass, false);
  assert.equal(checkGradeAReadiness({ batchAudit, brandUse: { pass: false }, geoIntegrity }).pass, false);
  assert.equal(checkGradeAReadiness({ batchAudit, brandUse, geoIntegrity: { mapped: false } }).pass, false);
  for (const visualName of visualResults.map((result) => result.name)) {
    const failedVisual = visualResults.map((result) => (
      result.name === visualName ? { ...result, pass: false } : result
    ));
    assert.equal(checkGradeAReadiness({ batchAudit, brandUse, geoIntegrity, visualResults: failedVisual }).pass, false);
    assert.equal(checkGradeAReadiness({
      batchAudit,
      brandUse,
      geoIntegrity,
      visualResults: visualResults.filter((result) => result.name !== visualName),
    }).pass, false);
  }
});

test("hidden signature decoys cannot certify visibly identical clones", async () => {
  const batch = tempBatch();
  for (let index = 0; index < 3; index += 1) {
    const slug = `clone-${index + 1}`;
    const dir = createSite(batch, { slug, radius: 8 });
    const packetPath = path.join(dir, "packet.json");
    const packet = JSON.parse(readFileSync(packetPath, "utf8"));
    const signature = packet.visual_system.resolved.design_signature;
    const decoyOrder = [...signature.section_order, `qc-decoy-${index}`];
    const decoyId = `ds1-${crypto.createHash("sha256")
      .update([signature.palette_hash, signature.font_pair, decoyOrder.join("|")].join("::"))
      .digest("hex")
      .slice(0, 20)}`;
    signature.id = decoyId;
    signature.section_order = decoyOrder;
    packet.visual_system.resolved.section_order = decoyOrder;
    writeFileSync(packetPath, JSON.stringify(packet));
    const htmlPath = path.join(dir, "index.html");
    const html = readFileSync(htmlPath, "utf8")
      .replace(/data-design-signature="[^"]+"/, `data-design-signature="${decoyId}"`)
      .replace("</style>", `.hidden-card-${index}{display:none;gap:${index + 1}px}</style>`)
      .replace("<body ", `<body data-layout-signature="decoy-${index}" `)
      .replace("</main>", `<div hidden class="hidden-card-${index}">QC-only decoy</div></main>`);
    writeFileSync(htmlPath, html);
  }

  const audit = await auditBatchDistinctness(batch);
  assert.equal(audit.distinct, false, JSON.stringify(audit, null, 2));
  const integrity = audit.results.find((item) => item.name === "design-signature-integrity");
  assert.equal(integrity?.pass, false);
  assert.match(integrity?.detail ?? "", /packet section order differs from rendered declaration/);
  for (const name of [
    "layout-signature-dedup",
    "grammar-dedup",
    "palette-dedup",
    "font-pair-dedup",
    "section-order-dedup",
  ]) {
    assert.equal(audit.results.find((item) => item.name === name)?.pass, false, name);
  }
});

test("signature integrity rejects visible-order, body, and root-palette drift", () => {
  const batch = tempBatch();
  const wrongOrder = createSite(batch, {
    slug: "wrong-visible-order",
    order: "hero>services>proof>gallery>location>cta",
    actualOrder: "hero>gallery>proof>services>location>cta",
  });
  const orderResult = checkDesignSignatureIntegrity(wrongOrder);
  assert.equal(orderResult.pass, false);
  assert.match(orderResult.detail, /visible DOM order/);

  const wrongCss = createSite(batch, { slug: "wrong-root-palette" });
  const wrongCssPath = path.join(wrongCss, "index.html");
  const cssHtml = readFileSync(wrongCssPath, "utf8").replace("--accent:#c44820", "--accent:#6d3b86");
  writeFileSync(wrongCssPath, cssHtml);
  const cssResult = checkDesignSignatureIntegrity(wrongCss);
  assert.equal(cssResult.pass, false);
  assert.match(cssResult.detail, /root CSS accent/);

  const wrongBody = createSite(batch, { slug: "wrong-body-signature" });
  const wrongBodyPath = path.join(wrongBody, "index.html");
  const bodyHtml = readFileSync(wrongBodyPath, "utf8")
    .replace(/data-font-pair="[^"]+"/, 'data-font-pair="unrelated-font-pair"');
  writeFileSync(wrongBodyPath, bodyHtml);
  const bodyResult = checkDesignSignatureIntegrity(wrongBody);
  assert.equal(bodyResult.pass, false);
  assert.match(bodyResult.detail, /body font-pair id mismatch/);
});

test("hidden or dormant brand-token references are not visible brand proof", () => {
  const batch = tempBatch();
  const dir = path.join(batch, "hidden-brand");
  mkdirSync(dir);
  writeFileSync(path.join(dir, "brand.json"), JSON.stringify({ colors: ["#c44820", "#195d67"] }));
  writeFileSync(path.join(dir, "packet.json"), JSON.stringify({ slug: "hidden-brand" }));
  writeFileSync(path.join(dir, "index.html"), `<!doctype html><style>
    :root{--accent:#c44820;--accent2:#195d67}
    .never-rendered{color:var(--accent)}
    .hidden-proof{display:none;border-color:var(--accent2)}
  </style><main><div class="hidden-proof">Hidden</div></main>`);

  assert.equal(checkBrandPaletteUse(dir).pass, false);
});

test("map proof requires visible matching attrs and a matching provider destination", () => {
  const batch = tempBatch();
  const dir = path.join(batch, "false-map");
  mkdirSync(dir);
  writeFileSync(path.join(dir, "packet.json"), JSON.stringify({
    slug: "false-map",
    business: { name: "False Map", lat: 33.05, lng: -96.75 },
  }));
  writeFileSync(path.join(dir, "index.html"), `<!doctype html><style>.premier-map{display:none}</style>
    <script type="application/ld+json">{"@type":"LocalBusiness","geo":{"@type":"GeoCoordinates","latitude":33.05,"longitude":-96.75}}</script>
    <div class="premier-map" data-lat="0" data-lng="0"><iframe src="about:blank"></iframe></div>`);

  assert.equal(checkGeoIntegrity(dir).pass, false);
});

test("a visible provider map pointing at a different destination fails", () => {
  const batch = tempBatch();
  const dir = createSite(batch, { slug: "wrong-destination" });
  const htmlPath = path.join(dir, "index.html");
  const html = readFileSync(htmlPath, "utf8")
    .replace("q=33.05,-96.75", "q=1600%20Pennsylvania%20Avenue%20NW");
  writeFileSync(htmlPath, html);

  const result = checkGeoIntegrity(dir);
  assert.equal(result.pass, false);
  assert.match(result.detail, /matching attrs and destination/);
});

test("coordinate lookup ignores unrelated nested media coordinates", () => {
  const batch = tempBatch();
  const dir = path.join(batch, "explicit-coordinates");
  mkdirSync(dir);
  writeFileSync(path.join(dir, "packet.json"), JSON.stringify({
    slug: "explicit-coordinates",
    media: { catalog: [{ metadata: { lat: 0, lng: 0 } }] },
    enrichment_sources: {
      latlng: { source: "business-profile", value: { lat: 33.05, lng: -96.75 } },
    },
  }));
  writeFileSync(path.join(dir, "index.html"), `<!doctype html>
    <script type="application/ld+json">{"@type":"LocalBusiness","geo":{"@type":"GeoCoordinates","latitude":33.05,"longitude":-96.75}}</script>
    <div class="premier-map" data-lat="33.05" data-lng="-96.75">
      <iframe src="https://www.google.com/maps?q=33.05,-96.75&output=embed"></iframe>
    </div>`);

  const result = checkGeoIntegrity(dir);
  assert.equal(result.pass, true, result.detail);
});

test("duplicate packet slugs are an explicit batch failure", async () => {
  const batch = tempBatch();
  const first = createSite(batch, { slug: "first", radius: 5 });
  const second = createSite(batch, { slug: "second", radius: 12 });
  createSite(batch, { slug: "third", radius: 20 });
  for (const dir of [first, second]) {
    const packet = JSON.parse(readFileSync(path.join(dir, "packet.json"), "utf8"));
    packet.slug = "duplicate";
    writeFileSync(path.join(dir, "packet.json"), JSON.stringify(packet));
  }

  const audit = await auditBatchDistinctness(batch);
  const slugResult = audit.results.find((item) => item.name === "batch-slug-integrity");
  assert.equal(slugResult?.pass, false, JSON.stringify(audit, null, 2));
  assert.match(slugResult.detail, /duplicate/i);
});

test("an empty rendered media set cannot pass image dedup", async () => {
  const batch = tempBatch();
  createSite(batch, { slug: "empty-a", radius: 5, images: "" });
  createSite(batch, {
    slug: "empty-b",
    radius: 12,
    accent: "#80561c",
    accent2: "#254588",
    display: "Bodoni Moda",
    body: "Public Sans",
    order: "hero>proof>services>gallery>location>cta",
    images: "",
  });
  createSite(batch, {
    slug: "empty-c",
    radius: 20,
    accent: "#6d3b86",
    accent2: "#2f6c45",
    display: "Syne",
    body: "Source Sans 3",
    order: "hero>gallery>proof>services>location>cta",
    images: "",
  });

  const audit = await auditBatchDistinctness(batch);
  const imageResult = audit.results.find((item) => item.name === "image-dedup");
  assert.equal(imageResult.pass, false, imageResult.detail);
});
