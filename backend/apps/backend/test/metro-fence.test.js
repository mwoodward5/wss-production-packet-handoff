"use strict";

// THE METRO FENCE — a lead must resolve inside the market it was mined for.
//
// THE INCIDENT. Mining "plumbing in Jackson MS" produced exactly one
// build-ready lead, and it was Liberty Plumbing of 7853 Draper Rd, Jackson,
// MICHIGAN — 700 miles from the market that was searched, (517) 937-8274, at
// 42.1490752/-84.3836978. It cleared every gate in the funnel.
//
// It cleared them because nothing ever compared the RESOLVED place to the
// QUERIED one. cityHint was used ONLY to compose the Places query string; the
// match was then accepted on registrable-domain equality alone; and
// latLngInState checks the coordinates against the record's OWN state, so MI
// against MI passed with room to spare. Three geography checks, none of them
// asking the only question that mattered.
//
// A store audit found the same failure already shipped once:
// wss-test-columbus-fence-columbus was mined for "fencing in Columbus OH" and
// resolved to 5356 Hwy 182 E, Columbus, MS. Same-name-different-state is the
// shape of this bug, which is why a bare city-NAME match is never enough here.
//
// WHAT THIS FILE PINS
//   · the two real incidents are refused, by name
//   · a same-state lead passes, because that is the unit we can actually verify
//   · a genuine two-state metro (Kansas City, Cincinnati) is NOT thrown away —
//     but it crosses only on the business's own stated market plus a real land
//     border, never on a matching city name
//   · the refusal is COUNTED IN THE FUNNEL like every other rejection, and the
//     funnel still reconciles: entered === survived + Σ rejected
//   · a metro given without a state is refused at stage 0, before any provider call

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  metroFence,
  metroOfPlan,
  statesAdjacent,
  mineBuildReady,
} = require("../lib/lead-miner");

const JACKSON_MS = metroOfPlan("Jackson MS");
const KC_MO = metroOfPlan("Kansas City MO");

// ---------------------------------------------------------------------------
// THE DECISION
// ---------------------------------------------------------------------------

test("the Jackson incident: a lead 700 miles out of state is refused, by name", () => {
  const verdict = metroFence({
    metro: JACKSON_MS,
    state: "MI",
    locality: "Jackson",
    assertion: null,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "out_of_metro_state");
  // The reason must carry BOTH markets. "refused" with no places named is a
  // counter nobody can audit against the run that produced it.
  assert.match(verdict.detail, /queried Jackson MS/);
  assert.match(verdict.detail, /resolved Jackson MI/);
});

test("the store incident: fencing in Columbus OH never adopts Columbus MS", () => {
  const verdict = metroFence({ metro: metroOfPlan("Columbus OH"), state: "MS", locality: "Columbus", assertion: null });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "out_of_metro_state");
});

test("an identical city name is not a market — that IS the failure", () => {
  // Liberty Plumbing's own site says Jackson. So does every Jackson MS plumber.
  // If a name match crossed the line, the incident would still ship.
  for (const assertion of [
    { city: "Jackson", state: "", surface: "schema_area_served" },
    { city: "Jackson", state: "MI", surface: "title" },
  ]) {
    const verdict = metroFence({ metro: JACKSON_MS, state: "MI", locality: "Jackson", assertion });
    assert.equal(verdict.ok, false, `assertion ${JSON.stringify(assertion)} must not cross a state line`);
    assert.equal(verdict.reason, "out_of_metro_state");
  }
});

test("even a site that DOES name Jackson MS cannot pull Michigan into Mississippi", () => {
  // The second lock. Michigan does not border Mississippi, so no border metro
  // can exist between them and no self-published claim can invent one.
  const verdict = metroFence({
    metro: JACKSON_MS, state: "MI", locality: "Jackson",
    assertion: { city: "Jackson", state: "MS", surface: "title" },
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "out_of_metro_state");
  assert.match(verdict.detail, /MI does not border MS/);
});

test("a same-state lead passes, and the record says on what basis", () => {
  const verdict = metroFence({ metro: JACKSON_MS, state: "MS", locality: "Ridgeland", assertion: null });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.basis, "metro_state_match");
  assert.equal(verdict.queried, "Jackson, MS");
  assert.equal(verdict.resolved, "Ridgeland, MS");
});

test("a genuine two-state metro is not thrown away — on evidence, not on a guess", () => {
  // A plumber in Overland Park KS whose own og:title sells "Kansas City, MO" is
  // a real Kansas City lead. Refusing every crossing would delete the Kansas
  // side of Kansas City, the Kentucky side of Cincinnati and the Washington
  // side of Portland from the whole campaign.
  const kc = metroFence({
    metro: KC_MO, state: "KS", locality: "Overland Park",
    assertion: { city: "Kansas City", state: "MO", surface: "og_title" },
  });
  assert.equal(kc.ok, true);
  assert.equal(kc.basis, "cross_border_metro_self_asserted");
  // The loosened branch is never silent: it names its evidence and its border.
  assert.equal(kc.evidence.surface, "og_title");
  assert.equal(kc.evidence.asserted, "Kansas City, MO");
  assert.equal(kc.evidence.border, "MO-KS");

  const cincy = metroFence({
    metro: metroOfPlan("Cincinnati OH"), state: "KY", locality: "Covington",
    assertion: { city: "Cincinnati", state: "OH", surface: "meta_description" },
  });
  assert.equal(cincy.ok, true);
  assert.equal(cincy.basis, "cross_border_metro_self_asserted");
});

test("the crossing needs the metro itself, not merely a state that touches", () => {
  // Overland Park KS whose site sells Overland Park KS is a fine Kansas lead
  // and a bad Kansas City MO lead. The assertion must be the QUERIED metro.
  const verdict = metroFence({
    metro: KC_MO, state: "KS", locality: "Overland Park",
    assertion: { city: "Overland Park", state: "KS", surface: "title" },
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "out_of_metro_state");
  assert.match(verdict.detail, /own site asserts Overland Park KS/);
});

test("a national page that names the metro from three states away is still refused", () => {
  const verdict = metroFence({
    metro: KC_MO, state: "FL", locality: "Miami",
    assertion: { city: "Kansas City", state: "MO", surface: "title" },
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.detail, /FL does not border MO/);
});

test("absence never widens the fence", () => {
  // No metro state, no resolved state, no assertion — each is a refusal, never
  // a pass. A gate that opens when evidence is missing is not a gate.
  assert.equal(metroFence({ metro: metroOfPlan("Austin"), state: "TX", locality: "Austin" }).reason, "metro_state_unstated");
  assert.equal(metroFence({ metro: JACKSON_MS, state: "", locality: "Jackson" }).reason, "nap_no_state_code");
  assert.equal(metroFence({ metro: JACKSON_MS, state: "LA", locality: "Monroe" }).ok, false);
});

// ---------------------------------------------------------------------------
// THE GEOGRAPHY IT RELIES ON
// ---------------------------------------------------------------------------

test("state adjacency is real, symmetric, and has no self-edges", () => {
  const CODES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");
  for (const a of CODES) {
    assert.equal(statesAdjacent(a, a), false, `${a} cannot border itself`);
    for (const b of CODES) {
      assert.equal(statesAdjacent(a, b), statesAdjacent(b, a),
        `${a}/${b} adjacency must be symmetric — an asymmetric table lets a lead cross one way only`);
    }
  }
  // Islands and peninsulas: Alaska and Hawaii touch nothing.
  for (const b of CODES) {
    assert.equal(statesAdjacent("AK", b), false);
    assert.equal(statesAdjacent("HI", b), false);
  }
  // Spot checks in both directions, including the pair from the incident.
  assert.equal(statesAdjacent("MS", "MI"), false);
  assert.equal(statesAdjacent("OH", "MS"), false);
  for (const [a, b] of [["MO", "KS"], ["OH", "KY"], ["TN", "MS"], ["OR", "WA"], ["DC", "VA"], ["NJ", "NY"], ["TX", "AR"]]) {
    assert.equal(statesAdjacent(a, b), true, `${a} borders ${b}`);
    assert.equal(statesAdjacent(b, a), true, `${b} borders ${a}`);
  }
});

test("every metro in the console's own rotation states its state", () => {
  // The fence is only as good as the plan it fences against, and the console
  // supplies the plan. If someone adds a bare "Austin" to the rotation, that
  // metro silently stops producing leads at all — so it fails HERE instead.
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "console-page.js"), "utf8");
  const match = /var METROS=\[([^\]]+)\]/.exec(source);
  assert.ok(match, "console-page.js must still declare a METROS rotation");
  const metros = match[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
  assert.ok(metros.length >= 40, `expected the full rotation, saw ${metros.length}`);
  for (const metro of metros) {
    const parsed = metroOfPlan(metro);
    assert.match(parsed.state, /^[A-Z]{2}$/, `"${metro}" must carry a state code, got ${JSON.stringify(parsed)}`);
    assert.ok(parsed.city, `"${metro}" must resolve a city, got ${JSON.stringify(parsed)}`);
  }
});

test("a city that shares a state's name still yields a city", () => {
  // normalizeUsLocation reads "Washington" as the state Washington and blanks
  // the city. Without recovery, the DC metro loses the cross-border branch
  // entirely and every Arlington VA business is refused on a naming quirk.
  assert.deepEqual(metroOfPlan("Washington DC"), { city: "Washington", state: "DC" });
  assert.deepEqual(metroOfPlan("Jackson MS"), { city: "Jackson", state: "MS" });
  assert.deepEqual(metroOfPlan("Kansas City, MO"), { city: "Kansas City", state: "MO" });
  assert.deepEqual(metroOfPlan("United States"), { city: "", state: "" });
});

// ---------------------------------------------------------------------------
// THE FUNNEL — the refusal has to be COUNTED, not just decided
// ---------------------------------------------------------------------------

const reconciles = (funnel) => {
  for (const stage of funnel) {
    const rejected = Object.values(stage.rejected).reduce((a, b) => a + b, 0);
    assert.equal(stage.entered, stage.survived + rejected,
      `stage ${stage.stage}: entered ${stage.entered} !== survived ${stage.survived} + rejected ${rejected}`);
  }
};

test("a metro with no state is refused at stage 0, before a single provider call", async () => {
  let firecrawlCalls = 0;
  const out = await mineBuildReady({
    queries: [{ industry: "plumbing", location: "Jackson", textQuery: "plumbing in Jackson" }],
    env: { GOOGLE_PLACES_API_KEY: "k", FIRECRAWL_API_KEY: "k" },
    fetchImpl: async () => { firecrawlCalls++; throw new Error("no call should be made"); },
  });
  assert.equal(out.ok, false);
  assert.equal(out.mode, "metro_state_unstated");
  // Not one cent, and the message tells the operator how to fix their own input.
  assert.equal(firecrawlCalls, 0);
  assert.equal(out.cost.firecrawl_search_calls, 0);
  assert.equal(out.cost.places_calls, 0);
  assert.match(out.message, /"Jackson MS", not "Jackson"/);
  const s0 = out.funnel[0];
  assert.equal(s0.stage, "0_vertical_donor_gate");
  assert.equal(s0.rejected.metro_state_unstated, 1);
  assert.equal(s0.survived, 0);
  reconciles(out.funnel);
  assert.equal(out.rejects[0].reason, "metro_state_unstated");
});

// A hermetic end-to-end run of the funnel's identity half. Two prospects, one
// in the queried metro and one 700 miles out of it, so the test proves the fence
// refuses the stranger WITHOUT also refusing the neighbour — a gate that stops
// everything is not evidence that it stops the right thing.
//
// ZERO PLACES (2026-08-25): the default lane no longer dials Google, so both
// identities come from each business's own STRUCTURED first-party evidence —
// a schema.org PostalAddress, which is exactly the postal-vs-marketing split
// the fence has always adjudicated. The marketing title still carries the
// (possibly different) asserted market; the schema address carries the postal
// truth. Same fence, same refusal, no provider.
//
// The hosts are IP literals from the RFC 5737 documentation ranges: they are
// public addresses (so the engine's SSRF guard admits them without a DNS
// lookup) and they route nowhere, so a stub that leaked would fail loudly
// rather than reach a real business.
const IN_METRO = "203.0.113.10";
const OUT_OF_METRO = "198.51.100.20";

const pageHtml = (name, marketingCity, marketingState, postalCity, postalState) => `<!doctype html><html><head>
<title>${name} | Plumbing in ${marketingCity}, ${marketingState}</title>
<meta name="description" content="${name} — plumbing, drain cleaning and water heaters in ${marketingCity}, ${marketingState}.">
<script type="application/ld+json">{"@type":"LocalBusiness","name":"${name}","telephone":"(555) 555-0100","address":{"@type":"PostalAddress","addressLocality":"${postalCity}","addressRegion":"${postalState}","postalCode":"00000"}}</script>
</head><body><h1>${name}</h1>
<img class="custom-logo" src="/logo.svg" alt="${name}">
<p>Call us or email <a href="mailto:${name.toLowerCase().split(" ")[0]}plumbing@gmail.com">us</a>.</p>
<p>We handle plumbing repairs, drain cleaning and water heater installation.</p>
</body></html>`;

const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#1d4ed8"/></svg>';

const placeFor = (host, name, city, state, lat, lng) => ({
  id: `place-${host}`,
  displayName: { text: name },
  formattedAddress: `100 Main St, ${city}, ${state} 00000, USA`,
  location: { latitude: lat, longitude: lng },
  nationalPhoneNumber: "(555) 555-0100",
  websiteUri: `https://${host}/`,
  primaryType: "plumber",
  types: ["plumber", "point_of_interest"],
  businessStatus: "OPERATIONAL",
  addressComponents: [
    { types: ["locality"], longText: city, shortText: city },
    { types: ["administrative_area_level_1"], longText: state, shortText: state },
    { types: ["postal_code"], longText: "00000", shortText: "00000" },
  ],
});

const PLACES = {
  [IN_METRO]: placeFor(IN_METRO, "Capitol Plumbing", "Jackson", "MS", 32.2988, -90.1848),
  // The real record, as mined: Jackson, MICHIGAN.
  [OUT_OF_METRO]: placeFor(OUT_OF_METRO, "Liberty Plumbing", "Jackson", "MI", 42.1490752, -84.3836978),
};

function harnessFetch(counts, { assertedCityByHost = {}, assertedStateByHost = {} } = {}) {
  const realFetch = global.fetch;
  const impl = async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    if (href.includes("firecrawl")) {
      counts.firecrawl++;
      return new Response(JSON.stringify({
        data: [
          { url: `https://${IN_METRO}/`, title: "Capitol Plumbing | Jackson MS" },
          { url: `https://${OUT_OF_METRO}/`, title: "Liberty Plumbing | Jackson" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href.includes("places.googleapis.com")) {
      counts.places++;
      throw new Error("ZERO-PLACES CONTRACT VIOLATED: the default lane must never dial Google");
    }
    if (/\/logo\.svg$/.test(href)) {
      counts.logo++;
      return new Response(Buffer.from(LOGO_SVG), { status: 200, headers: { "content-type": "image/svg+xml" } });
    }
    const host = new URL(href).hostname;
    if (PLACES[host]) {
      counts.page++;
      const p = PLACES[host];
      const city = p.addressComponents[0].longText;
      const state = p.addressComponents[1].longText;
      // Marketing surfaces may assert a different market; the schema postal
      // address always carries the business's own postal truth.
      return new Response(pageHtml(
        p.displayName.text,
        assertedCityByHost[host] || city,
        assertedStateByHost[host] || state,
        city,
        state,
      ), { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };
  return { impl, restore: () => { global.fetch = realFetch; }, install: () => { global.fetch = impl; } };
}

test("the zero-Places identity funnel refuses the out-of-metro lead and keeps the in-metro one", async () => {
  const counts = { firecrawl: 0, places: 0, logo: 0, page: 0 };
  const harness = harnessFetch(counts);
  harness.install();
  let out;
  try {
    out = await mineBuildReady({
      queries: [{ industry: "plumbing", location: "Jackson MS", textQuery: "plumbing in Jackson MS" }],
      // STRICT MODE: the fence refusal below is the pre-2026-08-31 behavior,
      // now pinned by the kill switch. Trust mode (the default) keeps the
      // out-of-metro row and tags it — see the identity-trust tests below.
      env: { GOOGLE_PLACES_API_KEY: "k", FIRECRAWL_API_KEY: "k", GHOST_AGENCY_IDENTITY_TRUST: "0" },
      fetchImpl: harness.impl,
      resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
      mirrorImpl: async () => ({
        ok: true, status: 200,
        body: {
          ok: true, build_hash: "hash", donor_content_hash: "donor", file_count: 51,
          evidence_sha: "sha", renderer: "mirror-engine@v1",
          checks: { brand: { status: "passed", logo_refs_in_output: 3 } },
        },
      }),
    });
  } finally {
    harness.restore();
  }

  assert.equal(out.ok, true, JSON.stringify(out).slice(0, 400));
  reconciles(out.funnel);

  const s6 = out.funnel.find((s) => s.stage === "6_nap_verification");
  assert.equal(s6.entered, 2, "both prospects must reach the identity stage");
  assert.equal(s6.rejected.out_of_metro_state, 1, "the Michigan lead must be counted as a metro refusal");
  assert.equal(s6.survived, 1);

  // The rejection is in the audit list with both markets named.
  const refusal = out.rejects.find((r) => r.reason === "out_of_metro_state");
  assert.ok(refusal, "the refusal must appear in rejects[] like every other one");
  assert.match(refusal.detail, /queried Jackson MS -> resolved Jackson MI/);

  // And exactly one record survives: the Jackson MISSISSIPPI plumber.
  assert.equal(out.records.length, 1);
  const rec = out.records[0];
  assert.equal(rec.mirror_request.facts.business_name, "Capitol Plumbing");
  assert.equal(rec.mirror_request.facts.state, "MS");
  assert.equal(rec.metro_fence.basis, "metro_state_match");
  assert.equal(rec.metro_fence.queried, "Jackson, MS");
  assert.equal(rec.metro_fence.resolved, "Jackson, MS");
  // The stamp reaches the provenance the packet is audited from.
  assert.equal(rec.provenance.state.metro_fence, "metro_state_match");
  assert.equal(rec.provenance.state.mined_for, "Jackson, MS");
});

// ---------------------------------------------------------------------------
// IDENTITY TRUST MODE (owner directive 2026-08-31) — THE DEFAULT.
//
// TRUST THE SITE: the fence refusal is converted, the row keeps the SITE'S
// market, and the original refusal rides it as
// identity_trust_overridden:out_of_metro_state. This test deliberately sets
// NO GHOST_AGENCY_IDENTITY_TRUST — it pins that trust mode is the default a
// production run gets. The in-metro neighbour is untouched: trust widens the
// gate, it never changes a row that already passed. The kill switch
// (GHOST_AGENCY_IDENTITY_TRUST=0, pinned by the test above) restores the
// refusal exactly.
// ---------------------------------------------------------------------------
test("identity trust is the DEFAULT: the out-of-metro lead survives, tagged, on its own market", async () => {
  const counts = { firecrawl: 0, places: 0, logo: 0, page: 0 };
  const harness = harnessFetch(counts);
  harness.install();
  let out;
  try {
    out = await mineBuildReady({
      queries: [{ industry: "plumbing", location: "Jackson MS", textQuery: "plumbing in Jackson MS" }],
      env: { GOOGLE_PLACES_API_KEY: "k", FIRECRAWL_API_KEY: "k" },
      fetchImpl: harness.impl,
      resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
      mirrorImpl: async () => ({
        ok: true, status: 200,
        body: {
          ok: true, build_hash: "hash", donor_content_hash: "donor", file_count: 51,
          evidence_sha: "sha", renderer: "mirror-engine@v1",
          checks: { brand: { status: "passed", logo_refs_in_output: 3 } },
        },
      }),
    });
  } finally {
    harness.restore();
  }

  assert.equal(out.ok, true, JSON.stringify(out).slice(0, 400));
  reconciles(out.funnel);

  const s6 = out.funnel.find((s) => s.stage === "6_nap_verification");
  assert.equal(s6.entered, 2);
  assert.equal(s6.survived, 2, "the fence refusal became a warning: nobody dies at stage 6");
  assert.deepEqual(s6.rejected, {});
  assert.equal(counts.places, 0, "trust mode stays zero-Places on this lane");

  assert.equal(out.records.length, 2);
  const liberty = out.records.find((r) => r.mirror_request.facts.business_name === "Liberty Plumbing");
  assert.ok(liberty, "the Michigan lead must survive under trust");
  // The override tag rides the row for audit.
  assert.deepEqual(liberty.identity_trust_overrides, ["identity_trust_overridden:out_of_metro_state"]);
  // THE SITE'S OWN MARKET WINS — never the one we queried.
  assert.equal(liberty.mirror_request.facts.state, "MI");
  assert.equal(liberty.mirror_request.facts.city, "Jackson");
  assert.equal(liberty.metro_fence.basis, "identity_trust_overridden");
  assert.equal(liberty.metro_fence.trust.overridden, "out_of_metro_state");
  assert.match(liberty.metro_fence.trust.original_detail, /queried Jackson MS -> resolved Jackson MI/);
  assert.equal(liberty.provenance.state.metro_fence, "identity_trust_overridden");
  // The site's scraped email routes the new site's contact form.
  assert.equal(liberty.mirror_request.facts.email, "libertyplumbing@gmail.com");

  // The in-metro neighbour passed the real fence and carries no tag.
  const capitol = out.records.find((r) => r.mirror_request.facts.business_name === "Capitol Plumbing");
  assert.equal(capitol.identity_trust_overrides, undefined);
  assert.equal(capitol.metro_fence.basis, "metro_state_match");
});

test("the LeadMiner packet never promotes a same-state service area outside the mining city", async () => {
  const counts = { firecrawl: 0, places: 0, logo: 0, page: 0 };
  const harness = harnessFetch(counts, { assertedCityByHost: { [IN_METRO]: "Columbus" } });
  harness.install();
  let out;
  try {
    out = await mineBuildReady({
      queries: [{ industry: "plumbing", location: "Jackson MS", textQuery: "plumbing in Jackson MS" }],
      env: { GOOGLE_PLACES_API_KEY: "k", FIRECRAWL_API_KEY: "k" },
      fetchImpl: harness.impl,
      resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
      mirrorImpl: async () => ({
        ok: true,
        status: 200,
        body: {
          ok: true, build_hash: "hash", donor_content_hash: "donor", file_count: 51,
          evidence_sha: "sha", renderer: "mirror-engine@v1",
          checks: { brand: { status: "passed", logo_refs_in_output: 3 } },
        },
      }),
    });
  } finally {
    harness.restore();
  }

  assert.equal(out.ok, true, JSON.stringify(out).slice(0, 400));
  const capitol = out.records.find((record) => record.mirror_request.facts.business_name === "Capitol Plumbing");
  assert.ok(capitol, "the candidate is ordered and retained; the market claim is not a gate");
  assert.equal(capitol.mirror_request.facts.city, "Jackson");
  assert.equal(capitol.mirror_request.facts.service_area, undefined,
    "Columbus is a real Mississippi city, but not the Jackson market this packet was mined for");
});
