"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const line = require("../lib/line-mirror-resume");

function prospect() {
  return {
    prospect_id: "p1",
    business_name: "Fence Co",
    record: {
      build_ready: {
        proof: { dry_run_ok: true, build_hash: "dry-hash" },
        mirror_request: {
          slug: "wss-test-fence-co-denver",
          donor: "fencing-sterling",
          facts: { business_name: "Fence Co", industry: "fencing", city: "Denver", state: "CO" },
          brand: { logo: "https://example.com/logo.png", accent: "#123456", photos: ["https://example.com/1.jpg"] },
          content: { services: [{ name: "Fence Installation" }], reviews: [], hours: [] },
        },
      },
    },
  };
}

test("stored build-ready request is cloned and stable", () => {
  const p = prospect();
  const one = line.storedBuildReadyRequest(p);
  const two = line.storedBuildReadyRequest(p);
  assert.deepEqual(one, two);
  one.facts.city = "Changed";
  assert.equal(p.record.build_ready.mirror_request.facts.city, "Denver");
});

test("durable Line uses immutable mined request instead of rebuilding enrichment on retries", async () => {
  const seen = [];
  let fallbackCalls = 0;
  const options = {
    runEngine: async (request) => {
      seen.push(JSON.stringify(request));
      return {
        status: 200,
        body: {
          ok: true,
          revealable: true,
          preview_url: "https://wss-test-fence-co-denver.wss-ai.com/",
          build_hash: "stable-live-hash",
          renderer: "mirror-engine@v1",
          qc_contract: "mirror-engine-qc-v1",
          evidence_schema: "mirror-engine-release-evidence-v1",
          evidence_sha: "a".repeat(64),
          checks: { content: { status: "injected", injected: 1 } },
        },
      };
    },
    resolveSignupConfig: () => ({ ok: true, signup: { clientId: "ABC123", domain: "wss-test-fence-co-denver.wss-ai.com" } }),
    buildMirrorForProspect: async () => { fallbackCalls += 1; throw new Error("fallback must not run"); },
  };

  const first = await line.lineBuildMirror(prospect(), options);
  const second = await line.lineBuildMirror(prospect(), options);
  assert.equal(fallbackCalls, 0);
  assert.equal(first.source, "stored_build_ready_mirror_request");
  assert.equal(second.source, "stored_build_ready_mirror_request");
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1], "two retries must hand Mirror Engine byte-identical request inputs");
  const request = JSON.parse(seen[0]);
  assert.equal(request.facts.city, "Denver");
  assert.equal(request.signup.clientId, "ABC123");
});

test("needs_fill prospects retain the existing enrichment builder", async () => {
  let fallbackCalls = 0;
  const p = prospect();
  p.needs_fill = true;
  const out = await line.lineBuildMirror(p, {
    buildMirrorForProspect: async () => {
      fallbackCalls += 1;
      return { ok: false, reason: "fill-path" };
    },
  });
  assert.equal(fallbackCalls, 1);
  assert.equal(out.reason, "fill-path");
});
