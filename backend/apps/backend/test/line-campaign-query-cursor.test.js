"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { campaignQueryGeometry } = require("../lib/line-continuation");
const { pickProspects } = require("../lib/line-adapters");
const { buildQueries, dispatchQueryPlans, mineLeads } = require("../lib/lead-miner");
const { nextQuotaSource, QUOTA_CONTRACT_STAGE } = require("../lib/line-quota");

test("durable batch ids produce stable non-secret query geometry", () => {
  const first = campaignQueryGeometry("batch_campaign_0");
  const retry = campaignQueryGeometry("batch_campaign_0");
  const next = campaignQueryGeometry("batch_campaign_2");

  assert.deepEqual(retry, first, "the same durable batch must reproduce its cursor and offset");
  assert.notDeepEqual(next, first, "different campaign ids should rotate the starting geometry");
  assert.ok(Number.isInteger(first.queryShapeCursor) && first.queryShapeCursor >= 0);
  assert.ok(Number.isInteger(first.queryGroupOffset) && first.queryGroupOffset >= 0);
  assert.deepEqual(campaignQueryGeometry(""), { queryShapeCursor: 0, queryGroupOffset: 0 });
});

test("durable batch ids rotate the actual first All Trades vertical and metro", () => {
  const options = {
    verticals: ["plumbing", "hvac", "roofing", "concrete"].map((vertical) => ({ vertical })),
    metros: ["Austin TX", "Denver CO", "Boise ID", "Tulsa OK"],
  };
  const sourceFor = (batchId) => nextQuotaSource({
    batchId,
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    rows: [],
    mineFunnel: [{ stage: QUOTA_CONTRACT_STAGE }],
  }, options);
  const first = sourceFor("batch_campaign_source_0");
  assert.deepEqual(sourceFor("batch_campaign_source_0"), first, "one campaign retry is deterministic");
  const targets = new Set(Array.from({ length: 8 }, (_, index) => sourceFor(`batch_campaign_source_${index}`).target));
  assert.ok(targets.size > 1, "different campaigns must not all restart at the same trade and metro");
});

test("campaign geometry rotates the first trade/metro while preserving one search per market", () => {
  const plans = buildQueries({
    industries: "plumbing,hvac",
    locations: "Austin TX,Denver CO",
    nearbyCities: ["Round Rock TX"],
    env: {},
  });
  const groups = new Set(plans.map((plan) => plan.queryGroup));
  assert.equal(groups.size, 4);

  const geometry = campaignQueryGeometry("batch_campaign_0");
  const same = dispatchQueryPlans(plans, geometry.queryShapeCursor, geometry.queryGroupOffset);
  const retry = dispatchQueryPlans(plans, geometry.queryShapeCursor, geometry.queryGroupOffset);
  assert.deepEqual(retry, same);
  assert.equal(same.length, groups.size, "retargeting must still collapse to one provider search per market");
  assert.equal(new Set(same.map((plan) => plan.queryGroup)).size, groups.size);

  const rotated = dispatchQueryPlans(plans, geometry.queryShapeCursor, geometry.queryGroupOffset + 1);
  assert.equal(rotated.length, same.length);
  assert.notEqual(rotated[0].queryGroup, same[0].queryGroup, "the offset rotates the starting trade/metro");
  const byGroup = (rows) => new Map(rows.map((row) => [row.queryGroup, row.textQuery]));
  assert.deepEqual(byGroup(rotated), byGroup(same), "market rotation must not widen or change its selected query shape");

  const nextGeometry = campaignQueryGeometry("batch_campaign_2");
  const nextCampaign = dispatchQueryPlans(plans, nextGeometry.queryShapeCursor, nextGeometry.queryGroupOffset);
  assert.notEqual(nextCampaign[0].queryGroup, same[0].queryGroup, "a different batch rotates the actual starting trade/metro");
  assert.notDeepEqual(byGroup(nextCampaign), byGroup(same), "a different batch also rotates its query-shape selection");
});

test("Line adapter combines the stable campaign cursor with refill round and preserves exclusions", async () => {
  const geometry = campaignQueryGeometry("batch_campaign_0");
  let received;
  await pickProspects({
    target: "plumbing in Bend OR",
    count: 10,
    refillRound: 3,
    excludeProspectIds: ["already-attempted"],
    ...geometry,
  }, {
    select: async () => ({ ok: true, data: [] }),
    resolveBuildableDonor: (vertical) => ({ ok: true, donor: `${vertical}-donor` }),
    mineLeads: async (input) => {
      received = input;
      return { ok: true, rows: [], funnel: [] };
    },
  });

  assert.equal(received.queryShapeCursor, geometry.queryShapeCursor + 3);
  assert.equal(received.queryGroupOffset, geometry.queryGroupOffset);
  assert.deepEqual(received.excludeProspectIds, undefined, "exclusions stay enforced by the Line shelf/reload path, not sent to providers");
  assert.equal(received.trigger, "operator_line");
  assert.equal(received.lane, "sandbox", "Practice defaults to the sandbox mining lane");
  assert.equal(received.limit, 10);
  assert.equal(received.candidatesPerQuery, 10, "a 10-site Line source must not grade the miner's default 40 candidates before checkpointing");
});

test("Line adapter passes the Live delivery boundary into LeadMiner", async () => {
  let received;
  await pickProspects({
    target: "plumbing in Bend OR",
    count: 1,
    lane: "live",
  }, {
    select: async () => ({ ok: true, data: [] }),
    resolveBuildableDonor: (vertical) => ({ ok: true, donor: `${vertical}-donor` }),
    mineLeads: async (input) => {
      received = input;
      return { ok: true, rows: [], funnel: [] };
    },
  });

  assert.equal(received.trigger, "operator_line");
  assert.equal(received.lane, "live", "Live prospect delivery must retain the live mining lane");
});

for (const lane of ["sandbox", "live"]) {
  test(`LeadMiner forwards the ${lane} lane and both geometry axes into the truth-gated build-ready lane`, async () => {
    const geometry = campaignQueryGeometry("batch_campaign_0");
    let received;
    const result = await mineLeads({
      industry: "plumbing",
      location: "Austin TX",
      limit: 1,
      persist: false,
      lane,
      ...geometry,
      mineBuildReady: async (input) => {
        received = input;
        return {
          ok: true,
          records: [],
          held_rows: [],
          funnel: [
            { stage: "plan", entered: 1, survived: 1, rejected: {} },
            { stage: "discovery", entered: 0, survived: 0, rejected: {} },
          ],
          cost: {},
          rejects: [],
        };
      },
      persistMinedRows: async () => ({
        rows: [], created: 0, updated: 0, duplicateSkipped: 0,
        heldForReview: 0, writeFailed: 0, persistenceAvailable: true,
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(received.queryShapeCursor, geometry.queryShapeCursor);
    assert.equal(received.queryGroupOffset, geometry.queryGroupOffset);
    assert.equal(received.trigger, "manual_console");
    assert.equal(received.lane, lane, `LeadMiner must preserve the ${lane} delivery boundary`);
  });
}
