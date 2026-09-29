"use strict";

// test/discovery-503.test.js — A PROVIDER 503 MUST FAIL FAST AND SAY SO.
//
// Reproduces the live Command Center outage: mine.run returned "Error: timeout"
// on every variant while the heartbeat passed and the pill read
// "CAN'T REACH SERVER (SERVER 503)". The miner logic was fine; the discovery
// fetch had no deadline, so a provider that never answers produced a generic
// timeout instead of a named 503.
//
// EVERY provider call here is injected. Nothing in this file touches the
// network — a test that can be broken by a real outage is not a test.

const test = require("node:test");
const assert = require("node:assert");

const { CircuitBreaker, callProvider, classifyStatus, describe: describeMode } =
  require("../lib/discovery-health");

const noSleep = async () => {};
const respond = (status, body = {}) => ({ status, json: async () => body, text: async () => "" });

test("a 503 is classified unavailable, not a generic error or a quota problem", () => {
  assert.strictEqual(classifyStatus(503), "unavailable");
  assert.strictEqual(classifyStatus(502), "unavailable");
  assert.strictEqual(classifyStatus(504), "unavailable");
  assert.strictEqual(classifyStatus(429), "quota");
  assert.strictEqual(classifyStatus(400), "error");
  assert.strictEqual(classifyStatus(200), "ok");
});

test("(a) simulated 503 -> fast, honest, NAMED error — never 'timeout'", async () => {
  let calls = 0;
  const res = await callProvider({
    url: "https://places.googleapis.com/v1/places:searchText",
    fetchImpl: async () => { calls += 1; return respond(503, { error: "upstream unavailable" }); },
    retries: 2,
    timeoutMs: 500,
    sleepImpl: noSleep,
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.mode, "unavailable");
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res.error, "discovery provider unavailable — 503");
  assert.ok(!/^timeout$/i.test(res.error), "a 503 was reported as a bare timeout again");
  assert.strictEqual(calls, 3, "bounded retry should be 1 attempt + 2 retries");
  assert.strictEqual(res.attempts, 3);
});

test("a hung provider becomes a named deadline error, not an unresolved promise", async () => {
  const res = await callProvider({
    url: "https://example.invalid",
    // The exact live shape: connection accepted, no response, ever.
    fetchImpl: (url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const e = new Error("aborted"); e.name = "TimeoutError"; reject(e);
      });
    }),
    retries: 0,
    timeoutMs: 60,
    sleepImpl: noSleep,
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.mode, "timeout");
  assert.strictEqual(res.error, "discovery provider unavailable — no response before deadline");
});

test("(b) breaker opens after N failures and the card status reflects it", async () => {
  const breaker = new CircuitBreaker({ threshold: 3, cooldownMs: 60000 });
  const fetchImpl = async () => respond(503);

  assert.strictEqual(breaker.status().state, "closed");
  assert.strictEqual(breaker.status().label, "provider healthy");

  for (let i = 0; i < 3; i += 1) {
    await callProvider({ url: "u", fetchImpl, breaker, retries: 0, timeoutMs: 200, sleepImpl: noSleep });
  }

  const status = breaker.status();
  assert.strictEqual(status.state, "open", "breaker never opened after 3 consecutive 503s");
  assert.strictEqual(status.label, "discovery provider down — retrying",
    "the miner card would still show a stale 'mine.run failed'");
  assert.strictEqual(status.failures, 3);

  // Once open, the next call must NOT reach the provider at all.
  let reached = 0;
  const res = await callProvider({
    url: "u",
    fetchImpl: async () => { reached += 1; return respond(503); },
    breaker, retries: 2, timeoutMs: 200, sleepImpl: noSleep,
  });
  assert.strictEqual(reached, 0, "an open breaker still hammered the down provider");
  assert.strictEqual(res.mode, "breaker_open");
  assert.strictEqual(res.error, "discovery provider down — retrying");
  assert.strictEqual(res.attempts, 0);
});

test("the breaker closes again on recovery, so an outage is not sticky", async () => {
  let now = 0;
  const breaker = new CircuitBreaker({ threshold: 2, cooldownMs: 1000, now: () => now });
  const down = async () => respond(503);
  await callProvider({ url: "u", fetchImpl: down, breaker, retries: 0, sleepImpl: noSleep });
  await callProvider({ url: "u", fetchImpl: down, breaker, retries: 0, sleepImpl: noSleep });
  assert.strictEqual(breaker.status().state, "open");

  now += 1001; // cooldown elapses -> half-open probe allowed
  const ok = await callProvider({
    url: "u", fetchImpl: async () => respond(200, { places: [] }), breaker, retries: 0, sleepImpl: noSleep,
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(breaker.status().state, "closed");
  assert.strictEqual(breaker.status().failures, 0);
});

test("a quota error is NOT retried as if the provider were down", async () => {
  let calls = 0;
  const res = await callProvider({
    url: "u",
    fetchImpl: async () => { calls += 1; return respond(429, {}); },
    retries: 3, sleepImpl: noSleep,
  });
  assert.strictEqual(res.mode, "quota");
  assert.strictEqual(calls, 1, "hammering a 429 burns the account's remaining quota");
  assert.strictEqual(res.error, "discovery provider quota exceeded — 429");
});

test("lead-miner surfaces the named mode, not places_error, on a 503", async () => {
  const { searchPlacesPage } = require("../lib/lead-miner");
  const breaker = new CircuitBreaker({ threshold: 99 });
  const out = await searchPlacesPage({
    key: "test-key-not-real",
    textQuery: "roofing in Fort Worth",
    pageSize: 5,
    fetchImpl: async () => respond(503, { error: "upstream" }),
    breaker,
  });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.mode, "provider_unavailable");
  assert.strictEqual(out.status, 503);
  assert.strictEqual(out.error, "discovery provider unavailable — 503");
  assert.strictEqual(out.provider, "google_places_searchtext");
  assert.ok(out.providerHealth, "no provider health for the miner card to render");
});

test("describe() never returns a bare 'timeout' for any mode", () => {
  for (const mode of ["unavailable", "timeout", "network", "quota", "breaker_open", "no_key", "other"]) {
    const text = describeMode(mode, 503);
    assert.ok(text.length > 10 && !/^timeout$/i.test(text), `mode ${mode} produced "${text}"`);
  }
});

// --- RECOVERY: the other half of the provider contract -----------------------
// A fail-fast path is only half a fix. These prove the miner still WORKS the
// moment the provider answers — mocked, never touching live Places.

test("recovery: key present + 200 -> records returned, breaker closed", async () => {
  const { searchPlacesPage } = require("../lib/lead-miner");
  const breaker = new CircuitBreaker({ threshold: 3 });
  const places = [
    { id: "p1", displayName: { text: "A Roofing" }, formattedAddress: "1 Main St, Fort Worth, TX", websiteUri: "https://a.example" },
    { id: "p2", displayName: { text: "B Roofing" }, formattedAddress: "2 Main St, Fort Worth, TX" },
  ];
  const out = await searchPlacesPage({
    key: "mock-key-not-real",
    textQuery: "roofing in Fort Worth",
    pageSize: 5,
    fetchImpl: async () => ({ status: 200, json: async () => ({ places, nextPageToken: null }), text: async () => "" }),
    breaker,
  });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.places.length, 2, "a healthy provider returned no records");
  assert.strictEqual(out.places[0].displayName.text, "A Roofing");
  assert.strictEqual(breaker.status().state, "closed");
});

test("recovery after an outage: 503s then a 200 in the same process", async () => {
  const { searchPlacesPage } = require("../lib/lead-miner");
  let now = 0;
  const breaker = new CircuitBreaker({ threshold: 2, cooldownMs: 500, now: () => now });
  const down = async () => ({ status: 503, json: async () => ({}), text: async () => "" });

  const a = await searchPlacesPage({ key: "k", textQuery: "q", pageSize: 5, fetchImpl: down, breaker });
  assert.strictEqual(a.mode, "provider_unavailable");
  await searchPlacesPage({ key: "k", textQuery: "q", pageSize: 5, fetchImpl: down, breaker });
  assert.strictEqual(breaker.status().state, "open");

  // Breaker open -> named "down", provider untouched.
  let hit = 0;
  const blocked = await searchPlacesPage({
    key: "k", textQuery: "q", pageSize: 5, breaker,
    fetchImpl: async () => { hit += 1; return down(); },
  });
  assert.strictEqual(hit, 0);
  assert.strictEqual(blocked.mode, "provider_down");

  now += 501; // cooldown elapses
  const ok = await searchPlacesPage({
    key: "k", textQuery: "q", pageSize: 5, breaker,
    fetchImpl: async () => ({ status: 200, json: async () => ({ places: [{ id: "x", displayName: { text: "C" } }] }), text: async () => "" }),
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.places.length, 1, "miner did not resume after the provider recovered");
  assert.strictEqual(breaker.status().state, "closed");
});

test("no auto-mine: the module exposes no scheduler and mining stays caller-driven", () => {
  const miner = require("../lib/lead-miner");
  for (const forbidden of ["startAutoMine", "scheduleMining", "autoMine", "beginMining"]) {
    assert.strictEqual(typeof miner[forbidden], "undefined",
      `${forbidden} exists — a key appearing could self-trigger a mine run`);
  }
  // The 503 policy module must not schedule anything either.
  const health = require("../lib/discovery-health");
  assert.strictEqual(typeof health.startPolling, "undefined");
  assert.strictEqual(typeof health.autoRetryLoop, "undefined");
});
