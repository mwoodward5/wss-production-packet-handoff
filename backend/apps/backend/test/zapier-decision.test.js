"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { dispatchZapier, zapierStatus } = require("../lib/adapters");

test("Zapier is explicitly excluded when native fulfillment owns the path", async () => {
  const previous = process.env.ZAPIER_GHOST_AGENCY_HOOK_URL;
  delete process.env.ZAPIER_GHOST_AGENCY_HOOK_URL;
  try {
    assert.deepEqual(zapierStatus({}), {
      mode: "intentionally_disabled", configured: false, required: false, launchReadiness: "excluded",
    });
    const result = await dispatchZapier({ id: "safe-test" });
    assert.equal(result.mode, "intentionally_disabled");
    assert.equal(result.launchReadiness, "excluded");
  } finally {
    if (previous === undefined) delete process.env.ZAPIER_GHOST_AGENCY_HOOK_URL;
    else process.env.ZAPIER_GHOST_AGENCY_HOOK_URL = previous;
  }
});

test("a configured optional hook is visible but never a launch blocker", () => {
  assert.deepEqual(zapierStatus({ ZAPIER_GHOST_AGENCY_HOOK_URL: "https://hooks.zapier.com/test" }), {
    mode: "enabled_optional_adapter", configured: true, required: false, launchReadiness: "not_blocking",
  });
});
