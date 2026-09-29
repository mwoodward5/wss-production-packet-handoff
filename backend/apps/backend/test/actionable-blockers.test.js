"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { actionableBlockers, blockerFromEvent } = require("../lib/actionable-blockers");

test("turns raw intake blocker into an owner-actionable record", () => {
  const item = blockerFromEvent({
    type: "intake.failed", created_at: "2026-07-18T00:00:00Z", prospect_id: "p1",
    payload: { code: "intake_genie_blocked", stage: "intake", requirementSatisfied: false },
  }, { p1: "Ink House" });
  assert.equal(item.prospect, "Ink House");
  assert.equal(item.code, "intake_genie_blocked");
  assert.equal(item.retryEligible, false);
  assert.match(item.safeNextAction, /public/);
});

test("keeps supervised ten review pending and never offers premature retry", () => {
  const [item] = actionableBlockers({ events: [{
    type: "campaign.blocked", created_at: "2026-07-18T00:00:00Z",
    payload: { blocked: "supervised_10_review_pending" },
  }] });
  assert.equal(item.code, "supervised_10_review_pending");
  assert.equal(item.retryEligible, false);
  assert.match(item.safeNextAction, /owner explicitly approves/);
});
