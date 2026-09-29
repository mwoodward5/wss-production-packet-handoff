import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runVisualFidelityChecks } from "../../qc-audit/qc-visual-fidelity.mjs";

const ORIGINAL_CHECKS = [
  "visual-public-surface-scrub",
  "visual-kitchen-contract",
  "visual-hero-anatomy",
  "visual-cinematic-motion",
  "visual-premium-media",
  "visual-no-fake-proof",
  "visual-source-carry-through",
  "visual-recipe-manifest",
  "visual-assets-manifest",
];

const SCREENSHOT_PATHS = [
  "desktop/hero.png", "desktop/mid.png", "desktop/footer.png", "desktop/full.png",
  "mobile/hero.png", "mobile/mid.png", "mobile/footer.png", "mobile/full.png",
];
const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n3sAAAAASUVORK5CYII=", "base64");
const RENDERED_SATELLITE_DOM = '<!doctype html><div class="premier-map map-live" data-google-map="satellite" data-map-rendered="true"><canvas class="maplibregl-canvas" data-map-canvas></canvas></div>';

const BATCH_VARIANTS = [
  { name: "site-a", anatomy: "editorial-offset", architecture: "garden-window-journal", heroVariant: "editorial", layoutGravity: "asymmetric-left", mediaFrame: "botanical-aperture", mediaTreatment: "source-photo-light-shader", sectionSequence: ["gallery", "services", "area", "quote"] },
  { name: "site-b", anatomy: "cinematic-cascade", architecture: "garden-window-showcase", heroVariant: "immersive", layoutGravity: "immersive-center", mediaFrame: "panorama-coordinate", mediaTreatment: "source-photo-light-shader", sectionSequence: ["services", "gallery", "quote", "area"] },
  { name: "site-c", anatomy: "coordinate-ledger", architecture: "atlas-coordinate-gallery", heroVariant: "journal", layoutGravity: "ledger-right", mediaFrame: "calibration-lens", mediaTreatment: "source-photo-light-shader", sectionSequence: ["area", "gallery", "services", "quote"] },
  { name: "site-d", anatomy: "panoramic-mast", architecture: "atlas-coordinate-journal", heroVariant: "panorama", layoutGravity: "panoramic-low", mediaFrame: "journal-spread", mediaTreatment: "source-photo-light-shader", sectionSequence: ["gallery", "area", "quote", "services"] },
  { name: "site-e", anatomy: "tool-dock-stage", architecture: "atlas-coordinate-showcase", heroVariant: "cascade", layoutGravity: "tool-dock-high", mediaFrame: "inspection-bay", mediaTreatment: "source-photo-light-shader", sectionSequence: ["quote", "services", "gallery", "area"] },
];

function heroBody(variant, media, mediaFrame, mediaTreatment) {
  const mediaBlock = `<div class="media-plane media-${mediaFrame}" data-media-treatment="${mediaTreatment}"><div class="premier-media premier-media--cinematic-light-photo" data-media-kind="photo" data-media-provenance="source-owned" data-motion-treatment="cinematic-light-shader" data-reduced-motion="static">${media}</div><div class="cinematic-light" aria-hidden="true"></div></div>`;
  const copy = '<div class="hero-copy"><h1>Plumbing built around the property.</h1></div>';
  const layouts = {
    editorial: `${copy}<div class="hero-stage">${mediaBlock}</div>`,
    immersive: `<div class="hero-stage">${mediaBlock}</div>${copy}<aside class="hero-tool-dock"><a href="#quote">Start</a></aside>`,
    journal: `<aside class="hero-index">01</aside>${copy}<div class="hero-stage">${mediaBlock}</div><aside class="hero-tool-dock"><a href="#quote">Start</a></aside>`,
    panorama: `<header class="hero-mast">Premier Plumbing</header><div class="hero-stage">${mediaBlock}</div>${copy}<footer class="hero-proof-ribbon">Serving Mesa</footer>`,
    cascade: `${copy}<aside class="hero-tool-dock"><a href="#quote">Start</a></aside><div class="hero-proof-ribbon">Serving Mesa</div><div class="hero-stage">${mediaBlock}</div>`,
  };
  return `<div class="hero-layout fixture-layout-${variant}" data-hero-layout>${layouts[variant] || layouts.editorial}</div>`;
}

function writeScreenshotEvidence(dir, status) {
  if (status === false) return;
  for (const relative of SCREENSHOT_PATHS) {
    const file = path.join(dir, "screenshots", relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, ONE_PIXEL_PNG);
  }
  writeFileSync(path.join(dir, "screenshots", "desktop", "map.png"), ONE_PIXEL_PNG);
  const screenshots = status === "deferred"
    ? { name: "screenshots", pass: false, deferred: true, detail: "headless browser unavailable" }
    : status === "failed"
      ? { name: "screenshots", pass: false, detail: "capture failed" }
      : { name: "screenshots", pass: true, detail: "all present" };
  writeFileSync(path.join(dir, "qc-report.json"), JSON.stringify([screenshots]));
}

function fiveSiteBatch(root, overrides = {}) {
  return BATCH_VARIANTS.map((variant, index) => siteFixture(root, variant.name, {
    ...variant,
    fingerprint: `composition-${index + 1}`,
    ...(overrides[variant.name] || {}),
  }));
}

function threeSiteCohort(root, overrides = {}) {
  return BATCH_VARIANTS.slice(0, 3).map((variant, index) => siteFixture(root, variant.name, {
    ...variant,
    fingerprint: `cohort-composition-${index + 1}`,
    qcCohort: { kind: "release", id: "release-three-site", trade: "landscaping" },
    ...(overrides[variant.name] || {}),
  }));
}

function siteFixture(root, name, options = {}) {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  const anatomy = options.anatomy || "editorial-offset";
  const architecture = options.architecture || `${anatomy}-journal`;
  const fingerprint = options.fingerprint || `composition-${name}`;
  const galleryCount = options.galleryCount ?? 3;
  const heroVariant = options.heroVariant || "editorial";
  const layoutGravity = options.layoutGravity || `gravity-${name}`;
  const mediaFrame = options.mediaFrame || `frame-${name}`;
  const mediaTreatment = options.mediaTreatment || "source-photo-light-shader";
  const sectionSequence = options.sectionSequence || ["gallery", "services", "area", "quote"];
  const logoUrl = options.logoUrl || `media/${name}-logo.svg`;
  const logoSignature = options.logoSignature ? ` data-logo-signature="${options.logoSignature}"` : "";
  const logo = options.logo === "missing"
    ? "<span>Premier Plumbing</span>"
    : `<img data-role="logo" data-logo-kind="source" class="sourced-logo" src="${logoUrl}"${logoSignature} alt="Premier Plumbing logo" width="${options.logo === "tiny" ? 20 : 176}" height="${options.logo === "tiny" ? 20 : 64}" style="width:${options.logo === "tiny" ? 20 : 176}px;height:${options.logo === "tiny" ? 20 : 64}px">`;
  const heroMedia = options.media === false
    ? '<svg class="scene-under" viewBox="0 0 100 100"><path d="M0 0h100v100H0z"/></svg>'
    : '<img class="hero-media" src="media/hero.webp" alt="Premier Plumbing crew at work">';
  const renderedHeroBody = heroBody(heroVariant, heroMedia, mediaFrame, mediaTreatment);
  const gallery = Array.from({ length: galleryCount }, (_, index) => `<figure data-gallery-item><img src="media/gallery-${index}.webp" alt="Completed plumbing project ${index + 1}"></figure>`).join("");
  const satellite = '<div class="geo-map" data-google-map="satellite"><iframe title="Premier Plumbing satellite map" src="https://www.google.com/maps/embed/v1/place?key=test&amp;q=44%20Main%20St&amp;maptype=satellite"></iframe></div>';
  const fakeRing = '<div class="geo-map satellite" data-google-map="satellite"><div class="ring-map" data-ring-map></div></div>';
  const map = options.map === "missing" ? '<div class="geo-map"></div>' : options.map === "fake-ring" ? fakeRing : satellite;
  const directions = options.directions === false ? "" : '<a href="https://www.google.com/maps/dir/?api=1&amp;destination=44%20Main%20St">Get directions</a>';
  const rail = options.rail === false ? "" : '<aside class="conversion-rail" data-conversion-rail><a data-conversion-action href="#quote">Request an estimate</a></aside>';
  const markers = options.markers === "malformed"
    ? 'data-mobile-qc="pending" data-overflow-qc="clean"'
    : 'data-mobile-qc="pass" data-overflow-qc="clean"';
  const internalCopy = options.internalCopy ? `<p>${options.internalCopy}</p>` : "";
  const sections = {
    gallery: `<section class="gallery"><div class="premier-gallery" data-gallery-source="business" data-gallery-count="${galleryCount}">${gallery}</div></section>`,
    services: options.servicesHtml ?? '<section class="services"><div class="service-list">Repairs and installation</div></section>',
    area: `<section class="service-area">${map}${directions}</section>`,
    quote: '<section id="quote"><form><button type="submit">Send request</button></form></section>',
  };

  const html = `<!doctype html>
<html ${markers}>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *{box-sizing:border-box}html,body{margin:0;max-width:100%;overflow-x:clip}
    .hero-grid{display:grid;grid-template-columns:1fr 1fr}.hero-stage{min-height:420px}
    .cinematic-light{animation:premierLight 12s ease-in-out infinite}
    @keyframes premierLight{from{transform:translateX(-75%)}to{transform:translateX(75%)}}
    @media(max-width:760px){.hero-grid{grid-template-columns:1fr}.conversion-rail{inset:auto 8px 8px}}
    @media(prefers-reduced-motion:reduce){.cinematic-light{animation:none}}
  </style>
</head>
<body>
  <header><a class="brand" href="/">${logo}</a></header>
  <main>
    <section class="hero hero-${heroVariant}${options.heroGalleryClass ? " edition-gallery" : ""}" data-hero-anatomy="${anatomy}" data-hero-model="${anatomy}" data-hero-architecture="${architecture}" data-composition-fingerprint="${fingerprint}" data-layout-gravity="${layoutGravity}" data-media-frame="${mediaFrame}" data-kitchen-stack="razzle-fx-kitchen site-superpowers-kitchen master-glue-kitchen" data-motion-model="photo-light-shader">
      ${renderedHeroBody}
    </section>
    ${sectionSequence.map((section) => sections[section]).filter(Boolean).join("\n    ")}
    ${internalCopy}
  </main>
  ${rail}
</body>
</html>`;

  const packet = {
    slug: name,
    business: { name: "Premier Plumbing", category: "plumbing", city: "Mesa", state: "AZ", address: "44 Main St, Mesa, AZ 85201" },
    enrichment_sources: { address: { value: "44 Main St, Mesa, AZ 85201", source: "gbp" } },
    logo_source: { chosen_url: logoUrl, origin: "upload", proposed: false },
    media: {
      catalog: [
        { kind: "photo", url: options.packetMediaUrl || "media/hero.webp", source: "upload", hero_eligible: true, proof_eligible: true },
        ...Array.from({ length: galleryCount }, (_, index) => ({
          kind: "photo",
          url: `media/gallery-${index}.webp`,
          source: "upload",
          hero_eligible: false,
          proof_eligible: true,
        })),
      ],
    },
    visual_system: {
      kitchens: ["razzle-fx-kitchen", "site-superpowers-kitchen", "master-glue-kitchen"],
      recipes: ["hero-cinema", "editorial-layout", "media-rescue", "conversion-rail"],
      composition_fingerprint: fingerprint,
    },
    ...(options.qcCohort ? { qc_cohort: options.qcCohort } : {}),
  };
  const assets = {
    items: [
      { kind: "logo", url: logoUrl, source: "upload", proposed: false },
      { kind: "photo", url: "media/hero.webp", source: "upload" },
      ...Array.from({ length: galleryCount }, (_, index) => ({
        kind: "photo",
        url: `media/gallery-${index}.webp`,
        source: "upload",
      })),
    ],
  };
  writeFileSync(path.join(dir, "index.html"), html);
  writeFileSync(path.join(dir, "packet.json"), JSON.stringify(packet));
  writeFileSync(path.join(dir, "assets.json"), JSON.stringify(assets));
  writeScreenshotEvidence(dir, options.screenshotEvidence ?? "passed");
  const screenshotDom = options.screenshotDom === false
    ? null
    : options.screenshotDom || (!["missing", "fake-ring"].includes(options.map) ? RENDERED_SATELLITE_DOM : null);
  if (screenshotDom) {
    mkdirSync(path.join(dir, "screenshots"), { recursive: true });
    writeFileSync(path.join(dir, "screenshots", "rendered-dom.html"), screenshotDom);
  }
  return dir;
}

function result(results, name) {
  const found = results.find((item) => item.name === name);
  assert.ok(found, `missing QC result: ${name}`);
  return found;
}

function fixtureRoot(t) {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-premier-visual-qc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("premier visual QC preserves existing checks and accepts a complete site", (t) => {
  const dir = siteFixture(fixtureRoot(t), "complete");
  const results = runVisualFidelityChecks(dir);
  for (const name of ORIGINAL_CHECKS) assert.ok(result(results, name).pass, `${name}: ${result(results, name).detail}`);
  assert.deepEqual(results.filter((item) => !item.pass), []);
});

test("premier visual QC rejects generic hero anatomy", (t) => {
  const dir = siteFixture(fixtureRoot(t), "generic-hero", { anatomy: "generic" });
  assert.equal(result(runVisualFidelityChecks(dir), "visual-hero-anatomy").pass, false);
});

test("premier visual QC rejects fake ring maps and requires satellite directions for an address", (t) => {
  const root = fixtureRoot(t);
  const fake = siteFixture(root, "fake-ring", { map: "fake-ring" });
  const fakeResults = runVisualFidelityChecks(fake);
  assert.equal(result(fakeResults, "visual-no-fake-ring-map").pass, false);
  assert.equal(result(fakeResults, "visual-address-map-directions").pass, false);

  const noMap = siteFixture(root, "no-map", { map: "missing" });
  assert.equal(result(runVisualFidelityChecks(noMap), "visual-address-map-directions").pass, false);

  const noDirections = siteFixture(root, "no-directions", { directions: false });
  assert.equal(result(runVisualFidelityChecks(noDirections), "visual-address-map-directions").pass, false);
});

test("premier visual QC requires rendered satellite evidence, not URL parameters", (t) => {
  const root = fixtureRoot(t);
  const urlOnly = siteFixture(root, "url-only-satellite", { screenshotEvidence: false, screenshotDom: false });
  const urlOnlyResult = result(runVisualFidelityChecks(urlOnly), "visual-satellite-map-evidence");
  assert.equal(urlOnlyResult.pass, false);
  assert.match(urlOnlyResult.detail, /URL parameters declare satellite/i);

  const renderedDom = siteFixture(root, "rendered-satellite", {
    screenshotEvidence: "passed",
    screenshotDom: RENDERED_SATELLITE_DOM,
  });
  assert.equal(result(runVisualFidelityChecks(renderedDom), "visual-satellite-map-evidence").pass, true);

  const renderedCropDom = siteFixture(root, "rendered-satellite-crop", {
    screenshotEvidence: "passed",
    screenshotDom: '<!doctype html><div class="premier-map map-live" data-google-map="satellite" data-map-rendered="verified" data-satellite-rendered="verified"><img data-satellite-tile="rendered" src="desktop/map.png" alt="Rendered satellite map evidence"></div>',
  });
  assert.equal(result(runVisualFidelityChecks(renderedCropDom), "visual-satellite-map-evidence").pass, true);

  const unrenderedDom = siteFixture(root, "unrendered-satellite", {
    screenshotDom: '<!doctype html><div class="premier-map" data-google-map="satellite"><iframe src="https://www.google.com/maps/embed?maptype=satellite"></iframe></div>',
  });
  const unrenderedResult = result(runVisualFidelityChecks(unrenderedDom), "visual-satellite-map-evidence");
  assert.equal(unrenderedResult.pass, false);
  assert.match(unrenderedResult.detail, /did not confirm loaded satellite imagery/i);
});

test("premier visual QC keeps deferred satellite screenshots non-passing", (t) => {
  const deferred = siteFixture(fixtureRoot(t), "deferred-satellite", {
    screenshotEvidence: "deferred",
    screenshotDom: RENDERED_SATELLITE_DOM,
  });
  const mapResult = result(runVisualFidelityChecks(deferred), "visual-satellite-map-evidence");
  assert.equal(mapResult.pass, false);
  assert.match(mapResult.detail, /deferred/i);
});

test("premier visual QC rejects missing and tiny sourced logos", (t) => {
  const root = fixtureRoot(t);
  for (const logo of ["missing", "tiny"]) {
    const dir = siteFixture(root, `logo-${logo}`, { logo });
    assert.equal(result(runVisualFidelityChecks(dir), "visual-real-logo").pass, false, logo);
  }
});

test("premier visual QC caps galleries and requires rendered media", (t) => {
  const root = fixtureRoot(t);
  const oversized = siteFixture(root, "oversized-gallery", { galleryCount: 13 });
  assert.equal(result(runVisualFidelityChecks(oversized), "visual-gallery-cap").pass, false);

  const cappedWithGalleryHero = siteFixture(root, "capped-gallery-hero", { galleryCount: 12, heroGalleryClass: true });
  const cappedResult = result(runVisualFidelityChecks(cappedWithGalleryHero), "visual-gallery-cap");
  assert.equal(cappedResult.pass, true, cappedResult.detail);

  const empty = siteFixture(root, "empty-media", { galleryCount: 0, media: false });
  assert.equal(result(runVisualFidelityChecks(empty), "visual-rendered-media").pass, false);
});

test("premier visual QC accepts exact service tags, complete descriptions, and safe text-only cards", (t) => {
  const servicesHtml = `<section class="services"><div class="svc-grid">
    <article class="svc" data-service-media="matched-source">
      <div class="svc-visual"><img class="svc-photo" src="media/roof-repair.webp" alt="" data-service-match="Roof Repair" data-service-match-score="102" data-service-match-basis="explicit-tag" data-service-match-terms="roof|repair" data-service-match-evidence="Roof Repair"></div>
      <h3>Roof Repair</h3><p>Repair damaged roof areas.</p>
    </article>
    <article class="svc" data-service-media="matched-source">
      <div class="svc-visual"><img class="svc-photo" src="media/roof-replacement.webp" alt="" data-service-match="Roof Replacement" data-service-match-score="22" data-service-match-basis="descriptive-all-terms" data-service-match-terms="roof|replacement" data-service-match-evidence="Completed roof replacement after storm damage"></div>
      <h3>Roof Replacement</h3><p>Replace worn roofing systems.</p>
    </article>
    <article class="svc" data-service-media="matched-source">
      <div class="svc-visual"><img class="svc-photo" src="media/metal-roofing.webp" alt="" data-service-match="Metal Roofing" data-service-match-score="82" data-service-match-basis="vision-all-terms" data-service-match-terms="metal|roof" data-service-match-evidence="Vision classification: completed metal roofing installation" data-service-match-confidence="0.91"></div>
      <h3>Metal Roofing</h3><p>Install durable metal roof systems.</p>
    </article>
    <article class="svc svc--text" data-service-media="text-only">
      <h3>Roof Inspection</h3><p>Inspect the roof before scoping work.</p>
    </article>
  </div></section>`;
  const dir = siteFixture(fixtureRoot(t), "honest-service-media", { servicesHtml });
  const gate = result(runVisualFidelityChecks(dir), "visual-service-media-honesty");
  assert.equal(gate.pass, true, gate.detail);
  assert.match(gate.detail, /3 semantically matched \/ 1 deliberate text-only/i);
});

test("premier visual QC rejects generic roof-project evidence despite a passing claimed score", (t) => {
  const servicesHtml = `<section class="services"><div class="svc-grid">
    <article class="svc" data-service-media="matched-source">
      <div class="svc-visual"><img class="svc-photo" src="media/roof-project-1.webp" alt="" data-service-match="Roof Repair" data-service-match-score="22" data-service-match-basis="descriptive-all-terms" data-service-match-terms="roof|repair" data-service-match-evidence="roof project 1"></div>
      <h3>Roof Repair</h3><p>Repair damaged roof areas.</p>
    </article>
    <article class="svc" data-service-media="matched-source">
      <div class="svc-visual"><img class="svc-photo" src="media/roof-project-2.webp" alt="" data-service-match="Roof Replacement" data-service-match-score="102" data-service-match-basis="explicit-tag" data-service-match-terms="roof|replacement" data-service-match-evidence="roof project 2"></div>
      <h3>Roof Replacement</h3><p>Replace worn roofing systems.</p>
    </article>
  </div></section>`;
  const dir = siteFixture(fixtureRoot(t), "generic-roof-project-media", { servicesHtml });
  const gate = result(runVisualFidelityChecks(dir), "visual-service-media-honesty");
  assert.equal(gate.pass, false);
  assert.match(gate.detail, /descriptive evidence missing: repair/i);
  assert.match(gate.detail, /explicit semantic evidence does not exactly classify roof replacement/i);
});

test("premier visual QC enforces the service match score floor independently of exact evidence", (t) => {
  const servicesHtml = `<section class="services"><article class="svc" data-service-media="matched-source">
    <div class="svc-visual"><img class="svc-photo" src="media/roof-repair.webp" alt="" data-service-match="Roof Repair" data-service-match-score="19" data-service-match-basis="explicit-tag" data-service-match-terms="roof|repair" data-service-match-evidence="Roof Repair"></div>
    <h3>Roof Repair</h3><p>Repair damaged roof areas.</p>
  </article></section>`;
  const dir = siteFixture(fixtureRoot(t), "low-service-score", { servicesHtml });
  const gate = result(runVisualFidelityChecks(dir), "visual-service-media-honesty");
  assert.equal(gate.pass, false);
  assert.match(gate.detail, /match score 19 below 20/i);
});

test("premier visual QC rejects low-confidence vision classifications", (t) => {
  const servicesHtml = `<section class="services"><article class="svc" data-service-media="matched-source">
    <div class="svc-visual"><img class="svc-photo" src="media/metal-roofing.webp" alt="" data-service-match="Metal Roofing" data-service-match-score="82" data-service-match-basis="vision-all-terms" data-service-match-terms="metal|roof" data-service-match-evidence="Vision classification: completed metal roofing installation" data-service-match-confidence="0.74"></div>
    <h3>Metal Roofing</h3><p>Install durable metal roof systems.</p>
  </article></section>`;
  const dir = siteFixture(fixtureRoot(t), "low-confidence-classification", { servicesHtml });
  const gate = result(runVisualFidelityChecks(dir), "visual-service-media-honesty");
  assert.equal(gate.pass, false);
  assert.match(gate.detail, /classification confidence 0\.74 below 0\.75/i);
});

test("premier visual QC rejects service photos hidden outside the declared visual frame", (t) => {
  const servicesHtml = `<section class="services"><article class="svc svc--text" data-service-media="text-only">
    <h3>Roof Repair</h3><img class="svc-photo" src="media/roof-repair.webp" alt="">
    <p>Repair damaged roof areas.</p>
  </article></section>`;
  const dir = siteFixture(fixtureRoot(t), "dishonest-text-only-service", { servicesHtml });
  const gate = result(runVisualFidelityChecks(dir), "visual-service-media-honesty");
  assert.equal(gate.pass, false);
  assert.match(gate.detail, /text-only card renders media/i);
});

test("premier visual QC blocks AI atmosphere from hiding omitted client media", (t) => {
  const dir = siteFixture(fixtureRoot(t), "omitted-source-media", { packetMediaUrl: "media/real-client-project.webp" });
  const carried = result(runVisualFidelityChecks(dir), "visual-source-carry-through");
  assert.equal(carried.pass, false);
  assert.match(carried.detail, /\d+\/\d+ real source media/i);
});

test("premier visual QC rejects malformed responsive markers and a missing conversion rail", (t) => {
  const root = fixtureRoot(t);
  const malformed = siteFixture(root, "malformed-markers", { markers: "malformed" });
  assert.equal(result(runVisualFidelityChecks(malformed), "visual-mobile-overflow-contract").pass, false);

  const noRail = siteFixture(root, "no-rail", { rail: false });
  assert.equal(result(runVisualFidelityChecks(noRail), "visual-conversion-rail").pass, false);
});

test("premier visual QC rejects internal public copy", (t) => {
  const dir = siteFixture(fixtureRoot(t), "internal-copy", { internalCopy: "PageHub renderer QC report" });
  assert.equal(result(runVisualFidelityChecks(dir), "visual-public-surface-scrub").pass, false);
});

test("premier visual QC accepts five distinct structural hero architectures", (t) => {
  const batch = fixtureRoot(t);
  const [first] = fiveSiteBatch(batch);
  const results = runVisualFidelityChecks(first, { batchDir: batch });
  assert.equal(result(results, "visual-hero-anatomy-batch").pass, true);
  assert.equal(result(results, "visual-hero-architecture-batch").pass, true);
  assert.equal(result(results, "visual-composition-fingerprint-batch").pass, true);
  assert.equal(result(results, "visual-rendered-uniqueness-batch").pass, true);
  assert.equal(result(results, "visual-layout-gravity-batch").pass, true);
  assert.equal(result(results, "visual-media-behavior-batch").pass, true);
  assert.equal(result(results, "visual-logo-identity-batch").pass, true);
});

test("exact three-site cohort requires distinct layout, media behavior, and logo identity", (t) => {
  const batch = fixtureRoot(t);
  const [current] = threeSiteCohort(batch);
  siteFixture(batch, "other-release", {
    ...BATCH_VARIANTS[0],
    qcCohort: { kind: "release", id: "release-other", trade: "landscaping" },
    logoUrl: "media/site-a-logo.svg",
  });
  siteFixture(batch, "other-trade", {
    ...BATCH_VARIANTS[0],
    qcCohort: { kind: "release", id: "release-three-site", trade: "roofing" },
    logoUrl: "media/site-a-logo.svg",
  });

  const results = runVisualFidelityChecks(current, { batchDir: batch, filterCohort: true });
  assert.equal(result(results, "visual-layout-gravity-batch").pass, true);
  assert.equal(result(results, "visual-media-behavior-batch").pass, true);
  assert.equal(result(results, "visual-logo-identity-batch").pass, true);
  assert.match(result(results, "visual-layout-gravity-batch").detail, /^3 distinct/i);
});

test("exact three-site cohort rejects a repeated layout gravity", (t) => {
  const batch = fixtureRoot(t);
  const [current] = threeSiteCohort(batch, {
    "site-c": { layoutGravity: BATCH_VARIANTS[0].layoutGravity },
  });
  const gate = result(
    runVisualFidelityChecks(current, { batchDir: batch, filterCohort: true }),
    "visual-layout-gravity-batch",
  );
  assert.equal(gate.pass, false);
  assert.match(gate.detail, /layout gravity collision: site-a <-> site-c/i);
});

test("exact three-site cohort rejects a repeated frame and treatment combination", (t) => {
  const batch = fixtureRoot(t);
  const [current] = threeSiteCohort(batch, {
    "site-c": {
      mediaFrame: BATCH_VARIANTS[0].mediaFrame,
      mediaTreatment: BATCH_VARIANTS[0].mediaTreatment,
    },
  });
  const gate = result(
    runVisualFidelityChecks(current, { batchDir: batch, filterCohort: true }),
    "visual-media-behavior-batch",
  );
  assert.equal(gate.pass, false);
  assert.match(gate.detail, /hero media behavior collision: site-a <-> site-c/i);
});

test("exact three-site cohort rejects a repeated sourced logo identity", (t) => {
  const batch = fixtureRoot(t);
  const [current] = threeSiteCohort(batch, {
    "site-c": { logoUrl: "media/site-a-logo.svg" },
  });
  const gate = result(
    runVisualFidelityChecks(current, { batchDir: batch, filterCohort: true }),
    "visual-logo-identity-batch",
  );
  assert.equal(gate.pass, false);
  assert.match(gate.detail, /logo identity collision: site-a <-> site-c/i);
});

test("exact three-site cohort hashes safely contained local logo bytes instead of filenames", (t) => {
  const root = fixtureRoot(t);
  const logoUrls = {
    "site-a": "media/alpha-brand.svg",
    "site-b": "assets/beta-brand.svg",
    "site-c": "media/gamma-brand.svg",
  };
  const overrides = Object.fromEntries(
    Object.entries(logoUrls).map(([name, logoUrl]) => [name, {
      logoUrl,
      logoSignature: `declared-${name}`,
    }]),
  );
  const writeLogos = (sites, bytesForSite) => {
    for (const siteDir of sites) {
      const name = path.basename(siteDir);
      const logoPath = path.join(siteDir, ...logoUrls[name].split("/"));
      mkdirSync(path.dirname(logoPath), { recursive: true });
      writeFileSync(logoPath, bytesForSite(name));
    }
  };

  const identicalBatch = path.join(root, "identical");
  const identicalSites = threeSiteCohort(identicalBatch, overrides);
  const identicalLogo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2 2h16v16H2z"/></svg>');
  writeLogos(identicalSites, () => identicalLogo);
  const collision = result(
    runVisualFidelityChecks(identicalSites[0], { batchDir: identicalBatch, filterCohort: true }),
    "visual-logo-identity-batch",
  );
  assert.equal(collision.pass, false);
  assert.match(collision.detail, /logo identity collision: site-a <-> site-b <-> site-c/i);

  const distinctBatch = path.join(root, "distinct");
  const distinctSites = threeSiteCohort(distinctBatch, overrides);
  writeLogos(distinctSites, (name) => Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path data-site="${name}" d="M2 2h16v16H2z"/></svg>`,
  ));
  const distinct = result(
    runVisualFidelityChecks(distinctSites[0], { batchDir: distinctBatch, filterCohort: true }),
    "visual-logo-identity-batch",
  );
  assert.equal(distinct.pass, true, distinct.detail);
});

test("premier visual QC rejects repeated anatomy in a five-site batch", (t) => {
  const batch = fixtureRoot(t);
  const [first] = fiveSiteBatch(batch, { "site-b": { anatomy: "editorial-offset" } });
  const batchResult = result(runVisualFidelityChecks(first, { batchDir: batch }), "visual-hero-anatomy-batch");
  assert.equal(batchResult.pass, false);
  assert.match(batchResult.detail, /anatomy collision/i);
});

test("premier visual QC rejects repeated declared hero architecture", (t) => {
  const batch = fixtureRoot(t);
  const [first] = fiveSiteBatch(batch, { "site-b": { architecture: "garden-window-journal" } });
  const batchResult = result(runVisualFidelityChecks(first, { batchDir: batch }), "visual-hero-architecture-batch");
  assert.equal(batchResult.pass, false);
  assert.match(batchResult.detail, /declared architecture collision/i);
});

test("premier visual QC rejects repeated structural architecture behind unique labels", (t) => {
  const batch = fixtureRoot(t);
  const [first] = fiveSiteBatch(batch, {
    "site-c": { heroVariant: "editorial" },
    "site-e": { heroVariant: "editorial" },
  });
  const batchResult = result(runVisualFidelityChecks(first, { batchDir: batch }), "visual-hero-architecture-batch");
  assert.equal(batchResult.pass, false);
  assert.match(batchResult.detail, /structural architecture collision/i);
});

test("premier visual QC rejects batch composition fingerprint collisions", (t) => {
  const batch = fixtureRoot(t);
  const [first] = fiveSiteBatch(batch, { "site-b": { fingerprint: "composition-1" } });
  const batchResult = result(runVisualFidelityChecks(first, { batchDir: batch }), "visual-composition-fingerprint-batch");
  assert.equal(batchResult.pass, false);
  assert.match(batchResult.detail, /declared fingerprint collision/i);
});

test("premier visual QC rejects rendered hero reuse despite unique declarations", (t) => {
  const batch = fixtureRoot(t);
  const [first] = fiveSiteBatch(batch, {
    "site-c": { heroVariant: "editorial" },
    "site-e": { heroVariant: "editorial" },
  });
  const results = runVisualFidelityChecks(first, { batchDir: batch });
  const rendered = result(results, "visual-rendered-uniqueness-batch");
  assert.equal(rendered.pass, false);
  assert.match(rendered.detail, /rendered hero architecture\/anatomy\/layout reused by 3\/5 sites \(limit 2\)/i);
  assert.equal(result(results, "visual-composition-fingerprint-batch").pass, false);
});

test("premier visual QC rejects a media frame reused by three of five sites", (t) => {
  const batch = fixtureRoot(t);
  const [first] = fiveSiteBatch(batch, {
    "site-b": { mediaFrame: "botanical-aperture" },
    "site-c": { mediaFrame: "botanical-aperture" },
  });
  const rendered = result(runVisualFidelityChecks(first, { batchDir: batch }), "visual-rendered-uniqueness-batch");
  assert.equal(rendered.pass, false);
  assert.match(rendered.detail, /rendered media frame reused by 3\/5 sites \(limit 2\)/i);
});

test("premier visual QC rejects a section sequence reused by three of five sites", (t) => {
  const batch = fixtureRoot(t);
  const repeated = BATCH_VARIANTS[0].sectionSequence;
  const [first] = fiveSiteBatch(batch, {
    "site-b": { sectionSequence: repeated },
    "site-c": { sectionSequence: repeated },
  });
  const rendered = result(runVisualFidelityChecks(first, { batchDir: batch }), "visual-rendered-uniqueness-batch");
  assert.equal(rendered.pass, false);
  assert.match(rendered.detail, /rendered section sequence reused by 3\/5 sites \(limit 2\)/i);
});

test("premier visual QC allows two rendered media-frame uses and keeps single-site mode unchanged", (t) => {
  const batch = fixtureRoot(t);
  const sites = fiveSiteBatch(batch, { "site-b": { mediaFrame: "botanical-aperture" } });
  const batchResults = runVisualFidelityChecks(sites[0], { batchDir: batch });
  assert.equal(result(batchResults, "visual-rendered-uniqueness-batch").pass, true);

  const singleResults = runVisualFidelityChecks(sites[0]);
  assert.equal(singleResults.some((item) => item.name.endsWith("-batch")), false);
});

test("production visual batch checks ignore other releases and trades but block same-cohort collisions", (t) => {
  const batch = fixtureRoot(t);
  const current = siteFixture(batch, "current", {
    qcCohort: { kind: "release", id: "release-1", trade: "landscaping" },
  });
  siteFixture(batch, "other-release", {
    qcCohort: { kind: "release", id: "release-2", trade: "landscaping" },
  });
  siteFixture(batch, "other-trade", {
    qcCohort: { kind: "release", id: "release-1", trade: "roofing" },
  });

  const isolated = runVisualFidelityChecks(current, { batchDir: batch, filterCohort: true });
  assert.equal(result(isolated, "visual-hero-anatomy-batch").pass, true);
  assert.equal(result(isolated, "visual-hero-architecture-batch").pass, true);

  siteFixture(batch, "same-cohort", {
    qcCohort: { kind: "release", id: "release-1", trade: "landscaping" },
  });
  const collided = runVisualFidelityChecks(current, { batchDir: batch, filterCohort: true });
  assert.equal(result(collided, "visual-hero-anatomy-batch").pass, false);
  assert.equal(result(collided, "visual-hero-architecture-batch").pass, false);
});
