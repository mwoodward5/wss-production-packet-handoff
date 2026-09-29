"use strict";

// A DELETED MIRROR MUST STOP CONVICTING THE LIVING. Measured 2026-08-20: the
// two twin-host orphans were deleted from Vercel, yet their mirror.identity
// rows kept failing every rebuild of the ORIGINAL hosts as duplicate_h1 /
// duplicate_title — the fleet is read from the event log, and deleting a
// project writes nothing there. The log stays append-only: a newest
// {slug, retired:true} row hides that slug and every older row beneath it.
const test = require("node:test");
const assert = require("node:assert/strict");

// Patch the store BEFORE mirror-fleet-identity destructures it at require time.
const store = require("../lib/store");
const realSelect = store.select;
const realRecord = store.recordEvent;
let rows = [];
const captured = [];
store.select = async () => ({ ok: true, data: rows });
store.recordEvent = async (type, payload) => { captured.push({ type, payload }); return { ok: true }; };
const { readFleetIdentities, recordFleetRetirement } = require("../lib/mirror-fleet-identity");
test.after(() => { store.select = realSelect; store.recordEvent = realRecord; });

const live = (slug, h1) => ({ payload: { slug, h1, title: `${h1} | Title` } });

test("a retirement tombstone hides the slug — and every older row beneath it", async () => {
  rows = [
    { payload: { slug: "wss-test-twin-orphan", retired: true } },      // newest
    live("wss-test-twin-orphan", "Build Your. Fencing in Dallas."),    // the poison, older
    live("wss-test-original-host", "Quality Fencing in Tulsa."),
  ];
  const fleet = await readFleetIdentities({});
  assert.deepEqual(fleet.identities.map((i) => i.slug), ["wss-test-original-host"],
    "the retired slug is gone from the comparison fleet entirely");
});

test("without a tombstone the same rows still compare — the gate did not loosen", async () => {
  rows = [
    live("wss-test-twin-orphan", "Build Your. Fencing in Dallas."),
    live("wss-test-original-host", "Quality Fencing in Tulsa."),
  ];
  const fleet = await readFleetIdentities({});
  assert.equal(fleet.identities.length, 2, "live rows keep convicting duplicates exactly as before");
});

test("recordFleetRetirement writes an append-only retired row, never a delete", async () => {
  captured.length = 0;
  const out = await recordFleetRetirement({ slug: "wss-test-twin-orphan", reason: "project deleted" });
  assert.equal(out.ok, true);
  assert.equal(captured[0].type, "mirror.identity");
  assert.equal(captured[0].payload.retired, true);
  assert.equal(captured[0].payload.slug, "wss-test-twin-orphan");
});
