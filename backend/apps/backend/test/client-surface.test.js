"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { clientSurfaceOf, normalizeClientSurface, MAX_AGE_DAYS } = require("../lib/client-surface");
const theme = require("../lib/mirror-engine/theme");

const NOW = Date.parse("2026-08-11T00:00:00.000Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

const goodDark = () => ({
  mode: "dark", basis: "paper", brightShare: 0.38, darkShare: 0.51,
  surface: "#141414", chars: 4200, measured_at: daysAgo(1),
});

test("a real dark reading survives and keeps only the keys the schema names", () => {
  const { surface, reason } = normalizeClientSurface(goodDark(), { now: NOW });
  assert.deepStrictEqual(Object.keys(surface).sort(),
    ["basis", "brightShare", "darkShare", "measured_at", "mode", "surface"]);
  assert.strictEqual(surface.mode, "dark");
  assert.match(reason, /measured_dark_from_paper/);
  // `chars` and `url` are ours for judging the reading; the request schema is
  // additionalProperties:false and would 400 on them.
  assert.ok(!("chars" in surface) && !("url" in surface));
});

test("no measurement is reported as no measurement, not as light", () => {
  for (const empty of [null, undefined, "", 0, []]) {
    const { surface, reason } = normalizeClientSurface(empty, { now: NOW });
    assert.strictEqual(surface, null);
    assert.strictEqual(reason, "no_measurement");
  }
});

test("a bot wall is not a measurement of their site", () => {
  // Northland's own site served 58 characters of 'Checking your browser...' and
  // measured 99.7% bright. Trusting that teaches the engine that every guarded
  // site is white.
  const { surface, reason } = normalizeClientSurface(
    { mode: "light", basis: "paper", chars: 58, measured_at: daysAgo(0) }, { now: NOW },
  );
  assert.strictEqual(surface, null);
  assert.match(reason, /page_had_no_content:58_chars/);
});

test("a stale reading is dropped — businesses redesign", () => {
  const old = { ...goodDark(), measured_at: daysAgo(MAX_AGE_DAYS + 1) };
  const { surface, reason } = normalizeClientSurface(old, { now: NOW });
  assert.strictEqual(surface, null);
  assert.match(reason, /measurement_stale:\d+d_over_120d/);
  // and one day inside the window is kept
  assert.ok(normalizeClientSurface({ ...goodDark(), measured_at: daysAgo(MAX_AGE_DAYS - 1) }, { now: NOW }).surface);
});

test("an unstamped or unparseable reading is refused", () => {
  assert.strictEqual(normalizeClientSurface({ mode: "dark", basis: "paper", chars: 900 }, { now: NOW }).surface, null);
  const bad = normalizeClientSurface({ ...goodDark(), measured_at: "last tuesday" }, { now: NOW });
  assert.strictEqual(bad.surface, null);
  assert.match(bad.reason, /measured_at_unparseable/);
});

test("malformed fields are dropped, never repaired", () => {
  const { surface } = normalizeClientSurface({
    ...goodDark(), brightShare: 42, darkShare: "0.5", surface: "not-a-hex",
  }, { now: NOW });
  assert.ok(surface, "the reading itself is still usable");
  assert.ok(!("brightShare" in surface), "a share outside 0..1 is not a share");
  assert.ok(!("darkShare" in surface), "a string is not a number");
  assert.ok(!("surface" in surface), "a non-hex is not a colour");
});

test("an unrecognised mode or basis names itself in the reason", () => {
  assert.match(normalizeClientSurface({ ...goodDark(), mode: "greyish" }, { now: NOW }).reason, /mode_not_recognised:greyish/);
  assert.match(normalizeClientSurface({ ...goodDark(), basis: "vibes" }, { now: NOW }).reason, /basis_not_recognised:vibes/);
});

test("clientSurfaceOf reads the prospect record and prefers the freshest place it lives", () => {
  const prospect = { record: { client_surface: goodDark() } };
  assert.strictEqual(clientSurfaceOf(prospect, { now: NOW }).surface.mode, "dark");

  // A stale record-level reading does not mask a good one on the contract.
  const both = {
    record: {
      client_surface: { ...goodDark(), measured_at: daysAgo(400) },
      build_ready: { mirror_request: { client_surface: { ...goodDark(), mode: "light" } } },
    },
  };
  assert.strictEqual(clientSurfaceOf(both, { now: NOW }).surface.mode, "light");

  // Nothing anywhere is honest about being nothing.
  assert.strictEqual(clientSurfaceOf({ record: {} }, { now: NOW }).surface, null);
  assert.strictEqual(clientSurfaceOf({}, { now: NOW }).surface, null);
});

test("what survives here is exactly what decideMode can act on", () => {
  // The contract between the two files, asserted rather than assumed.
  const dark = clientSurfaceOf({ record: { client_surface: goodDark() } }, { now: NOW }).surface;
  assert.strictEqual(theme.decideMode(dark).mode, "dark");
  assert.strictEqual(theme.decideMode(dark).measured, true);

  // A hero-only reading passes the normalizer and is still refused as grounds
  // for dark by decideMode — a dark photographic hero is not a dark website.
  const heroOnly = clientSurfaceOf(
    { record: { client_surface: { ...goodDark(), basis: "hero-only" } } }, { now: NOW },
  ).surface;
  assert.strictEqual(heroOnly.basis, "hero-only");
  assert.strictEqual(theme.decideMode(heroOnly).mode, "light");

  // And no measurement at all still means light, recorded as a default.
  assert.strictEqual(theme.decideMode(null).mode, "light");
  assert.strictEqual(theme.decideMode(null).measured, false);
});

test("the object it emits validates against the request schema", () => {
  const schema = require("../lib/mirror-engine/mirror-request.schema.json");
  const def = schema.properties.client_surface;
  const surface = normalizeClientSurface(goodDark(), { now: NOW }).surface;
  assert.strictEqual(def.additionalProperties, false);
  for (const key of Object.keys(surface)) {
    assert.ok(def.properties[key], `schema has no property '${key}' — this would be a 400 at build time`);
  }
  assert.ok(def.properties.mode.enum.includes(surface.mode));
  assert.ok(def.properties.basis.enum.includes(surface.basis));
});
