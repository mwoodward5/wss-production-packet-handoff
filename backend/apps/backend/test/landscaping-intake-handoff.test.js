"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { prospectBuildInput } = require("../lib/full-run");
const { buildMirrorForProspect } = require("../lib/mirror-lane-build");

function canonicalLandscapingTruth() {
  return {
    meta: { source: "intake_genie", version: "intake-genie-v2" },
    identity: { category: { value: "landscaping", confidence: 0.96 } },
    intakeGenie: {
      source: "intake_genie",
      assets: [
        { kind: "photo", url: "https://landscape.example/projects/front-yard.jpg", verified: true, source: "website" },
        { kind: "photo", url: "https://landscape.example/projects/back-yard.jpg", verified: true, source: "website" },
      ],
      evidence: [
        { field: "category", value: "landscaping", verified: true, source: "https://landscape.example/" },
        { field: "services", value: "Landscape design", verified: true, source: "https://landscape.example/services" },
        { field: "services", value: "Irrigation", verified: true, source: "https://landscape.example/services" },
      ],
    },
  };
}

test("verified Intake Genie landscaping evidence outranks a stale generic construction row label", () => {
  const truth = canonicalLandscapingTruth();
  const out = prospectBuildInput({
    prospect_id: "landscape-1",
    business_name: "The Landscape Connection",
    industry: "construction",
    city: "Lansdale",
    state: "PA",
  }, truth);
  assert.equal(out.industry, "landscaping");
  assert.equal(out.truth_packet, truth);
});

test("PageHub Packet 2 source evidence reaches the build without treating generated prose as truth", () => {
  const pagehub = {
    meta: { source: "intake_genie", version: "intake-genie-v2" },
    identity: { category: { value: "plumbing", confidence: 0.96 } },
    intakeGenie: {
      source: "intake_genie",
      facts: { services: ["Drain cleaning", "Water heater repair"] },
      content: {
        services: [
          { name: "Drain cleaning", description: "Generated marketing claim must not cross the truth seam." },
          { name: "Water heater repair", description: "Another generated claim." },
          { name: "Invented luxury service", description: "Not source-backed." },
        ],
      },
      assets: [
        { kind: "logo", url: "https://plumber.example/assets/logo.svg", source: "firecrawl_website" },
        { kind: "photo", url: "https://plumber.example/assets/van.webp", source: "firecrawl_website" },
      ],
      evidence: [
        { field: "services", value: "Drain cleaning", verified: true, source: "https://plumber.example/services" },
        { field: "services", value: "Water heater repair", confidence: 0.95, source_url: "https://plumber.example/services" },
      ],
      packet2: {
        version: "2.0",
        compiled: { contentFiles: [{ path: "services/drain-cleaning.md", body: "lossless sidecar" }] },
      },
      packet2_sha256: "a".repeat(64),
    },
  };

  const out = prospectBuildInput({
    prospect_id: "pagehub-1",
    business_name: "Packet Plumbing",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    current_website: "https://plumber.example/",
  }, pagehub);

  assert.equal(out.logo_url, "https://plumber.example/assets/logo.svg");
  assert.deepEqual(out.services, [{ name: "Drain cleaning" }, { name: "Water heater repair" }]);
  assert.deepEqual(out.verified_content, { services: out.services });
  assert.deepEqual(out.genie_assets.map((asset) => asset.kind), ["logo", "photo"]);
  assert.strictEqual(out.truth_packet.intakeGenie.packet2, pagehub.intakeGenie.packet2);
  assert.doesNotMatch(JSON.stringify(out.verified_content), /Invented luxury|Generated marketing/);
});

test("Packet confidence and a competitor source cannot self-certify services", () => {
  const truth = {
    meta: { source: "intake_genie", version: "intake-genie-v2" },
    intakeGenie: {
      facts: { services: ["Victim service", "Competitor invention"] },
      evidence: [
        { field: "services", value: "Victim service", confidence: 0.99, source_url: "https://victim.example/services" },
        { field: "services", value: "Competitor invention", confidence: 1, source_url: "https://competitor.example/services" },
        { field: "services", value: "Generic label", confidence: 1, source: "pagehub" },
      ],
    },
  };

  const out = prospectBuildInput({
    prospect_id: "pagehub-domain-bound",
    business_name: "Victim Business",
    industry: "plumbing",
    current_website: "https://victim.example/",
  }, truth);

  assert.deepEqual(out.services, [{ name: "Victim service" }]);
  assert.deepEqual(out.verified_content, { services: out.services });
});

test("normal mirror lane hands Intake Genie photo candidates to the existing ownership gate", async () => {
  const truth = canonicalLandscapingTruth();
  const captured = { harvest: null, request: null };
  const prospect = {
    prospect_id: "landscape-2",
    business_name: "The Landscape Connection",
    industry: "landscaping",
    city: "Lansdale",
    state: "PA",
    site: "https://landscape.example/",
    current_website: "https://landscape.example/",
    logo: "https://landscape.example/logo.png",
    truth_packet: truth,
    record: {},
  };

  const out = await buildMirrorForProspect(prospect, {
    deps: {
      resolveBuildableDonor: () => ({ ok: true, donor: "landscaping-evergreen", vertical: "landscaping" }),
      resolveVerifiedFacts: async () => ({
        ok: true,
        facts: {
          business_name: "The Landscape Connection",
          city: "Lansdale",
          state: "PA",
          current_website: "https://landscape.example/",
          phone: "(215) 555-0100",
        },
        content: { services: ["Landscape design", "Irrigation"] },
        coverage: {},
      }),
      harvestClientPhotos: async (args) => {
        captured.harvest = args;
        return {
          ok: true,
          photos: [
            { url: "https://landscape.example/projects/front-yard.jpg", sha256: "front", ext: "jpg", bytes: 80000, width: 1600, height: 1000 },
            { url: "https://landscape.example/projects/back-yard.jpg", sha256: "back", ext: "jpg", bytes: 70000, width: 1400, height: 900 },
          ],
        };
      },
      resolveSocials: async () => ({ socials: [], source: "not_attempted" }),
      buildDesignBrief: async () => null,
      readFleetIdentities: async () => ({ ok: true, identities: [] }),
      recordFleetIdentity: async () => ({ ok: true }),
      mirror: async (request) => {
        captured.request = request;
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

  assert.equal(out.ok, true);
  assert.ok(captured.harvest, "photo harvester ran");
  assert.deepEqual(
    captured.harvest.genieAssets.map((asset) => asset.url),
    truth.intakeGenie.assets.map((asset) => asset.url),
  );
  assert.equal(captured.request.donor, "landscaping-evergreen");
  assert.equal(captured.request.brand.photos.length, 2);
});
