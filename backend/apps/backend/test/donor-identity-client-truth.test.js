"use strict";

// test/donor-identity-client-truth.test.js — the campaign line_mthy1zg2 kills,
// pinned. Three real businesses died mirror_dispatch_failed_before_build ->
// donor_identity_detected (500):
//
//   Interstate AC   {"bucket":"geo","token":"42.4844","file":"index.html"}
//   Cypress Roofing {"bucket":"socials", ...}
//   Ryson Roofing   {"bucket":"socials", ...}
//
// The investigation found NO donor residue in any donor tree: the geo and
// social atoms live only in the BOILERPLATE manifests, and the bytes that
// matched them in the built pages were the CLIENTS' OWN verified truth —
// a prospect whose pin shares geography with the donor renders coordinates
// that CONTAIN the donor's surveyed atom as a decimal prefix, and a prospect
// whose owner or reviewer is named Mike word-matched roofing-falcon-clean's
// bare-nickname person needle. Two engine defects let that happen:
//
//   1. engine.js called identityScan(files, manifest) with NO client, so the
//      BF-5 place excuse existed in scan.js but never ran in production
//      (pristine main also killed a Dyersville prospect on
//      {"bucket":"city","token":"Dyersville"}).
//   2. The geo bucket had no client-truth mechanism at all.
//
// These tests pin the FIX and the FIRE both: the client's own truth passes,
// and every genuinely foreign token — a leaked donor coordinate, a byline, a
// donor social URL — still fails the build. The gate got WIRING, not softening.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { identityScan, isClientGeo, clientGeoRenderings } = require("../lib/mirror-engine/scan");

const DONOR_ROOT = path.join(__dirname, "..", "donors-clean");
const readManifest = (name) =>
  JSON.parse(fs.readFileSync(path.join(DONOR_ROOT, name, "BOILERPLATE.json"), "utf8"));

// ---------------------------------------------------------------------------
// The geo class (Interstate AC): the client's own verified pin.
// ---------------------------------------------------------------------------

const PLUMBING = readManifest("plumbing-clean");
const IOWA_CLIENT = {
  facts: {
    city: "Dyersville",
    state: "IA",
    county: "Dubuque County",
    latitude: 42.484412,
    longitude: -91.123208,
  },
  content: { areas: ["Dyersville"] },
};
// The page a real build ships: JSON-LD geo nodes and the combined GEO token,
// all rendered from the CLIENT's verified coordinates.
const CLIENT_GEO_PAGE = Buffer.from(
  '<html><body><script type="application/ld+json">' +
    '{"@type":"LocalBusiness","geo":{"@type":"GeoCoordinates","latitude":42.484412,"longitude":-91.123208}}' +
    '</script><p>Find us at 42.484412,-91.123208.</p></body></html>',
  "utf8",
);

test("a coordinate contained in the CLIENT's own verified pin is not donor residue", () => {
  const result = identityScan({ "index.html": CLIENT_GEO_PAGE }, PLUMBING, IOWA_CLIENT);
  assert.deepEqual(result.hits, [], JSON.stringify(result.hits));
  assert.equal(result.clean, true);
  // The excuse is recorded, never silent.
  assert.deepEqual(result.client_places_excused, ["42.4844", "-91.1232"]);
});

test("strict mode (no client) keeps the donor coordinate fully fatal — the gate can still fire", () => {
  const result = identityScan({ "index.html": CLIENT_GEO_PAGE }, PLUMBING);
  assert.equal(result.clean, false, "without the client nothing may be excused");
  const geoTokens = result.hits.filter((h) => h.bucket === "geo").map((h) => h.token);
  assert.deepEqual([...new Set(geoTokens)].sort(), ["-91.1232", "42.4844"]);
});

test("a client with no verified coordinates gets no geo excuse", () => {
  const noGeoClient = { facts: { city: "Dyersville", state: "IA" }, content: {} };
  const result = identityScan({ "index.html": CLIENT_GEO_PAGE }, PLUMBING, noGeoClient);
  assert.equal(result.clean, false, "client truth must be PRESENT to be excused");
  assert.ok(result.hits.some((h) => h.bucket === "geo" && h.token === "42.4844"));
});

test("a genuinely foreign donor coordinate stays fatal even with the client supplied", () => {
  // The roofing donor's Powell OH pin, leaked onto the Iowa client's page.
  const roofing = readManifest("roofing-falcon-clean");
  const page = Buffer.from('<p>Old pin: 40.1581,-83.0752</p>', "utf8");
  const result = identityScan({ "index.html": page }, roofing, IOWA_CLIENT);
  assert.equal(result.clean, false, "a donor coordinate outside the client's pin is a leak");
  const geoTokens = [...new Set(result.hits.filter((h) => h.bucket === "geo").map((h) => h.token))];
  assert.deepEqual(geoTokens.sort(), ["-83.0752", "40.1581"]);
});

test("a same-geography roofing client's own pin is excused (the mirror case)", () => {
  const roofing = readManifest("roofing-falcon-clean");
  const client = {
    facts: { city: "Powell", state: "OH", latitude: 40.158112, longitude: -83.075299 },
    content: {},
  };
  const page = Buffer.from("<p>40.158112,-83.075299</p>", "utf8");
  const result = identityScan({ "index.html": page }, roofing, client);
  assert.deepEqual(result.hits, [], JSON.stringify(result.hits));
});

test("isClientGeo refuses non-coordinate tokens — a zip-shaped geo-list entry can never ride in", () => {
  const renderings = clientGeoRenderings(IOWA_CLIENT);
  assert.ok(isClientGeo("42.4844", renderings));
  assert.ok(!isClientGeo("43065", renderings), "a bare zip is not a coordinate fragment");
  assert.ok(!isClientGeo("52040", renderings), "the donor's own zip is not a coordinate fragment");
  assert.ok(!isClientGeo("42.48", renderings), "two fraction digits is not source-precision survey form");
  assert.ok(!isClientGeo("424844", renderings), "no decimal point, no excuse");
});

// ---------------------------------------------------------------------------
// The socials class (Cypress/Ryson Roofing): the bare-nickname person needle.
// ---------------------------------------------------------------------------

const ROOFING = readManifest("roofing-falcon-clean");
const ROOFING_CLIENT = {
  facts: { city: "Powell", state: "OH", county: "Delaware County", owner_name: "Mike Cypress" },
  content: { areas: ["Powell"] },
};
// What a legitimate roofing build carries when the client's owner or a verified
// reviewer is named Mike — words that belong to the CLIENT.
const MIKE_PAGE = Buffer.from(
  "<html><body><h1>Cypress Roofing</h1><footer>Owner: Mike</footer>" +
    '<blockquote><cite>Mike R.</cite> Great roof.</blockquote></body></html>',
  "utf8",
);

test("the roofing donor no longer declares the bare nickname 'Mike' as a person atom", () => {
  // The kill: {"bucket":"socials","token":"Mike"} — a four-letter common given
  // name folds into the socials bucket and is NEVER excusable (person atoms
  // stay fatal by design), so any Mike on a client page failed the build.
  assert.ok(
    !ROOFING.persons.includes("Mike"),
    "roofing-falcon-clean still carries the unusable 'Mike' needle",
  );
  // The DISTINCTIVE needles remain — this is not the atom list going soft.
  for (const needle of ["Michael Forchione", "Forchione", "M. Forchione"]) {
    assert.ok(ROOFING.persons.includes(needle), `distinctive person needle lost: ${needle}`);
  }
});

test("a client owner/reviewer named Mike no longer fails the roofing build", () => {
  const result = identityScan({ "index.html": MIKE_PAGE }, ROOFING, ROOFING_CLIENT);
  assert.deepEqual(result.hits, [], JSON.stringify(result.hits));
  assert.equal(result.clean, true);
});

test("a real Falcon byline leak still fails closed (the OWNER · M. FORCHIONE class)", () => {
  const page = Buffer.from("<p>OWNER · M. Forchione</p>", "utf8");
  const result = identityScan({ "index.html": page }, ROOFING, ROOFING_CLIENT);
  assert.equal(result.clean, false);
  const tokens = result.hits.map((h) => h.token);
  assert.ok(tokens.includes("Forchione"), `hits were ${JSON.stringify(result.hits)}`);
  assert.ok(tokens.includes("M. Forchione"), `hits were ${JSON.stringify(result.hits)}`);
});

test("a donor social URL leak still fails closed", () => {
  const page = Buffer.from(
    '<a href="https://www.facebook.com/share/16rhQWHwU2/?mibextid=wwXIfr">follow us</a>',
    "utf8",
  );
  const result = identityScan({ "index.html": page }, ROOFING, ROOFING_CLIENT);
  assert.equal(result.clean, false);
  assert.ok(result.hits.some((h) => h.bucket === "socials" && String(h.token).includes("facebook.com")));
});

test("the installed roofing tree carries no 'Mike' — dropping the needle blinds nothing in-tree", () => {
  const dir = path.join(DONOR_ROOT, "roofing-falcon-clean");
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name !== "BOILERPLATE.json") {
        const text = fs.readFileSync(full, "utf8");
        assert.ok(!/\bMike\b/.test(text), `${path.relative(dir, full)} contains 'Mike' — re-declare the needle with a distinctiveness argument`);
      }
    }
  };
  walk(dir);
});

// ---------------------------------------------------------------------------
// The BF-5 wiring gap: the engine never passed the client, so even place
// atoms (the client's own city/county) stayed fatal in production.
// ---------------------------------------------------------------------------

test("the client's own city and county are excused when the client is supplied", () => {
  const page = Buffer.from("<p>Serving Powell and Delaware County.</p>", "utf8");
  const withClient = identityScan({ "index.html": page }, ROOFING, ROOFING_CLIENT);
  assert.deepEqual(withClient.hits, [], JSON.stringify(withClient.hits));
  const withoutClient = identityScan({ "index.html": page }, ROOFING);
  assert.equal(withoutClient.clean, false, "strict mode keeps donor geography fatal");
});

// ---------------------------------------------------------------------------
// Engine level: the production path that killed the three businesses.
// ---------------------------------------------------------------------------

test("ENGINE: an Interstate-AC-shaped build on the real plumbing donor passes the identity gate", async () => {
  process.env.MIRROR_DONOR_ROOT = DONOR_ROOT;
  process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-"));
  const { mirror } = require("../lib/mirror-engine/engine");
  const { createRegistry } = require("../lib/mirror-engine/build-hash");
  const res = await mirror(
    {
      slug: "wss-test-interstate-ac-geo-truth",
      donor: "plumbing-clean",
      facts: {
        business_name: "Interstate AC",
        industry: "plumbing",
        city: "Dyersville",
        state: "IA",
        county: "Dubuque County",
        phone: "(563) 555-0142",
        latitude: 42.484412,
        longitude: -91.123208,
      },
      content: { areas: ["Dyersville"], services: ["Drain cleaning"], reviews: [], faqs: [] },
    },
    { dryRun: true, registry: createRegistry() },
  );
  assert.equal(res.ok, true, JSON.stringify(res.body).slice(0, 600));
  assert.equal(res.body.checks.identity_scan.status, "passed");
});

test("ENGINE: a Cypress-Roofing-shaped build with a Mike owner on the real roofing donor passes", async () => {
  process.env.MIRROR_DONOR_ROOT = DONOR_ROOT;
  process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-"));
  const { mirror } = require("../lib/mirror-engine/engine");
  const { createRegistry } = require("../lib/mirror-engine/build-hash");
  const res = await mirror(
    {
      slug: "wss-test-cypress-roofing-socials",
      donor: "roofing-falcon-clean",
      facts: {
        business_name: "Cypress Roofing",
        industry: "roofing",
        city: "Powell",
        state: "OH",
        county: "Delaware County",
        phone: "(614) 555-0142",
        owner_name: "Mike Cypress",
      },
      content: {
        areas: ["Powell"],
        services: ["Roof repair"],
        reviews: [{ author: "Mike R.", text: "Great roof.", rating: 5 }],
        faqs: [],
      },
    },
    { dryRun: true, registry: createRegistry() },
  );
  assert.equal(res.ok, true, JSON.stringify(res.body).slice(0, 600));
  assert.equal(res.body.checks.identity_scan.status, "passed");
});
