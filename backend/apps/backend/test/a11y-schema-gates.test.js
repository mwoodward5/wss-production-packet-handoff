"use strict";

// test/a11y-schema-gates.test.js — THE ACCESSIBILITY + SCHEMA GATES (one fast
// file, wired into test:mirror-engine).
//
// Pins the 2026-09-02 a11y layer end to end:
//   1. ALT TEXT IS REQUIRED AT INTAKE — facts.validateFacts auto-generates the
//      composed sentence ("Absolute Roofing — roof replacement in Naples, FL")
//      for every image, honors supplied alts, keeps decorative alt="" and
//      rejects unusable ones (auto + strict modes).
//   2. scripts/validate-schema.js — valid and invalid fixtures, real exit
//      codes: the defect classes the fleet audits actually shipped (empty
//      string facts, frame-*@mhtml.blink artifacts, double-slash URLs,
//      missing telephone) each fail the page they seed.
//   3. The a11y audit (a11y-audit.js + scripts/a11y-check.js) catches every
//      seeded serious violation, and the fleet-polish a11y floor REPAIRS the
//      same document so the audit passes it afterwards.

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const { validateFacts } = require("../lib/mirror-engine/facts");
const { composeAlt, applyImageAltPolicy, serviceHintFromSrc } = require("../lib/mirror-engine/image-alt");
const { auditHtml } = require("../lib/mirror-engine/a11y-audit");
const {
  polishSite,
  ensureLangAttribute,
  ensureSkipLink,
  imageAltFloor,
  formLabelFloor,
  a11yFloorCss,
} = require("../lib/mirror-engine/fleet-polish");

// ---------------------------------------------------------------------------
// 1. ALT REQUIRED AT INTAKE (facts.js + image-alt.js)
// ---------------------------------------------------------------------------

function roofingRequest(overrides = {}) {
  return {
    slug: "wss-test-absolute-roofing",
    donor: "mirror-donor",
    facts: {
      business_name: "Absolute Roofing",
      industry: "roofing",
      city: "Naples",
      state: "FL",
      ...(overrides.facts || {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "facts")),
  };
}

test("alt policy: the composed sentence matches the owner's example shape", () => {
  assert.equal(
    composeAlt({ businessName: "Absolute Roofing", service: "roof replacement", city: "Naples", state: "FL" }),
    "Absolute Roofing — roof replacement in Naples, FL",
  );
  assert.equal(
    composeAlt({ businessName: "Absolute Roofing", industry: "roofing", city: "Naples", state: "FL" }),
    "Absolute Roofing — roofing in Naples, FL",
  );
  // Absent fields shorten the sentence; never invented.
  assert.equal(composeAlt({ businessName: "Absolute Roofing", industry: "roofing" }), "Absolute Roofing — roofing");
  // No business name -> no sentence (the caller flags).
  assert.equal(composeAlt({ industry: "roofing" }), "");
});

test("alt intake: bank images without alt are auto-generated at the facts boundary", () => {
  const request = roofingRequest({
    brand: {
      photos: ["https://client.example/hero.jpg"],
      photo_bank: {
        photos: [
          { url: "https://client.example/hero.jpg", sha256: "a".repeat(64), grade: "hero" },
          { url: "https://client.example/roof-replacement-2.jpg", sha256: "b".repeat(64), grade: "gallery" },
        ],
      },
    },
  });
  const out = validateFacts(request);
  assert.equal(out.ok, true, JSON.stringify(out.detail || []));
  const bankAlts = out.imageAlts.filter((i) => i.path.startsWith("/brand/photo_bank"));
  assert.equal(bankAlts.length, 2);
  for (const record of bankAlts) {
    assert.equal(record.source, "generated");
    assert.match(record.alt, /^Absolute Roofing — /);
    assert.match(record.alt, /Naples, FL$/);
    assert.ok(record.alt.trim().length > 0);
  }
  // The plain URL list gets the composed sentence keyed by URL too.
  assert.equal(out.altsByUrl["https://client.example/hero.jpg"], out.imageAlts.find((i) => i.path === "/brand/photo_bank/photos/0").alt);
  // And the alt landed ON the bank entry the downstream engine reads.
  assert.equal(typeof request.brand.photo_bank.photos[0].alt, "string");
  assert.ok(request.brand.photo_bank.photos[0].alt.length > 0);
});

test("alt intake: a supplied usable alt wins; decorative images keep alt=\"\"", () => {
  const request = roofingRequest({
    brand: {
      photo_bank: {
        photos: [
          { url: "https://client.example/crew.jpg", alt: "  Our 2023 crew on a Valrico roof  ", grade: "gallery", subject: "team" },
          { url: "https://client.example/badge.png", decorative: true },
        ],
      },
    },
  });
  const out = validateFacts(request);
  assert.equal(out.ok, true, JSON.stringify(out.detail || []));
  const supplied = out.imageAlts.find((i) => i.path === "/brand/photo_bank/photos/0");
  assert.equal(supplied.source, "supplied");
  assert.equal(supplied.alt, "Our 2023 crew on a Valrico roof");
  const decorative = out.imageAlts.find((i) => i.path === "/brand/photo_bank/photos/1");
  assert.equal(decorative.source, "decorative");
  assert.equal(decorative.alt, "");
  assert.equal(request.brand.photo_bank.photos[1].alt, "");
});

test("alt intake: an unusable supplied alt is a 422 at the boundary, in any mode", () => {
  for (const mode of [undefined, "auto", "strict"]) {
    const brand = {
      photo_bank: { photos: [{ url: "https://client.example/x.jpg", alt: 'roofing <img src="evil">' }] },
    };
    if (mode) brand.alt_policy = { mode };
    const out = validateFacts(roofingRequest({ brand }));
    assert.equal(out.ok, false, `mode ${mode || "default"} must reject`);
    assert.equal(out.error, "invalid_facts");
    assert.equal(out.detail[0].path, "/brand/photo_bank/photos/0/alt");
    assert.equal(out.detail[0].reason, "forbidden_characters");
  }
});

test("alt intake: strict mode rejects a MISSING alt instead of inventing one", () => {
  const request = roofingRequest({
    brand: {
      alt_policy: { mode: "strict" },
      photo_bank: { photos: [{ url: "https://client.example/x.jpg", grade: "gallery" }] },
    },
  });
  const out = validateFacts(request);
  assert.equal(out.ok, false);
  assert.equal(out.detail[0].reason, "alt_required");
  // Auto mode is the default: the same image passes with a generated alt.
  const lenient = validateFacts(roofingRequest({
    brand: { photo_bank: { photos: [{ url: "https://client.example/x.jpg", grade: "gallery" }] } },
  }));
  assert.equal(lenient.ok, true);
  assert.equal(lenient.imageAlts[0].source, "generated");
});

test("alt intake: no images means no alt records and no failure", () => {
  const out = validateFacts(roofingRequest());
  assert.equal(out.ok, true);
  assert.deepEqual(out.imageAlts, []);
  assert.deepEqual(out.altsByUrl, {});
});

test("alt policy used directly (no facts boundary): it never throws on garbage", () => {
  const result = applyImageAltPolicy({ brand: { photo_bank: { photos: [null, 3, { url: "https://x.example/a.jpg" }] } } }, {});
  // No business name to compose from: flagged, never invented, never thrown.
  assert.equal(result.ok, false);
  assert.ok(result.violations.every((v) => v.reason === "alt_required_no_business_name"));
  assert.deepEqual(serviceHintFromSrc("https://x.example/roof-replacement-2.jpg?q=1"), "roof replacement");
});

// ---------------------------------------------------------------------------
// 2. scripts/validate-schema.js — valid and invalid fixtures, real exit codes
// ---------------------------------------------------------------------------

const SCRIPT = path.join(__dirname, "..", "scripts", "validate-schema.js");

const VALID_BIZ = {
  "@type": ["LocalBusiness", "RoofingContractor"],
  "@id": "https://absolute-roofing.wss-ai.com/#business",
  name: "Absolute Roofing",
  telephone: "+1-239-555-0142",
  url: "https://absolute-roofing.wss-ai.com/",
  address: { "@type": "PostalAddress", streetAddress: "10 Gulf Shore Blvd", addressLocality: "Naples", addressRegion: "FL", postalCode: "34102", addressCountry: "US" },
};

function pageWith(ldObject, extra = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body><h1>t</h1>${extra}<script type="application/ld+json">${JSON.stringify(ldObject)}</script></body></html>`;
}

function writeFixtures(dir) {
  const p = (name) => path.join(dir, name);
  fs.writeFileSync(p("valid.html"), pageWith({ "@graph": [VALID_BIZ, { "@type": "WebSite", name: "Absolute Roofing", url: "https://absolute-roofing.wss-ai.com/" }] }));
  // Missing telephone on the business node.
  fs.writeFileSync(p("missing-phone.html"), pageWith({ "@graph": [{ ...VALID_BIZ, telephone: undefined }] }));
  // Empty string fact — the class that published blank facts live.
  fs.writeFileSync(p("empty-string.html"), pageWith({ "@graph": [{ ...VALID_BIZ, description: "" }] }));
  // The scraper artifact that reached Google through a FAQPage graph.
  fs.writeFileSync(p("artifact.html"), pageWith({ "@graph": [VALID_BIZ, { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "How do I reach you?", acceptedAnswer: { "@type": "Answer", text: "Email frame-A013717F96D5CBAEFCD26EB58FD1540F@mhtml.blink." } }] }] }));
  // Host-adjacent double slash.
  fs.writeFileSync(p("double-slash.html"), pageWith({ "@graph": [{ ...VALID_BIZ, url: "https://absolute-roofing.wss-ai.com//home" }] }));
  // No JSON-LD at all.
  fs.writeFileSync(p("no-schema.html"), "<!doctype html><html lang=\"en\"><head><title>x</title></head><body><h1>x</h1></body></html>");
  // Unparseable JSON-LD.
  fs.writeFileSync(p("broken-json.html"), "<!doctype html><html lang=\"en\"><head><title>x</title></head><body><script type=\"application/ld+json\">{not json</script></body></html>");
  return dir;
}

test("validate-schema: the valid fixture passes (exit 0)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-valid-"));
  writeFixtures(dir);
  const res = spawnSync(process.execPath, [SCRIPT, "--file", path.join(dir, "valid.html"), "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const report = JSON.parse(res.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.reports[0].violations.length, 0);
});

test("validate-schema: each seeded defect class fails with its named code", () => {
  const dir = writeFixtures(fs.mkdtempSync(path.join(os.tmpdir(), "schema-bad-")));
  const expectations = [
    ["missing-phone.html", "missing_required_field"],
    ["empty-string.html", "empty_string"],
    ["artifact.html", "scraper_artifact"],
    ["double-slash.html", "url_double_slash"],
    ["no-schema.html", "no_json_ld"],
    ["broken-json.html", "json_ld_unparseable"],
  ];
  const res = spawnSync(process.execPath, [SCRIPT, "--dir", dir, "--json"], { encoding: "utf8" });
  assert.equal(res.status, 1, "any invalid page must exit non-zero");
  const report = JSON.parse(res.stdout);
  const byFile = Object.fromEntries(report.reports.map((r) => [path.basename(r.label), r.violations.map((v) => v.code)]));
  for (const [file, code] of expectations) {
    assert.ok((byFile[file] || []).includes(code), `${file} must carry ${code}; got ${JSON.stringify(byFile[file])}`);
  }
  assert.ok(byFile["valid.html"].length === 0);
});

test("validate-schema: --strict fails a page that has schema but no business node; help exits 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-strict-"));
  fs.writeFileSync(path.join(dir, "faq-only.html"), pageWith({ "@type": "FAQPage", mainEntity: [] }));
  const strict = spawnSync(process.execPath, [SCRIPT, "--file", path.join(dir, "faq-only.html"), "--strict"], { encoding: "utf8" });
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /missing_business_node/);
  const lenient = spawnSync(process.execPath, [SCRIPT, "--file", path.join(dir, "faq-only.html")], { encoding: "utf8" });
  assert.equal(lenient.status, 0, "page-specific type satisfies the type gate without --strict");
  const help = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
});

// ---------------------------------------------------------------------------
// 3. THE A11Y AUDIT + THE POLISH-SIDE REPAIR
// ---------------------------------------------------------------------------

const DIRTY_PAGE = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Absolute Roofing | Roofing in Naples, FL</title></head>
<body>
<main>
  <h1>Absolute Roofing</h1>
  <img src="/assets/photo-roof-replacement-1.jpg">
  <a href="https://facebook.com/absolute" aria-label="Facebook"></a>
  <a href="https://facebook.com/absolute2"></a>
  <form>
    <input type="tel" name="phone">
    <label for="email">Email</label><input type="email" id="email">
  </form>
  <h3>Skipped level</h3>
</main>
</body>
</html>`;

test("a11y audit: every seeded serious violation is caught with its rule name", () => {
  const report = auditHtml(DIRTY_PAGE);
  assert.equal(report.ok, false);
  for (const rule of ["html-lang", "img-alt", "link-empty", "input-label"]) {
    assert.ok(report.violations.some((v) => v.rule === rule && v.severity === "serious"), `missing ${rule}`);
  }
  assert.ok(report.violations.some((v) => v.rule === "heading-order" && v.severity === "moderate"));
});

test("a11y audit: the clean page passes", () => {
  const report = auditHtml(`<!doctype html>
<html lang="en"><head><title>Clean</title></head><body>
<main id="main"><h1>Clean</h1>
<img src="/a.jpg" alt="A roof">
<a href="/s">Services</a>
<input type="email" id="e" aria-label="Email address">
<h2>More</h2></main></body></html>`);
  assert.equal(report.ok, true, JSON.stringify(report.violations));
});

test("fleet-polish a11y floor repairs the dirty page so the audit passes it", () => {
  const polished = polishSite({ "index.html": DIRTY_PAGE }, { site: { businessName: "Absolute Roofing", industry: "roofing", city: "Naples", state: "FL" } });
  const html = polished.files["index.html"];
  assert.equal(polished.applied.langFixed, 1);
  assert.equal(polished.applied.skipLinks, 1);
  assert.equal(polished.applied.altsAdded, 1);
  assert.equal(polished.applied.linksNamed, 1, "the one nameless link is named from its own href");
  assert.equal(polished.applied.labelsAdded, 1);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<a class="wss-skip-link" href="#wss-main">/);
  assert.match(html, /<main id="wss-main"/);
  assert.match(html, /alt="Absolute Roofing — roof replacement in Naples, FL"/);
  assert.match(html, /<a aria-label="facebook.com" href="https:\/\/facebook.com\/absolute2"><\/a>/);
  assert.match(html, /aria-label="Phone"/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /prefers-reduced-motion/);
  // The repaired page must now pass the auditor: the only remaining finding
  // is the seeded heading skip, which is moderate by contract.
  const report = auditHtml(html);
  assert.equal(report.ok, true, JSON.stringify(report.violations));
  assert.ok(report.violations.some((v) => v.rule === "heading-order" && v.severity === "moderate"));
});

test("fleet-polish a11y floor is idempotent and honors what the donor already ships", () => {
  const donor = `<!doctype html>
<html lang="es"><head><title>Donor</title></head><body>
<main id="donor-main"><h1>Donor</h1>
<img src="/assets/photo-roof.jpg" alt="Existing alt">
<img class="wss-p__badge" src="/assets/badge.png">
<form><input type="hidden" name="csrf"><input type="text" name="full_name"></form>
</main></body></html>`;
  const once = polishSite({ "index.html": donor }, {});
  const twice = polishSite(once.files, {});
  // Donor lang + existing alt + wrapped/skipped controls are authoritative.
  assert.match(once.files["index.html"], /<html lang="es"/);
  assert.equal((once.files["index.html"].match(/lang="es"/g) || []).length, 1);
  assert.match(once.files["index.html"], /alt="Existing alt"/);
  // The badge is decorative -> alt="" (correct for decoration, not generated copy).
  assert.match(once.files["index.html"], /<img alt="" class="wss-p__badge"/);
  assert.equal(once.applied.langFixed, 0, "donor lang kept");
  assert.equal(once.applied.altsAdded, 1, "the badge gets alt=\"\"; the already-named photo is left alone");
  assert.ok(once.applied.labelsAdded >= 1);
  assert.match(once.files["index.html"], /aria-label="Full name"/);
  // Second pass changes nothing.
  assert.equal(twice.applied.langFixed, 0);
  assert.equal(twice.applied.skipLinks, 0);
  assert.equal(twice.applied.altsAdded, 0);
  assert.equal(twice.applied.labelsAdded, 0);
  assert.equal(twice.files["index.html"], once.files["index.html"]);
});

test("a11y floor passes are individually graceful on hostile input", () => {
  for (const pass of [ensureLangAttribute, ensureSkipLink, (h) => imageAltFloor(h, null), formLabelFloor]) {
    const r = pass(42);
    assert.ok(!r.applied && !r.added, "nothing applied on non-string input");
    assert.ok(r.warning, "non-string input must say so");
  }
  // No <main>: the skip link stands down rather than pointing nowhere.
  const noMain = ensureSkipLink("<html><head></head><body><h1>x</h1></body></html>");
  assert.equal(noMain.applied, false);
  assert.match(noMain.html, /<html>/, "untouched when it stands down");
  // The a11y CSS floor rides in the canonical block.
  assert.match(a11yFloorCss(), /:focus-visible/);
});

test("npm run test:a11y self-test proves the gate's teeth (script exit 0)", () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "a11y-check.js")], { encoding: "utf8" });
  assert.match(out, /self-test OK/);
});
