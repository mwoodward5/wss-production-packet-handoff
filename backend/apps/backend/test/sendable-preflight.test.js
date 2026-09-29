"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { sendablePreflight } = require("../lib/sendable-preflight");
const { HOLD_KEY } = require("../lib/supervised-held-drafts");

function readyProspect(id) {
  return {
    prospect_id: id,
    business_name: `Business ${id}`,
    email: `${id}@example.test`,
  };
}

function environmentDeps(overrides = {}) {
  return {
    reviewHoldActive: () => false,
    deliveryPauseStatus: async () => ({ active: false }),
    outreachFromStatus: () => ({ ok: true, from: "cold@go.wss-ai.com" }),
    emailConfigured: () => true,
    resendWebhookConfigured: () => true,
    outreachDnsStatus: async () => ({ ok: true }),
    prospectSendsEnabled: () => true,
    postalAddressConfigured: () => true,
    unsubscribeConfigured: () => true,
    suppressionBlocked: async () => ({ blocked: false }),
    emailLogExists: async () => ({ exists: false }),
    ...overrides,
  };
}

test("reports honest per-gate counts for a mixed candidate set", async () => {
  const readyOne = readyProspect("ready-1");
  const noEmail = { ...readyProspect("no-email-1"), email: "" };
  const noBuildArtifacts = { ...readyProspect("no-build-1"), preview_url: "", release_evidence: null };
  const suppressed = readyProspect("suppressed-1");
  const alreadyContacted = readyProspect("contacted-1");

  const deps = environmentDeps({
    loadByProspectIds: async (ids) => ({
      ok: true,
      rows: [readyOne, noEmail, noBuildArtifacts, suppressed, alreadyContacted].filter(
        (row) => ids.includes(row.prospect_id),
      ),
    }),
    suppressionBlocked: async (row) => ({ blocked: row.prospect_id === "suppressed-1" }),
    emailLogExists: async (row) => ({ exists: row.prospect_id === "contacted-1" }),
  });

  const result = await sendablePreflight(
    { prospectIds: ["ready-1", "no-email-1", "no-build-1", "suppressed-1", "contacted-1"] },
    deps,
  );

  assert.equal(result.ok, true);
  assert.equal(result.source, "prospect_ids");
  assert.equal(result.requested, 5);
  assert.equal(result.consent_ready, 4, "every prospect except the one with no recipient email");
  assert.equal(result.built_ok, 4, "legacy key mirrors consent readiness, not build state");
  assert.equal(result.has_email, 4, "every prospect except the one with no email");
  assert.equal(result.not_suppressed, 4, "every prospect except the suppressed one");
  assert.equal(result.not_already_contacted, 4, "every prospect except the already-contacted one");
  assert.equal(result.actually_sendable, 2, "release/build artifacts do not gate the consent-first offer");
  const readyEntry = result.prospects.find((item) => item.prospectId === "ready-1");
  assert.equal(readyEntry.actually_sendable, true);
  const noBuildEntry = result.prospects.find((item) => item.prospectId === "no-build-1");
  assert.equal(noBuildEntry.actually_sendable, true);
});

test("defaults to the current held-drafts batch when no filter is given", async () => {
  const held = readyProspect("held-1");
  const deps = environmentDeps({
    loadHeldBatch: async (loadByProspectIds) => loadByProspectIds(["held-1"]),
    loadByProspectIds: async (ids) => ({ ok: true, rows: ids.includes("held-1") ? [held] : [] }),
  });
  const result = await sendablePreflight({}, deps);
  assert.equal(result.source, "held_drafts");
  assert.equal(result.holdKey, HOLD_KEY);
  assert.equal(result.requested, 1);
  assert.equal(result.actually_sendable, 1);
});

test("filters by category and location when neither prospectIds nor held batch is requested", async () => {
  let capturedFilter;
  const deps = environmentDeps({
    loadByCategoryLocation: async (filter) => {
      capturedFilter = filter;
      return { ok: true, rows: [readyProspect("filtered-1")] };
    },
  });
  const result = await sendablePreflight({ category: "roofing", location: "Irvine", limit: 40 }, deps);
  assert.equal(result.source, "category_location");
  assert.equal(capturedFilter.category, "roofing");
  assert.equal(capturedFilter.location, "Irvine");
  assert.equal(capturedFilter.limit, 40);
  assert.equal(result.requested, 1);
});

test("surfaces the environment-wide gates that block every send regardless of per-prospect status", async () => {
  const deps = environmentDeps({
    loadByProspectIds: async () => ({ ok: true, rows: [readyProspect("ready-1")] }),
    reviewHoldActive: () => true,
    deliveryPauseStatus: async () => ({ active: true }),
    outreachDnsStatus: async () => ({ ok: false }),
    prospectSendsEnabled: () => false,
    postalAddressConfigured: () => false,
    unsubscribeConfigured: () => false,
  });
  const result = await sendablePreflight({ prospectIds: ["ready-1"] }, deps);
  assert.equal(result.environment.reviewHoldActive, true);
  assert.equal(result.environment.deliveryPauseActive, true);
  assert.equal(result.environment.dnsVerified, false);
  assert.equal(result.environment.prospectSendsEnabled, false);
  assert.equal(result.environment.postalAddressConfigured, false);
  assert.equal(result.environment.unsubscribeConfigured, false);
  assert.equal(result.environment.ready, false, "environment must not read ready while any global gate is blocking");
  assert.equal(result.actually_sendable, 0, "global hold/provider gates are part of actual sendability");
});

test("fails closed when suppression or dedup state cannot be verified", async () => {
  const unavailableSuppression = await sendablePreflight(
    { prospectIds: ["ready-1"] },
    environmentDeps({
      loadByProspectIds: async () => ({ ok: true, rows: [readyProspect("ready-1")] }),
      suppressionBlocked: async () => ({ blocked: false, unavailable: true }),
    }),
  );
  assert.equal(unavailableSuppression.not_suppressed, 0);
  assert.equal(unavailableSuppression.actually_sendable, 0);

  const unavailableDedup = await sendablePreflight(
    { prospectIds: ["ready-1"] },
    environmentDeps({
      loadByProspectIds: async () => ({ ok: true, rows: [readyProspect("ready-1")] }),
      emailLogExists: async () => { throw new Error("offline"); },
    }),
  );
  assert.equal(unavailableDedup.not_already_contacted, 0);
  assert.equal(unavailableDedup.actually_sendable, 0);
});

test("fails closed when the prospect store cannot be read", async () => {
  const deps = environmentDeps({
    loadByProspectIds: async () => ({ ok: false, rows: [] }),
  });
  const result = await sendablePreflight({ prospectIds: ["ready-1"] }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "prospect_store_unavailable");
});

test("fails closed when provider or send-environment readiness cannot be read", async () => {
  const result = await sendablePreflight(
    { prospectIds: ["ready-1"] },
    environmentDeps({
      loadByProspectIds: async () => ({ ok: true, rows: [readyProspect("ready-1")] }),
      outreachDnsStatus: async () => { throw new Error("provider status unavailable"); },
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "send_environment_state_unavailable");
});
