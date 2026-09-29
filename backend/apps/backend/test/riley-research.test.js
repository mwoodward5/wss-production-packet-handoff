"use strict";

// test/riley-research.test.js — the contract for Riley's research tool
// (api/vapi-tools/research.js), the one place a live phone call imports text
// that somebody else wrote.
//
// Three properties are load-bearing, and each has its own section below:
//
//   1. IT NEVER PUBLISHES. Not "it is not supposed to" — there is no write path
//      in the module, and no third-party COPY ever reaches the response, so
//      there is nothing downstream could lift onto a customer's page even by
//      mistake. That is what killed the donor-leak and manufacturer-badge
//      incidents, and both of those passed every gate that only read a boolean.
//   2. IT STAYS IN SCOPE. Every query is anchored to a city resolved from OUR
//      record, so the tool cannot be steered into being a web browser.
//   3. IT ANSWERS INSIDE THE BUDGET. A caller is on the phone. A search that
//      does not come back must produce an honest sentence, not dead air, and
//      never a guessed number.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const handlerPath = require.resolve("../api/vapi-tools/research.js");
const storePath = require.resolve("../lib/store");
const brightPath = require.resolve("../lib/mirror-engine/trust-brightdata");
const targetsPath = require.resolve("../lib/site-edit-targets");
const memoryPath = require.resolve("../lib/riley-call-memory");

const SECRET = "vapi-tool-secret-for-tests-0123456789";

const RAMON = Object.freeze({
  status: "ok",
  matched_by: "client_id",
  prospect_id: "p_ramon",
  business_name: "Ramon Roofing",
  client_id: "WSS-1F9506",
  city: "Fort Worth",
  state: "TX",
  phone: "(817) 924-1645",
});

const RAMON_ROW = Object.freeze({ prospect_id: "p_ramon", current_website: "https://ramonroofing.com", phone: "(817) 924-1645" });

function mockRes() {
  return {
    statusCode: 200,
    body: "",
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(chunk) { if (chunk) this.body += chunk; return this; },
  };
}

/**
 * Load the handler with the SERP transport, the store and caller resolution
 * stubbed. `norm`/`digits10` stay REAL — they are the matching rules the
 * production trust path uses, and swapping them would test a different system.
 */
function withHandler(run, { serpResult = null, caller = RAMON, row = RAMON_ROW, env = {}, missingCallMemory = false } = {}) {
  const serpCalls = [];
  const events = [];
  const realBright = require(brightPath);
  const saved = {
    store: require.cache[storePath],
    bright: require.cache[brightPath],
    targets: require.cache[targetsPath],
    memory: require.cache[memoryPath],
    handler: require.cache[handlerPath],
    env: {
      VAPI_TOOL_SECRET: process.env.VAPI_TOOL_SECRET,
      VAPI_WEBHOOK_SECRET: process.env.VAPI_WEBHOOK_SECRET,
      GHOST_AGENCY_ADMIN_TOKEN: process.env.GHOST_AGENCY_ADMIN_TOKEN,
      RILEY_RESEARCH_BUDGET_MS: process.env.RILEY_RESEARCH_BUDGET_MS,
    },
  };
  process.env.VAPI_TOOL_SECRET = SECRET;
  delete process.env.VAPI_WEBHOOK_SECRET;
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  delete process.env.RILEY_RESEARCH_BUDGET_MS;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;

  const stub = (path, exports) => { require.cache[path] = { id: path, filename: path, loaded: true, exports }; };
  stub(brightPath, {
    ...realBright,
    serp: async (query, opts) => {
      serpCalls.push({ query, opts });
      return typeof serpResult === "function" ? serpResult(query, opts) : serpResult;
    },
  });
  stub(storePath, {
    select: async () => (row ? [row] : []),
    recordEvent: async (name, payload) => { events.push({ name, payload }); return { ok: true }; },
  });
  stub(targetsPath, { ...require(targetsPath), resolveCaller: async () => caller });
  stub(memoryPath, { ...require(memoryPath), recallCaller: async () => null });

  delete require.cache[handlerPath];
  // Reproduce production's module graph exactly: riley-call-memory belongs to
  // another lane and may simply not be in the build.
  const Module = require("node:module");
  const realResolve = Module._resolveFilename;
  if (missingCallMemory) {
    delete require.cache[memoryPath];
    Module._resolveFilename = function (request, ...rest) {
      if (String(request).endsWith("riley-call-memory")) {
        const e = new Error(`Cannot find module '${request}'`);
        e.code = "MODULE_NOT_FOUND";
        throw e;
      }
      return realResolve.call(this, request, ...rest);
    };
  }
  let handler;
  try { handler = require(handlerPath); } finally { Module._resolveFilename = realResolve; }

  const call = async (args, { headers = { "x-vapi-secret": SECRET }, method = "POST" } = {}) => {
    const res = mockRes();
    await handler({ method, headers, body: args, query: {} }, res);
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, text: res.body };
  };

  return Promise.resolve(run({ call, serpCalls, events, handler })).finally(() => {
    for (const p of [handlerPath, storePath, brightPath, targetsPath, memoryPath]) delete require.cache[p];
    if (saved.store) require.cache[storePath] = saved.store;
    if (saved.bright) require.cache[brightPath] = saved.bright;
    if (saved.targets) require.cache[targetsPath] = saved.targets;
    if (saved.memory) require.cache[memoryPath] = saved.memory;
    if (saved.handler) require.cache[handlerPath] = saved.handler;
    for (const [k, v] of Object.entries(saved.env)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    for (const k of Object.keys(env)) if (!(k in saved.env)) delete process.env[k];
  });
}

/* ------------------------------------------------------------- fixtures */

// A SERP shaped like the real thing and DELIBERATELY STUFFED with the exact
// class of string that must never reach a customer's page: competitor taglines,
// years-in-business claims, and a manufacturer certification badge. Ramon
// Roofing sits at #2 on the map and #3 in organic.
const MARKETING_COPY = [
  "25 Years Serving Dallas-Fort Worth — GAF Master Elite Certified",
  "Voted #1 Roofer in Tarrant County three years running",
  "Free inspections, financing available, lifetime workmanship warranty",
  "Mastercool Authorized Dealer",
];
const LOADED_SERP = Object.freeze({
  snack_pack: [
    { rank: 1, name: "Falcon Roof Craft | 25 Years Serving Dallas", link: "https://falconroofcraft.com", description: MARKETING_COPY[0] },
    { rank: 2, name: "Ramon Roofing", link: "https://ramonroofing.com", description: "Roofing contractor" },
    { rank: 3, name: "Tekline Roofing — Voted #1 Roofer in Tarrant County three years running", link: "https://teklineroofing.com", description: MARKETING_COPY[1] },
    { rank: 4, name: "Apex Roof Systems", link: "https://apexroofsystems.com", description: MARKETING_COPY[2] },
  ],
  organic: [
    { rank: 1, title: "Best Roofers in Fort Worth (2026) - Yelp", link: "https://www.yelp.com/search?find=roofers", description: "Top 10 roofers near you" },
    { rank: 2, title: "Falcon Roof Craft | 25 Years Serving Dallas", link: "https://falconroofcraft.com", description: MARKETING_COPY[0] },
    { rank: 3, title: "Ramon Roofing - Fort Worth TX", link: "https://ramonroofing.com", description: "Free inspections, financing available, lifetime workmanship warranty. Call (817) 924-1645." },
    { rank: 4, title: "Mastercool Authorized Dealer - Roof & Air", link: "https://roofandair.example", description: MARKETING_COPY[3] },
  ],
  knowledge: { name: "Ramon Roofing", address: "1200 Main St, Fort Worth, TX", phone: "(817) 924-1645", rating: 4.9, reviews_cnt: 93 },
});

const NO_PACK_SERP = Object.freeze({
  organic: [
    { rank: 1, title: "Falcon Roof Craft", link: "https://falconroofcraft.com", description: "roofing" },
    { rank: 2, title: "Ramon Roofing - Fort Worth TX", link: "https://ramonroofing.com", description: "roofing" },
  ],
});

const rank = (over = {}) => ({ topic: "rank", search_phrase: "roof repair", ...over });

/* =========================================================== 1. AUTH === */

test("no tool secret: 401, and no search is run", () => withHandler(async ({ call, serpCalls }) => {
  const r = await call(rank(), { headers: {} });
  assert.equal(r.status, 401);
  assert.equal(serpCalls.length, 0);
}, { serpResult: LOADED_SERP }));

test("a secret of the right length but wrong bytes is rejected", () => withHandler(async ({ call, serpCalls }) => {
  const r = await call(rank(), { headers: { "x-vapi-secret": "X".repeat(SECRET.length) } });
  assert.equal(r.status, 401);
  assert.equal(serpCalls.length, 0);
}, { serpResult: LOADED_SERP }));

test("GET is refused", () => withHandler(async ({ call }) => {
  assert.equal((await call(rank(), { method: "GET" })).status, 405);
}, { serpResult: LOADED_SERP }));

/* ============================================ 2. NEVER PUBLISHES ======= */

const SOURCE = fs.readFileSync(handlerPath, "utf8");

test("the module has no write path — its dependency list is pinned", () => {
  const required = [...SOURCE.matchAll(/require\((["'])([^"']+)\1\)/g)].map((m) => m[2]).sort();
  // Adding anything here is a deliberate act that has to be reviewed. A builder,
  // an edit queue, a deploy client or a file writer appearing in this list is
  // the failure this assertion exists to catch.
  assert.deepEqual(required, [
    "../../lib/http",
    "../../lib/mirror-engine/trust-brightdata",
    "../../lib/riley-call-memory",
    "../../lib/site-edit-targets",
    "../../lib/store",
    "node:crypto",
  ]);
});

test("a module owned by another lane cannot kill this tool", () => withHandler(async ({ call }) => {
  // THE REAL INCIDENT, reproduced: riley-call-memory is not in the repo yet, and
  // requiring it hard took the live endpoint to FUNCTION_INVOCATION_FAILED on
  // every invocation (dpl_CPa4S27p). Research does not own caller identity, so a
  // missing memory costs one repeated question, not the whole tool.
  const r = await call(rank());
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "ok");
  assert.match(r.json.say, /map listings/);
}, { serpResult: LOADED_SERP, missingCallMemory: true }));

test("the module never calls a store mutation or a filesystem write", () => {
  // recordEvent is the ONE write, and it writes telemetry about the call —
  // never anything about, or onto, the client's site. Everything else is out.
  for (const forbidden of ["insertRow", "upsertRow", "updateRow", "deleteRow", "writeFile", "enqueue", "dispatch", "publish("]) {
    assert.ok(!SOURCE.includes(forbidden), `research.js must not reference ${forbidden}`);
  }
  assert.ok(SOURCE.includes("recordEvent"), "the telemetry write is expected and measured");
});

test("no competitor copy survives into the response — only identity does", () => withHandler(async ({ call }) => {
  for (const topic of ["rank", "competitors", "listing"]) {
    const r = await call({ topic, search_phrase: "roof repair", client_ref: "WSS-1F9506" });
    for (const copy of MARKETING_COPY) {
      assert.ok(!r.text.includes(copy), `${topic}: marketing copy leaked into the response: ${copy}`);
    }
    // The distinctive fragments, in case a substring survived a reformat.
    for (const fragment of ["25 Years", "Master Elite", "Voted #1", "Mastercool", "lifetime workmanship", "financing available"]) {
      assert.ok(!r.text.includes(fragment), `${topic}: third-party fragment leaked: ${fragment}`);
    }
  }
}, { serpResult: LOADED_SERP }));

test("every fact is stamped unpublishable and the response says why", () => withHandler(async ({ call }) => {
  const r = await call({ topic: "competitors", search_phrase: "roof repair" });
  assert.equal(r.json.use, "spoken_only");
  assert.match(r.json.do_not_publish, /may be written to the client's website/i);
  assert.match(r.json.do_not_publish, /request_site_change/);
  assert.ok(r.json.facts.length > 0);
  for (const f of r.json.facts) assert.equal(f.publishable, false, `fact ${f.kind} must be marked unpublishable`);
}, { serpResult: LOADED_SERP }));

test("safeName keeps the name and drops the sales pitch attached to it", () => {
  const { safeName } = require(handlerPath);
  assert.equal(safeName("Falcon Roof Craft | 25 Years Serving Dallas"), "Falcon Roof Craft");
  assert.equal(safeName("Tekline Roofing — Voted #1 Roofer in Tarrant County"), "Tekline Roofing");
  assert.equal(safeName("Apex Roofing: Free Estimates Today"), "Apex Roofing");
  // A real hyphenated or slashed name is not a tagline separator.
  assert.equal(safeName("Smith-Jones Roofing"), "Smith-Jones Roofing");
  assert.equal(safeName("A&B Roofing/Siding Co."), "A&B Roofing/Siding Co.");
  assert.ok(safeName("x".repeat(200)).length <= 60);
});

/* ================================================ 3. SCOPE ============= */

test("a topic outside the three is refused before anything is searched", () => withHandler(async ({ call, serpCalls }) => {
  for (const topic of ["", "weather", "web_search", "anything", "browse"]) {
    const r = await call({ topic, search_phrase: "roof repair" });
    assert.equal(r.json.status, "refused");
    assert.equal(r.json.reason, "topic_not_supported");
    assert.match(r.json.say, /how you come up for a search/i);
  }
  assert.equal(serpCalls.length, 0, "a refused topic must not reach the search engine");
}, { serpResult: LOADED_SERP }));

test("off-topic, person-lookup and operator phrases are refused, and nothing is searched", () => withHandler(async ({ call, serpCalls }) => {
  const bad = {
    weather: "weather in fort worth",
    news: "election news today",
    sports: "cowboys score",
    person: "who is john ramon",
    home_address: "home address for john ramon",
    medical: "cancer symptoms",
    financial: "bitcoin price",
    credentials: "gmail password reset",
    operator: "site:competitor.com roofing",
    url: "https://competitor.com",
    email: "owner@competitor.com",
    too_long: "roof repair ".repeat(12),
  };
  for (const [label, phrase] of Object.entries(bad)) {
    const r = await call({ topic: "rank", search_phrase: phrase });
    assert.equal(r.json.status, "refused", `must refuse ${label}`);
    assert.ok(r.json.reason.startsWith("out_of_scope") || r.json.reason.startsWith("search_phrase"), `${label}: unexpected reason ${r.json.reason}`);
    assert.ok(r.json.say.length > 0);
  }
  assert.equal(serpCalls.length, 0, "no refused phrase may reach the search engine");
}, { serpResult: LOADED_SERP }));

test("the search is ALWAYS anchored to the city on our record — the caller cannot pick the market", () => withHandler(async ({ call, serpCalls }) => {
  await call(rank({ search_phrase: "roof repair" }));
  assert.equal(serpCalls.length, 1);
  assert.equal(serpCalls[0].query, "roof repair Fort Worth TX");
  await call({ topic: "listing" });
  assert.equal(serpCalls[1].query, '"Ramon Roofing" Fort Worth TX');
}, { serpResult: LOADED_SERP }));

test("an unresolved caller means no search at all — there is no unanchored query", () => withHandler(async ({ call, serpCalls }) => {
  const r = await call(rank());
  assert.equal(r.json.status, "unavailable");
  assert.equal(r.json.reason, "caller_not_resolved");
  assert.match(r.json.say, /Client ID/i);
  assert.equal(serpCalls.length, 0);
}, { serpResult: LOADED_SERP, caller: { status: "not_found", say: "no match" } }));

test("an ambiguous caller is read back, never picked", () => withHandler(async ({ call, serpCalls }) => {
  const r = await call(rank());
  assert.equal(r.json.status, "refused");
  assert.equal(r.json.reason, "caller_ambiguous");
  assert.equal(r.json.candidates.length, 2);
  assert.equal(serpCalls.length, 0);
}, {
  serpResult: LOADED_SERP,
  caller: { status: "ambiguous", say: "I found two — which Client ID is on your email?", candidates: [{ client_id: "WSS-A" }, { client_id: "WSS-B" }] },
}));

/* ============================================= 4. RANK ================= */

test("rank: found on the map reports the map position", () => withHandler(async ({ call }) => {
  const r = await call(rank());
  assert.equal(r.json.status, "ok");
  const map = r.json.facts.find((f) => f.kind === "map_listing_position");
  assert.equal(map.available, true);
  assert.equal(map.found, true);
  assert.equal(map.position, 2);
  assert.equal(map.matched_by, "website");
  assert.match(r.json.say, /number 2 in the map listings in Fort Worth, TX/);
  assert.ok(r.json.say.split(/(?<=[.!?])\s+/).length <= 2, "Riley reads this on a call: one or two sentences");
}, { serpResult: LOADED_SERP }));

test("rank: organic position is reported separately from the map", () => withHandler(async ({ call }) => {
  const r = await call(rank());
  const organic = r.json.facts.find((f) => f.kind === "organic_position");
  assert.equal(organic.found, true);
  assert.equal(organic.position, 3);
}, { serpResult: LOADED_SERP }));

test("rank: on the page but not the map says exactly that", () => withHandler(async ({ call }) => {
  const r = await call(rank());
  assert.match(r.json.say, /don't see you in the map listings/i);
  assert.match(r.json.say, /number 2 in the regular results/);
}, {
  serpResult: {
    snack_pack: [{ rank: 1, name: "Falcon Roof Craft", link: "https://falconroofcraft.com" }],
    organic: NO_PACK_SERP.organic,
  },
}));

test("rank: absent from both is stated plainly, with no invented number", () => withHandler(async ({ call }) => {
  const r = await call(rank());
  assert.match(r.json.say, /didn't find you on the first page/i);
  assert.ok(!/number \d/.test(r.json.say), "a miss must not carry a position number");
  const map = r.json.facts.find((f) => f.kind === "map_listing_position");
  assert.equal(map.found, false);
  assert.equal(map.position, null);
}, {
  serpResult: {
    snack_pack: [{ rank: 1, name: "Falcon Roof Craft", link: "https://falconroofcraft.com" }],
    organic: [{ rank: 1, title: "Falcon Roof Craft", link: "https://falconroofcraft.com", description: "roofing" }],
  },
}));

test("rank: NO map pack in the response is never reported as 'not on the map'", () => withHandler(async ({ call }) => {
  // The distinction that matters: we did not look, versus we looked and you were
  // not there. Saying the second when we only know the first is an invented
  // claim, spoken to an owner, about the thing he is paying us to fix.
  const r = await call(rank());
  const map = r.json.facts.find((f) => f.kind === "map_listing_position");
  assert.equal(map.available, false, "the fact must record that no pack came back");
  assert.equal(map.found, false);
  assert.match(r.json.say, /No map listings came back/i);
  assert.ok(!/don't see you in the map listings/i.test(r.json.say), "must not claim absence from a pack we never saw");
}, { serpResult: NO_PACK_SERP }));

test("rank: with no website on file, the weaker name-only basis is declared", () => withHandler(async ({ call }) => {
  const r = await call(rank());
  const basis = r.json.facts.find((f) => f.kind === "match_basis");
  assert.equal(basis.value, "business_name_only");
  assert.equal(r.json.facts.find((f) => f.kind === "map_listing_position").matched_by, "business_name");
}, { serpResult: LOADED_SERP, row: { prospect_id: "p_ramon", current_website: "" } }));

test("a near-name does not claim the caller's rank", () => {
  const { sameBusiness } = require(handlerPath);
  assert.equal(sameBusiness("Ramon Roofing", "Ramon Roofing Inc"), true);
  assert.equal(sameBusiness("Ramon Roofing", "Ramon Roofing LLC"), true);
  assert.equal(sameBusiness("Ramon Roofing", "Falcon Roof Craft"), false);
  // Containment needs substance, or a short trading name claims every longer one.
  assert.equal(sameBusiness("Ace", "Ace Hardware Supply Co"), false);
  assert.equal(sameBusiness("", "Ramon Roofing"), false);
});

/* ====================================== 5. COMPETITORS ================= */

test("competitors: names the rivals, excludes the caller, excludes directories", () => withHandler(async ({ call }) => {
  const r = await call({ topic: "competitors", search_phrase: "roof repair" });
  assert.equal(r.json.status, "ok");
  const names = r.json.facts.filter((f) => f.kind === "competitor").map((f) => f.name);
  assert.deepEqual(names, ["Falcon Roof Craft", "Tekline Roofing", "Apex Roof Systems"]);
  assert.ok(!names.includes("Ramon Roofing"), "the caller is not their own competitor");
  assert.ok(r.json.facts.filter((f) => f.kind === "competitor").length <= require(handlerPath).MAX_COMPETITORS);
  assert.match(r.json.say, /you're sitting at number 2/);
}, { serpResult: LOADED_SERP }));

test("competitors: a directory is not read back as a rival", () => withHandler(async ({ call }) => {
  const r = await call({ topic: "competitors", search_phrase: "roof repair" });
  const names = r.json.facts.filter((f) => f.kind === "competitor").map((f) => f.name);
  const domains = r.json.facts.filter((f) => f.kind === "competitor").map((f) => f.domain);
  assert.ok(!domains.includes("yelp.com"), "Yelp is a directory, not a competing roofer");
  assert.deepEqual(names, ["Falcon Roof Craft"]);
  assert.match(r.json.say, /I don't find you on that first page/i);
}, {
  serpResult: {
    organic: [
      { rank: 1, title: "Best Roofers in Fort Worth - Yelp", link: "https://www.yelp.com/x", description: "top 10" },
      { rank: 2, title: "Roofing Contractors | Angi", link: "https://www.angi.com/x", description: "hire a pro" },
      { rank: 3, title: "Falcon Roof Craft", link: "https://falconroofcraft.com", description: "roofing" },
    ],
  },
}));

/* ========================================== 6. LISTING ================= */

test("listing: agreeing numbers are reported as agreeing", () => withHandler(async ({ call }) => {
  const r = await call({ topic: "listing" });
  assert.equal(r.json.status, "ok");
  const checks = r.json.facts.filter((f) => f.kind === "listing_check");
  assert.ok(checks.length >= 1);
  assert.ok(checks.every((c) => c.matches === true));
  assert.ok(checks.some((c) => c.source === "google_business_profile"));
  assert.match(r.json.say, /lines up/i);
}, { serpResult: LOADED_SERP }));

test("listing: a stale number is named by its last four, and nothing else", () => withHandler(async ({ call }) => {
  const r = await call({ topic: "listing" });
  const bad = r.json.facts.find((f) => f.kind === "listing_check" && f.matches === false);
  assert.ok(bad, "the mismatch must be reported");
  assert.equal(bad.source, "yelp.com");
  assert.equal(bad.observed_ending, "4412");
  assert.match(r.json.say, /ending 4412/);
  // The whole stale number is never returned — four digits identify it to the
  // owner and are the least third-party data that does the job.
  assert.ok(!r.text.includes("5554412"), "only the last four digits leave this endpoint");
  assert.ok(!r.text.includes("817) 555"), "the full observed number must not be returned");
}, {
  serpResult: {
    organic: [
      { rank: 1, title: "Ramon Roofing - Fort Worth, TX - Yelp", link: "https://www.yelp.com/biz/ramon-roofing", description: "Ramon Roofing, Fort Worth. Call (817) 555-4412 for a free estimate." },
    ],
    knowledge: { name: "Ramon Roofing", address: "1200 Main St, Fort Worth, TX", phone: "(817) 924-1645" },
  },
}));

test("listing: a knowledge panel for a DIFFERENT business is discarded, not compared", () => withHandler(async ({ call }) => {
  const r = await call({ topic: "listing" });
  const checks = r.json.facts.filter((f) => f.kind === "listing_check");
  assert.equal(checks.length, 0, "an unattested panel must not become a fact about this client");
  assert.equal(r.json.status, "unavailable");
  assert.match(r.json.say, /rather tell you that/i);
}, {
  serpResult: { knowledge: { name: "Falcon Roof Craft", address: "500 Elm St, Dallas, TX", phone: "(214) 555-0000" }, organic: [] },
}));

test("listing: with no phone on file we say so instead of guessing", () => withHandler(async ({ call }) => {
  const r = await call({ topic: "listing" });
  assert.equal(r.json.status, "unavailable");
  assert.match(r.json.say, /don't have a phone number on file/i);
}, { serpResult: LOADED_SERP, caller: { ...RAMON, phone: "" }, row: { prospect_id: "p_ramon", current_website: "https://ramonroofing.com" } }));

/* ========================================== 7. LATENCY ================= */

test("the budget is clamped to a range a phone call can survive", () => {
  const { budgetMs } = require(handlerPath);
  assert.equal(budgetMs({}), 5000);
  assert.equal(budgetMs({ RILEY_RESEARCH_BUDGET_MS: "2500" }), 2500);
  assert.equal(budgetMs({ RILEY_RESEARCH_BUDGET_MS: "50" }), 1500, "too small is raised to the floor");
  assert.equal(budgetMs({ RILEY_RESEARCH_BUDGET_MS: "600000" }), 12000, "no caller waits ten minutes");
  assert.equal(budgetMs({ RILEY_RESEARCH_BUDGET_MS: "nonsense" }), 5000);
});

test("a search that never returns still answers inside the budget, honestly", () => withHandler(async ({ call, handler }) => {
  const started = Date.now();
  const r = await call(rank());
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 4000, `answered in ${elapsed}ms — a caller cannot hold that long`);
  // ...but not so eagerly that the search never had a chance. A budget smaller
  // than the floor still buys the search the floor, because handing a SERP call
  // half a second is handing it a guaranteed failure.
  assert.ok(elapsed >= handler.SEARCH_FLOOR_MS - 100, `gave up after ${elapsed}ms, below the ${handler.SEARCH_FLOOR_MS}ms search floor`);
  assert.equal(r.json.status, "unavailable");
  assert.equal(r.json.reason, "search_timed_out");
  assert.equal(r.json.timing.timed_out, true);
  assert.equal(r.json.timing.partial, true);
  assert.match(r.json.say, /not going to guess/i);
  assert.equal(r.json.facts.length, 0, "a timeout yields no facts, not empty-looking ones");
}, { serpResult: () => new Promise(() => {}), env: { RILEY_RESEARCH_BUDGET_MS: "1500" } }));

test("a search that fails outright is reported as a failure, never as a miss", () => withHandler(async ({ call }) => {
  const r = await call(rank());
  assert.equal(r.json.status, "unavailable");
  assert.equal(r.json.reason, "search_unavailable");
  assert.equal(r.json.sources[0].reached, false);
  assert.ok(!/didn't find you/i.test(r.json.say), "an unreachable search must not become 'you don't rank'");
  // Measured on production 2026-08-11: BrightData answers 401 "Token expired",
  // so this is the live path today. It must still say WHAT was attempted —
  // reporting the query only on success reads, in a log, as "nothing was tried".
  assert.equal(r.json.searched, "roof repair Fort Worth TX");
  assert.equal(r.json.client.city, "Fort Worth");
}, { serpResult: null }));

test("the shared SERP client is called with call-shaped options, not build-shaped ones", () => withHandler(async ({ call, serpCalls }) => {
  await call(rank());
  const { opts } = serpCalls[0];
  assert.equal(opts.attempts, 1, "no retries while somebody is on the phone");
  assert.equal(opts.waitMs, 0, "no 20-second backoff on a live call");
  assert.equal(typeof opts.fetchImpl, "function", "our own abort signal replaces the 70s build timeout");
}, { serpResult: LOADED_SERP }));

test("every response carries measured timings, and every call records one", () => withHandler(async ({ call, events }) => {
  const r = await call(rank());
  for (const key of ["identity_ms", "search_ms", "elapsed_ms", "budget_ms"]) {
    assert.equal(typeof r.json.timing[key], "number", `timing.${key} must be measured`);
  }
  assert.ok(r.json.timing.elapsed_ms >= 0 && r.json.timing.elapsed_ms < 5000);
  const logged = events.find((e) => e.name === "riley.research");
  assert.ok(logged, "the call is measurable after the fact");
  assert.equal(logged.payload.topic, "rank");
  assert.equal(typeof logged.payload.elapsed_ms, "number");
}, { serpResult: LOADED_SERP }));

/* ====================================== 8. VAPI WIRING ================= */

test("a VAPI-wrapped tool call is unwrapped and answered in tool-result shape", () => withHandler(async ({ call }) => {
  const r = await call({
    message: {
      toolCalls: [{ id: "call_r1", function: { name: "research", arguments: JSON.stringify(rank()) } }],
      call: { id: "vapi_call_1", customer: { number: "+18179241645" } },
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.results[0].toolCallId, "call_r1");
  const inner = JSON.parse(r.json.results[0].result);
  assert.equal(inner.topic, "rank");
  assert.equal(inner.use, "spoken_only");
  assert.match(inner.say, /map listings/);
}, { serpResult: LOADED_SERP }));

test("string-encoded arguments are parsed, not 400'd", () => withHandler(async ({ call }) => {
  // The exact fault that broke site_edit_status on every live call.
  const r = await call({ message: { toolCalls: [{ id: "c", function: { arguments: JSON.stringify({ topic: "listing" }) } }] } });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.json.results[0].result).topic, "listing");
}, { serpResult: LOADED_SERP }));

const admin = require("../api/admin/vapi-assistants.js");

test("the tool definition carries the whole contract, so her prompt is not touched", () => {
  const def = admin.researchToolDefinition({ GHOST_AGENCY_API_URL: "https://ghost.example.test", VAPI_TOOL_SECRET: "s1" });
  assert.equal(def.function.name, "research");
  assert.equal(def.server.url, "https://ghost.example.test/api/vapi-tools/research");
  assert.equal(def.server.secret, "s1", "a secretless tool 401s on every mid-call invocation");
  assert.deepEqual(def.function.parameters.properties.topic.enum, ["rank", "competitors", "listing"]);
  assert.deepEqual(def.function.parameters.required, ["topic"]);
  const d = def.function.description;
  assert.match(d, /EYES, NOT A PAIR OF HANDS/i, "the publishing limit is stated to the model");
  assert.match(d, /NOTHING it tells you may be put on their website/i);
  assert.match(d, /request_site_change/, "the legitimate route for a change is named");
  assert.match(d, /ran out of time/i, "a timeout must be spoken, not filled with a guess");
  assert.match(d, /refuses/i, "out-of-scope asks are refused, not reworded");
});

test("a tool cannot be provisioned without a secret", () => {
  assert.throws(() => admin.researchToolDefinition({ GHOST_AGENCY_API_URL: "https://x.test" }), /vapi_tool_secret_unset/);
});

test("attaching research is additive — the four tools already on Riley survive", () => {
  const RILEY = Object.freeze({
    id: "assistant_riley",
    model: {
      provider: "openai", model: "gpt-4.1-mini", temperature: 0.7,
      messages: [{ role: "system", content: "You are Riley..." }],
      toolIds: ["a325d1b1", "a5707543", "4766fb67", "b5aa0f65"],
    },
    voice: { provider: "11labs", voiceId: "riley" },
    transcriber: { provider: "deepgram", model: "nova-3", language: "multi" },
  });
  const built = admin.additiveModelPatch(RILEY, ["tool_research"]);
  assert.equal(built.ok, true);
  assert.deepEqual(Object.keys(built.patch), ["model"], "voice, transcriber and first message are not in the patch at all");
  assert.deepEqual(built.patch.model.toolIds, ["a325d1b1", "a5707543", "4766fb67", "b5aa0f65", "tool_research"]);
  assert.deepEqual(built.patch.model.messages, RILEY.model.messages, "the system prompt passes through verbatim");
  assert.deepEqual(RILEY.model.toolIds, ["a325d1b1", "a5707543", "4766fb67", "b5aa0f65"], "the source config is not mutated");
  // Re-running must not duplicate.
  const twice = admin.additiveModelPatch({ ...RILEY, model: built.patch.model }, ["tool_research"]);
  assert.equal(twice.patch.model.toolIds.length, 5);
});
