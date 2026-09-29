"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const routes = require("../lib/mirror-engine/routes");
const { checkOwnedPhotos } = require("../lib/render-gate");
const {
  photoAccountingFromRow,
  donorFromRow,
  rankedOutOfBuildReasons,
  mergePhotoReasons,
  createProductionSourceFacts,
} = require("../lib/line-production-source-facts");
const {
  reconcileAdministrativeAreaSchema,
  reconcileLandscapeDonor,
  LANDSCAPE_ADJACENT_TERMS,
} = require("../lib/line-production-gate");
const {
  parallelAudit,
  recoverableProblems,
  repairedResult,
  secondLook,
} = require("../lib/line-render-audit");

function launchWithSnapshots(snapshots) {
  return async () => {
    let currentPath = "/";
    return {
      newPage: async () => ({
        goto: async (url) => {
          currentPath = new URL(url).pathname;
          return { status: () => 200 };
        },
        evaluate: async () => snapshots[currentPath] || snapshots["/"],
        waitForTimeout: async () => {},
      }),
      close: async () => {},
    };
  };
}

test("clean directory-index routes resolve as real static pages for hash validation", () => {
  const files = {
    "index.html": Buffer.from('<a href="/service-area#city">Areas</a>'),
    "service-area/index.html": Buffer.from('<main><h1>Areas</h1><div id="coverage"></div></main>'),
  };
  const inventory = routes.filePaths(files);
  assert.equal(inventory.has("/service-area"), true);
  assert.deepEqual(
    routes.staticMissingHashes(files, [{ path: "/service-area", id: "city" }]),
    [{ path: "/service-area", id: "city" }],
  );

  const withTarget = {
    ...files,
    "service-area/index.html": Buffer.from('<main><h1>Areas</h1><div id="city"></div></main>'),
  };
  assert.deepEqual(routes.staticMissingHashes(withTarget, [{ path: "/service-area", id: "city" }]), []);
});

test("production source facts recover signed photo placement and donor identity", async () => {
  const releaseEvidence = {
    donor: "landscaping-evergreen",
    renderer: "mirror-engine@v1",
    checks: { brand: { photos: { placed: 4, usable: 8, supplied: 8, unplaced: 4 } } },
  };
  const row = { releaseEvidence };
  assert.deepEqual(photoAccountingFromRow(row), {
    placed: 4,
    usable: 8,
    supplied: 8,
    unplaced: 4,
    source: "signed_release_evidence",
  });
  assert.equal(donorFromRow(row), "landscaping-evergreen");

  let received = null;
  const sourceFacts = createProductionSourceFacts({
    sourceFacts: async (_row, options) => {
      received = options;
      return { vertical: "landscaping", photos_captured: 8 };
    },
  });
  const out = await sourceFacts(row, { publishedAggregate: { ok: true } });
  assert.equal(received.photoAccounting.placed, 4);
  assert.equal(out.build_donor, "landscaping-evergreen");
});

test("banked photos beyond the signed build input get exact per-asset reasons instead of a false retention failure", async () => {
  const photos = Array.from({ length: 20 }, (_, index) => ({
    url: `https://client.example/photo-${index + 1}.jpg`,
  }));
  const accounting = { placed: 7, usable: 8, supplied: 8, unplaced: 1 };
  const reasons = rankedOutOfBuildReasons({ photos }, accounting);
  assert.equal(reasons.length, 12);
  assert.equal(reasons[0].url, "https://client.example/photo-9.jpg");
  assert.match(reasons[0].reason, /not_supplied_to_renderer/);

  const releaseEvidence = {
    donor: "tattoo-aurelia",
    renderer: "mirror-engine@v1",
    checks: { brand: { photos: accounting } },
  };
  const sourceFacts = createProductionSourceFacts({
    sourceFacts: async () => ({ vertical: "tattoo", photos_captured: 20, photos_placed: 7 }),
    photoBankForRow: async () => ({ photos }),
  });
  const out = await sourceFacts({ prospectId: "opal", releaseEvidence });
  assert.equal(out.photos_unplaced.length, 12);
  const check = checkOwnedPhotos({ ok: true }, out);
  assert.equal(check.pass, true, check.reason);
  assert.equal(check.evidence.captured, 20);
  assert.equal(check.evidence.placed, 7);
  assert.equal(check.evidence.required, 10);
  assert.equal(check.evidence.gap, 3);
  assert.equal(check.evidence.unplaced_reasons.length, 3);
});

test("photo-cap reconciliation never hides malformed evidence or mixes a different bank version", async () => {
  const additions = [{ url: "https://client.example/late.jpg", reason: "not_supplied_to_renderer" }];
  assert.deepEqual(
    mergePhotoReasons({ photos_unplaced: "corrupt" }, additions),
    { photos_unplaced: "corrupt" },
  );

  const releaseEvidence = {
    donor: "tattoo-aurelia",
    checks: { brand: { photos: { placed: 2, supplied: 8 } } },
  };
  const sourceFacts = createProductionSourceFacts({
    sourceFacts: async () => ({ photos_captured: 20, photos_placed: 2 }),
    photoBankForRow: async () => ({ photos: Array.from({ length: 19 }, (_, i) => ({ url: `https://client.example/${i}.jpg` })) }),
  });
  const out = await sourceFacts({ prospectId: "bank-raced", releaseEvidence });
  assert.equal(out.photos_unplaced, undefined, "a count mismatch leaves the comparative gate fail-closed");
});

test("schema State areaServed is not reclassified as a broken town", () => {
  const dom = {
    ok: true,
    jsonld: [{
      "@type": "Plumber",
      areaServed: [
        { "@type": "City", name: "Chicago" },
        { "@type": "State", name: "IL" },
      ],
    }],
  };
  const fixed = reconcileAdministrativeAreaSchema(dom);
  assert.deepEqual(fixed.jsonld[0].areaServed, [{ "@type": "City", name: "Chicago" }]);
  assert.equal(fixed.administrative_area_schema_reconciled.removed, 1);

  const untyped = reconcileAdministrativeAreaSchema({
    ok: true,
    jsonld: [{ "@type": "Plumber", areaServed: ["IL", { "@type": "City", name: "IL" }] }],
  });
  assert.deepEqual(untyped.jsonld[0].areaServed, ["IL", { "@type": "City", name: "IL" }]);
});

test("only the signed landscaping donor earns adjacent property vocabulary reconciliation", () => {
  const dom = {
    ok: true,
    donorText: "Landscape design around the roof, gutter drainage, paver patios and stonework. Roofing shingles and masonry repair are separate trades.",
  };
  const fixed = reconcileLandscapeDonor(dom, {
    vertical: "landscaping",
    build_donor: "landscaping-evergreen",
  });
  for (const term of LANDSCAPE_ADJACENT_TERMS) {
    assert.equal(new RegExp(`\\b${term}\\b`, "i").test(fixed.donorText), false, term);
  }
  // Unambiguous wrong-trade language is deliberately untouched.
  assert.match(fixed.donorText, /roofing/i);
  assert.match(fixed.donorText, /shingles/i);
  assert.match(fixed.donorText, /masonry/i);

  const wrongDonor = reconcileLandscapeDonor(dom, {
    vertical: "landscaping",
    build_donor: "roofing-falcon-clean",
  });
  assert.equal(wrongDonor.donorText, dom.donorText);
});

test("large route audits keep full coverage and detect cross-chunk collisions", async () => {
  const calls = [];
  const paths = ["/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h", "/i", "/j", "/k", "/l", "/m"];
  const baseAudit = async (_base, options) => {
    calls.push(options.paths.slice());
    const pages = [
      { path: "/", status: 200, chars: 100, text_hash: "home", entity_residue: [], injected_sections: 2, injected_sections_in_markup: 2 },
      ...options.paths.map((p) => ({
        path: p,
        status: 200,
        chars: 100,
        text_hash: p === "/a" || p === "/f" ? "cross-chunk-same" : `hash-${p}`,
        entity_residue: [],
        injected_sections: 0,
        injected_sections_in_markup: 0,
      })),
    ];
    return { status: "passed", problems: [], pages, collisions: [], missing_hash_targets: [], prose: [], paths_rendered: pages.length };
  };
  const result = await parallelAudit("https://example.test", { paths, expectInjectedOn: ["/"] }, baseAudit);
  assert.equal(calls.length, 3, "13 non-home routes should be partitioned into three concurrent proof chunks");
  assert.equal(result.pages.length, 14, "home plus all 13 routes remain in the merged proof");
  assert.equal(result.status, "failed");
  assert.match(result.problems.join(" | "), /route_collisions:\/a=\/f|route_collisions:\/f=\/a/);
});

test("second-look audit only recovers named hydration and heading false negatives", () => {
  const result = {
    status: "failed",
    problems: [
      "injected_content_present_but_not_visible:/",
      'broken_prose:/about:line_ends_with_connector :: "WHAT WE STAND FOR"',
    ],
    pages: [{ path: "/", injected_sections: 0 }],
    prose: [{ path: "/about", artifacts: [{ rule: "line_ends_with_connector", excerpt: "WHAT WE STAND FOR" }] }],
  };
  const plan = recoverableProblems(result);
  assert.ok(plan);
  assert.equal(plan.hidden.has("/"), true);
  const repaired = repairedResult(result, plan, {
    ok: true,
    evidence: {
      "/": { visibleInjected: 3, injectedMarkup: 3, headings: ["Home"] },
      "/about": { visibleInjected: 0, injectedMarkup: 0, headings: ["WHAT WE STAND FOR"] },
    },
  });
  assert.equal(repaired.status, "passed");
  assert.deepEqual(repaired.problems, []);
  assert.equal(repaired.pages[0].injected_sections, 3);

  assert.equal(recoverableProblems({
    ...result,
    problems: ["route_collisions:/=/about"],
  }), null);
  assert.equal(recoverableProblems({
    ...result,
    prose: [{ path: "/", artifacts: [{ rule: "empty_brackets", excerpt: "[ ]" }] }],
  }), null);
});

test("Kidd and Roland roofing recover only after every label and list artifact has DOM proof", async () => {
  const roofingCases = [
    {
      business: "Kidd Roofing",
      area: "Texas",
      artifacts: [
        { rule: "line_ends_with_connector", excerpt: "BEST FOR" },
        { rule: "line_starts_with_separator", excerpt: "• Free, no-pressure roof inspections" },
        { rule: "line_starts_with_separator", excerpt: "• Photo-documented findings and clear written es" },
        { rule: "line_starts_with_separator", excerpt: "• Residential and commercial — Texas & the surro" },
      ],
    },
    {
      business: "Roland's Roofing Co. Inc.",
      area: "Austin",
      artifacts: [
        { rule: "line_ends_with_connector", excerpt: "BEST FOR" },
        { rule: "line_starts_with_separator", excerpt: "• Free, no-pressure roof inspections" },
        { rule: "line_starts_with_separator", excerpt: "• Photo-documented findings and clear written es" },
        { rule: "line_starts_with_separator", excerpt: "• Residential and commercial — Austin & the surr" },
      ],
    },
  ];

  for (const fixture of roofingCases) {
    const result = {
      status: "failed",
      problems: ['broken_prose:/:line_ends_with_connector :: "BEST FOR"'],
      pages: [{ path: "/", injected_sections: 3 }],
      prose: [{ path: "/", artifacts: fixture.artifacts }],
    };
    const plan = recoverableProblems(result);
    assert.ok(plan, fixture.business);
    assert.equal(plan.headingArtifacts.length, 1, fixture.business);
    assert.equal(plan.separatorArtifacts.length, 3, fixture.business);

    const recovery = await secondLook("https://example.test", plan, {
      launch: launchWithSnapshots({
        "/": {
          visibleInjected: 3,
          injectedMarkup: 3,
          headings: [],
          shortLabels: ["SYSTEM", "BEST FOR", "SCOPE HANDLED", "MATERIALS"],
          listItems: [
            { rendered: "• Free, no-pressure roof inspections", content: "Free, no-pressure roof inspections" },
            { rendered: "• Photo-documented findings and clear written estimates", content: "Photo-documented findings and clear written estimates" },
            { rendered: `• Residential and commercial — ${fixture.area} & the surrounding area`, content: `Residential and commercial — ${fixture.area} & the surrounding area` },
          ],
          separatorContinuations: [],
        },
      }),
    });
    assert.equal(recovery.ok, true, `${fixture.business}: ${recovery.reason || "no reason"}`);
    assert.equal(repairedResult(result, plan, recovery).status, "passed", fixture.business);

    if (fixture.business === "Kidd Roofing") {
      const incomplete = await secondLook("https://example.test", plan, {
        launch: launchWithSnapshots({
          "/": {
            visibleInjected: 3,
            injectedMarkup: 3,
            headings: [],
            shortLabels: ["BEST FOR"],
            listItems: [
              { rendered: "• Free, no-pressure roof inspections", content: "Free, no-pressure roof inspections" },
              { rendered: "• Photo-documented findings and clear written estimates", content: "Photo-documented findings and clear written estimates" },
            ],
            separatorContinuations: [],
          },
        }),
      });
      assert.equal(incomplete.ok, false, "one missing list proof keeps the whole prose failure closed");
      assert.match(incomplete.reason, /^second_look_prose_separator_unproven:/);
    }
  }
});

test("Carlton Electric separator fragments recover only with a nonempty preceding sibling", async () => {
  const result = {
    status: "failed",
    problems: ['broken_prose:/:line_starts_with_separator :: "· DENVER COUNTY"'],
    pages: [{ path: "/", injected_sections: 4 }],
    prose: [{
      path: "/",
      artifacts: [
        { rule: "line_starts_with_separator", excerpt: "· DENVER COUNTY" },
        { rule: "line_starts_with_separator", excerpt: "· DENVER COUNTY" },
        { rule: "line_starts_with_separator", excerpt: "· 3 reviews" },
      ],
    }],
  };
  const plan = recoverableProblems(result);
  assert.ok(plan);
  const recovery = await secondLook("https://example.test", plan, {
    launch: launchWithSnapshots({
      "/": {
        visibleInjected: 4,
        injectedMarkup: 4,
        headings: [],
        shortLabels: [],
        listItems: [],
        separatorContinuations: [
          { text: "· DENVER COUNTY", preceding: "DENVER, CO" },
          { text: "· 3 reviews", preceding: "3.7" },
        ],
      },
    }),
  });
  assert.equal(recovery.ok, true, recovery.reason);
  assert.equal(repairedResult(result, plan, recovery).status, "passed");
});

test("an orphan leading separator remains failed without exact DOM context", async () => {
  const result = {
    status: "failed",
    problems: ['broken_prose:/:line_starts_with_separator :: "· Clarksville /"'],
    pages: [{ path: "/", injected_sections: 0 }],
    prose: [{ path: "/", artifacts: [{ rule: "line_starts_with_separator", excerpt: "· Clarksville /" }] }],
  };
  const plan = recoverableProblems(result);
  assert.ok(plan, "the named rule may receive a second look");
  const recovery = await secondLook("https://example.test", plan, {
    launch: launchWithSnapshots({
      "/": {
        visibleInjected: 0,
        injectedMarkup: 0,
        headings: [],
        shortLabels: [],
        listItems: [],
        separatorContinuations: [],
      },
    }),
  });
  assert.equal(recovery.ok, false);
  assert.match(recovery.reason, /^second_look_prose_separator_unproven:/);
  assert.equal(result.status, "failed", "failed audit is unchanged when fresh DOM proof is absent");
});

test("concrete donor ships one self-contained bundle with no ESM to transpile", () => {
  // 2026-08-19: the fragile SSG dist (many ESM chunks, each needing a .js.raw
  // sidecar, and un-buildable at serve time) was replaced with a client-SPA
  // recompile of the identical source: ONE bundle, zero ESM syntax, nothing
  // for Vercel's transpiler to touch. The cross-library law stays enforced by
  // test/donor-esm-invariant.test.js.
  const dir = path.join(__dirname, "..", "donors-clean", "concrete-elconstruction", "assets");
  const names = fs.readdirSync(dir);
  assert.deepEqual(names.filter((n) => n.endsWith(".js.raw")), [],
    "the SPA rebuild needs no raw pinning; a sidecar reappearing means the fragile shape is back");
  const bundles = names.filter((n) => /^index-.*\.js$/.test(n));
  assert.equal(bundles.length, 1, `exactly one bundle: ${bundles.join(", ")}`);
  const src = fs.readFileSync(path.join(dir, bundles[0]), "utf8");
  assert.equal(/(^|[;}])\s*(import|export)[{\s]|import\.meta|import\s*\(/.test(src), false,
    "no ESM syntax means Vercel cannot CommonJS-transpile it");
});
