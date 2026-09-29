"use strict";

// test/donor-library-integrity.test.js — THE LIBRARY THE ENGINE ACTUALLY SEES.
//
// Three defects found by auditing the whole donor library on 2026-07-31. Each
// one passed every existing gate, which is the point: a status field is not
// evidence.
//
// 1. SPLIT-BRAIN DONOR ROOT (P0, production).
//    api/mirror.js never sets MIRROR_DONOR_ROOT, so production ran on the
//    default. lib/mirror-engine/donor.js defaulted to boilerplates/ while
//    lib/donor-verticals.js — the alias layer api/mirror.js applies to every
//    request — defaulted to donors-clean/. Two halves of ONE request path
//    disagreed about where donors live. Proven at the console before the fix:
//        applyDonorAlias(industry:"masonry") -> concrete-elconstruction
//        resolveDonor({donor:"concrete-elconstruction"}) -> 404 no_built_dist
//        resolveDonor({industry:"concrete"}) -> 404 no_donor_for_vertical
//        resolveDonor({industry:"fencing"})  -> 404 no_donor_for_vertical
//    concrete and fencing are the two verticals the clean library was BUILT
//    for and neither could be mirrored at all.
//
// 2. A DONOR WITH NO MANIFEST HAS NO IDENTITY GATE (P0, safety).
//    boilerplates/roofing-tekline had no BOILERPLATE.json. readManifest()
//    returns {} for that, so identityScan() built an EMPTY atom list and
//    returned clean:true for any bytes — while that donor's index.html
//    hardcodes a third party's street address, geo coordinates and Google
//    Analytics id. Retirement needs a manifest to live in, so "no manifest"
//    was also "cannot be retired".
//
// 3. AN OPTIONAL FACT MUST NEVER 500 A BUILD (P1).
//    concrete-elconstruction welded a literal ";" between {{GEO_LAT}} and
//    {{GEO_LNG}} in an unguarded <meta>, so every concrete prospect without
//    verified coordinates got 500 unguarded_optional_slot. TRUTH LAW says a
//    blank is correct; the donor has to collapse it, not fail.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONORS_CLEAN = path.join(BACKEND, "donors-clean");
const BOILERPLATES = path.join(BACKEND, "boilerplates");

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-library-"));

const { resolveDonor, donorRoot, listDonors, donorRetirement } = require("../lib/mirror-engine/donor");
const { identityScan } = require("../lib/mirror-engine/scan");
const { applyDonorAlias, loadTable } = require("../lib/donor-verticals");
const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");

/** Every engine donor root. site-forge-lane/donors is NOT one — those are
 *  source repos with no manifests and no {{TOKEN}}s; see the audit notes. */
const ENGINE_ROOTS = [DONORS_CLEAN, BOILERPLATES];

const donorDirs = (root) =>
  fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

// ---------------------------------------------------------------------------
// 1. One library, agreed on by both halves of the request path
// ---------------------------------------------------------------------------
test("the engine and the alias layer resolve donors from the SAME default root", () => {
  const prev = process.env.MIRROR_DONOR_ROOT;
  delete process.env.MIRROR_DONOR_ROOT;
  try {
    assert.equal(path.resolve(donorRoot()), path.resolve(DONORS_CLEAN),
      "the engine default must be the real library, not the boilerplates scratch folder");

    // The alias layer's own default is exercised through its public API: it
    // refuses to alias a vertical the engine already owns, which is only true
    // if both are reading the same directory.
    const owned = applyDonorAlias({ facts: { industry: "concrete" } });
    assert.equal(owned.applied, null,
      "concrete is a live vertical in the shared root, so the alias table must stand down");
  } finally {
    if (prev === undefined) delete process.env.MIRROR_DONOR_ROOT;
    else process.env.MIRROR_DONOR_ROOT = prev;
  }
});

test("the verticals the clean library was built for actually resolve", () => {
  const prev = process.env.MIRROR_DONOR_ROOT;
  delete process.env.MIRROR_DONOR_ROOT;
  try {
    for (const industry of ["concrete", "fencing", "plumbing"]) {
      const res = resolveDonor({ industry });
      assert.equal(res.ok, true, `${industry} does not resolve: ${JSON.stringify(res.detail)}`);
    }
  } finally {
    if (prev === undefined) delete process.env.MIRROR_DONOR_ROOT;
    else process.env.MIRROR_DONOR_ROOT = prev;
  }
});

test("every alias points at a donor that is installed AND in service", () => {
  const prev = process.env.MIRROR_DONOR_ROOT;
  delete process.env.MIRROR_DONOR_ROOT;
  try {
    const aliases = loadTable().aliases || {};
    assert.ok(Object.keys(aliases).length > 0, "expected an alias table");
    for (const [industry, donor] of Object.entries(aliases)) {
      const routed = applyDonorAlias({ facts: { industry } });
      // An alias for a vertical the engine already owns correctly stands down.
      if (!routed.applied) continue;
      assert.equal(routed.body.donor, donor);
      const res = resolveDonor({ donor: routed.body.donor });
      assert.equal(res.ok, true,
        `alias "${industry}" -> ${donor} does not resolve: ${JSON.stringify(res.detail)}`);
    }
  } finally {
    if (prev === undefined) delete process.env.MIRROR_DONOR_ROOT;
    else process.env.MIRROR_DONOR_ROOT = prev;
  }
});

// ---------------------------------------------------------------------------
// 2. No donor without a manifest — an inert identity gate cannot ship again
// ---------------------------------------------------------------------------
test("every installed donor dist carries a BOILERPLATE.json", () => {
  const naked = [];
  for (const root of ENGINE_ROOTS) {
    for (const name of donorDirs(root)) {
      const dir = path.join(root, name);
      if (!fs.existsSync(path.join(dir, "index.html"))) continue; // not a dist
      if (!fs.existsSync(path.join(dir, "BOILERPLATE.json"))) {
        naked.push(path.relative(BACKEND, dir).split(path.sep).join("/"));
      }
    }
  }
  assert.deepEqual(naked, [],
    "a donor with no manifest gets an EMPTY identity-scan atom list, which returns clean:true for any bytes — and it cannot be retired, because retirement lives in the manifest");
});

test("an empty manifest really does make the identity gate inert — that is why the rule above exists", () => {
  // Documents the mechanism rather than trusting it: this is the exact call
  // that returned clean:true for roofing-tekline's contaminated index.html.
  const leaked = {
    "index.html": Buffer.from(
      '<html><body><script type="application/ld+json">{"streetAddress":"635 Industry Dr",' +
      '"addressRegion":"WA","latitude":47.452588999999996}</script></body></html>', "utf8"),
  };
  assert.equal(identityScan(leaked, {}).clean, true,
    "if this ever returns false the gate learned to work without atoms — delete this test and celebrate");
});

// ---------------------------------------------------------------------------
// 3. roofing-tekline is unselectable, both ways in
// ---------------------------------------------------------------------------
test("roofing-tekline is refused by NAME and by VERTICAL, with a reason", () => {
  const byName = resolveDonor({ donor: "roofing-tekline" }, BOILERPLATES);
  assert.equal(byName.ok, false);
  assert.equal(byName.error, "donor_retired");
  assert.match(byName.detail[0].since, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(byName.detail[0].why.length > 10, "the refusal must carry a human reason");

  // Its vertical is prefixed, so no caller-sendable industry string reaches it.
  const manifest = JSON.parse(fs.readFileSync(path.join(BOILERPLATES, "roofing-tekline", "BOILERPLATE.json"), "utf8"));
  assert.match(manifest.vertical, /^__retired__/);
  assert.ok(donorRetirement(manifest), "BOILERPLATE.retired missing — it would go straight back into service");
  assert.ok(Array.isArray(manifest.retired.unretire_requires) && manifest.retired.unretire_requires.length >= 3,
    "the exit criteria must be written down before anyone tries to reverse this");
});

test("the retirement record names the actual contaminants, so a repair has a checklist", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(BOILERPLATES, "roofing-tekline", "BOILERPLATE.json"), "utf8"));
  const blob = JSON.stringify(manifest.retired).toLowerCase();
  for (const contaminant of ["635 industry dr", "g-nm0se1m1t4", "47.45", "addressregion"]) {
    assert.ok(blob.includes(contaminant), `retirement record does not mention ${contaminant}`);
  }
  // And the contaminants really are still in the dist — this donor is retired,
  // not repaired. If someone cleans it, this test tells them to unretire it.
  const html = fs.readFileSync(path.join(BOILERPLATES, "roofing-tekline", "index.html"), "utf8");
  assert.ok(html.includes("635 Industry Dr") && html.includes("G-NM0SE1M1T4"),
    "the dist looks clean now — finish the unretire_requires checklist and put it back in service");
});

test("the retired donors stay on disk — retirement is not deletion", () => {
  for (const name of ["roofing-tekline", "tree-care-dark"]) {
    assert.ok(fs.existsSync(path.join(BOILERPLATES, name, "index.html")), `${name} dist was deleted`);
    assert.ok(listDonors(BOILERPLATES).some((d) => d.name === name),
      `${name} must stay visible in the listing, flagged rather than hidden`);
  }
});

// ---------------------------------------------------------------------------
// 4. A missing OPTIONAL fact collapses; it never 500s a build
// ---------------------------------------------------------------------------
function concreteRequest() {
  return {
    slug: "wss-test-granite-ridge-concrete",
    donor: "concrete-elconstruction",
    facts: {
      business_name: "Granite Ridge Concrete",
      industry: "concrete",
      city: "Boise",
      state: "ID",
      phone: "(208) 555-0161",
      // NO latitude/longitude on purpose — that is the whole test.
    },
  };
}

test("a concrete prospect with no verified coordinates still builds", async () => {
  const prev = process.env.MIRROR_DONOR_ROOT;
  process.env.MIRROR_DONOR_ROOT = DONORS_CLEAN;
  try {
    const res = await mirror(concreteRequest(), { dryRun: true, registry: createRegistry() });
    assert.equal(res.status, 200,
      `geo is OPTIONAL — a blank must collapse, not fail: ${res.body.error} ${JSON.stringify(res.body.detail || "").slice(0, 300)}`);
    assert.equal(res.body.donor, "concrete-elconstruction");
  } finally {
    if (prev === undefined) delete process.env.MIRROR_DONOR_ROOT;
    else process.env.MIRROR_DONOR_ROOT = prev;
  }
});

test("the geo meta is ABSENT from the rendered head when geo is blank, and real when it is not", () => {
  // Rendered bytes, not a check status: the failure this replaces was a
  // <meta> that rendered content=";" for every prospect without coordinates.
  const { loadDonor } = require("../lib/mirror-engine/donor");
  const { hydrate } = require("../lib/mirror-engine/hydrate");
  const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");
  const { files } = loadDonor(path.join(DONORS_CLEAN, "concrete-elconstruction"));

  const tokensFor = (geo) => {
    const tv = {};
    for (const t of ALLOWED_TOKENS) tv[t] = "";
    Object.assign(tv, {
      BUSINESS_NAME: "Granite Ridge Concrete", PHONE: "(208) 555-0161", PHONE_DIGITS: "2085550161",
      CITY: "Boise", ADDRESS_CITY: "Boise", STATE: "ID", REGION: "ID",
      HERO_HEADLINE: "Concrete in Boise, ID", LOGO_URL: "/assets/brand-logo.svg",
      DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
      PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
    });
    if (geo) { tv.GEO_LAT = "43.6150"; tv.GEO_LNG = "-116.2023"; }
    return tv;
  };

  const blank = hydrate({ donorFiles: files, tokenValues: tokensFor(false) });
  assert.equal(blank.ok, true, `blank geo failed to hydrate: ${blank.error}`);
  const blankHtml = blank.files["index.html"].toString("utf8");
  assert.doesNotMatch(blankHtml, /geo\.position/, "the geo meta must collapse, not render an empty value");
  assert.doesNotMatch(blankHtml, /data-collapse-if-empty/, "collapse markers must never ship to a customer");

  const filled = hydrate({ donorFiles: files, tokenValues: tokensFor(true) });
  assert.equal(filled.ok, true, `geo-supplied build failed: ${filled.error}`);
  const filledHtml = filled.files["index.html"].toString("utf8");
  assert.match(filledHtml, /<meta name="geo\.position" content="43\.6150;-116\.2023"\/>/,
    "with real coordinates the meta must still render them");
});
