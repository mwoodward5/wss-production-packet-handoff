"use strict";

// A FROZEN ABSENCE MUST NOT FREEZE. Five of ten acceptance-run builds
// (2026-08-20) carried a build-ready contract whose service list was EMPTY —
// the miner's schema+heading harvest reads no navigation — and the frozen
// lane shipped that absence straight into a service_floor refusal while the
// resolver's own firstPartySite finds 12 services on the same homepages.
// The rescue: one free GET fills ONLY services; a miner-harvested list is
// never overridden; a site that truly lists nothing still refuses honestly.
const test = require("node:test");
const assert = require("node:assert/strict");
const { lineBuildMirror } = require("../lib/line-mirror-resume");

function prospect({ services = null, website = "https://www.example-fence.com/" } = {}) {
  return {
    prospect_id: "wss-test-example-fence-denton",
    business_name: "Example Fence Co",
    current_website: website,
    record: {
      current_website: website,
      build_ready: {
        mirror_request: {
          slug: "wss-test-example-fence-denton",
          donor: "fencing-sterling",
          facts: { business_name: "Example Fence Co", industry: "fencing", city: "Denton", state: "TX" },
          brand: { logo: "https://www.example-fence.com/logo.png" },
          content: {
            hours: ["Mon 8-5"],
            reviews: [{ text: "Great fence, straight lines, done on time and on budget.", author: "Pat R." }],
            ...(services ? { services } : {}),
          },
        },
      },
    },
  };
}

function options(over = {}) {
  const captured = {};
  return {
    captured,
    freezeVisualIdentity: async (p, frozen) => ({ request: frozen, measured: false, persisted: false, reason: "test" }),
    resolveSignupConfig: () => ({ signup: null }),
    runEngine: async (request) => {
      captured.request = request;
      return { status: 200, body: { ok: true, revealable: true, preview_url: `https://${request.slug}.wss-ai.com/`, build_hash: "h1" } };
    },
    firstPartySite: async (ctx) => {
      captured.firstPartyCtx = ctx;
      return {
        id: "first_party_site",
        status: "ok",
        observations: { services: [{ name: "Wood Fences" }, { name: "Iron Fences" }, { name: "Automatic Gates" }] },
      };
    },
    ...over,
  };
}

test("an empty contract list is rescued off the client's own site — services only, provenance on the result", async () => {
  const opts = options();
  const out = await lineBuildMirror(prospect(), opts);
  assert.ok(opts.captured.firstPartyCtx, "the one free GET runs when the contract holds no services");
  assert.equal(opts.captured.firstPartyCtx.website, "https://www.example-fence.com/");
  const services = opts.captured.request.content.services.map((s) => s.name);
  assert.deepEqual(services, ["Wood Fences", "Iron Fences", "Automatic Gates"]);
  assert.equal(opts.captured.request.content.hours[0], "Mon 8-5", "everything else in the contract stays frozen");
  assert.equal(opts.captured.request.content_provenance, undefined,
    "the request schema is additionalProperties:false — provenance rides the RESULT, never the request");
  assert.equal(out.content_source, "verified_mined_contract+first_party_services");
  assert.equal(out.service_floor.status, "passed", `rescued services satisfy the floor: ${JSON.stringify(out.service_floor)}`);
});

test("a miner-harvested list is NEVER overridden — the resolver does not even run", async () => {
  const opts = options();
  const out = await lineBuildMirror(prospect({ services: [{ name: "Chain Link Fencing" }] }), opts);
  assert.equal(opts.captured.firstPartyCtx, undefined, "a present list means no fetch at all");
  assert.deepEqual(opts.captured.request.content.services, [{ name: "Chain Link Fencing" }]);
  assert.equal(out.content_source, "verified_mined_contract");
});

test("a site that lists nothing still refuses honestly — the rescue invents no services", async () => {
  const opts = options({
    firstPartySite: async () => ({ id: "first_party_site", status: "ok", observations: {} }),
  });
  const out = await lineBuildMirror(prospect(), opts);
  assert.equal(opts.captured.request.content.services, undefined, "no services arrive from an empty site");
  assert.equal(out.service_floor.status === "passed", false, "the floor still refuses — Encore Concrete stays refused");
  assert.match(String(out.reason), /service_floor/);
});

test("no website on record means no fetch — absence beats guessing", async () => {
  const opts = options();
  await lineBuildMirror(prospect({ website: "" }), opts);
  assert.equal(opts.captured.firstPartyCtx, undefined);
});
