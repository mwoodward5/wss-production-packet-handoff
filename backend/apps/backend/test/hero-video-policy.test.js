"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const policy = require("../lib/hero-video-policy");

test("Seedance is the hard code-default with an explicit kill switch", () => {
  assert.equal(policy.defaultHeroProducer({}), policy.OPENROUTER_SEEDANCE_PRODUCER);
  for (const value of [undefined, "", "1", "true", "ON", "yes", "unexpected"]) {
    assert.equal(
      policy.defaultHeroProducer({ GHOST_AGENCY_SEEDANCE_PRIMARY: value }),
      policy.OPENROUTER_SEEDANCE_PRODUCER,
      String(value),
    );
  }
  for (const value of ["0", "false", "OFF", "no"]) {
    assert.equal(
      policy.defaultHeroProducer({ GHOST_AGENCY_SEEDANCE_PRIMARY: value }),
      policy.ADS_PRODUCER,
      value,
    );
  }
  for (const value of ["1", "true", "ON", "yes"]) {
    assert.equal(
      policy.defaultHeroProducer({ GHOST_AGENCY_SEEDANCE_PRIMARY: "0", GHOST_AGENCY_WAN_PRIMARY: value }),
      policy.WAN_PRODUCER,
      value,
    );
  }
  assert.equal(policy.defaultHeroProducer(
    { GHOST_AGENCY_SEEDANCE_PRIMARY: "0", GHOST_AGENCY_WAN_PRIMARY: "1" },
    "unknown vertical",
  ), policy.ADS_PRODUCER);
});

test("automatic producer selection respects every existing hero-line kill switch", () => {
  assert.equal(policy.autolineHeroProducer({}), policy.OPENROUTER_SEEDANCE_PRODUCER);
  for (const key of [
    "GHOST_AGENCY_HERO_AUTOLINE",
    "GHOST_AGENCY_HERO_REMMASTER",
    "GHOST_AGENCY_HERO_REMASTER",
  ]) {
    assert.equal(policy.heroAutolineEnabled({ [key]: "0" }), false, key);
    assert.equal(policy.autolineHeroProducer({ [key]: "0" }), "", key);
    assert.equal(
      policy.autolineHeroProducer({
        GHOST_AGENCY_WAN_PRIMARY: "1",
        [key]: "0",
      }),
      "",
      `${key} with WAN opted in`,
    );
  }
  assert.equal(
    policy.autolineHeroProducer({ GHOST_AGENCY_SEEDANCE_PRIMARY: "0", GHOST_AGENCY_WAN_PRIMARY: "1" }),
    policy.WAN_PRODUCER,
  );
});

test("only WAN, Ads, and OpenRouter Seedance are durable; legacy compose requires an explicit or fallback call", () => {
  assert.deepEqual(policy.DURABLE_HERO_PRODUCERS, [
    policy.WAN_PRODUCER,
    policy.ADS_PRODUCER,
    policy.OPENROUTER_SEEDANCE_PRODUCER,
  ]);
  assert.equal(policy.normalizeDurableHeroProducer("", {}), policy.ADS_PRODUCER);
  assert.equal(
    policy.normalizeDurableHeroProducer("", { GHOST_AGENCY_WAN_PRIMARY: "1" }),
    policy.WAN_PRODUCER,
  );
  assert.equal(policy.normalizeDurableHeroProducer(policy.ADS_PRODUCER, {}), policy.ADS_PRODUCER);
  assert.equal(policy.normalizeDurableHeroProducer(policy.LEGACY_COMPOSE_PRODUCER, {}), "");
  assert.equal(policy.resolveHeroProducer(policy.LEGACY_COMPOSE_PRODUCER, { env: {} }), "");
  assert.equal(
    policy.resolveHeroProducer(policy.LEGACY_COMPOSE_PRODUCER, { explicit: true, env: {} }),
    policy.LEGACY_COMPOSE_PRODUCER,
  );
  assert.equal(
    policy.resolveHeroProducer(policy.LEGACY_COMPOSE_PRODUCER, { fallback: true, env: {} }),
    policy.LEGACY_COMPOSE_PRODUCER,
  );
  assert.equal(policy.resolveHeroProducer("unknown", { explicit: true, env: {} }), "");
});
