"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  APPROVED_CATEGORIES,
  normalizeLlmResult,
  parseDeterministic,
} = require("../lib/copilot");
const commandHandler = require("../api/admin/command");

test("all 29 approved categories parse without changing the requested market", () => {
  // 29 = 28 + "real estate agent" (realestate-waterline donor, 2026-08-20).
  assert.equal(APPROVED_CATEGORIES.length, 29);
  for (const category of APPROVED_CATEGORIES) {
    const result = parseDeterministic(`mine 7 ${category.name} businesses in Dallas, TX`);
    assert.equal(result.ok, true, category.name);
    assert.equal(result.action, "mine", category.name);
    assert.equal(result.params.industry, category.name, category.name);
    assert.equal(result.params.location, "Dallas, TX", category.name);
    assert.equal(result.params.limit, 7, category.name);
    assert.equal(result.needsConfirm, true, category.name);
  }
});

test("tattoo artists in Dallas never becomes landscaping in Orange County", () => {
  const result = parseDeterministic("mine 10 tattoo artists in Dallas, TX");
  assert.deepEqual(result.params, { industry: "tattoo", location: "Dallas, TX", limit: 10 });
});

test("unknown category or missing city is refused with no action", () => {
  for (const prompt of ["mine 10 quantum mechanics in Dallas, TX", "mine 10 tattoo artists"]){
    const result = parseDeterministic(prompt);
    assert.equal(result.ok, false);
    assert.equal(result.action, "none");
    assert.deepEqual(result.params, {});
  }
});

test("mine action is inert until explicit confirmation", () => {
  const parsed = parseDeterministic("mine tattoo artists in Dallas, TX");
  const held = commandHandler.enforceMineConfirmation(parsed, false);
  assert.equal(held.action, "none");
  assert.equal(held.confirmationRequired, true);
  assert.deepEqual(held.proposedAction, { action: "mine", params: parsed.params });

  const confirmed = commandHandler.enforceMineConfirmation(parsed, true);
  assert.equal(confirmed.action, "mine");
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.needsConfirm, false);
});

test("LLM mine plans never receive hidden industry or location defaults", () => {
  for (const params of [{ location: "Dallas, TX" }, { industry: "tattoo" }, {}]) {
    const result = normalizeLlmResult({ action: "mine", params }, "test-llm");
    assert.equal(result.ok, false);
    assert.equal(result.refused, true);
    assert.equal(result.action, "none");
    assert.deepEqual(result.params, {});
  }
});

test("LLM mine plans are refused even when complete so confirmation cannot reparse into a different plan", () => {
  const result = normalizeLlmResult({ action: "mine", params: { industry: "tattoo", location: "Dallas, TX", limit: 10 } }, "test-llm");
  assert.equal(result.ok, false);
  assert.equal(result.action, "none");
  assert.equal(result.reason, "mine_requires_deterministic_command");
});
