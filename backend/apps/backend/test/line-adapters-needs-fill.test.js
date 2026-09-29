"use strict";

/**
 * test/line-adapters-needs-fill.test.js — the pick + dispatch half of the
 * needs_fill unblock.
 *
 * An incomplete LeadMiner export with real identity is no longer killed at pick;
 * it rides through flagged needs_fill and dispatches on the packet lane, so the
 * build can AI-fill the thin content. A packet with no usable identity is still
 * killed. And a vertical target prefers the held shelf over a fresh web-hunt.
 */

const test = require("node:test");
const assert = require("node:assert");

const { pickProspects, mirrorProspect } = require("../lib/line-adapters");
const { createContentCertification } = require("../lib/intake-genie-client");

const CERT_KEY = "line-adapters-certified-content-test-key";

function thinPacket() {
  return {
    source: "leadminer_mirror_ready",
    meta: { source: "leadminer_mirror_ready", build_ready: false, missing_build_evidence: ["services"] },
    mirror_ready: { business_name: "Anchor Plumbing Co", place_id: "ChIJthin", industry: "plumbing" },
    services: ["Drain Cleaning", "Water Heater Repair"],
    industry: "plumbing",
  };
}

function thinRow(id, extra = {}, recordExtra = {}) {
  return {
    prospect_id: id,
    business_name: "Anchor Plumbing Co",
    city: "Anchorage",
    state: "AK",
    email: "owner@anchorplumbing.example",
    status: "held",
    preview_url: "",
    updated_at: "2026-08-14T08:00:00.000Z",
    record: {
      status: "held",
      handoff_state: "ready_for_build",
      build_ready: false, // the strict contract FAILED
      truth_packet: thinPacket(),
      truth_packet_source: "leadminer_mirror_ready",
      business_name: "Anchor Plumbing Co",
      industry: "plumbing",
      ...recordExtra,
    },
    ...extra,
  };
}

test('target "leadminer" flags an incomplete-but-identified packet needs_fill instead of killing it', async () => {
  const rows = await pickProspects(
    { target: "leadminer", count: 10 },
    {
      select: async () => ({ ok: true, data: [thinRow("place_thin")] }),
      resolveBuildableDonor: (v) => ({ ok: true, donor: `${v}-donor` }),
    },
  );
  assert.equal(rows.length, 1, "the incomplete export is picked, not killed");
  assert.equal(rows[0].prospectId, "place_thin");
  assert.equal(rows[0].needs_fill, true, "flagged for AI-fill");
  assert.equal(rows[0].contractIssue, "", "a resolvable trade is not a contract refusal");
});

test('an incomplete packet with NO usable identity is still killed at pick', async () => {
  const noIdentity = thinRow("place_dead", { business_name: "", city: "", state: "", email: "" }, {
    business_name: "", industry: "",
    truth_packet: {
      source: "leadminer_mirror_ready",
      meta: { source: "leadminer_mirror_ready", build_ready: false },
      mirror_ready: { place_id: "ChIJdead" }, // no name, no city, no trade
      industry: "",
    },
  });
  const rows = await pickProspects(
    { target: "leadminer", count: 10 },
    { select: async () => ({ ok: true, data: [noIdentity] }) },
  );
  assert.equal(rows.length, 0, "no name, no place, no trade — nothing to AI-fill");
  const shelfStage = rows.funnel[0];
  const killReason = Object.keys(shelfStage.rejected).find((k) => /no usable identity/.test(k));
  assert.ok(killReason, `the kill must be named, got: ${JSON.stringify(shelfStage.rejected)}`);
});

test("mirrorProspect dispatches a needs_fill packet on the packet lane, flag carried to the builder", async () => {
  let dispatched = null;
  const out = await mirrorProspect(
    { prospectId: "place_thin", needs_fill: true },
    {
      lane: "sandbox",
      select: async () => ({ ok: true, data: [thinRow("place_thin")] }),
      mirrorLaneEnabled: () => true,
      dispatchMirrorLane: async (prospect) => {
        dispatched = prospect;
        return { mode: "mirror_lane", urls: { preview_url: "https://wss-test-anchor.wss-ai.com/" } };
      },
    },
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(dispatched, "an incomplete-but-identified packet must dispatch, not hit the contract gate");
  assert.equal(dispatched.truth_packet_source, "leadminer_mirror_ready");
  assert.equal(dispatched.needs_fill, true, "the fill flag reaches buildMirrorForProspect");
});

test("mirrorProspect carries a valid Genie receipt instead of reclassifying it needs_fill", async () => {
  const stored = thinRow("place_certified", {
    current_website: "https://anchorplumbing.example/",
  }, {
    current_website: "https://anchorplumbing.example/",
  });
  stored.website = stored.current_website;
  stored.record.website = stored.current_website;
  const source = "https://anchorplumbing.example/services";
  const requestId = "ghost:place_certified:line-genie-certified-v7";
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true },
    request_id: requestId,
    job_id: "genie-job-place-certified",
    facts: {
      name: "Anchor Plumbing Co",
      city: "Anchorage",
      state: "AK",
      services: ["Drain Cleaning"],
    },
    evidence: [{ field: "services", value: "Drain Cleaning", source_url: source }],
  };
  const made = createContentCertification(packet, stored, {
    signingKey: CERT_KEY,
    requestSources: { website_url: stored.current_website },
    packetLocation: "prospect_record:genie_canonical_packet",
    requestId,
    jobId: packet.job_id,
    idempotencyKey: requestId,
    certifiedAt: "2026-08-25T20:00:00.000Z",
  });
  assert.equal(made.ok, true, JSON.stringify(made));
  Object.assign(stored.record, {
    genie_canonical_packet: packet,
    genie_content_certification: made.receipt,
    genie_compile_sources: { website_url: stored.current_website },
    genie_compile_idempotency_key: requestId,
    genie_content_certification_contract: {
      version: "ghost-line-genie-receipt-v7",
      pipeline_version: "line-genie-certified-v7",
      idempotency_key_sha256: require("node:crypto").createHash("sha256").update(requestId).digest("hex"),
    },
    genie_build_certified: true,
    photo_bank: { photos: [{ url: "https://anchorplumbing.example/crew.jpg", sha256: "a".repeat(64) }] },
    media_bank: { hero_reel: { status: "approved", url: "https://anchorplumbing.example/hero.mp4" } },
    pagehub_build_packet: { packet_id: "pagehub:preserve-me" },
  });

  let dispatched = null;
  const out = await mirrorProspect(
    { prospectId: stored.prospect_id, vertical: "plumbing", needs_fill: true },
    {
      lane: "sandbox",
      certificationKey: CERT_KEY,
      nowMs: Date.parse("2026-08-25T20:05:00.000Z"),
      select: async () => ({ ok: true, data: [stored] }),
      mirrorLaneEnabled: () => true,
      dispatchMirrorLane: async (prospect) => {
        dispatched = prospect;
        return { mode: "mirror_lane", urls: { preview_url: "https://wss-test-anchor.wss-ai.com/" } };
      },
    },
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(dispatched.record?.genie_content_certification);
  assert.deepEqual(dispatched.record.photo_bank, stored.record.photo_bank);
  assert.deepEqual(dispatched.record.media_bank, stored.record.media_bank);
  assert.deepEqual(dispatched.record.pagehub_build_packet, stored.record.pagehub_build_packet);
  assert.equal(dispatched.needs_fill, undefined);
  assert.equal(dispatched.industry, "plumbing");
});

test("mirrorProspect still refuses a packet-source row with no identity at all via the contract gate", async () => {
  const out = await mirrorProspect(
    { prospectId: "place_bare" },
    {
      lane: "sandbox",
      // build_ready false, and the packet has no name/city/trade → not needs_fill,
      // falls to the mined-contract gate, which refuses.
      select: async () => ({
        ok: true,
        data: [{
          prospect_id: "place_bare",
          status: "held",
          record: {
            build_ready: false,
            truth_packet_source: "leadminer_mirror_ready",
            truth_packet: { source: "leadminer_mirror_ready", mirror_ready: { place_id: "ChIJbare" } },
          },
        }],
      }),
      mirrorLaneEnabled: () => true,
      dispatchMirrorLane: async () => { throw new Error("must not dispatch"); },
    },
  );
  assert.equal(out.ok, false);
  assert.match(String(out.reason || ""), /contract|build_ready/i);
});

// --- shelf-first for a vertical target ---------------------------------------

test('a vertical target prefers held shelf packets over a fresh mine', async () => {
  let mined = false;
  const rows = await pickProspects(
    { target: "plumbers in Anchorage AK", count: 2 },
    {
      select: async () => ({
        ok: true,
        data: [thinRow("shelf_a"), thinRow("shelf_b")],
      }),
      resolveBuildableDonor: (v) => ({ ok: true, donor: `${v}-donor` }),
      mineLeads: async () => { mined = true; return { ok: true, rows: [], funnel: [] }; },
    },
  );
  assert.equal(mined, false, "the shelf filled the request; no fresh mine was spent");
  assert.deepEqual(rows.map((r) => r.prospectId).sort(), ["shelf_a", "shelf_b"]);
  assert.ok(rows.every((r) => r.needs_fill === true), "shelf-preferred incomplete packets carry the fill flag");
});

test('a vertical target mines only the shortfall the shelf could not fill', async () => {
  let minedLimit = null;
  const rows = await pickProspects(
    { target: "plumbers in Anchorage AK", count: 3 },
    {
      select: async () => ({ ok: true, data: [thinRow("shelf_a")] }),
      resolveBuildableDonor: (v) => ({ ok: true, donor: `${v}-donor` }),
      mineLeads: async ({ limit }) => { minedLimit = limit; return { ok: true, rows: [], funnel: [{ stage: "mine", entered: 0 }] }; },
    },
  );
  assert.equal(minedLimit, 2, "one shelf row filled, so the mine ran for the remaining two");
  assert.equal(rows[0].prospectId, "shelf_a", "the shelf row leads");
});

test('a vertical quota refill advances the frozen deep-query cursor', async () => {
  let receivedCursor = null;
  await pickProspects(
    { target: "plumbers in Bend OR", count: 1, refillRound: 7 },
    {
      select: async () => ({ ok: true, data: [] }),
      resolveBuildableDonor: (v) => ({ ok: true, donor: `${v}-donor` }),
      mineLeads: async ({ queryShapeCursor }) => {
        receivedCursor = queryShapeCursor;
        return { ok: true, rows: [], funnel: [] };
      },
    },
  );
  assert.equal(receivedCursor, 7, "retry 7 must search shape 7 instead of replaying shape 0");
});

test('a vertical target excludes unrelated and missing-location shelf packets', async () => {
  let minedLimit = null;
  const rows = await pickProspects(
    { target: "plumbers in Cleveland OH", count: 2 },
    {
      select: async () => ({
        ok: true,
        data: [
          thinRow("shelf_alaska"),
          thinRow("shelf_wrong_state", { city: "Cleveland", state: "AK" }),
          thinRow("shelf_missing", { city: "", state: "" }),
        ],
      }),
      resolveBuildableDonor: (v) => ({ ok: true, donor: `${v}-donor` }),
      mineLeads: async ({ limit }) => {
        minedLimit = limit;
        return { ok: true, rows: [], funnel: [] };
      },
    },
  );
  assert.equal(minedLimit, 2, "the requested market is mined for the full count");
  assert.deepEqual(rows.map((row) => row.prospectId), [], "unrelated or unverified shelf locations never ride the run");
});

test('a vertical target keeps a shelf packet from the exact requested city and state', async () => {
  let mined = false;
  const rows = await pickProspects(
    { target: "plumbers in Cleveland, Ohio", count: 1 },
    {
      select: async () => ({
        ok: true,
        data: [
          thinRow("shelf_alaska"),
          thinRow("shelf_cleveland", { city: "Cleveland", state: "OH" }),
        ],
      }),
      resolveBuildableDonor: (v) => ({ ok: true, donor: `${v}-donor` }),
      mineLeads: async () => {
        mined = true;
        return { ok: true, rows: [], funnel: [] };
      },
    },
  );
  assert.equal(mined, false, "an exact shelf match fills the request without a provider call");
  assert.deepEqual(rows.map((row) => row.prospectId), ["shelf_cleveland"]);
});

test('a vertical shelf target without a state mines instead of guessing among same-named cities', async () => {
  let minedLimit = null;
  const rows = await pickProspects(
    { target: "plumbers in Springfield", count: 1 },
    {
      select: async () => ({
        ok: true,
        data: [thinRow("shelf_springfield", { city: "Springfield", state: "IL" })],
      }),
      resolveBuildableDonor: (v) => ({ ok: true, donor: `${v}-donor` }),
      mineLeads: async ({ limit }) => {
        minedLimit = limit;
        return { ok: true, rows: [], funnel: [] };
      },
    },
  );
  assert.equal(minedLimit, 1);
  assert.deepEqual(rows.map((row) => row.prospectId), []);
});

test('conflicting contract and row locations cannot fabricate a shelf match', async () => {
  let minedLimit = null;
  const conflicting = thinRow(
    "shelf_conflict",
    { city: "Anchorage", state: "AK", address: "1 Main St, Anchorage, AK 99501" },
    {
      build_ready: {
        mirror_request: { facts: { city: "Cleveland", state: "OH" } },
      },
    },
  );
  const rows = await pickProspects(
    { target: "plumbers in Anchorage OH", count: 1 },
    {
      select: async () => ({ ok: true, data: [conflicting] }),
      resolveBuildableDonor: (v) => ({ ok: true, donor: `${v}-donor` }),
      mineLeads: async ({ limit }) => {
        minedLimit = limit;
        return { ok: true, rows: [], funnel: [] };
      },
    },
  );
  assert.equal(minedLimit, 1);
  assert.deepEqual(rows.map((row) => row.prospectId), []);
});

test('a partial contract city cannot be completed from a conflicting row location', async () => {
  let minedLimit = null;
  const conflicting = thinRow("shelf_partial_city", {}, {
    build_ready: { mirror_request: { facts: { city: "Cleveland" } } },
  });
  const rows = await pickProspects(
    { target: "plumbers in Anchorage AK", count: 1 },
    {
      select: async () => ({ ok: true, data: [conflicting] }),
      resolveBuildableDonor: (v) => ({ ok: true, donor: `${v}-donor` }),
      mineLeads: async ({ limit }) => {
        minedLimit = limit;
        return { ok: true, rows: [], funnel: [] };
      },
    },
  );
  assert.equal(minedLimit, 1);
  assert.deepEqual(rows.map((row) => row.prospectId), []);
});

test('a partial contract state cannot be completed from a conflicting row location', async () => {
  let minedLimit = null;
  const conflicting = thinRow("shelf_partial_state", {}, {
    build_ready: { mirror_request: { facts: { state: "OH" } } },
  });
  const rows = await pickProspects(
    { target: "plumbers in Anchorage AK", count: 1 },
    {
      select: async () => ({ ok: true, data: [conflicting] }),
      resolveBuildableDonor: (v) => ({ ok: true, donor: `${v}-donor` }),
      mineLeads: async ({ limit }) => {
        minedLimit = limit;
        return { ok: true, rows: [], funnel: [] };
      },
    },
  );
  assert.equal(minedLimit, 1);
  assert.deepEqual(rows.map((row) => row.prospectId), []);
});
