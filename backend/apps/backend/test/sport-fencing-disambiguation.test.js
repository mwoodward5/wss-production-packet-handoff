"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  inferTrade,
  fencingVerticalVerdict,
} = require("../lib/trade-inference");
const { tradeSwapCheck, mineLeads, persistMinedRows } = require("../lib/lead-miner");
const { buildMirrorForProspect } = require("../lib/mirror-lane-build");
const { pickProspects } = require("../lib/line-adapters");
const { processRowPhase } = require("../lib/line-runner");
const { createLineHandler, defaultSend, quarantineSportFencingProspects } = require("../api/admin/line");

const DUKE_TEXT = fs.readFileSync(
  path.join(__dirname, "fixtures", "duke-city-fencing-site.txt"),
  "utf8",
);

test("Duke City's real sword-sport signals are held before donor resolution or mirror build", async () => {
  const verdict = fencingVerticalVerdict({
    intendedTrade: "fencing",
    categories: ["sports_club", "fencing_school"],
    businessName: "Duke City Fencing",
    siteText: DUKE_TEXT,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "vertical_mismatch_sport_fencing");
  assert.ok(verdict.sportSignals.length >= 2, JSON.stringify(verdict));

  let donorCalls = 0;
  let mirrorCalls = 0;
  const built = await buildMirrorForProspect({
    prospect_id: "wss-test-duke-city-fencing-albuquerque",
    business_name: "Duke City Fencing",
    industry: "fencing",
    site: "https://dukecityfencing.net/",
    site_text: DUKE_TEXT,
    services: ["Fencing classes", "Foil training", "Sabre coaching"],
  }, {
    deps: {
      resolveBuildableDonor: () => { donorCalls += 1; return { ok: true, donor: "fence", vertical: "fencing" }; },
      mirror: async () => { mirrorCalls += 1; return { status: 200, body: { ok: true } }; },
    },
  });
  assert.equal(built.ok, false);
  assert.equal(built.reason, "vertical_mismatch_sport_fencing");
  assert.equal(donorCalls, 0, "sport fencing is quarantined before donor selection");
  assert.equal(mirrorCalls, 0, "sport fencing never reaches a build");
});

test("two sport signals win even when contractor language is also present", () => {
  const verdict = fencingVerticalVerdict({
    intendedTrade: "fencing",
    businessName: "Crossed Blades Fence Company",
    categories: ["general_contractor"],
    siteText: "Fence installation plus sword classes and foil training.",
  });
  assert.equal(verdict.reason, "vertical_mismatch_sport_fencing");
  assert.ok(verdict.sportSignals.includes("sword"));
  assert.ok(verdict.sportSignals.includes("classes"));
  assert.ok(verdict.contractorSignals.length > 0, "fixture must prove sport overrides contractor terms");
});

test("label-less and label-variant sword fencing cannot bypass the guard", () => {
  const labelLess = inferTrade({
    label: "",
    businessName: "Duke City Fencing Club",
    services: ["Fence lessons"],
    siteText: "Olympic coaches teach foil classes.",
  });
  assert.equal(labelLess.reason, "vertical_mismatch_sport_fencing");
  assert.equal(labelLess.blocked, true);

  const variant = inferTrade({
    label: "fencing school",
    businessName: "Duke City Fencing",
    categories: ["sports_club"],
    siteText: "Sword, sabre, and epee classes with an Olympic coach.",
  });
  assert.equal(variant.reason, "vertical_mismatch_sport_fencing");
  assert.equal(variant.blocked, true);
});

test("fencer is not a fence-contractor term and service words cannot create sport signals", () => {
  const fencer = inferTrade({
    label: "",
    services: ["Fencer lessons"],
    siteText: "Olympic coach classes",
  });
  assert.equal(fencer.trade, "", JSON.stringify(fencer));

  const contractor = inferTrade({
    label: "fencing",
    businessName: "Alamo Fence Company",
    services: ["Sports field fencing", "Training facility perimeter fencing"],
    siteText: "Commercial perimeter work for schools and facilities.",
  });
  assert.equal(contractor.trade, "fencing", JSON.stringify(contractor));
  assert.equal(contractor.blocked, undefined);

  const goldenGate = fencingVerticalVerdict({
    intendedTrade: "fencing",
    businessName: "Golden Gate Fencing Club",
    siteText: "Learn fencing today",
  });
  assert.equal(goldenGate.ok, false);
  assert.equal(goldenGate.reason, "fencing_contracting_uncorroborated");
});

test("singular lookalikes do not turn real fence contractors into sword clubs", () => {
  const worldClass = fencingVerticalVerdict({
    intendedTrade: "fencing",
    businessName: "World Class Fence Company",
    siteText: "Safety training for fence installers.",
  });
  assert.equal(worldClass.ok, true, JSON.stringify(worldClass));
  assert.deepEqual(worldClass.sportSignals, ["training"]);

  const trainer = fencingVerticalVerdict({
    intendedTrade: "fencing",
    businessName: "Trainer Fence Company",
    siteText: "Residential fence installation for athlete homes.",
  });
  assert.equal(trainer.ok, true, JSON.stringify(trainer));
  assert.deepEqual(trainer.sportSignals, []);
});

test("the Google/category gate holds Duke City with the named queue reason", () => {
  const out = tradeSwapCheck({
    vertical: "fencing",
    place: {
      displayName: { text: "Duke City Fencing" },
      primaryType: "sports_club",
      types: ["sports_club", "school", "point_of_interest"],
    },
    html: `<main>${DUKE_TEXT}</main>`,
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "vertical_mismatch_sport_fencing");
  assert.ok(out.observed.includes("club"));
  assert.ok(out.observed.includes("coach"));
});

test("a freshly mined Duke result is persisted as held in the same mining run", async (t) => {
  const priorKey = process.env.GOOGLE_PLACES_API_KEY;
  const priorFetch = global.fetch;
  process.env.GOOGLE_PLACES_API_KEY = "test-google-key";
  t.after(() => {
    if (priorKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = priorKey;
    global.fetch = priorFetch;
  });
  const host = "dukecityfencing.net";
  const page = `<!doctype html><html><head>
    <title>Duke City Fencing | Albuquerque NM</title>
    <meta name="description" content="Olympic fencing club classes in Albuquerque.">
    </head><body><header><a href="/"><img class="custom-logo" src="/logo.png" alt="Duke City Fencing logo"></a></header>
    <main>${DUKE_TEXT}<a href="mailto:hello@dukecityfencing.net">Email us</a></main></body></html>`;
  let placesCalls = 0;
  const fetchImpl = async (url) => {
    const href = String(url?.url || url);
    if (href.includes("firecrawl")) {
      return new Response(JSON.stringify({ data: [{ url: `https://${host}/`, title: "Duke City Fencing" }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (href.includes("places.googleapis.com")) {
      placesCalls += 1;
      return new Response(JSON.stringify({ places: [{
        id: "ChIJDukeFreshMine",
        displayName: { text: "Duke City Fencing" },
        formattedAddress: "100 Blade Way, Albuquerque, NM 87102, USA",
        location: { latitude: 35.0844, longitude: -106.6504 },
        websiteUri: `https://${host}/`,
        primaryType: "sports_club",
        types: ["sports_club", "school", "point_of_interest"],
        addressComponents: [
          { types: ["locality"], longText: "Albuquerque", shortText: "Albuquerque" },
          { types: ["administrative_area_level_1"], longText: "New Mexico", shortText: "NM" },
          { types: ["postal_code"], longText: "87102", shortText: "87102" },
        ],
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href.includes("/logo.")) {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect width="300" height="100" fill="#17324d"/><path fill="#d8a31a" d="M0 80h300v20H0z"/></svg>';
      return new Response(svg, { status: 200, headers: { "content-type": "image/svg+xml" } });
    }
    if (href === `https://${host}/`) {
      return new Response(page, { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`unstubbed fetch ${href}`);
  };
  global.fetch = fetchImpl;
  let persistedInput = null;
  let mirrorCalls = 0;
  const result = await mineLeads({
    industry: "fencing",
    location: "Albuquerque NM",
    limit: 1,
    candidatesPerQuery: 1,
    // One exact manual candidate: the sport/trade gate needs the GBP category
    // observation, so this is the opted-in single-lookup lane.
    placesVerify: true,
    trigger: "manual_exact",
    env: {
      GOOGLE_PLACES_API_KEY: "test-google-key",
      FIRECRAWL_API_KEY: "test-firecrawl-key",
      GHOST_AGENCY_SPORT_FENCING_GUARD: "1",
    },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.dukecityfencing.net" }],
    mirrorImpl: async () => { mirrorCalls += 1; return { status: 200, body: { ok: true } }; },
    persistMinedRows: async (input) => {
      persistedInput = input;
      return {
        created: input.rows.length,
        updated: 0,
        duplicateSkipped: 0,
        heldForReview: 0,
        writeFailed: 0,
        persistenceAvailable: true,
        rows: input.rows.map((row) => ({ prospect_id: row.prospect_id, persistence: "created" })),
      };
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.emitted, 0, "sport fencing emits no build-ready record");
  assert.equal(result.held, 1, `the fresh mismatch becomes a held prospect: ${JSON.stringify(result)}`);
  assert.equal(placesCalls, 1, "the end-to-end fixture reached the real GBP/category gate");
  assert.equal(mirrorCalls, 0, "no dry-run mirror starts for Duke");
  assert.equal(persistedInput.rows.length, 1);
  const held = persistedInput.rows[0];
  assert.equal(held.status, "held");
  assert.equal(held.record.blocked_reason, "vertical_mismatch_sport_fencing");
  assert.equal(held.record.vertical_hold.reason, "vertical_mismatch_sport_fencing");
});

test("rediscovering an existing unsent Duke row updates the canonical prospect to held", async () => {
  const incoming = {
    prospect_id: "wss-test-duke-city-fencing-albuquerque",
    status: "held",
    business_name: "Duke City Fencing",
    city: "Albuquerque",
    state: "NM",
    current_website: "https://dukecityfencing.net/",
    industry: "fencing",
    record: {
      business_name: "Duke City Fencing",
      city: "Albuquerque",
      state: "NM",
      current_website: "https://dukecityfencing.net/",
      industry: "fencing",
      blocked_reason: "vertical_mismatch_sport_fencing",
      vertical_hold: { reason: "vertical_mismatch_sport_fencing", at: "2026-08-21T02:00:00.000Z" },
    },
  };
  const existing = {
    ...incoming,
    prospect_id: "canonical-duke",
    status: "line_queued",
    preview_url: "https://wss-test-duke-city-fencing-albuquerque.wss-ai.com/",
    record: {
      ...incoming.record,
      status: "line_queued",
      blocked_reason: "",
      vertical_hold: undefined,
    },
  };
  const writes = [];
  const result = await persistMinedRows({
    rows: [incoming],
    persist: true,
    actor: "test",
    trigger: "test",
    selectCount: 1,
    selectRowsImpl: async () => ({ mode: "live_select", rows: [existing] }),
    conditionalUpdateImpl: async (...args) => { writes.push(args); return { ok: true, updated: true }; },
  });
  assert.equal(result.updated, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][2], "canonical-duke");
  assert.equal(writes[0][4].status, "held");
  assert.equal(writes[0][4].record.blocked_reason, "vertical_mismatch_sport_fencing");
  assert.equal(result.rows[0].persistence, "updated_vertical_mismatch_hold");

  writes.length = 0;
  existing.status = "sent";
  existing.record.status = "sent";
  const terminal = await persistMinedRows({
    rows: [incoming],
    persist: true,
    actor: "test",
    trigger: "test",
    selectCount: 1,
    selectRowsImpl: async () => ({ mode: "live_select", rows: [existing] }),
    conditionalUpdateImpl: async (...args) => { writes.push(args); return { ok: true, updated: true }; },
  });
  assert.equal(writes.length, 0, "sent canonical prospects are never rolled back to held");
  assert.equal(terminal.rows[0].persistence, "terminal_sport_mismatch_observed");

  existing.status = "line_queued";
  existing.record.status = "line_queued";
  existing.sent_at = "";
  existing.delivered_at = "2026-08-21T01:02:00.000Z";
  const delivered = await persistMinedRows({
    rows: [incoming],
    persist: true,
    actor: "test",
    trigger: "test",
    selectCount: 1,
    selectRowsImpl: async () => ({ mode: "live_select", rows: [existing] }),
    conditionalUpdateImpl: async (...args) => { writes.push(args); return { ok: true, updated: true }; },
  });
  assert.equal(writes.length, 1, "current line_queued is quarantined despite a historical delivered marker");
  assert.equal(delivered.rows[0].persistence, "updated_vertical_mismatch_hold");

  delete existing.delivered_at;
  existing.status = "line_queued";
  existing.record.status = "line_queued";
  writes.length = 0;
  existing.sent_at = "2026-08-04T01:02:00.000Z";
  const historicalSend = await persistMinedRows({
    rows: [incoming], persist: true, actor: "test", trigger: "test", selectCount: 1,
    selectRowsImpl: async () => ({ mode: "live_select", rows: [existing] }),
    conditionalUpdateImpl: async (...args) => { writes.push(args); return { ok: true, updated: true }; },
  });
  assert.equal(writes.length, 1, "current line_queued is quarantined despite historical sent_at");
  assert.equal(historicalSend.rows[0].persistence, "updated_vertical_mismatch_hold");
  existing.sent_at = "";
  existing.status = "line_queued";
  existing.record.status = "line_queued";
  writes.length = 0;
  const casMiss = await persistMinedRows({
    rows: [incoming],
    persist: true,
    actor: "test",
    trigger: "test",
    selectCount: 1,
    selectRowsImpl: async () => ({ mode: "live_select", rows: [existing] }),
    conditionalUpdateImpl: async () => ({ ok: true, updated: false }),
  });
  assert.equal(casMiss.updated, 0);
  assert.equal(casMiss.writeFailed, 1);
  assert.equal(casMiss.rows[0].persistence, "vertical_hold_write_conflict");
});

test("opportunity-grade rollback cannot filter away a sport-fencing hold", async (t) => {
  const prior = process.env.GHOST_AGENCY_FLAT_SITE_FIRST;
  process.env.GHOST_AGENCY_FLAT_SITE_FIRST = "0";
  t.after(() => {
    if (prior === undefined) delete process.env.GHOST_AGENCY_FLAT_SITE_FIRST;
    else process.env.GHOST_AGENCY_FLAT_SITE_FIRST = prior;
  });
  const writes = [];
  const held = {
    prospect_id: "duke-modern-premium",
    status: "held",
    business_name: "Duke City Fencing",
    city: "Albuquerque",
    state: "NM",
    record: {
      blocked_reason: "vertical_mismatch_sport_fencing",
      vertical_hold: { reason: "vertical_mismatch_sport_fencing" },
      website_probe: { modernPremium: true },
    },
  };
  const result = await persistMinedRows({
    rows: [held], persist: true, actor: "test", trigger: "test", selectCount: 1,
    selectRowsImpl: async () => ({ mode: "live_select", rows: [] }),
    selectImpl: async () => ({ ok: true, data: [] }),
    insertRowImpl: async (_table, row) => { writes.push(row); return { mode: "live_write" }; },
    upsertRowImpl: async () => { throw new Error("sport holds must never merge-upsert"); },
  });
  assert.equal(result.created, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].record.blocked_reason, "vertical_mismatch_sport_fencing");
});

test("a stale broad snapshot cannot overwrite a terminal canonical row with a sport hold", async () => {
  const incoming = {
    prospect_id: "duke-stale-snapshot",
    status: "held",
    business_name: "Duke City Fencing",
    record: {
      blocked_reason: "vertical_mismatch_sport_fencing",
      vertical_hold: { reason: "vertical_mismatch_sport_fencing" },
    },
  };
  let inserts = 0;
  let merges = 0;
  let updates = 0;
  const result = await persistMinedRows({
    rows: [incoming], persist: true, actor: "test", trigger: "test", selectCount: 1,
    selectRowsImpl: async () => ({ mode: "live_select", rows: [] }),
    selectImpl: async () => ({
      ok: true,
      data: [{
        prospect_id: incoming.prospect_id,
        status: "sent",
        sent_at: "2026-08-21T01:00:00.000Z",
        record: { status: "sent" },
      }],
    }),
    insertRowImpl: async () => { inserts += 1; return { mode: "live_write" }; },
    upsertRowImpl: async () => { merges += 1; return { mode: "live_upsert" }; },
    conditionalUpdateImpl: async () => { updates += 1; return { ok: true, updated: true }; },
  });
  assert.equal(result.rows[0].persistence, "terminal_sport_mismatch_observed");
  assert.equal(inserts, 0);
  assert.equal(merges, 0, "a quarantine never merge-overwrites an exact canonical row");
  assert.equal(updates, 0);
});

test("a concurrent sport-hold insert conflict is retryable and never becomes a merge", async () => {
  const incoming = {
    prospect_id: "duke-insert-race",
    status: "held",
    business_name: "Duke City Fencing",
    record: {
      blocked_reason: "vertical_mismatch_sport_fencing",
      vertical_hold: { reason: "vertical_mismatch_sport_fencing" },
    },
  };
  let merges = 0;
  const result = await persistMinedRows({
    rows: [incoming], persist: true, actor: "test", trigger: "test", selectCount: 1,
    selectRowsImpl: async () => ({ mode: "live_select", rows: [] }),
    selectImpl: async () => ({ ok: true, data: [] }),
    insertRowImpl: async () => ({ mode: "live_write_failed", error: { category: "write_conflict" } }),
    upsertRowImpl: async () => { merges += 1; return { mode: "live_upsert" }; },
  });
  assert.equal(result.created, 0);
  assert.equal(result.writeFailed, 1);
  assert.equal(result.rows[0].persistence, "vertical_hold_insert_conflict");
  assert.equal(merges, 0);
});

test("the packet shelf durably quarantines Duke and routes the named hold through the line", async () => {
  const packet = {
    source: "leadminer_mirror_ready",
    meta: { source: "leadminer_mirror_ready", build_ready: true, missing_build_evidence: [] },
    mirror_ready: {
      business_name: "Duke City Fencing",
      place_id: "ChIJDukeCityFencing",
      industry: "fencing",
      categories: ["sports_club", "fencing_school"],
      services: ["Fencing classes", "Foil training", "Sabre coaching"],
      site_text: DUKE_TEXT,
    },
  };
  const row = {
    prospect_id: "wss-test-duke-city-fencing-albuquerque",
    business_name: "Duke City Fencing",
    city: "Albuquerque",
    state: "NM",
    status: "held",
    email: "hello@dukecityfencing.net",
    updated_at: "2026-08-21T01:00:00.000Z",
    record: {
      status: "held",
      handoff_state: "ready_for_build",
      build_ready: true,
      truth_packet: packet,
      truth_packet_source: "leadminer_mirror_ready",
      industry: "fencing",
    },
  };
  const updates = [];
  let donorCalls = 0;
  const picked = await pickProspects({ target: "leadminer", count: 1 }, {
    select: async () => ({ ok: true, data: [row] }),
    conditionalUpdate: async (...args) => { updates.push(args); return { ok: true, updated: true }; },
    resolveBuildableDonor: () => { donorCalls += 1; return { ok: true, donor: "fence" }; },
  });
  assert.equal(picked.length, 1, "quarantine stays visible on the line instead of being dropped");
  assert.equal(picked[0].contractIssue, "vertical_mismatch_sport_fencing");
  assert.equal(donorCalls, 0, "quarantine does not resolve a fence donor");
  assert.equal(updates.length, 1, "the prospect hold is written once");
  assert.equal(updates[0][4].status, "held");
  assert.equal(updates[0][4].record.blocked_reason, "vertical_mismatch_sport_fencing");
  assert.equal(updates[0][4].record.vertical_hold.reason, "vertical_mismatch_sport_fencing");

  let mirrorCalls = 0;
  const phase = await processRowPhase(
    { ...picked[0], status: "picked", history: [{ status: "picked", at: "2026-08-21T01:00:00.000Z" }] },
    { lane: "sandbox", batchId: "line_duke" },
    { mirror: async () => { mirrorCalls += 1; return { ok: true, previewUrl: "https://wrong.example/" }; } },
  );
  assert.equal(phase.complete, true);
  assert.equal(phase.row.status, "rejected");
  assert.equal(phase.row.reason, "vertical_mismatch_sport_fencing");
  assert.equal(mirrorCalls, 0, "the line never starts a mirror for a quarantined row");
});

test("the shelf audit never rewrites a preview-bearing or sent row", async () => {
  const packet = {
    source: "leadminer_mirror_ready",
    meta: { source: "leadminer_mirror_ready", build_ready: true, missing_build_evidence: [] },
    mirror_ready: {
      business_name: "Duke City Fencing",
      place_id: "ChIJDukePreview",
      industry: "fencing",
      categories: ["sports_club"],
      services: ["Foil classes", "Sabre coaching"],
    },
  };
  const row = {
    prospect_id: "wss-test-duke-preview",
    business_name: "Duke City Fencing",
    status: "previewed",
    preview_url: "https://wss-test-duke-city-fencing-albuquerque.wss-ai.com/",
    updated_at: "2026-08-21T01:00:00.000Z",
    record: {
      truth_packet: packet,
      truth_packet_source: "leadminer_mirror_ready",
      status: "line_queued",
    },
  };
  const updates = [];
  const picked = await pickProspects({ target: "leadminer", count: 1 }, {
    select: async () => ({ ok: true, data: [row] }),
    conditionalUpdate: async (...args) => { updates.push(args); return { ok: true, updated: true }; },
  });
  assert.equal(picked.length, 0);
  assert.equal(updates.length, 0, "preview-bearing rows preserve their terminal workflow state");

  row.status = "sent";
  row.preview_url = "";
  row.sent_at = "2026-08-21T01:01:00.000Z";
  await pickProspects({ target: "leadminer", count: 1 }, {
    select: async () => ({ ok: true, data: [row] }),
    conditionalUpdate: async (...args) => { updates.push(args); return { ok: true, updated: true }; },
  });
  assert.equal(updates.length, 0, "sent rows are immutable even if their preview field is absent");

  row.status = "line_queued";
  row.sent_at = "";
  row.delivered_at = "2026-08-21T01:02:00.000Z";
  await pickProspects({ target: "leadminer", count: 1 }, {
    select: async () => ({ ok: true, data: [row] }),
    conditionalUpdate: async (...args) => { updates.push(args); return { ok: true, updated: true }; },
  });
  assert.equal(updates.length, 1, "current line_queued is quarantined despite a historical delivered marker");
});

test("an unsent line_queued sport mismatch is moved to held even when it has a preview", async () => {
  const row = {
    prospect_id: "wss-test-duke-unbuilt-queued",
    business_name: "Duke City Fencing Club",
    status: "line_queued",
    sent_at: "2026-08-04T01:00:00.000Z",
    preview_url: "https://wss-test-duke-unbuilt-queued.wss-ai.com/",
    updated_at: "2026-08-21T01:00:00.000Z",
    record: {
      status: "line_queued",
      truth_packet_source: "leadminer_mirror_ready",
      truth_packet: {
        meta: { source: "leadminer_mirror_ready", build_ready: true },
        mirror_ready: {
          business_name: "Duke City Fencing Club",
          industry: "fencing",
          categories: ["sports_club"],
          services: ["Foil classes"],
          site_text: "Olympic coaches teach sword and sabre classes.",
        },
      },
    },
  };
  const updates = [];
  const picked = await pickProspects({ target: "leadminer", count: 1 }, {
    select: async () => ({ ok: true, data: [row] }),
    conditionalUpdate: async (...args) => { updates.push(args); return { ok: true, updated: true }; },
  });
  assert.equal(picked.length, 0, "queued quarantine is held, not picked into another build");
  assert.equal(updates.length, 1, "historical sent_at cannot exempt a current line_queued mismatch");
  assert.deepEqual(updates[0][3], {
    updated_at: "eq.2026-08-21T01:00:00.000Z",
    status: "eq.line_queued",
  });
  assert.equal(updates[0][4].status, "held");
});

test("an approved batch re-checks the durable sport hold before capture or email", async () => {
  let captureCalls = 0;
  let reportCalls = 0;
  let sendCalls = 0;
  let writeCalls = 0;
  const send = defaultSend("live", {
    select: async () => ({
      ok: true,
      data: [{
        prospect_id: "duke-approved-before-quarantine",
        status: "held",
        record: {
          status: "line_queued",
          vertical_hold: { reason: "vertical_mismatch_sport_fencing" },
        },
      }],
    }),
    proofShotsForSend: async () => { captureCalls += 1; return { shots: null, persist: false }; },
    ensureLineProofShots: async () => { captureCalls += 1; return null; },
    ensureLineReport: async () => { reportCalls += 1; return { ok: true, reportUrl: "" }; },
    sendSequenceStep: async () => { sendCalls += 1; return { ok: true }; },
    upsertRow: async () => { writeCalls += 1; return { ok: true }; },
  });

  const result = await send({
    prospectId: "duke-approved-before-quarantine",
    businessName: "Duke City Fencing",
    email: "club@example.test",
    previewUrl: "https://duke-preview.wss-ai.com/",
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "vertical_mismatch_sport_fencing",
    policyHold: true,
    providerAttempted: false,
  });
  assert.equal(captureCalls, 0, "durable quarantine must run before proof capture");
  assert.equal(reportCalls, 0, "durable quarantine must run before report minting");
  assert.equal(sendCalls, 0, "an approved snapshot cannot outrun the durable hold");
  assert.equal(writeCalls, 0, "the refused send does not mutate proof or report state");
});

test("the legacy send route rechecks a quarantine written during evidence work", async () => {
  let reads = 0;
  let proofCalls = 0;
  let sendCalls = 0;
  const queued = {
    prospect_id: "duke-legacy-send-race",
    status: "line_queued",
    email: "club@example.test",
    current_website: "https://dukecityfencing.net/",
    record: { status: "line_queued", proof_shots: {} },
  };
  const send = defaultSend("live", {
    select: async () => {
      reads += 1;
      return reads === 1
        ? { ok: true, data: [queued] }
        : { ok: true, data: [{
          ...queued,
          status: "held",
          record: { status: "held", blocked_reason: "vertical_mismatch_sport_fencing" },
        }] };
    },
    proofShotsForSend: async () => { proofCalls += 1; return { shots: null, persist: false }; },
    ensureLineReport: async () => ({ ok: false, reportUrl: "" }),
    sendSequenceStep: async () => { sendCalls += 1; return { ok: true }; },
    upsertRow: async () => ({ ok: true }),
  });

  const result = await send({
    prospectId: queued.prospect_id,
    businessName: "Duke City Fencing",
    email: queued.email,
    previewUrl: "https://duke-preview.wss-ai.com/",
  });

  assert.equal(result.reason, "vertical_mismatch_sport_fencing");
  assert.equal(result.policyHold, true);
  assert.equal(result.providerAttempted, false);
  assert.equal(reads, 2);
  assert.equal(proofCalls, 1, "the race lands after evidence starts");
  assert.equal(sendCalls, 0);
});

test("explicit admin quarantine CAS-updates only eligible fixed-policy prospects", async () => {
  const rows = new Map([
    ["duke-current", {
      prospect_id: "duke-current",
      status: "line_queued",
      sent_at: "2026-08-04T01:00:00.000Z",
      preview_url: "https://duke-preview.wss-ai.com/",
      updated_at: "2026-08-21T01:00:00.000Z",
      record: { status: "line_queued", history: [{ status: "sent", at: "2026-08-04T01:00:00.000Z" }] },
    }],
    ["already-held", {
      prospect_id: "already-held", status: "held",
      record: { status: "held", blocked_reason: "vertical_mismatch_sport_fencing" },
    }],
    ["terminal-sent", { prospect_id: "terminal-sent", status: "sent", record: { status: "sent" } }],
    ["cas-race", { prospect_id: "cas-race", status: "queued", updated_at: "2026-08-21T01:01:00.000Z", record: {} }],
  ]);
  const writes = [];
  const result = await quarantineSportFencingProspects(
    ["duke-current", "already-held", "terminal-sent", "cas-race"],
    {
      select: async (_table, query) => {
        const id = decodeURIComponent(query.match(/prospect_id=eq\.([^&]+)/)[1]);
        return { ok: true, data: [rows.get(id)] };
      },
      conditionalUpdate: async (...args) => {
        writes.push(args);
        return { ok: true, updated: args[2] !== "cas-race" };
      },
      now: () => new Date("2026-08-21T02:00:00.000Z"),
    },
  );

  assert.deepEqual(result.counts, { updated: 1, "already-held": 1, terminal: 1, "cas-failed": 1 });
  assert.equal(writes.length, 2);
  const dukeWrite = writes.find((call) => call[2] === "duke-current");
  assert.equal(dukeWrite[3].status, "eq.line_queued");
  assert.equal(dukeWrite[4].status, "held");
  assert.equal(dukeWrite[4].record.status, "held");
  assert.equal(dukeWrite[4].record.blocked_reason, "vertical_mismatch_sport_fencing");
  assert.deepEqual(dukeWrite[4].record.history, rows.get("duke-current").record.history, "audit history is preserved");
  assert.equal(Object.hasOwn(dukeWrite[4], "preview_url"), false, "partial CAS preserves the existing preview");
  assert.equal(Object.hasOwn(dukeWrite[4], "sent_at"), false, "partial CAS preserves historical send evidence");
});

test("the quarantine action is admin-authenticated and accepts no caller policy", async (t) => {
  const prior = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "sport-quarantine-admin-token";
  t.after(() => {
    if (prior === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = prior;
  });
  const calls = [];
  const handler = createLineHandler({
    quarantineSportFencingProspects: async (ids) => {
      calls.push(ids);
      return { ok: true, action: "quarantine_sport_fencing", results: [] };
    },
  });
  const invoke = async (body, token = "sport-quarantine-admin-token") => {
    const response = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(payload) { this.body = payload ? JSON.parse(payload) : null; },
    };
    await handler({
      method: "POST",
      url: "/api/admin/line",
      headers: { "x-admin-token": token },
      body: JSON.stringify(body),
    }, response);
    return response;
  };

  const unauthorized = await invoke({ action: "quarantine_sport_fencing", prospectIds: ["duke-current"] }, "wrong");
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(calls.length, 0);

  const arbitrary = await invoke({
    action: "quarantine_sport_fencing",
    prospectIds: ["duke-current"],
    reason: "caller_chosen",
  });
  assert.equal(arbitrary.statusCode, 400);
  assert.equal(arbitrary.body.error, "quarantine_policy_is_fixed");
  assert.equal(calls.length, 0);

  const accepted = await invoke({ action: "quarantine_sport_fencing", prospectIds: ["duke-current", "south-denver"] });
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(calls, [["duke-current", "south-denver"]]);
});

test("a failed quarantine write is visible and retryable", async () => {
  const row = {
    prospect_id: "duke-cas",
    business_name: "Duke City Fencing Club",
    city: "Albuquerque",
    state: "NM",
    email: "hello@dukecityfencing.net",
    status: "held",
    updated_at: "2026-08-21T01:00:00.000Z",
    record: {
      truth_packet_source: "leadminer_mirror_ready",
      truth_packet: {
        meta: { source: "leadminer_mirror_ready", build_ready: true },
        mirror_ready: {
          business_name: "Duke City Fencing Club",
          industry: "fencing",
          categories: ["sports_club"],
          site_text: "Olympic sword coaches teach foil classes.",
        },
      },
    },
  };
  for (const conditionalUpdate of [
    async () => { throw new Error("store offline"); },
    async () => ({ ok: true, updated: false, mode: "cas_miss" }),
  ]) {
    await assert.rejects(
      pickProspects({ target: "leadminer", count: 1 }, {
        select: async () => ({ ok: true, data: [row] }),
        conditionalUpdate,
      }),
      /vertical_hold_persist_failed/,
    );
  }
});

test("Alamo Fence Company remains buildable as fence contracting", async () => {
  const html = `
    <h1>Alamo Fence Company</h1>
    <p>Residential and commercial fence installation.</p>
    <p>Wood fence, vinyl fence, chain-link and gate installation.</p>`;
  const out = tradeSwapCheck({
    vertical: "fencing",
    place: {
      displayName: { text: "Alamo Fence Company" },
      primaryType: "general_contractor",
      types: ["general_contractor", "point_of_interest"],
    },
    html,
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.corroboration, "fence_contracting_signals");
  assert.ok(out.observed.includes("fence_company"));

  const inferred = inferTrade({
    label: "fencing",
    businessName: "Alamo Fence Company",
    services: ["Fence installation", "Chain-link fencing", "Gate installation"],
  });
  assert.equal(inferred.trade, "fencing");
  assert.equal(inferred.blocked, undefined);

  let mirrorCalls = 0;
  const built = await buildMirrorForProspect({
    prospect_id: "alamo-fence-company",
    business_name: "Alamo Fence Company",
    industry: "fencing",
    site: "https://alamofence.example/",
    logo: "https://alamofence.example/logo.png",
    services: ["Fence installation", "Chain-link fencing", "Gate installation"],
    city: "San Antonio",
    state: "TX",
  }, {
    dryRun: true,
    deps: {
      resolveBuildableDonor: () => ({ ok: true, donor: "fence-premier", vertical: "fencing" }),
      resolveVerifiedFacts: async () => ({
        ok: true,
        facts: {
          business_name: "Alamo Fence Company",
          industry: "fencing",
          city: "San Antonio",
          state: "TX",
          current_website: "https://alamofence.example/",
        },
        content: { services: ["Fence installation", "Chain-link fencing", "Gate installation"] },
        coverage: {},
      }),
      harvestClientPhotos: async () => ({ ok: true, photos: [] }),
      resolveSocials: async () => ({ socials: [], source: "not_attempted" }),
      readFleetIdentities: async () => ({ ok: true, identities: [] }),
      mirror: async (request) => {
        mirrorCalls += 1;
        return {
          status: 200,
          body: {
            ok: true,
            revealable: true,
            preview_url: `https://${request.slug}.wss-ai.com/`,
            checks: { content: { status: "injected", sections: 1 } },
          },
        };
      },
    },
  });
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.donor, "fence-premier");
  assert.equal(mirrorCalls, 1);
});

test("the word fencing alone never proves fence contracting", () => {
  const inferred = inferTrade({ label: "fencing", siteText: "Fencing in Albuquerque" });
  assert.equal(inferred.trade, "");
  assert.equal(inferred.blocked, true);
  assert.equal(inferred.reason, "fencing_contracting_uncorroborated");

  const gate = tradeSwapCheck({
    vertical: "fencing",
    place: { displayName: { text: "ABQ Fencing" }, types: ["point_of_interest"] },
    html: "<h1>Fencing in Albuquerque</h1>",
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "fencing_contracting_uncorroborated");
});

test("the default-on sport guard has an emergency rollback switch", () => {
  const out = tradeSwapCheck({
    vertical: "fencing",
    place: { displayName: { text: "Duke City Fencing" }, types: ["sports_club"] },
    html: `<main>${DUKE_TEXT}</main>`,
    env: { GHOST_AGENCY_SPORT_FENCING_GUARD: "0" },
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.corroboration, "self_published_only");
  const inferred = inferTrade({
    label: "fencing",
    businessName: "Duke City Fencing",
    siteText: DUKE_TEXT,
    env: { GHOST_AGENCY_SPORT_FENCING_GUARD: "0" },
  });
  assert.equal(inferred.trade, "fencing", "env 0 restores the legacy label fallback exactly");
  assert.equal(inferred.blocked, undefined);
});
