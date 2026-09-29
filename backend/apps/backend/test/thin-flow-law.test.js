"use strict";

// test/thin-flow-law.test.js — SCALING AND RAPID PRODUCTION FLOW.
//
// Owner doctrine 2026-09-04: "The goal is scaling and rapid production flow…
// get more of what we were calling thin sites instead of fully built out rich
// sites that fit our old criteria. Old policeman getting in the way — no
// longer a law."
//
// This file pins the engine changes the doctrine requires:
//
//   1. THE THIN-FLOW LAW. The three quality stages — 3_website_axis_ceiling,
//      6a_first_party_template_fit, 6b_composite_ceiling — still MEASURE and
//      still record (stage `accepted_thin` tallies, packet `qualification.*`
//      scores), but a low score no longer refuses a candidate. The compiler
//      enriches thin content from real harvested evidence. Refusals stay
//      reserved for identity failure, broken sources, and the non-quality
//      hard gates — never for a grade.
//
//   2. THE DEEP-BATCH DEPTH DIAL. LINE_DEEP_BATCH_DEPTH raises the
//      deep-verification wave above the goal-sized cohort so every
//      email-surviving candidate enters stages 6-8 in ONE wave. Default
//      (unset) keeps the historical goal-sized cohort exactly; an invalid
//      value falls back to that default rather than being guessed at.
//
//   3. THE RESUME CAP DIAL (zone-flood campaigns, 2026-09-03).
//      LINE_RESUME_CAP widens the accepted-checkpoint resume payload past
//      its historical 10 rows so a crash mid-deep-batch reconciles the whole
//      flood wave without paying the provider twice. Default 50; invalid
//      values fall back to the default, never guessed.
//
// The ABSOLUTE protections are not touched here and are pinned elsewhere:
// first-party identity verification (the wrong-company graft shield) and the
// truth law (no fabricated facts).

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mineBuildReady,
  lineDeepBatchDepth,
  LINE_DEEP_BATCH_DEPTH_ENV,
  LINE_DEEP_BATCH_DEPTH_CEILING,
} = require("../lib/lead-miner");
const {
  DEEP_BATCH_DEPTH_ENV,
  DEEP_BATCH_DEPTH_CEILING,
  requestedDeepBatchDepth,
  deepBatchDepthForBatch,
  RESUME_CAP_ENV,
  RESUME_CAP_CEILING,
  lineResumeCap,
} = require("../lib/line-quota");
const { pickProspects } = require("../lib/line-adapters");
const adminLine = require("../api/admin/line");

// ---------------------------------------------------------------------------
// The dial, read directly.
// ---------------------------------------------------------------------------

test("LINE_DEEP_BATCH_DEPTH defaults to the historical goal-sized cohort", () => {
  assert.equal(DEEP_BATCH_DEPTH_ENV, "LINE_DEEP_BATCH_DEPTH");
  assert.equal(lineDeepBatchDepth({}), 0, "unset keeps the default wave (0 = no raise)");
  assert.equal(lineDeepBatchDepth({ [LINE_DEEP_BATCH_DEPTH_ENV]: "" }), 0, "blank keeps the default");
  assert.equal(lineDeepBatchDepth(), 0, "reading process.env when unset keeps the default");
});

test("LINE_DEEP_BATCH_DEPTH parses whole values and clamps to the SERP ceiling", () => {
  assert.equal(lineDeepBatchDepth({ [LINE_DEEP_BATCH_DEPTH_ENV]: "40" }), 40);
  assert.equal(lineDeepBatchDepth({ [LINE_DEEP_BATCH_DEPTH_ENV]: " 12 " }), 12, "surrounding space is not a value");
  assert.equal(lineDeepBatchDepth({ [LINE_DEEP_BATCH_DEPTH_ENV]: String(LINE_DEEP_BATCH_DEPTH_CEILING) }), 100);
  assert.equal(lineDeepBatchDepth({ [LINE_DEEP_BATCH_DEPTH_ENV]: "150" }), 100,
    "beyond the provider SERP width is a typo, not a dial");
});

test("invalid LINE_DEEP_BATCH_DEPTH values fall back to the default, never guessed", () => {
  for (const bad of ["banana", "12.5", "-4", "0", "NaN", "40 sites", "forty"]) {
    assert.equal(lineDeepBatchDepth({ [LINE_DEEP_BATCH_DEPTH_ENV]: bad }), 0, `value ${JSON.stringify(bad)} must fall back`);
  }
});

test("the quota-side reader resolves env and batch-stamped requests", () => {
  assert.equal(requestedDeepBatchDepth({}), null);
  assert.equal(requestedDeepBatchDepth({ [DEEP_BATCH_DEPTH_ENV]: "40" }), 40);
  assert.equal(requestedDeepBatchDepth({ [DEEP_BATCH_DEPTH_ENV]: "500" }), DEEP_BATCH_DEPTH_CEILING);
  assert.equal(requestedDeepBatchDepth({ [DEEP_BATCH_DEPTH_ENV]: "nope" }), null);

  const contractRow = (extra = {}) => [{
    stage: "quota_contract_finished_sites_v1",
    entered: 10,
    survived: 0,
    rejected: {},
    ...extra,
  }];
  // No stamp, no env -> null (historical behaviour).
  assert.equal(deepBatchDepthForBatch({ mineFunnel: contractRow() }, {}), null);
  // Env alone applies to every batch.
  assert.equal(deepBatchDepthForBatch({ mineFunnel: contractRow() }, { [DEEP_BATCH_DEPTH_ENV]: "40" }), 40);
  // A stamped request wins over the environment, so a campaign keeps its wave.
  assert.equal(deepBatchDepthForBatch({ mineFunnel: contractRow({ deep_batch_depth: 40 }) }, { [DEEP_BATCH_DEPTH_ENV]: "12" }), 40);
  // Invalid stamps are ignored rather than trusted.
  assert.equal(deepBatchDepthForBatch({ mineFunnel: contractRow({ deep_batch_depth: -3 }) }, { [DEEP_BATCH_DEPTH_ENV]: "12" }), 12);
  assert.equal(deepBatchDepthForBatch({ mineFunnel: [] }, { [DEEP_BATCH_DEPTH_ENV]: "12" }), 12);
  assert.equal(deepBatchDepthForBatch(null, {}), null);
});

// ---------------------------------------------------------------------------
// The dial, wired through the start path.
// ---------------------------------------------------------------------------

test("the start route resolves the campaign's wave request and refuses invalid ones", () => {
  // Body request wins.
  assert.deepEqual(adminLine.requestedStartDeepBatchDepth({ deepBatchDepth: "40" }, {}), { ok: true, depth: 40 });
  assert.deepEqual(adminLine.requestedStartDeepBatchDepth({ deepBatchDepth: 25 }, {}), { ok: true, depth: 25 });
  assert.deepEqual(adminLine.requestedStartDeepBatchDepth({ deepBatchDepth: "150" }, {}), { ok: true, depth: 100 });
  // Absent -> environment; neither -> default (no stamp).
  assert.deepEqual(adminLine.requestedStartDeepBatchDepth({}, { [DEEP_BATCH_DEPTH_ENV]: "40" }), { ok: true, depth: 40 });
  assert.deepEqual(adminLine.requestedStartDeepBatchDepth({}, {}), { ok: true, depth: null });
  assert.deepEqual(adminLine.requestedStartDeepBatchDepth(undefined, {}), { ok: true, depth: null });
  // An invalid request refuses the start loudly instead of being guessed at.
  assert.equal(adminLine.requestedStartDeepBatchDepth({ deepBatchDepth: "-2" }, {}).ok, false);
  assert.equal(adminLine.requestedStartDeepBatchDepth({ deepBatchDepth: "forty" }, {}).ok, false);
});

test("pickProspects keeps the goal-sized cohort by default and floods when the dial is set", async () => {
  const calls = [];
  const mineStub = async (input) => {
    calls.push({ candidatesPerQuery: input.candidatesPerQuery, limit: input.limit });
    return { ok: true, rows: [], funnel: [] };
  };
  const deps = {
    mineLeads: mineStub,
    select: async () => ({ ok: true, data: [] }),
    selectRows: async () => ({ mode: "not_requested", rows: [] }),
  };
  const run = (overrides = {}) => pickProspects({
    target: "plumbing in Austin, TX",
    count: 10,
    lane: "live",
    ...overrides,
  }, deps);

  // DEFAULT: exactly the historical bound — the goal-sized cohort.
  await run();
  assert.equal(calls.at(-1).candidatesPerQuery, 10, "unset dial keeps the goal-sized cohort");
  await run({ count: 3 });
  assert.equal(calls.at(-1).candidatesPerQuery, 3, "a small quota still clips to the quota");

  const previous = process.env[DEEP_BATCH_DEPTH_ENV];
  try {
    // ENV DIAL: the wider cohort is graded in one wave (goal seated, surplus banked).
    process.env[DEEP_BATCH_DEPTH_ENV] = "40";
    await run();
    assert.equal(calls.at(-1).candidatesPerQuery, 40, "the env dial raises the wave above the goal");
    await run({ count: 60 });
    assert.equal(calls.at(-1).candidatesPerQuery, 60, "the wave never exceeds the actual deficit");
    // Campaign-level request rides the input and wins over the environment.
    await run({ deepBatchDepth: 25 });
    assert.equal(calls.at(-1).candidatesPerQuery, 25, "the batch's stamped request wins over the env dial");
    // INVALID: falls back to the historical cohort, never guessed.
    process.env[DEEP_BATCH_DEPTH_ENV] = "banana";
    await run();
    assert.equal(calls.at(-1).candidatesPerQuery, 10, "an invalid env value keeps the default cohort");
  } finally {
    if (previous === undefined) delete process.env[DEEP_BATCH_DEPTH_ENV];
    else process.env[DEEP_BATCH_DEPTH_ENV] = previous;
  }
});

// ---------------------------------------------------------------------------
// The resume cap dial (zone-flood campaigns, 2026-09-03): the
// accepted-checkpoint payload that survives a crash mid-deep-batch.
// ---------------------------------------------------------------------------

test("LINE_RESUME_CAP defaults to 50 and clamps to the SERP ceiling", () => {
  assert.equal(RESUME_CAP_ENV, "LINE_RESUME_CAP");
  assert.equal(lineResumeCap({}), 50, "unset widens the checkpoint to a full flood wave");
  assert.equal(lineResumeCap({ [RESUME_CAP_ENV]: "" }), 50, "blank keeps the default");
  assert.equal(lineResumeCap(), 50, "reading process.env when unset keeps the default");
  assert.equal(lineResumeCap({ [RESUME_CAP_ENV]: "12" }), 12);
  assert.equal(lineResumeCap({ [RESUME_CAP_ENV]: " 30 " }), 30, "surrounding space is not a value");
  assert.equal(lineResumeCap({ [RESUME_CAP_ENV]: String(RESUME_CAP_CEILING) }), 100);
  assert.equal(lineResumeCap({ [RESUME_CAP_ENV]: "500" }), RESUME_CAP_CEILING,
    "beyond the provider SERP width is a typo, not a dial");
  for (const bad of ["banana", "12.5", "-4", "0", "NaN", "50 rows", "fifty"]) {
    assert.equal(lineResumeCap({ [RESUME_CAP_ENV]: bad }), 50, `value ${JSON.stringify(bad)} must fall back`);
  }
});

test("pickProspects stages every flood-wave accepted row in the checkpoint payload", async () => {
  const floodRows = (count) => Array.from({ length: count }, (_, index) => ({
    prospect_id: `flood-${String(index + 1).padStart(2, "0")}`,
    build_hash: `${"a".repeat(62)}${String(index + 1).padStart(2, "0")}`,
    persistence: "created",
  }));
  const staged = [];
  const deps = {
    mineLeads: async () => ({ ok: true, rows: floodRows(25), funnel: [] }),
    selectRows: async () => ({ mode: "not_requested", rows: [] }),
    // Empty reload data: the pick stops at the natural contract-hash
    // mismatch right AFTER the accepted checkpoint is staged, which is the
    // boundary this test pins.
    select: async () => ({ ok: true, data: [] }),
  };
  const run = () => pickProspects({
    target: "plumbing in Austin, TX",
    count: 25,
    lane: "live",
    onStage: async (name, detail) => {
      if (name === "mine_build_ready_accepted") staged.push(detail.acceptedRows);
    },
  }, deps);

  await assert.rejects(run(), /persisted_contract_hash_mismatch/);
  assert.equal(staged.length, 1);
  assert.equal(staged[0].length, 25, "all 25 accepted rows ride the checkpoint payload, not the first 10");
  assert.deepEqual(staged[0][24], { prospect_id: "flood-25", build_hash: `${"a".repeat(62)}25` });

  // The env dial narrows the payload for operators who want the old shape.
  staged.length = 0;
  const previous = process.env[RESUME_CAP_ENV];
  try {
    process.env[RESUME_CAP_ENV] = "12";
    await assert.rejects(run(), /persisted_contract_hash_mismatch/);
    assert.equal(staged[0].length, 12, "LINE_RESUME_CAP=12 keeps only 12 durable rows");
  } finally {
    if (previous === undefined) delete process.env[RESUME_CAP_ENV];
    else process.env[RESUME_CAP_ENV] = previous;
  }
});

// ---------------------------------------------------------------------------
// The dial, wired through the miner: the deep-verification wave itself.
// ---------------------------------------------------------------------------

const WAVE_SITES = 12;

function waveFetchImpl() {
  const sites = Array.from({ length: WAVE_SITES }, (_, i) => `https://wave-plumbing-${String(i + 1).padStart(2, "0")}.example/`);
  return async (url) => {
    const href = String(url && url.url ? url.url : url);
    if (href.includes("firecrawl")) {
      return new Response(JSON.stringify({
        data: sites.map((site, i) => ({ url: site, title: `Wave Plumbing ${i + 1} | Spokane WA` })),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const match = href.match(/wave-plumbing-(\d+)\.example/);
    if (match) {
      const n = Number(match[1]);
      return new Response(`<!doctype html><html><head>
        <title>Wave Plumbing ${n} | Spokane WA</title></head><body>
        <h1>Wave Plumbing ${n}</h1><p>Plumbing repairs and water heaters in Spokane.</p>
        <a href="mailto:wave${n}@example.com">Email us</a></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };
}

function waveInput(envOverrides = {}) {
  return {
    trigger: "operator_line",
    lane: "sandbox",
    queries: [{ industry: "plumbing", location: "Spokane WA", textQuery: "plumbing in Spokane WA", queryGroup: 0 }],
    // A narrow per-query allowance with a wide search is exactly the
    // production shape: many survivors, small historical proof pool.
    candidatesPerQuery: 1,
    env: {
      FIRECRAWL_API_KEY: "firecrawl-test-key",
      GOOGLE_PLACES_API_KEY: "places-key-that-must-not-be-used",
      GHOST_AGENCY_OPERATOR_LINE_FIRECRAWL_FALLBACK_LIMIT: "0",
      GHOST_AGENCY_MINER_BRANDING_FALLBACK: "0",
      GHOST_AGENCY_PHOTO_BANK: "false",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
      GHOST_AGENCY_MINER_DIRECTORY_CRAWL: "0",
      GHOST_AGENCY_MAPS_DISCOVERY: "0",
      GHOST_AGENCY_IDENTITY_TRUST: "0",
      ...envOverrides,
    },
    fetchImpl: waveFetchImpl(),
    resolveMx: async () => [{ exchange: "mx.example", priority: 10 }],
    mirrorImpl: async () => ({
      ok: true,
      status: 200,
      body: {
        ok: true, build_hash: "wave-hash", donor_content_hash: "donor", file_count: 51,
        evidence_sha: "sha", renderer: "mirror-engine@v1",
        checks: { brand: { status: "passed", logo_refs_in_output: 0 } },
      },
    }),
  };
}

const stageRow = (out, name) => (out.funnel || []).find((stage) => stage.stage === name);

test("default wave: only the goal-sized pool reaches deep verification", async () => {
  const out = await mineBuildReady(waveInput());
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 400));
  const identity = stageRow(out, "6_first_party_identity");
  assert.ok(identity, JSON.stringify(out.funnel));
  assert.equal(identity.entered, 5,
    "without the dial the historical proof pool (max(perQuery, 5)) still bounds deep verification");
  assert.equal(out.records.length, 1,
    "the historical quota stop still proves only the goal-sized cohort (perQuery=1 here)");
  assert.equal(costOf(out, "homepage_fetches"), WAVE_SITES, "every survivor was fetched — the wide search still ran");
});

test("LINE_DEEP_BATCH_DEPTH=40 floods the wave: every email survivor deep-verifies in one pass", async () => {
  const out = await mineBuildReady(waveInput({ [LINE_DEEP_BATCH_DEPTH_ENV]: "40" }));
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 400));
  const identity = stageRow(out, "6_first_party_identity");
  assert.equal(identity.entered, WAVE_SITES,
    "all email-surviving candidates enter deep verification in ONE wave");
  assert.equal(out.records.length, WAVE_SITES, JSON.stringify(out.funnel));
  assert.equal(costOf(out, "dry_runs"), WAVE_SITES, "the wave is real build proof, not a paperwork pass");
});

test("an invalid LINE_DEEP_BATCH_DEPTH falls back to the historical wave", async () => {
  for (const bad of ["banana", "0", "-40", "12.6"]) {
    const out = await mineBuildReady(waveInput({ [LINE_DEEP_BATCH_DEPTH_ENV]: bad }));
    assert.equal(out.ok, true);
    assert.equal(stageRow(out, "6_first_party_identity").entered, 5,
      `value ${JSON.stringify(bad)} must keep the historical pool`);
  }
});

function costOf(out, key) {
  return Number((out.cost || {})[key]) || 0;
}

// ---------------------------------------------------------------------------
// THE THIN-FLOW LAW: the three quality stages record, never refuse.
// ---------------------------------------------------------------------------

// A real first-party business identity (schema LocalBusiness with a postal
// address) whose first-party SERVICE evidence is below the template-fit
// threshold. Under the old law 6a refused this candidate after its identity
// was proven; under the thin-flow law the same verdict is recorded and the
// candidate proceeds. The LIVE lane is deliberate: the thin-flow law must
// hold where identity is fully proven, not only in the owner-only practice
// lane — and the identity and trade hard gates around it stay shut.
const DANCE_HTML = `<!doctype html><html><head>
  <title>Duke Plumbing | Spokane WA</title>
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Duke Plumbing",
    telephone: "(509) 555-0142",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Spokane",
      addressRegion: "WA",
      postalCode: "99201",
    },
  })}</script>
</head><body>
  <h1>Duke Plumbing</h1>
  <p>Ballet, tap, and jazz classes for kids. Recital tickets each spring.</p>
  <p>Faculty, schedules, tuition, and registration for the spring recital.</p>
  <a href="mailto:hello@dukeplumbing.example">Email the studio</a>
</body></html>`;

test("6a template-fit records the mismatch as accepted_thin and the candidate proceeds", async () => {
  const fetchImpl = async (url) => {
    const href = String(url && url.url ? url.url : url);
    if (href.includes("firecrawl")) {
      return new Response(JSON.stringify({
        data: [{ url: "https://dukeplumbing.example/", title: "Duke Plumbing | Spokane WA" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href.startsWith("https://dukeplumbing.example")) {
      return new Response(DANCE_HTML, { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };
  const out = await mineBuildReady({ ...waveInput(), lane: "live", fetchImpl });
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 400));

  const identity = stageRow(out, "6_first_party_identity");
  assert.equal(identity.survived, 1, "the first-party identity is fully proven — it must be");
  const fit = stageRow(out, "6a_first_party_template_fit");
  assert.ok(fit, JSON.stringify(out.funnel));
  assert.equal(fit.entered, 1);
  assert.equal(fit.survived, 1, "the template-fit mismatch no longer refuses the candidate");
  assert.equal(fit.accepted_thin.template_family_fit_below_threshold, 1,
    "the stage records WHY the old law would have refused");
  assert.equal(out.rejects.some((item) => item.stage === "6a_first_party_template_fit"), false,
    "no template-fit refusal may appear in the reject list");

  // The verdict itself is still measured and still on the packet — provenance
  // keeps the number even though the gate no longer binds. The ABSOLUTE
  // protections beside it stay on: identity is first-party-proven and the
  // trade gate passed on the site's own words.
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects));
  assert.equal(out.records[0].qualification.template_fit.ok, false);
  assert.equal(out.records[0].qualification.template_fit.reason, "template_family_fit_below_threshold");
  assert.equal(out.records[0].identity_source, "first_party");
  assert.equal(out.records[0].trade_corroboration.ok, true);
});

test("6b composite ceiling records accepted_thin and the candidate proceeds", async () => {
  // A page that MEASURES a real composite (B-: live https, responsive, schema,
  // h1 — measured in development for this fixture) with the ceiling set below
  // its grade. Under the old law the composite ceiling refused it outright;
  // under the thin-flow law it can only record.
  const fetchImpl = async (url) => {
    const href = String(url && url.url ? url.url : url);
    if (href.includes("firecrawl")) {
      return new Response(JSON.stringify({
        data: [{ url: "https://wave-plumbing-07.example/", title: "Wave Plumbing 7 | Spokane WA" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (/wave-plumbing-07\.example/.test(href)) {
      return new Response(`<!doctype html><html><head>
        <title>Wave Plumbing 7 | Spokane WA</title>
        <meta name="viewport" content="width=device-width">
        <script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          name: "Wave Plumbing 7",
          address: { "@type": "PostalAddress", addressLocality: "Spokane", addressRegion: "WA", postalCode: "99201" },
        })}</script>
        </head><body>
        <h1>Wave Plumbing 7</h1><p>Plumbing repairs and water heaters.</p>
        <a href="mailto:wave7@example.com">Email us</a></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };
  const out = await mineBuildReady({ ...waveInput({ GHOST_AGENCY_COMPOSITE_CEILING: "D" }), fetchImpl });
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 400));

  const composite = stageRow(out, "6b_composite_ceiling");
  assert.ok(composite, JSON.stringify(out.funnel));
  assert.equal(composite.entered, 1);
  assert.equal(composite.survived, 1, "the composite ceiling no longer refuses the candidate");
  assert.equal(composite.accepted_thin.composite_above_D, 1,
    "the stage records the ceiling that would have refused");
  assert.equal(out.rejects.some((item) => item.stage === "6b_composite_ceiling"), false,
    "no composite refusal may appear in the reject list");
  assert.equal(out.records.length, 1, "the thin candidate reaches build proof");
  assert.ok(out.records[0].qualification.composite_signal,
    "the measured composite still rides the packet");
  assert.equal(out.records[0].qualification.composite_signal.grade, "D+");
});

test("the thin-flow law never resurrects a fabricated claim: the packet records the true score", async () => {
  // Truth law (ABSOLUTE): recording an acceptance must not upgrade what was
  // measured. The dance studio accepted at 6a still says template_fit.ok is
  // false; the modern-premium pin in miner-retarget-wiring asserts the same
  // for the website axis. This test pins the row arithmetic instead: a stage
  // that accepted thin candidates still reconciles
  // entered === survived + Σ rejected, with accepted_thin inside survived.
  const out = await mineBuildReady(waveInput({ [LINE_DEEP_BATCH_DEPTH_ENV]: "40" }));
  assert.equal(out.ok, true);
  for (const stage of out.funnel || []) {
    const rejected = Object.values(stage.rejected || {}).reduce((sum, n) => sum + n, 0);
    const thin = Object.values(stage.accepted_thin || {}).reduce((sum, n) => sum + n, 0);
    assert.ok(thin <= stage.survived,
      `${stage.stage}: accepted_thin counts sit inside survived, never beside them`);
    if (String(stage.stage).match(/^(3_|6a_|6b_)/)) {
      assert.equal(stage.entered, stage.survived + rejected,
        `${stage.stage}: the arithmetic still reconciles under the thin-flow law`);
    }
  }
});
