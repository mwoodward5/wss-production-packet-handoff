"use strict";

const assert = require("node:assert/strict");
const { afterEach, beforeEach, test } = require("node:test");
const commandHandler = require("../api/admin/command");
const mineRoute = require("../api/admin/mine-leads");
const { mineLeads, parseCsv, persistMinedRows, rowFromBuildReady } = require("../lib/lead-miner");
const { parseDeterministic } = require("../lib/copilot");

const ENV_KEYS = ["GHOST_AGENCY_ADMIN_TOKEN", "GOOGLE_PLACES_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
let previousEnv;
let previousFetch;

function response(json, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => json, text: async () => JSON.stringify(json), headers: { get: () => "application/json" } };
}

function mockRes() {
  return {
    headers: {}, statusCode: 0, body: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value || ""; },
  };
}

function body(res) {
  return JSON.parse(res.body || "{}");
}

function assertNarrowIdentityRead(options) {
  assert.equal(options.order, "updated_at.desc");
  assert.equal(options.limit, 5000);
  assert.equal(typeof options.select, "string");
  assert.match(options.select, /(?:^|,)canonical_place_id(?:,|$)/);
  assert.match(options.select, /(?:^|,)canonical_domain(?:,|$)/);
  assert.match(options.select, /(?:^|,)place_id:record->>place_id(?:,|$)/);
  assert.match(options.select, /(?:^|,)address:record->>address(?:,|$)/);
  assert.match(options.select, /(?:^|,)postal_code:record->>postal_code(?:,|$)/);
  assert.doesNotMatch(options.select, /(?:^|,)record(?:,|$)/, "the 5,000-row scan must never fetch complete record JSON");
  assert.doesNotMatch(options.select, /\*/, "the identity scan must never use select=*");
}

beforeEach(() => {
  previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  previousFetch = global.fetch;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "mining-contract-token";
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  global.fetch = previousFetch;
});

test("mine tattoo artists in Dallas has an exact, confirmation-only parsed plan", () => {
  const plan = parseDeterministic("mine tattoo artists in Dallas");
  assert.deepEqual(plan.params, { industry: "tattoo", location: "Dallas", limit: 10 });
  assert.equal(plan.reply, 'Parsed mining plan: industry="tattoo"; location="Dallas"; limit=10. Confirm to mine.');
  assert.equal(plan.confirmationRequired, true);
  assert.equal(plan.needsConfirm, true);
});

test("command endpoint accepts a confirmation only as a plan round-trip", async () => {
  const base = { method: "POST", headers: { "x-admin-token": "mining-contract-token" }, body: { prompt: "mine tattoo artists in Dallas" } };
  const pending = mockRes();
  await commandHandler(base, pending);
  assert.equal(pending.statusCode, 200);
  assert.equal(body(pending).confirmationRequired, true);
  assert.equal(body(pending).confirmationAccepted, false);

  const confirmed = mockRes();
  await commandHandler({ ...base, body: { ...base.body, confirmed: true } }, confirmed);
  assert.equal(confirmed.statusCode, 200);
  assert.equal(body(confirmed).confirmationRequired, false);
  assert.equal(body(confirmed).confirmationAccepted, true);
  assert.equal(body(confirmed).action, "mine");
});

test("mining endpoint refuses any request without confirmed:true", async () => {
  let calls = 0;
  const handler = mineRoute.createMineLeadsHandler({ mine: async () => { calls++; return { ok: true }; } });
  const res = mockRes();
  await handler({ method: "POST", headers: { "x-admin-token": "mining-contract-token" }, body: { industry: "tattoo", location: "Dallas" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(body(res).error, "mining_confirmation_required");
  assert.equal(calls, 0);
});

test("confirmed endpoint canonically scopes the miner to the parsed tattoo Dallas plan", async () => {
  let received;
  const handler = mineRoute.createMineLeadsHandler({ mine: async (input) => { received = input; return { ok: true }; } });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: { "x-admin-token": "mining-contract-token" },
    body: { confirmed: true, industry: "tattoo", location: "Dallas", query: "roofing in Austin" },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(received.query, "tattoo in Dallas");
  assert.equal(received.industry, "tattoo");
  assert.equal(received.location, "Dallas");
});

test("the admin route body can never select the legacy lane, a Places lookup, or provider/hook injection", async () => {
  let received;
  const handler = mineRoute.createMineLeadsHandler({ mine: async (input) => { received = input; return { ok: true }; } });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: { "x-admin-token": "mining-contract-token" },
    body: {
      confirmed: true,
      industry: "tattoo",
      location: "Dallas",
      buildReadyGate: false,
      placesVerify: true,
      trigger: "manual_exact",
      actor: "attacker",
      // A hostile discovery endpoint must never be dialed with the production
      // Firecrawl bearer; injection hooks must never reach mineLeads.
      firecrawlEndpoint: "https://evil.example/exfiltrate",
      env: { FIRECRAWL_API_KEY: "stolen" },
      fetchImpl: "not-a-function",
      mineBuildReady: "hook",
      persistMinedRows: "hook",
      mirrorImpl: "hook",
      bulk: false,
    },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(received.buildReadyGate, true, "the body must not reach the legacy raw Places lane");
  assert.equal(received.placesVerify, false, "the body must not opt a console run into a Places lookup");
  assert.equal(received.trigger, "manual_console", "the body must not choose its own trigger");
  assert.equal(received.actor, "agent_01_prospect_miner");
  for (const banned of ["firecrawlEndpoint", "env", "fetchImpl", "mineBuildReady", "persistMinedRows", "mirrorImpl", "bulk", "confirmed"]) {
    assert.equal(Object.hasOwn(received, banned), false, `${banned} must never be forwarded from the request body`);
  }
});

test("miner classifies existing unchanged rows as duplicates and reports created and updated rows truthfully", async () => {
  process.env.GOOGLE_PLACES_API_KEY = "test-places-key";
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  const writes = [];
  const existingRows = [
    { prospect_id: "place-unchanged", place_id: "unchanged", business_name: "Ink One", phone: "111", address: "1 Main St, Dallas, TX 75201", industry: "tattoo", city: "Dallas", state: "TX", source: "places-live-mine" },
    { prospect_id: "place-changed", place_id: "changed", business_name: "Ink Two", phone: "old", industry: "tattoo", city: "Dallas", state: "TX", source: "places-live-mine" },
  ];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith("https://places.googleapis.com/")) {
      assert.equal(JSON.parse(options.body).textQuery, "tattoo in Dallas");
      return response({ places: [
        { id: "unchanged", displayName: { text: "Ink One" }, formattedAddress: "1 Main St, Dallas, TX 75201", nationalPhoneNumber: "111" },
        { id: "changed", displayName: { text: "Ink Two" }, formattedAddress: "2 Main St, Dallas, TX 75201", nationalPhoneNumber: "222" },
        { id: "new", displayName: { text: "Ink Three" }, formattedAddress: "3 Main St, Dallas, TX 75201", nationalPhoneNumber: "333" },
      ] });
    }
    if (target.includes("/rest/v1/ghost_agency_prospects") && options.method === "GET") {
      if (target.includes("select=*") || target.includes("select=%2A")) {
        const prospectId = decodeURIComponent(new URL(target).searchParams.get("prospect_id") || "").replace(/^eq\./, "");
        const exact = existingRows.find((row) => row.prospect_id === prospectId);
        return response(exact ? [{
          ...exact,
          record: {
            place_id: exact.place_id,
            address: exact.address || "",
            business_name: exact.business_name,
            phone: exact.phone,
            industry: exact.industry,
            city: exact.city,
            state: exact.state,
            source: exact.source,
          },
        }] : []);
      }
      return response([
        // 2026-07-31 stale-fixture repair (NOT an assertion change). The row
        // named "unchanged" was no longer unchanged: `address` is a protected
        // field in mergeSafePlan, this stored row had none, and the incoming
        // Places result carries formattedAddress. mergeSafePlan fills a field
        // the stored row is MISSING, so the patch came back as
        // {address:"1 Main St, Dallas, TX 75201"} and the miner correctly
        // reported the row as updated. The miner was telling the truth; the
        // fixture was lying about being unchanged. Giving it the address it
        // would already hold restores an empty patch, so the assertions below
        // once again test what they claim: a row with genuinely nothing new is
        // a duplicate, not an update. Every assertion is left exactly as-is.
        ...existingRows,
      ]);
    }
    if (target.includes("/rest/v1/ghost_agency_prospects") && options.method === "POST") {
      writes.push(JSON.parse(options.body));
      return response([JSON.parse(options.body)]);
    }
    if (target.includes("/rest/v1/ghost_agency_events")) return response([]);
    throw new Error(`Unexpected request: ${options.method || "GET"} ${target}`);
  };

  const result = await mineLeads({
    industry: "tattoo",
    location: "Dallas",
    query: "tattoo in Dallas",
    limit: 3,
    enrichLimit: 0,
    buildReadyGate: false,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.created, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.duplicateSkipped, 1);
  assert.equal(result.upserted, 2);
  assert.deepEqual(writes.map((row) => row.prospect_id).sort(), ["place-changed", "place-new"]);
  assert.ok(writes.every((row) => row.industry === "tattoo" && row.city === "Dallas"));
  assert.ok(writes.every((row) => !Object.keys(row).some((key) => key.startsWith("_"))));
});

test("a matched prospect persists the exact computed build-ready contract", async () => {
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  const computed = {
    lead_id: "place-build-ready",
    slug: "wss-test-build-ready-dallas",
    identity_key: "place:place-build-ready",
    donor: "tattoo-example",
    donor_via: "exact",
    mirror_request: {
      slug: "wss-test-build-ready-dallas",
      donor: "tattoo-example",
      facts: {
        place_id: "place-build-ready",
        business_name: "Build Ready Ink",
        industry: "tattoo",
        city: "Dallas",
        state: "TX",
        email: "owner@build-ready.test",
        current_website: "https://build-ready.test",
        address: "456 Production Shape Rd",
        postal_code: "75202",
      },
      brand: { logo: "https://build-ready.test/logo.png", logo_sha256: "a".repeat(64), accent: "#2457d6" },
    },
    provenance: { business_name: { source: "google" } },
    brand_evidence: { logo_sha256: "a".repeat(64), accent: "#2457d6" },
    email_evidence: { email: "owner@build-ready.test", mx: true },
    qualification: {
      ceiling: "C+",
      website_axis: { score: 55, grade: "D+" },
      composite_signal: { score: 62, grade: "C" },
      categories: { websitePerformance: { score: 55, grade: "D+" } },
      probe: { analyzed: true, loadMs: 2400 },
      reasons: ["measured website needs an upgrade"],
    },
    trade_corroboration: { ok: true },
    proof: { dry_run_ok: true, build_hash: "build-hash-1" },
    discovery: { url: "https://build-ready.test", query: "tattoo in Dallas" },
  };
  const incoming = rowFromBuildReady(computed, { textQuery: "tattoo in Dallas" });
  assert.equal(incoming.prospect_id, "place-build-ready");
  assert.equal(incoming.record.prospect_id, "place-build-ready");
  assert.doesNotMatch(incoming.prospect_id, /^wss-test-/);
  assert.equal(incoming.record.build_ready.slug, "wss-test-build-ready-dallas", "future deployment slug remains separate");
  const writes = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes("/rest/v1/ghost_agency_prospects") && options.method === "GET") {
      return response([{
        prospect_id: "canonical-build-ready",
        business_name: "Build Ready Ink",
        email: "owner@build-ready.test",
        current_website: "https://build-ready.test",
        industry: "tattoo",
        city: "Dallas",
        state: "TX",
        record: { place_id: "place-build-ready", business_name: "Build Ready Ink" },
      }]);
    }
    if (target.includes("/rest/v1/ghost_agency_prospects") && options.method === "POST") {
      const written = JSON.parse(options.body);
      writes.push(written);
      return response([written]);
    }
    if (target.includes("/rest/v1/ghost_agency_events")) return response([]);
    throw new Error(`Unexpected request: ${options.method || "GET"} ${target}`);
  };

  const result = await persistMinedRows({ rows: [incoming], persist: true, selectCount: 1 });
  assert.equal(result.updated, 1);
  assert.equal(result.duplicateSkipped, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].prospect_id, "canonical-build-ready");
  assert.deepEqual(writes[0].record.build_ready, { version: 1, ...computed });
  assert.equal(Object.hasOwn(writes[0], "address"), false);
  assert.equal(Object.hasOwn(writes[0], "postal"), false);
  assert.equal(Object.hasOwn(writes[0], "postal_code"), false);
  assert.equal(writes[0].record.address, "456 Production Shape Rd");
  assert.equal(writes[0].record.postal, "75202");
});

test("a matched prospect keeps address and postal facts in record-only storage", async () => {
  const incoming = retryCandidate();
  incoming.record.address = "123 Record Only Ave";
  incoming.record.postal = "75201";
  const canonical = {
    prospect_id: "canonical-record-only-plumbing",
    canonical_prospect_id: "canonical-record-only-plumbing",
    status: "new",
    business_name: "Retry Plumbing",
    email: "owner@retry-plumbing.test",
    current_website: "https://retry-plumbing.test",
    industry: "plumbing",
    city: "Dallas",
    state: "TX",
    canonical_place_id: "place-retry-plumbing",
    // A projected alias or stale fixture must not leak record-only facts back
    // into the exact upsert payload either.
    address: "123 Record Only Ave",
    postal: "75201",
    record: {
      place_id: "place-retry-plumbing",
      business_name: "Retry Plumbing",
      current_website: "https://retry-plumbing.test",
      industry: "plumbing",
      city: "Dallas",
      state: "TX",
    },
  };
  const writes = [];

  const result = await persistMinedRows({
    rows: [incoming],
    persist: true,
    selectCount: 1,
    selectRowsImpl: async (_table, options) => {
      assertNarrowIdentityRead(options);
      return { mode: "live_select", rows: [{
        prospect_id: canonical.prospect_id,
        canonical_prospect_id: canonical.canonical_prospect_id,
        business_name: canonical.business_name,
        current_website: canonical.current_website,
        city: canonical.city,
        state: canonical.state,
        canonical_place_id: canonical.canonical_place_id,
      }] };
    },
    selectImpl: async () => ({ ok: true, mode: "live_select", data: [canonical] }),
    upsertRowImpl: async (_table, row) => {
      writes.push(row);
      return { mode: "live_upsert" };
    },
  });

  assert.equal(result.updated, 1);
  assert.equal(result.writeFailed, 0);
  assert.equal(writes.length, 1);
  assert.equal(Object.hasOwn(writes[0], "address"), false);
  assert.equal(Object.hasOwn(writes[0], "postal"), false);
  assert.equal(Object.hasOwn(writes[0], "postal_code"), false);
  assert.equal(writes[0].record.address, "123 Record Only Ave");
  assert.equal(writes[0].record.postal, "75201");
});

function retryCandidate() {
  return {
    prospect_id: "retry-plumbing-dallas",
    status: "new",
    business_name: "Retry Plumbing",
    email: "owner@retry-plumbing.test",
    current_website: "https://retry-plumbing.test",
    industry: "plumbing",
    city: "Dallas",
    state: "TX",
    leadminer_score: 0,
    source: "build-ready-mine",
    record: {
      prospect_id: "retry-plumbing-dallas",
      place_id: "place-retry-plumbing",
      business_name: "Retry Plumbing",
      email: "owner@retry-plumbing.test",
      current_website: "https://retry-plumbing.test",
      industry: "plumbing",
      city: "Dallas",
      state: "TX",
      source: "build-ready-mine",
    },
    updated_at: "2026-08-23T00:00:00.000Z",
  };
}

test("identity index retries transient read failures before the first prospect write", async () => {
  let reads = 0;
  let writes = 0;
  const sleeps = [];
  const result = await persistMinedRows({
    rows: [retryCandidate()],
    persist: true,
    selectCount: 1,
    selectRowsImpl: async (table, options) => {
      reads++;
      assert.equal(table, "ghost_agency_prospects");
      assertNarrowIdentityRead(options);
      return reads < 3
        ? { mode: "live_select_failed", rows: [] }
        : { mode: "live_select", rows: [] };
    },
    upsertRowImpl: async () => {
      writes++;
      assert.equal(reads, 3, "no write may begin before a live identity read succeeds");
      return { mode: "live_upsert" };
    },
    identityReadSleepImpl: async (ms) => { sleeps.push(ms); },
  });
  assert.equal(reads, 3);
  assert.deepEqual(sleeps, [25, 25]);
  assert.equal(writes, 1);
  assert.equal(result.created, 1);
  assert.equal(result.blocked, undefined);
});

test("a 5,000-row identity index stays narrow and hydrates only the matched prospect before merge", async () => {
  const incoming = retryCandidate();
  const projectedRows = Array.from({ length: 5000 }, (_, index) => ({
    prospect_id: `unrelated-${index}`,
    status: "new",
    business_name: `Unrelated ${index}`,
  }));
  projectedRows[4999] = {
    prospect_id: "canonical-retry-plumbing",
    canonical_prospect_id: "canonical-retry-plumbing",
    status: "new",
    business_name: "Retry Plumbing",
    current_website: "https://retry-plumbing.test",
    city: "Dallas",
    state: "TX",
    canonical_place_id: "place-retry-plumbing",
  };
  const preservedPhotoBank = Array.from({ length: 25 }, (_, index) => ({ sha256: String(index).padStart(64, "0") }));
  const exactRow = {
    ...projectedRows[4999],
    email: null,
    industry: "plumbing",
    record: {
      place_id: "place-retry-plumbing",
      business_name: "Retry Plumbing",
      current_website: "https://retry-plumbing.test",
      industry: "plumbing",
      city: "Dallas",
      state: "TX",
      photo_bank: preservedPhotoBank,
      proof_shots: { new_sha256: "f".repeat(64) },
    },
  };
  let exactReads = 0;
  const writes = [];
  const result = await persistMinedRows({
    rows: [incoming],
    persist: true,
    selectCount: 1,
    selectRowsImpl: async (table, options) => {
      assert.equal(table, "ghost_agency_prospects");
      assertNarrowIdentityRead(options);
      return { mode: "live_select", rows: projectedRows };
    },
    selectImpl: async (table, query) => {
      exactReads++;
      assert.equal(table, "ghost_agency_prospects");
      assert.equal(query, "?select=*&prospect_id=eq.canonical-retry-plumbing&limit=1");
      return { ok: true, mode: "live_select", data: [exactRow] };
    },
    upsertRowImpl: async (_table, row) => {
      writes.push(row);
      return { mode: "live_upsert" };
    },
  });
  assert.equal(exactReads, 1, "only the matched row receives a complete-record read");
  assert.equal(writes.length, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.created, 0);
  assert.equal(writes[0].prospect_id, "canonical-retry-plumbing");
  assert.deepEqual(writes[0].record.photo_bank, preservedPhotoBank, "exact hydration preserves heavy existing JSON");
  assert.equal(writes[0].record.proof_shots.new_sha256, "f".repeat(64));
});

test("a projected identity match that cannot be hydrated fails closed with zero writes", async () => {
  const incoming = retryCandidate();
  let writes = 0;
  const result = await persistMinedRows({
    rows: [incoming],
    persist: true,
    selectCount: 1,
    selectRowsImpl: async (_table, options) => {
      assertNarrowIdentityRead(options);
      return {
        mode: "live_select",
        rows: [{
          prospect_id: "canonical-retry-plumbing",
          canonical_prospect_id: "canonical-retry-plumbing",
          status: "new",
          business_name: "Retry Plumbing",
          current_website: "https://retry-plumbing.test",
          city: "Dallas",
          state: "TX",
          place_id: "place-retry-plumbing",
        }],
      };
    },
    selectImpl: async () => ({ ok: false, mode: "live_select_failed", data: [] }),
    upsertRowImpl: async () => { writes++; return { mode: "live_upsert" }; },
  });
  assert.equal(writes, 0);
  assert.equal(result.writeFailed, 1);
  assert.equal(result.rows[0].persistence, "prospect_identity_hydration_failed");
});

test("a sport hold cannot quarantine an exact row whose identity changed after the projected scan", async () => {
  const incoming = {
    prospect_id: "duke-city-fencing",
    status: "held",
    business_name: "Duke City Fencing",
    city: "Albuquerque",
    state: "NM",
    record: {
      place_id: "place-duke-city",
      business_name: "Duke City Fencing",
      city: "Albuquerque",
      state: "NM",
      blocked_reason: "vertical_mismatch_sport_fencing",
      vertical_hold: { reason: "vertical_mismatch_sport_fencing" },
    },
  };
  let conditionalWrites = 0;
  let otherWrites = 0;
  const result = await persistMinedRows({
    rows: [incoming],
    persist: true,
    selectCount: 1,
    selectRowsImpl: async (_table, options) => {
      assertNarrowIdentityRead(options);
      return {
        mode: "live_select",
        rows: [{
          prospect_id: "canonical-duke-city",
          canonical_prospect_id: "canonical-duke-city",
          status: "new",
          business_name: "Duke City Fencing",
          city: "Albuquerque",
          state: "NM",
          canonical_place_id: "place-duke-city",
        }],
      };
    },
    selectImpl: async () => ({
      ok: true,
      mode: "live_select",
      data: [{
        prospect_id: "canonical-duke-city",
        canonical_prospect_id: "canonical-duke-city",
        status: "new",
        business_name: "Unrelated Roofing",
        city: "Albuquerque",
        state: "NM",
        record: {
          business_name: "Unrelated Roofing",
          city: "Albuquerque",
          state: "NM",
        },
      }],
    }),
    conditionalUpdateImpl: async () => { conditionalWrites++; return { ok: true, updated: true }; },
    upsertRowImpl: async () => { otherWrites++; return { mode: "live_upsert" }; },
    insertRowImpl: async () => { otherWrites++; return { mode: "live_write" }; },
  });
  assert.equal(conditionalWrites, 0, "stale projected identity must not reach the quarantine CAS");
  assert.equal(otherWrites, 0);
  assert.equal(result.writeFailed, 1);
  assert.equal(result.updated, 0);
  assert.equal(result.rows[0].persistence, "prospect_identity_hydration_mismatch");
});

test("an exact merged alias can still route a sport hold to its canonical survivor", async () => {
  const incoming = {
    prospect_id: "duke-city-new-id",
    status: "held",
    business_name: "Duke City Fencing",
    city: "Albuquerque",
    state: "NM",
    record: {
      place_id: "place-duke-alias",
      business_name: "Duke City Fencing",
      city: "Albuquerque",
      state: "NM",
      blocked_reason: "vertical_mismatch_sport_fencing",
      vertical_hold: { reason: "vertical_mismatch_sport_fencing" },
    },
  };
  const survivorId = "canonical-duke-city";
  const projected = [
    {
      prospect_id: survivorId,
      canonical_prospect_id: survivorId,
      status: "new",
      business_name: "Duke City Historical",
      canonical_place_id: "place-duke-survivor",
    },
    {
      prospect_id: "duke-city-old-alias",
      canonical_prospect_id: survivorId,
      merged_into_prospect_id: survivorId,
      status: "merged",
      business_name: "Duke City Fencing",
      canonical_place_id: "place-duke-alias",
    },
  ];
  const exactById = {
    [survivorId]: {
      ...projected[0],
      record: { place_id: "place-duke-survivor", business_name: "Duke City Historical" },
    },
    "duke-city-old-alias": {
      ...projected[1],
      record: { place_id: "place-duke-alias", business_name: "Duke City Fencing" },
    },
  };
  const exactReads = [];
  const conditionalWrites = [];
  const result = await persistMinedRows({
    rows: [incoming],
    persist: true,
    selectCount: 1,
    selectRowsImpl: async (_table, options) => {
      assertNarrowIdentityRead(options);
      return { mode: "live_select", rows: projected };
    },
    selectImpl: async (_table, query) => {
      const id = decodeURIComponent(new URL(`https://local.test/${query}`).searchParams.get("prospect_id") || "").replace(/^eq\./, "");
      exactReads.push(id);
      return { ok: true, mode: "live_select", data: exactById[id] ? [exactById[id]] : [] };
    },
    conditionalUpdateImpl: async (_table, _idColumn, id, _guards, patch) => {
      conditionalWrites.push({ id, patch });
      return { ok: true, updated: true };
    },
  });
  assert.deepEqual(exactReads, [survivorId, "duke-city-old-alias"]);
  assert.equal(conditionalWrites.length, 1);
  assert.equal(conditionalWrites[0].id, survivorId);
  assert.equal(conditionalWrites[0].patch.status, "held");
  assert.equal(result.updated, 1);
  assert.equal(result.rows[0].persistence, "updated_vertical_mismatch_hold");
});

test("identity index blocks with zero writes after all three read attempts fail", async () => {
  let reads = 0;
  let writes = 0;
  const sleeps = [];
  const result = await persistMinedRows({
    rows: [retryCandidate()],
    persist: true,
    selectCount: 1,
    selectRowsImpl: async () => {
      reads++;
      return { mode: "live_select_failed", rows: [] };
    },
    upsertRowImpl: async () => { writes++; return { mode: "live_upsert" }; },
    insertRowImpl: async () => { writes++; return { mode: "live_write" }; },
    conditionalUpdateImpl: async () => { writes++; return { ok: true, updated: true }; },
    identityReadSleepImpl: async (ms) => { sleeps.push(ms); },
  });
  assert.equal(reads, 3);
  assert.deepEqual(sleeps, [25, 25]);
  assert.equal(writes, 0);
  assert.equal(result.blocked.ok, false);
  assert.equal(result.blocked.mode, "prospect_identity_index_unavailable");
  assert.equal(result.blocked.created, 0);
  assert.equal(result.blocked.updated, 0);
});

test("CSV parser remains available for scheduled mining inputs", () => {
  assert.deepEqual(parseCsv("tattoo;Dallas"), ["tattoo", "Dallas"]);
});
