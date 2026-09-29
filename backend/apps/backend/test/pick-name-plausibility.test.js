"use strict";

// pick_name_implausible — conservative pick-time prefilter for fresh-mined
// AND shelf-held business names.
//
// Production evidence (line_mthqns6w_f11076abfd, 2026-08-31): the fresh-mining
// lane admitted "Welcome to Portland, Oregon" and "content frame" as
// businessNames; downstream intake certification correctly refused both as
// business_name_mismatch — but only AFTER burning a compile slot, 1-3 minutes
// of compile time, and a batch quota slot. The prefilter refuses obviously-
// not-a-business-name picks at admission, BEFORE the compile, with the
// terminal cause pick_name_implausible riding the same quarantine metadata
// path a certification refusal rides (durable rejected row + refill
// exclusion + auto-replace).
//
// Round 2 evidence (line_mthsj44q, fired 2026-08-31 ~22:11Z on the #517
// deploy): ten MORE garbage names still reached certification — the round-1
// rules were too narrow AND the round-1 hook covered only the fresh-mine
// admission loop, so the recycled pick pool (LeadMiner packet shelf, vertical
// shelf, freshest-store fallback) kept feeding batches scraped <title> tags,
// a raw CSS selector, HTML entities, truncated exports, and marketing
// taglines. These tests pin the round-2 rules AND the round-2 hook surface
// (every pick path except exact-ID operator promises, which stay exempt).
//
// Round 3 evidence (line_mthuxe6u / line_mthy1zg2, 2026-09-01): civic page
// titles, truncated tails, and a few marketing-sentence shapes still reached
// certification. The paired tests below pin those new high-precision rules.
//
// The design law these tests pin: CONSERVATIVE. Only obviously-not-a-business
// names die; legal suffixes, possessives, and ampersand names pass except for
// the documented raw/truncation artifacts; the default verdict is plausible
// because downstream certification remains the last line of defense.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const { pickNamePlausible, stripTitleTagPrefix, PICK_NAME_IMPLAUSIBLE } = require("../lib/pick-name-plausibility");
const { pickProspects } = require("../lib/line-adapters");

const KEY = "test-only-intake-genie-content-certification-key";

// A CertifiedPracticePacket/v1 content contract the current certification
// accepts (schema + kind + version + private builder instructions + hashed,
// safety-passed visitor copy + a category that matches the prospect's).
function certifiedContentContract(category) {
  const body = `# Services\n\nDrain cleaning and water heater repair by a local crew.\n`;
  return {
    schema: "CertifiedPracticePacket/v1",
    kind: "certified_practice_packet",
    version: 1,
    builder_instructions: { public: false },
    visitor_copy: {
      kind: "visitor_copy",
      safety: { pass: true, violations: [] },
      files: { "services.md": body },
      file_hashes: { "services.md": createHash("sha256").update(body).digest("hex") },
    },
    facts: { category },
  };
}

// ---------------------------------------------------------------------------
// Unit: each rule kills its class.
// ---------------------------------------------------------------------------

test("live production rejects are refused: scraped page headlines and UI fragments", () => {
  assert.equal(pickNamePlausible("Welcome to Portland, Oregon"), false);
  assert.equal(pickNamePlausible("content frame"), false);
});

test("empty, whitespace-only, 1-char, and letter-less names are refused", () => {
  for (const name of ["", "   ", "\t", "x", "X", "!", "...", "123", "24/7", "- -"]) {
    assert.equal(pickNamePlausible(name), false, JSON.stringify(name));
  }
});

test("page-headline / CTA prefixes are refused regardless of proper nouns after them", () => {
  for (const name of [
    "Welcome to Portland, Oregon",
    "welcome to the future of plumbing",
    "Home Page",
    "home page for portland plumbing",
    "Click Here",
    "Click here to learn more",
    "Learn More",
    "Read More",
    "Skip to main content",
    "Contact Us",
    "Contact us today",
    "About Us",
    "About us and our history",
    "Our Services",
    "Our services include drain cleaning",
    "Sign In",
    "Log In",
  ]) {
    assert.equal(pickNamePlausible(name), false, JSON.stringify(name));
  }
});

test("pure generic UI/structural fragments with no proper-noun content are refused", () => {
  for (const name of [
    "content frame",
    "Content Frame",
    "CONTENT FRAME.",
    "main content",
    "navigation",
    "Navigation Menu",
    "sidebar",
    "footer",
    "header",
    "iframe",
    "gallery",
    "slider",
    "carousel",
    "video",
    "image",
    "photo",
    "loading",
    "search",
    "menu",
    "home",
    "home page",
    "website",
    "undefined",
    "null",
    "error",
  ]) {
    assert.equal(pickNamePlausible(name), false, JSON.stringify(name));
  }
});

test("unambiguous marketing-copy tails are refused", () => {
  assert.equal(pickNamePlausible("Find the right pro for your project"), false);
  assert.equal(pickNamePlausible("Choosing the best pro for your project"), false);
});

// ---------------------------------------------------------------------------
// Round 2 (line_mthsj44q, 2026-08-31): the ten garbage names that still
// reached certification on the #517 deploy. Each rule below is documented at
// its source in lib/pick-name-plausibility.js.
// ---------------------------------------------------------------------------

test("round 2: all nine garbage names from line_mthsj44q are refused", () => {
  for (const name of [
    // 1. all-lowercase hero-copy sentence with a trailing period
    "we help power the world around us.",
    // 2. ALL-CAPS every-token-generic descriptor name (documented judgment
    //    call: with a legal suffix it always passes; see the pass list below)
    "TURNKEY DESIGN BUILD",
    // 3. marketing-phrase exclamation
    "New and Improved!",
    // 4. leading invitation verb, title case, no proper noun
    "We Build Great Places to Work",
    // 5. raw CSS selector scrape
    ".wc-legacyPageTitle, .GeneralHeade",
    // 6. leading marketing adjective ("Trusted ...") — the ampersand guard
    //    rail does NOT save a tagline-shaped name (documented override)
    "Trusted Home Renovation & Building",
    // 7. truncated export (final token is a single letter)
    "Residential + Commercial General C",
    // 8. leading invitation verb + truncated tail
    "Experience Your Outdoor Living wit",
    // 9. un-rendered HTML entity ("&#038;") — raw markup beats the ampersand
    //    guardrail (documented override)
    "Professional Lawn Care &#038; Land",
  ]) {
    assert.equal(pickNamePlausible(name), false, JSON.stringify(name));
  }
});

test("round 2: the earlier-observed garbage shapes are refused too", () => {
  assert.equal(pickNamePlausible("Local trusted roofing experts"), false); // sentence-case all-generic
  assert.equal(pickNamePlausible("Plumbing Contractor Omaha, NE"), false); // ", ST" address fragment
  assert.equal(pickNamePlausible("Best concrete contractor"), false); // sentence-case all-generic variant
});

test("round 2: markup, entity, and selector syntax is refused regardless of ampersand", () => {
  for (const name of [
    ".wc-legacyPageTitle",
    "#main-content",
    "Smith &amp; Sons",
    "Smith &quot;The Best&quot; Roofing",
    "Professional Lawn Care &#038; Land",
    "a[href], .button",
    "undefined { color: red }",
    "Click <here> now",
  ]) {
    assert.equal(pickNamePlausible(name), false, JSON.stringify(name));
  }
});

test("round 2: real business names proven safe — the filter must never kill these", () => {
  for (const name of [
    // The rescued #10: a REAL business scraped off a <title> tag
    "Backlund Plumbing",
    // A real business the operator explicitly said NOT to target
    "Iowa Roofing Company",
    "Iowa Roofing",
    // Recurring real names from the recycled pool evidence
    "Regency",
    "Regency Roofing",
    "Signature Heating & Air",
    // Mission-pinned real names
    "TURNKEY DESIGN BUILD LLC", // suffix guardrail beats every all-caps rule
    "Trust Building & Construction", // "Trust" is not the "Trusted" invitation token
    "Smith's Plumbing",
    "Anderson Residential + Commercial Services",
    // Tagline-adjacent but proper-noun-anchored names stay admitted
    "Explore Portland Tours",
    "We Build Houses Omaha",
    "Discover Regency Roofing",
    // Hyphenated real names must NOT lose a "Home-" prefix
    "Home-Style Cooking",
    "Home-Style Cooking LLC",
    // Two-token all-caps descriptor names stay admitted (conceivable DBAs)
    "PREMIER ROOFING",
    "QUALITY PLUMBING",
  ]) {
    assert.equal(pickNamePlausible(name), true, JSON.stringify(name));
  }
});

test("round 2: documented judgment call — bare all-caps descriptor names vs suffixed ones", () => {
  // "TURNKEY DESIGN BUILD" (bare) is REFUSED: an ALL-CAPS name of 3+ tokens
  // where every token is a generic trade descriptor (no surname, place,
  // suffix, or ampersand) is directory noise — in line_mthsj44q this exact
  // string died business_name_mismatch. The suffixed registration passes:
  assert.equal(pickNamePlausible("TURNKEY DESIGN BUILD"), false);
  assert.equal(pickNamePlausible("TURNKEY DESIGN BUILD LLC"), true);
  // Title-case "Best Concrete Contractor" keeps its round-1 PASS pin; only
  // the sentence-case every-token-generic variant is refused.
  assert.equal(pickNamePlausible("Best Concrete Contractor"), true);
});

test("round 2: scraped <title> prefixes are stripped, not refused", () => {
  assert.equal(stripTitleTagPrefix("Home - Backlund Plumbing"), "Backlund Plumbing");
  assert.equal(stripTitleTagPrefix("Welcome | Jane's Cafe"), "Jane's Cafe");
  assert.equal(stripTitleTagPrefix("Index — Portland Roofing Co"), "Portland Roofing Co");
  assert.equal(stripTitleTagPrefix("Home: Smith Plumbing"), "Smith Plumbing");
  // No separator, or a hyphenated compound: NOT title-tag chrome, untouched.
  assert.equal(stripTitleTagPrefix("Home Page"), "Home Page");
  assert.equal(stripTitleTagPrefix("Home-Style Cooking"), "Home-Style Cooking");
  assert.equal(stripTitleTagPrefix("Homeward Plumbing"), "Homeward Plumbing");
  // The verdict itself strips first: the rescued business is plausible...
  assert.equal(pickNamePlausible("Home - Backlund Plumbing"), true);
  // ...and a title prefix does not launder garbage ("Home - content frame").
  assert.equal(pickNamePlausible("Home - content frame"), false);
  assert.equal(pickNamePlausible("Home - Welcome to Portland, Oregon"), false);
});

// ---------------------------------------------------------------------------
// Round 3 (line_mthuxe6u / line_mthy1zg2, 2026-09-01).
// ---------------------------------------------------------------------------

test("round 3: all six verified live garbage names are refused", () => {
  for (const name of [
    "Discover the Power of Quality",
    "From quiet nights in to life's brightest m…",
    "Committed to superior quality and results…",
    "A Modern Company for a Modern World",
    "Providing Residential HVAC Products & Serv…",
    "Welcome Louisvilleky.gov",
  ]) {
    assert.equal(pickNamePlausible(name), false, JSON.stringify(name));
  }
});

test("round 3: civic, truncation, and marketing sentence classes are paired with conservative negatives", () => {
  for (const name of [
    "Welcome Louisvilleky",
    "Welcome cityoflouisville",
    "Louisvilleky.gov",
    "Residential General C",
    "Acme Plumbing Serv...",
    "Providing Residential HVAC Products and Services",
    "Committed to Superior Quality and Results",
    "Delivering Quality Results",
    "Experience the Best in HVAC",
    "From quiet nights in to brighter days",
  ]) {
    assert.equal(pickNamePlausible(name), false, JSON.stringify(name));
  }
});

test("round 3: required real-business guardrails and proper-noun rescues stay admitted", () => {
  for (const name of [
    "Quality Heating & Air",
    "Modern Company LLC",
    "Louisville Plumbing Pros",
    "Discover Lawn Care LLC",
    "Robert C. Plumbing",
    "Welcome Inn",
    // Ambiguous initials stay admitted rather than overfitting truncation.
    "Robert C",
    "Robert C.",
    "Robert James C.",
    // Round-3 literal-& judgment: leave to certification when not truncated.
    "Providing Residential HVAC Products & Services",
    "Smith & Sons Providing Quality Work Since 1962 LLC",
    "Smith & Sons Plumbing",
    // A proper noun mid-token rescues the marketing sentence shape.
    "Providing Portland Plumbing",
    "Delivering Andersen Results",
  ]) {
    assert.equal(pickNamePlausible(name), true, JSON.stringify(name));
  }
});

test("a name that is only a legal suffix token is not a business name", () => {
  assert.equal(pickNamePlausible("LLC"), false);
  assert.equal(pickNamePlausible("Inc."), false);
});

// ---------------------------------------------------------------------------
// Unit: real business names MUST pass. THE FILTER MUST NEVER KILL A REAL
// BUSINESS.
// ---------------------------------------------------------------------------

test("live good names and registered-entity names pass", () => {
  for (const name of [
    "Andersen Construction",
    "Portland Custom Homes Construction Company",
    "LS Ready Mix, LLC",
    "H D Pros, LLC.",
    "Pacific Plumbing Co",
    "Plain Co",
    "Acme Plumbing 1",
    "No Email Plumbing",
    "Receipt Roofing",
    "RiverCity Plumbing",
  ]) {
    assert.equal(pickNamePlausible(name), true, JSON.stringify(name));
  }
});

test("guardrails: legal suffixes, possessives, and ampersand names always pass", () => {
  for (const name of [
    "Smith & Sons Plumbing",
    "O'Brien Roofing",
    "Smith's Plumbing",
    "Wells & Fargo",
    "Welcome Home LLC",
    "Best Concrete Contractor LLC",
    "Content Frame Company",
    "Bob's",
  ]) {
    assert.equal(pickNamePlausible(name), true, JSON.stringify(name));
  }
});

test("plausible names containing generic words pass — the generic rule needs EVERY token generic", () => {
  for (const name of [
    "The Gallery",
    "Welcome Inn",
    "Home Improvement Pros",
    "Photo Magic",
    "Video King",
    "Maple Gallery Framing",
    "Open Doors Restoration",
    "US Logistics",
    "To The Point Wellness",
    "7-Eleven",
    "24/7 Plumbing",
    "Search Party Media",
    "A Frame Construction",
    "Main Street Grill",
  ]) {
    assert.equal(pickNamePlausible(name), true, JSON.stringify(name));
  }
});

test("documented boundary decision: keyword-y names that could conceivably be real PASS", () => {
  // "Best Concrete Contractor" and "... Partner" slogans are conceivably
  // registered names; the prefilter is an optimization, not the last line of
  // defense, so bias is to admit. Downstream intake certification still
  // refuses them as business_name_mismatch when the page disagrees.
  assert.equal(pickNamePlausible("Best Concrete Contractor"), true);
  assert.equal(pickNamePlausible("Your Full-Service Plumbing Partner"), true);
  assert.equal(pickNamePlausible("Top Rated Plumbers"), true);
});

// ---------------------------------------------------------------------------
// Integration: the prefilter hooks fresh-pick admission, BEFORE the Intake
// Genie compile, through the same quarantine metadata auto-replace consumes.
// ---------------------------------------------------------------------------

function freshRow(n, business) {
  const id = `pick-q${n}`;
  const website = `https://${id}.example`;
  return {
    prospect_id: id,
    business_name: business,
    city: "Portland",
    state: "OR",
    place_id: `ChIJ-${id}`,
    website,
    status: "new",
    email: `owner@${id}.example`,
    updated_at: "2026-08-31T09:00:00.000Z",
    record: {
      status: "new",
      source: "build-ready-mine",
      truth_packet_source: "leadminer_mirror_ready",
      truth_packet: {
        source: "leadminer_mirror_ready",
        meta: { source: "leadminer_mirror_ready", build_ready: false, missing_build_evidence: ["content"] },
        mirror_ready: {
          business_name: business,
          place_id: `ChIJ-${id}`,
          logo_url: "",
          services: ["Drain Cleaning", "Water Heater Repair"],
        },
        services: ["Drain Cleaning", "Water Heater Repair"],
        industry: "plumbing",
      },
      business_name: business,
      city: "Portland",
      state: "OR",
      place_id: `ChIJ-${id}`,
      website,
      industry: "plumbing",
      build_ready: {
        proof: { build_hash: `fresh-build-${n}` },
        mirror_request: { facts: { current_website: website, socials: [] } },
      },
    },
  };
}

function compilerResultFor(prospect) {
  const id = String(prospect.prospect_id || "");
  const src = `${String(prospect.website || "")}/services`;
  const requestId = `ghost:${id}:line-genie-certified-v7`;
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "plumbing" },
    job_id: `genie-job-${id}`,
    request_id: requestId,
    content: { content_contract: certifiedContentContract("plumbing") },
    // Source observations + provenance-marked evidence rows satisfy the
    // strict source-bound service contract the current certification enforces.
    sources: {
      observations: [{
        source: src,
        extracted: { exactServices: ["Drain Cleaning", "Water Heater Repair"] },
      }],
    },
    facts: {
      name: String(prospect.business_name || ""),
      city: "Portland",
      state: "OR",
      category: "plumbing",
      services: ["Drain Cleaning", "Water Heater Repair"],
    },
    evidence: ["Drain Cleaning", "Water Heater Repair"].map((value) => ({
      field: "services",
      value,
      source_url: src,
      provenance: "observed",
      verification_status: "source observation",
      source_observations: [src],
    })),
  };
  return {
    ok: true,
    packet,
    request: { request_id: requestId, sources: { website_url: src } },
    idempotencyKey: requestId,
  };
}

function fixture({ rows }) {
  const byId = new Map(rows.map((row) => [row.prospect_id, row]));
  const calls = { compiler: [], persisted: [] };
  const deps = {
    env: { VERCEL_ENV: "production" },
    certificationKey: KEY,
    select: async (_table, query) => {
      if (String(query).includes("truth_packet_source=eq.leadminer_mirror_ready")) {
        return { ok: true, data: [] };
      }
      if (String(query).includes("prospect_id=in.")) {
        return { ok: true, data: rows };
      }
      return { ok: true, data: [] };
    },
    mineLeads: async () => ({
      ok: true,
      rows: rows.map((row, index) => ({
        prospect_id: row.prospect_id,
        build_hash: `fresh-build-${index + 1}`,
        persistence: "created",
      })),
      funnel: [],
    }),
    callIntakeGenie: async (prospect) => {
      calls.compiler.push(String(prospect.prospect_id || ""));
      return compilerResultFor(prospect);
    },
    conditionalUpdate: async (_table, _key, id, _guards, patch) => {
      calls.persisted.push(String(id));
      const base = byId.get(String(id)) || {};
      return { ok: true, updated: true, rows: [{ ...base, record: patch.record, updated_at: patch.updated_at }] };
    },
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
    now: () => "2026-08-31T10:00:00.000Z",
    nowMs: Date.parse("2026-08-31T10:05:00.000Z"),
  };
  return { deps, calls };
}

test("an implausibly named fresh pick is refused at admission, never compiled, and rides quarantine for auto-replace", async () => {
  // The live production evidence shape: one page-headline pick, one UI-fragment
  // pick, one real business sibling.
  const rows = [
    freshRow(1, "Welcome to Portland, Oregon"),
    freshRow(2, "content frame"),
    freshRow(3, "Andersen Construction"),
  ];
  const { deps, calls } = fixture({ rows });

  const picked = await pickProspects({ target: "plumbers in Portland OR", count: 3, lane: "sandbox" }, deps);

  assert.deepEqual(
    picked.map((line) => line.prospectId),
    ["pick-q3"],
    "only the real business sibling stays admitted",
  );
  assert.deepEqual(
    calls.compiler,
    ["pick-q3"],
    "no compile slot, compile time, or provider call is spent on either garbage pick",
  );
  assert.deepEqual(picked.quarantined, [
    {
      prospectId: "pick-q1",
      businessName: "Welcome to Portland, Oregon",
      vertical: "plumbing",
      reason: PICK_NAME_IMPLAUSIBLE,
    },
    {
      prospectId: "pick-q2",
      businessName: "content frame",
      vertical: "plumbing",
      reason: PICK_NAME_IMPLAUSIBLE,
    },
  ]);
  assert.equal(PICK_NAME_IMPLAUSIBLE, "pick_name_implausible");

  // The refill arrives with every attempted id excluded (runPick derives the
  // exclusion from ALL durable batch rows — the terminal rejected row for
  // pick-q1/pick-q2 included). Even when the miner re-emits the same
  // businesses, the garbage pick is dropped BEFORE anything else runs.
  const refill = await pickProspects({
    target: "plumbers in Portland OR",
    count: 1,
    lane: "sandbox",
    excludeProspectIds: ["pick-q1", "pick-q2", "pick-q3"],
  }, deps);
  assert.equal(refill.length, 0);
  assert.equal(refill.quarantined, undefined, "an excluded candidate is not re-quarantined");
  assert.equal(calls.compiler.length, 1, "no garbage pick was ever compiled");
});

test("plausibly named fresh picks — including keyword-y and suffixed names — still reach the compiler untouched", async () => {
  const rows = [
    freshRow(1, "LS Ready Mix, LLC"),
    freshRow(2, "Best Concrete Contractor"),
  ];
  const { deps, calls } = fixture({ rows });

  const picked = await pickProspects({ target: "plumbers in Portland OR", count: 2, lane: "sandbox" }, deps);

  assert.deepEqual(picked.map((line) => line.prospectId).sort(), ["pick-q1", "pick-q2"]);
  assert.deepEqual(calls.compiler.sort(), ["pick-q1", "pick-q2"]);
  assert.equal(picked.quarantined, undefined);
});

// ---------------------------------------------------------------------------
// Round 2 integration: the recycled pick pool. #517 hooked ONLY the fresh-mine
// admission loop; line_mthsj44q proved campaign picks also flow through the
// LeadMiner packet shelf, the vertical shelf, and the freshest-store
// fallback. Each test pins the SAME contract on those paths: garbage is
// refused BEFORE any compile spend, title-prefixed real businesses are
// admitted under their stripped name, and quarantine metadata rides the
// picked array for durable rejected rows. The exact-ID operator promise path
// stays exempt by design.
// ---------------------------------------------------------------------------

// A held, build-ready LeadMiner truth-packet row (the shelf inventory shape)
// carrying the same identity anchors the certification path needs.
function shelfRow(n, business) {
  const row = freshRow(n, business);
  return {
    ...row,
    status: "held",
    record: {
      ...row.record,
      status: "held",
      handoff_state: "ready_for_build",
      build_ready: true,
    },
  };
}

test('round 2: target "leadminer" — shelf garbage is refused before the compile, title prefixes are stripped', async () => {
  const rows = [
    shelfRow(1, "Trusted Home Renovation & Building"),
    shelfRow(2, "Home - Backlund Plumbing"),
    shelfRow(3, "Signature Heating & Air"),
  ];
  const calls = { compiler: [] };
  const byId = new Map(rows.map((row) => [row.prospect_id, row]));
  const deps = {
    env: { VERCEL_ENV: "production" },
    certificationKey: KEY,
    select: async (_table, query) => {
      if (String(query).includes("truth_packet_source=eq.leadminer_mirror_ready")) {
        return { ok: true, data: rows };
      }
      return { ok: true, data: [] };
    },
    callIntakeGenie: async (prospect) => {
      calls.compiler.push(`${prospect.prospect_id}|${prospect.business_name}`);
      return compilerResultFor(prospect);
    },
    conditionalUpdate: async (_table, _key, id, _guards, patch) => {
      const base = byId.get(String(id)) || {};
      return { ok: true, updated: true, rows: [{ ...base, record: patch.record, updated_at: patch.updated_at }] };
    },
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
    now: () => "2026-08-31T10:00:00.000Z",
    nowMs: Date.parse("2026-08-31T10:05:00.000Z"),
  };

  const picked = await pickProspects({ target: "leadminer", count: 3, lane: "sandbox" }, deps);

  // The garbage shelf row never reaches the compiler — no compile slot burned.
  assert.deepEqual(
    calls.compiler.sort(),
    ["pick-q2|Backlund Plumbing", "pick-q3|Signature Heating & Air"],
    "the compiler sees the STRIPPED name for the title-tag row and never sees the garbage row",
  );
  assert.deepEqual(
    picked.map((line) => line.businessName).sort(),
    ["Backlund Plumbing", "Signature Heating & Air"],
    "the title-prefixed real business is admitted as 'Backlund Plumbing'",
  );
  assert.deepEqual(picked.quarantined, [
    {
      prospectId: "pick-q1",
      businessName: "Trusted Home Renovation & Building",
      vertical: "plumbing",
      reason: PICK_NAME_IMPLAUSIBLE,
    },
  ]);
  assert.equal(picked.funnel[0].rejected[PICK_NAME_IMPLAUSIBLE], 1, "the funnel names the shelf kill");
});

test("round 2: vertical shelf-first — garbage is refused with durable quarantine, title prefixes stripped", async () => {
  const rows = [
    shelfRow(1, ".wc-legacyPageTitle, .GeneralHeade"),
    shelfRow(2, "Home - Backlund Plumbing"),
    shelfRow(3, "Backlund Plumbing & Heating"),
  ];
  const deps = {
    select: async (_table, query) => {
      if (String(query).includes("truth_packet_source=eq.leadminer_mirror_ready")) {
        return { ok: true, data: rows };
      }
      return { ok: true, data: [] };
    },
    mineLeads: async () => ({ ok: true, rows: [], funnel: [] }),
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
    conditionalUpdate: async () => ({ ok: true, updated: true }),
  };

  const picked = await pickProspects({ target: "plumbers in Portland OR", count: 3, lane: "sandbox" }, deps);

  assert.deepEqual(
    picked.map((line) => line.businessName).sort(),
    ["Backlund Plumbing", "Backlund Plumbing & Heating"],
    "the CSS-selector shelf row is gone and the title-prefixed row is admitted stripped",
  );
  assert.deepEqual(picked.quarantined, [
    {
      prospectId: "pick-q1",
      businessName: ".wc-legacyPageTitle, .GeneralHeade",
      vertical: "plumbing",
      reason: PICK_NAME_IMPLAUSIBLE,
    },
  ]);
});

test("round 2: freshest-store fallback — the third recycled-pool entrance carries the same prefilter", async () => {
  const rows = [
    freshRow(1, "we help power the world around us."),
    freshRow(2, "Home - Backlund Plumbing"),
    freshRow(3, "Smith's Plumbing"),
  ];
  const deps = {
    selectRows: async () => ({ rows }),
    select: async () => ({ ok: true, data: [] }),
  };

  const picked = await pickProspects({ target: "", count: 3, lane: "sandbox" }, deps);

  assert.deepEqual(
    picked.map((line) => line.businessName).sort(),
    ["Backlund Plumbing", "Smith's Plumbing"],
  );
  assert.deepEqual(picked.quarantined, [
    {
      prospectId: "pick-q1",
      businessName: "we help power the world around us.",
      vertical: "plumbing",
      reason: PICK_NAME_IMPLAUSIBLE,
    },
  ]);
});

test("round 2: an excluded garbage row is not re-quarantined by the shelf prefilter", async () => {
  // The refill arrives with every attempted id excluded (runPick derives the
  // exclusion from ALL durable batch rows — the pick_name_implausible
  // rejected row included). The shelf must drop the id without emitting a
  // duplicate quarantine entry, exactly like the fresh lane.
  const rows = [shelfRow(1, "New and Improved!")];
  const deps = {
    select: async (_table, query) => {
      if (String(query).includes("truth_packet_source=eq.leadminer_mirror_ready")) {
        return { ok: true, data: rows };
      }
      return { ok: true, data: [] };
    },
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-donor" }),
    conditionalUpdate: async () => ({ ok: true, updated: true }),
  };

  const picked = await pickProspects({
    target: "leadminer",
    count: 1,
    lane: "sandbox",
    excludeProspectIds: ["pick-q1"],
  }, deps);

  assert.equal(picked.length, 0);
  assert.equal(picked.quarantined, undefined, "an excluded candidate is not re-quarantined");
});