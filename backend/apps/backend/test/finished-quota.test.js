"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const quota = require("../lib/line-quota");
const { contactFirstVerdict, pickProspects } = require("../lib/line-adapters");

function quotaBatch(overrides = {}) {
  return {
    target: "leadminer",
    requested: 50,
    status: "building",
    mineFunnel: [{ stage: quota.QUOTA_CONTRACT_STAGE, entered: 50, survived: 0, rejected: {} }],
    rows: [],
    ...overrides,
  };
}

test("finished quota refills only the gap beyond finished and active rows", () => {
  const batch = quotaBatch({ rows: [{ status: "queued" }, { status: "sent" }, { status: "rejected" }, { status: "qualified" }] });
  assert.equal(quota.finishedQuotaEnabled(batch), true);
  assert.equal(quota.remainingFinishedQuota(batch), 48);
  assert.equal(quota.replacementDeficit(batch), 47);
  assert.equal(quota.shouldRefill(batch), true, "failed capacity is replaced while unrelated active work continues");
  batch.rows[3].status = "gate_failed";
  assert.equal(quota.replacementDeficit(batch), 48);
  assert.equal(quota.shouldRefill(batch), true);
});

test("explicit LeadMiner starts one full ten-row packet wave from the shelf", () => {
  const verticals = Array.from({ length: 10 }, (_, index) => ({ vertical: `trade-${index + 1}`, outreachRetired: false }));
  const batch = quotaBatch();
  const shelf = quota.nextQuotaSource(batch, { verticals, metros: ["Metro One ST", "Metro Two ST"] });
  assert.equal(shelf.target, "leadminer");
  assert.equal(shelf.mode, "packet_shelf_balanced_seed");
  assert.equal(shelf.chunk, 10, "the shelf fills one complete packet wave before fresh-source rotation");
});

test("All Trades Nationwide starts fresh and is never an invalid donor vertical", () => {
  const verticals = ["plumbing", "hvac", "fencing", "concrete"].map((vertical) => ({ vertical, outreachRetired: false }));
  const first = quota.nextQuotaSource(quotaBatch({ target: "all trades nationwide", requested: 25 }), {
    verticals,
    metros: ["Houston TX", "Dallas TX"],
  });
  assert.equal(first.target, "plumbing in Houston TX");
  assert.equal(first.mode, "fresh_all_trades_balanced");
  assert.equal(first.chunk, 10);

  const refill = quota.nextQuotaSource(quotaBatch({
    target: "all trades nationwide",
    requested: 25,
    rows: [{ vertical: "plumbing", status: "rejected" }],
    mineFunnel: [
      { stage: quota.QUOTA_CONTRACT_STAGE, entered: 25, survived: 0, rejected: {} },
      { stage: "quota_source_0_plumbing_in_houston_tx", entered: 10, survived: 0, rejected: {} },
    ],
  }), { verticals, metros: ["Houston TX", "Dallas TX"] });
  // Attempt 1 rotates the query SHAPE off the metro ladder (owner directive
  // 2026-09-01): a batch with no durable id starts the region ladder at its
  // head, so the refill searches a region token, not another metro SERP.
  assert.equal(refill.target, "hvac in North Texas");
  assert.equal(refill.queryShape, "region");
  assert.equal(refill.mode, "fresh_all_trades_balanced");
  assert.doesNotMatch(refill.target, /^all trades\b/i);
});

test("plain All Trades also rotates named donor verticals after the first fresh source", () => {
  const verticals = ["plumbing", "hvac", "fencing"].map((vertical) => ({ vertical, outreachRetired: false }));
  const batch = quotaBatch({
    target: "all trades",
    requested: 10,
    rows: [{ vertical: "plumbing", status: "queued" }],
    mineFunnel: [
      { stage: quota.QUOTA_CONTRACT_STAGE, entered: 10, survived: 0, rejected: {} },
      { stage: "quota_source_0_plumbing_in_austin_tx", entered: 4, survived: 1, rejected: {} },
    ],
  });
  const next = quota.nextQuotaSource(batch, { verticals, metros: ["Austin TX"] });
  // Attempt 1 = region shape; the vertical rotation this test protects still
  // lands on the underrepresented fencing donor.
  assert.equal(next.target, "fencing in North Texas");
  assert.equal(next.queryShape, "region");
  assert.equal(next.mode, "fresh_all_trades_balanced");
});

test("all-trades refill chooses the least represented donor vertical, repairing a plumbing-heavy run", () => {
  const verticals = ["plumbing", "hvac", "fencing", "concrete"].map((vertical) => ({ vertical, outreachRetired: false }));
  const plumbing = Array.from({ length: 12 }, () => ({ vertical: "plumbing", status: "queued" }));
  const hvac = Array.from({ length: 3 }, () => ({ vertical: "hvac", status: "queued" }));
  const batch = quotaBatch({
    target: "all trades",
    rows: plumbing.concat(hvac),
    mineFunnel: [
      { stage: quota.QUOTA_CONTRACT_STAGE, entered: 50, survived: 0, rejected: {} },
      { stage: "quota_source_0_plumbing_in_metro_one_st", entered: 15, survived: 15, rejected: {} },
    ],
  });
  const next = quota.nextQuotaSource(batch, { verticals, metros: ["Metro One ST", "Metro Two ST"] });
  assert.equal(next.target, "concrete in North Texas", "zero-count trades win over plumbing and hvac while attempts rotate ties");
  assert.equal(next.queryShape, "region");
  assert.equal(next.mode, "fresh_all_trades_balanced");
});

test("balanced refill rotates tied underrepresented trades instead of repeatedly choosing the first", () => {
  const verticals = ["plumbing", "hvac", "fencing", "concrete"].map((vertical) => ({ vertical, outreachRetired: false }));
  const base = quotaBatch({
    target: "all trades",
    rows: [{ vertical: "plumbing", status: "queued" }],
    mineFunnel: [
      { stage: quota.QUOTA_CONTRACT_STAGE, entered: 50, survived: 0, rejected: {} },
      { stage: "quota_source_0_plumbing_in_metro_one_st", entered: 5, survived: 1, rejected: {} },
      { stage: "quota_source_1_hvac_in_metro_one_st", entered: 10, survived: 0, rejected: {} },
    ],
  });
  const next = quota.nextQuotaSource(base, { verticals, metros: ["Metro One ST", "Metro Two ST"] });
  // Attempt 2 = zip shape (metro -> region -> zip); the tied-trade rotation
  // this test protects still advances past hvac onto concrete.
  assert.equal(next.target, "concrete in 79901");
  assert.equal(next.queryShape, "zip");
});

test("the production picker keeps a buildable business without email and marks delivery held", async () => {
  const row = {
    prospect_id: "no-email-buildable",
    business_name: "No Email Plumbing",
    city: "Boise",
    state: "ID",
    industry: "plumbing",
    status: "new",
    preview_url: "",
    record: {
      build_ready: {
        proof: { build_hash: "build-proof" },
        qualification: {
          website_axis: { score: 40 },
          composite_signal: { score: 40 },
        },
        brand_evidence: {},
        mirror_request: {
          facts: {
            business_name: "No Email Plumbing",
            industry: "plumbing",
            city: "Boise",
            state: "ID",
          },
        },
      },
    },
  };
  const picked = await pickProspects({ target: "", count: 1 }, {
    selectRows: async () => ({ rows: [row] }),
  });
  assert.equal(picked.length, 1);
  assert.equal(picked[0].prospectId, "no-email-buildable");
  assert.equal(picked[0].hasEmail, false);
  assert.equal(picked[0].contactReady, false);
  assert.match(picked[0].contactHoldReason, /delivery held/);
});

test("contact classification holds delivery for missing, placeholder and no-reply email without blocking a build", () => {
  const missing = contactFirstVerdict({ record: {} });
  assert.equal(missing.ok, true);
  assert.equal(missing.contactReady, false);
  assert.equal(missing.email, "");
  const placeholder = contactFirstVerdict({ email: "your@email.com", record: {} });
  assert.equal(placeholder.ok, true);
  assert.equal(placeholder.contactReady, false);
  assert.equal(placeholder.email, "");
  const noReply = contactFirstVerdict({ email: "noreply@realplumber.com", record: {} });
  assert.equal(noReply.ok, true);
  assert.equal(noReply.contactReady, false);
  assert.equal(noReply.email, "");
  const valid = contactFirstVerdict({ email: "service@realplumber.com", record: { truth_packet_source: "leadminer_mirror_ready" } });
  assert.equal(valid.ok, true);
  assert.equal(valid.contactReady, true);
  assert.equal(valid.email, "service@realplumber.com");
});
