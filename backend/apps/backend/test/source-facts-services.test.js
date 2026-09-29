"use strict";

// The gate's own-services exemption is only as good as the services that reach
// it. Measured live 2026-08-20: "Texas Best Fence & Patio" (a WEB-HUNTED
// prospect — no LeadMiner packet) was convicted twice as
// `concrete:driveway, concrete:patio` for printing its own offerings, because
// sourceFactsFor consulted only packet fields for the verified list while the
// mirror printed the list from the immutable build request
// (build_ready.mirror_request.content.services). The sourcing order now
// mirrors where the page's own bytes came from.
const test = require("node:test");
const assert = require("node:assert/strict");
const { sourceFactsFor } = require("../lib/line-adapters");
const { signEvidence } = require("../lib/mirror-engine/engine");

function selectFor(record) {
  return async () => ({ ok: true, data: [{ prospect_id: "p1", business_name: "Texas Best Fence & Patio", record }] });
}

function releaseEvidence(brand) {
  const evidence = {
    renderer: "mirror-engine@v1",
    qc_contract: "mirror-engine-qc-v1",
    evidence_schema: "mirror-engine-release-evidence-v1",
    revealable: true,
    preview_url: "https://wss-test-source-facts.wss-ai.com/",
    build_hash: "build-source-facts",
    checks: { brand },
  };
  evidence.evidence_sha = signEvidence(evidence);
  return evidence;
}

test("a mined prospect's verified services come from the immutable mirror request", async () => {
  const record = {
    build_ready: {
      mirror_request: {
        facts: { business_name: "Texas Best Fence & Patio", industry: "fencing" },
        content: {
          services: [
            { name: "Wood & Iron Fence Installation" },
            { name: "Automatic Driveway Gates" },
            { name: "Patio Covers" },
          ],
        },
      },
    },
  };
  const out = await sourceFactsFor({ prospectId: "p1" }, { select: selectFor(record) });
  assert.ok(Array.isArray(out.services) && out.services.length === 3,
    `the request's verified service list must reach the gate: ${JSON.stringify(out.services)}`);
  assert.equal(out.services[2].name, "Patio Covers");
});

test("a packet prospect still prefers the packet's list", async () => {
  const record = {
    truth_packet_source: "leadminer_mirror_ready",
    truth_packet: { mirror_ready: { business_name: "B", services: ["Drain Cleaning"] } },
    build_ready: { mirror_request: { content: { services: [{ name: "Other" }] } } },
  };
  const out = await sourceFactsFor({ prospectId: "p1" }, { select: selectFor(record) });
  assert.deepEqual(out.services, ["Drain Cleaning"]);
});

test("source facts use only a proven requested secondary and preserve the original primary", async () => {
  const businessName = "Roy Briley General Contracting, Fire & Water Damage Restoration";
  const services = ["Home Repair", "Emergency Repairs", "Roofing replacement and repairs"];
  const record = {
    truth_packet_source: "leadminer_mirror_ready",
    truth_packet: {
      mirror_ready: {
        business_name: businessName,
        industry: "plumber",
        services,
      },
      services,
    },
  };
  const out = await sourceFactsFor({
    prospectId: "p1",
    businessName,
    vertical: "general contractor",
  }, {
    select: async () => ({ ok: true, data: [{ prospect_id: "p1", business_name: businessName, record }] }),
  });
  assert.equal(out.vertical, "general contractor");
  assert.ok(out.secondary_verticals.includes("water damage restoration"), JSON.stringify(out));

  const refused = await sourceFactsFor({
    prospectId: "p1",
    businessName,
    vertical: "roofing",
  }, {
    select: async () => ({ ok: true, data: [{ prospect_id: "p1", business_name: businessName, record }] }),
  });
  assert.equal(refused.vertical, "water damage restoration", "one roofing hit cannot replace the proven primary");
});

test("no verified list anywhere => the field stays absent (ABSENT beats invented)", async () => {
  const out = await sourceFactsFor({ prospectId: "p1" }, { select: selectFor({}) });
  assert.equal(out.services, undefined);
});

test("source facts trust the matching logo hash in signed engine evidence", async () => {
  const sha = "a".repeat(64);
  const row = {
    prospectId: "p1",
    vertical: "fencing",
    previewUrl: "https://wss-test-source-facts.wss-ai.com/",
    releaseEvidence: releaseEvidence({
      status: "passed",
      logo: "client",
      logo_asset_shipped: true,
      logo_in_dom: true,
      logo_sha_source: sha,
      logo_sha_in_output: sha,
    }),
  };
  const out = await sourceFactsFor(row, { select: selectFor({}) });
  assert.equal(out.logo_sha256, sha);
});

test("source facts trust an in-flight packet logo hash enriched before persistence", async () => {
  const sha = "b".repeat(64);
  const out = await sourceFactsFor({
    prospectId: "p1",
    truth_packet_source: "leadminer_mirror_ready",
    truth_packet: {
      mirror_ready: {
        business_name: "Texas Best Fence & Patio",
        logo_url: "https://anchor.example/assets/anchor-logo.png",
        logo_sha256: sha,
      },
    },
  }, { select: selectFor({}) });
  assert.equal(out.logo_sha256, sha);
});

test("source facts carry a signed wordmark fallback and ignore tampered evidence", async () => {
  const mark = {
    rung: "wordmark",
    value: { type: "wordmark", text: "Texas Best Fence", color: "#123456" },
    reason: "no usable image fell to wordmark",
  };
  const signed = releaseEvidence({
    status: "passed",
    logo: "wordmark-fallback",
    logo_in_dom: false,
    mark_fallback: "wordmark",
    mark,
  });
  const clean = await sourceFactsFor({
    prospectId: "p1",
    vertical: "fencing",
    previewUrl: signed.preview_url,
    releaseEvidence: signed,
  }, { select: selectFor({}) });
  assert.deepEqual(clean.brand_mark, mark);

  const tampered = { ...signed, checks: { brand: { ...signed.checks.brand, mark: { ...mark, rung: "donor_default" } } } };
  const refused = await sourceFactsFor({
    prospectId: "p1",
    vertical: "fencing",
    previewUrl: signed.preview_url,
    releaseEvidence: tampered,
  }, { select: selectFor({}) });
  assert.equal(refused.brand_mark, undefined);
});
