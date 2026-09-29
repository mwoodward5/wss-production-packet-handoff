"use strict";

// test/discovery-blast-radius.test.js — ONE PLACES ERROR MUST NOT KILL A RUN.
//
// Reproduces the live funnel the owner watched on 2026-08-06. Kansas City,
// plumbing, production:
//
//     5_email             in 22 out  8
//     6_nap_verification  in  8 out  0   places_error=1, provider_down=7
//
// Nashville was identical in shape and every metro ended at zero, while the
// provider was healthy — searchText returned 5 results and place details
// returned reviews and photos on a direct call with the same production key.
//
// The same shape was recorded earlier in a five-metro run: San Antonio burned
// 3 real 403s, the breaker opened, and the remaining 35 candidates across ALL
// FIVE metros were never attempted and were reported as provider_down.
//
// THREE DEFECTS, all proven here with injected transports — nothing in this
// file touches the network:
//
//   1. BLAST RADIUS. callProvider() counted every non-ok result as a provider
//      failure, so per-request 4xx (a 404 "no match", a 400 on a query built
//      from a scraped page <title>, a 403 key restriction) opened a breaker
//      that means "the provider is down" and stopped every remaining lead.
//   2. AMNESIA. The refusal carried the mode alone — "places_error" — and
//      discarded the HTTP status and the provider's own message, which is why
//      this went undiagnosed across at least two multi-metro runs.
//   3. A DISHONEST LEDGER. cost.places_calls counted LEADS, so it billed
//      breaker-skipped candidates that dispatched no request at all.
//
// Plus the defect found while tracing them: intFromEnv() read an UNSET
// variable as the number 0, so the discovery deadline was 1000ms rather than
// 8000 and retries were 0 rather than 2.

const test = require("node:test");
const assert = require("node:assert");

const { CircuitBreaker, callProvider, providerFault, OUTAGE_MODES } = require("../lib/discovery-health");
const { verifyNapForCandidate, searchPlacesPage } = require("../lib/lead-miner");

const noSleep = async () => {};
const respond = (status, body = {}) => ({ status, json: async () => body, text: async () => "" });

// The exact 403 body Google returned for a referrer-restricted key, captured
// live from places.googleapis.com on 2026-08-06.
const REAL_403 = {
  error: {
    code: 403,
    message: "Requests from referer <empty> are blocked.",
    status: "PERMISSION_DENIED",
    details: [{
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      reason: "API_KEY_HTTP_REFERRER_BLOCKED",
      domain: "googleapis.com",
    }],
  },
};

// --- 1. BLAST RADIUS ---------------------------------------------------------

test("a per-lead 4xx never opens the provider breaker", async () => {
  for (const status of [400, 403, 404]) {
    const breaker = new CircuitBreaker({ threshold: 3 });
    for (let i = 0; i < 10; i += 1) {
      await callProvider({
        url: "u", fetchImpl: async () => respond(status, REAL_403),
        breaker, retries: 0, sleepImpl: noSleep,
      });
    }
    assert.strictEqual(breaker.status().state, "closed",
      `${status} opened the provider breaker — one bad lead can kill a whole run again`);
    assert.strictEqual(breaker.status().failures, 0);
  }
});

test("a 404 'no match for this business' is not a provider failure", async () => {
  const breaker = new CircuitBreaker({ threshold: 2 });
  const res = await callProvider({
    url: "u", fetchImpl: async () => respond(404, {}), breaker, retries: 0, sleepImpl: noSleep,
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.countedAgainstProvider, false);
  assert.strictEqual(breaker.status().state, "closed");
});

test("THE REGRESSION: 3 real 403s no longer strand the leads behind them", async () => {
  // Eight candidates reach stage 6, exactly like the Kansas City run. Every
  // one 403s. Before the fix the first three were attempted and the last five
  // came back provider_down without a single request being made.
  const breaker = new CircuitBreaker({ threshold: 3 });
  let dispatched = 0;
  const fetchImpl = async () => { dispatched += 1; return respond(403, REAL_403); };

  const modes = [];
  for (let i = 0; i < 8; i += 1) {
    const r = await verifyNapForCandidate({
      key: "k", name: `lead ${i}`, cityHint: "Kansas City, MO",
      siteDomain: `lead${i}.example`, fetchImpl, breaker,
    });
    modes.push(r.reason);
  }

  assert.strictEqual(modes.filter((m) => m === "provider_down").length, 0,
    "leads were still reported provider_down while the provider was answering");
  assert.strictEqual(dispatched, 8, "some candidates were never attempted");
  assert.strictEqual(breaker.status().state, "closed");
});

test("but a GENUINE outage still fails fast rather than hanging fifty times", async () => {
  const breaker = new CircuitBreaker({ threshold: 3 });
  let dispatched = 0;
  const fetchImpl = async () => { dispatched += 1; return respond(503, {}); };

  const reasons = [];
  for (let i = 0; i < 50; i += 1) {
    const r = await verifyNapForCandidate({
      key: "k", name: `lead ${i}`, cityHint: "KC", siteDomain: `l${i}.example`, fetchImpl, breaker,
    });
    reasons.push(r.reason);
  }
  assert.strictEqual(breaker.status().state, "open", "a real 503 storm no longer trips the breaker");
  // The ceiling is threshold (3 failures) x attempts per call (1 try + 2
  // bounded retries) = 9 requests, after which nothing else is dispatched.
  // The point is that it is a small constant and not a function of the 50
  // leads behind it.
  assert.strictEqual(dispatched, 9,
    `an open breaker still hammered a down provider ${dispatched} times`);
  assert.ok(reasons.filter((r) => r === "provider_down").length >= 45);
});

test("only provider-availability modes may open the breaker", () => {
  assert.deepStrictEqual([...OUTAGE_MODES].sort(), ["network", "quota", "timeout", "unavailable"]);
  assert.ok(!OUTAGE_MODES.has("error"), "the 4xx class is counted as an outage again");
});

// --- 2. A REFUSAL CARRIES ITS REASON ----------------------------------------

test("a stage-6 refusal carries the HTTP status and the provider's own words", async () => {
  const r = await verifyNapForCandidate({
    key: "k", name: "Carters My Plumber", cityHint: "Kansas City, MO",
    siteDomain: "cartersmyplumber.com",
    fetchImpl: async () => respond(403, REAL_403),
    breaker: new CircuitBreaker({ threshold: 3 }),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 403, "the HTTP status was thrown away again");
  assert.match(r.detail, /API_KEY_HTTP_REFERRER_BLOCKED/,
    "the refusal does not say what actually went wrong");
  assert.match(r.detail, /Requests from referer <empty> are blocked/);
  assert.strictEqual(r.providerAtFault, false);
});

test("providerFault extracts Google's structured error, and survives odd bodies", () => {
  assert.strictEqual(
    providerFault(REAL_403),
    "PERMISSION_DENIED/API_KEY_HTTP_REFERRER_BLOCKED: Requests from referer <empty> are blocked.",
  );
  // A body that is not the structured shape must not throw or invent text.
  assert.strictEqual(providerFault(null), null);
  assert.strictEqual(providerFault({ error: "upstream unavailable" }), null);
  assert.strictEqual(providerFault({}), null);
  assert.strictEqual(providerFault([1, 2]), null);
});

test("nap_not_found_for_domain says what was searched and what came back", async () => {
  const r = await verifyNapForCandidate({
    key: "k", name: "Ghost Plumbing", cityHint: "Nashville, TN", siteDomain: "ghostplumbing.com",
    fetchImpl: async () => respond(200, { places: [{ id: "p", websiteUri: "https://someone-else.com" }] }),
    breaker: new CircuitBreaker({ threshold: 3 }),
  });
  assert.strictEqual(r.reason, "nap_not_found_for_domain");
  assert.strictEqual(r.providerAtFault, false, "a clean 200 with no match was blamed on the provider");
  assert.match(r.detail, /ghostplumbing\.com/);
});

// --- 3. AN HONEST COST LEDGER ------------------------------------------------

test("a breaker-skipped lead costs nothing, because no request was made", async () => {
  const breaker = new CircuitBreaker({ threshold: 1 });
  breaker.recordFailure();
  assert.strictEqual(breaker.open, true);

  let dispatched = 0;
  const r = await verifyNapForCandidate({
    key: "k", name: "n", cityHint: "c", siteDomain: "d.example",
    fetchImpl: async () => { dispatched += 1; return respond(200, { places: [] }); },
    breaker,
  });
  assert.strictEqual(dispatched, 0);
  assert.strictEqual(r.reason, "provider_down");
  assert.strictEqual(r.httpCalls, 0, "the ledger billed a request that never left the machine");
});

test("a lead that falls through to the domain fallback query costs TWO calls", async () => {
  // The old ledger incremented once per LEAD, so this candidate — which really
  // does dispatch two requests — was billed as one.
  let dispatched = 0;
  const r = await verifyNapForCandidate({
    key: "k", name: "Tulsa's Best Fencing Since 1994", cityHint: "Tulsa, OK",
    siteDomain: "bestfence.com",
    fetchImpl: async () => { dispatched += 1; return respond(200, { places: [] }); },
    breaker: new CircuitBreaker({ threshold: 3 }),
  });
  assert.strictEqual(dispatched, 2, "the domain fallback query did not run");
  assert.strictEqual(r.httpCalls, 2, `ledger said ${r.httpCalls} for 2 real requests`);
});

test("searchPlacesPage reports the requests it actually dispatched, retries included", async () => {
  let dispatched = 0;
  const page = await searchPlacesPage({
    key: "k", textQuery: "q", pageSize: 5,
    fetchImpl: async () => { dispatched += 1; return respond(503, {}); },
    breaker: new CircuitBreaker({ threshold: 99 }),
  });
  assert.strictEqual(page.ok, false);
  assert.strictEqual(page.httpCalls, dispatched);
});

// --- 4. RUN SCOPING ----------------------------------------------------------

test("a fresh run does not inherit a previous run's failure tally", () => {
  // THE KANSAS CITY ARITHMETIC. failures was only ever reset by a success, so
  // a run could start at 2 and be killed by its own first error — which is the
  // only way {places_error: 1, provider_down: 7} can happen at threshold 3.
  const breaker = new CircuitBreaker({ threshold: 3 });
  breaker.recordFailure();
  breaker.recordFailure();
  assert.strictEqual(breaker.status().failures, 2, "precondition: two failures carried in");

  breaker.beginRun();
  assert.strictEqual(breaker.status().failures, 0, "the new run inherited a grudge");

  assert.strictEqual(breaker.recordFailure(), false,
    "one error in a fresh run still opened the breaker");
  assert.strictEqual(breaker.status().state, "half-open");
});

test("beginRun leaves an OPEN breaker open, so a real outage still fails fast", () => {
  let now = 0;
  const breaker = new CircuitBreaker({ threshold: 2, cooldownMs: 60000, now: () => now });
  breaker.recordFailure();
  breaker.recordFailure();
  assert.strictEqual(breaker.status().state, "open");

  breaker.beginRun();
  assert.strictEqual(breaker.status().state, "open",
    "a new run cleared a live outage and will now hang against a down provider");

  now += 60001; // cooldown elapses -> the next run may probe again
  assert.strictEqual(breaker.beginRun().state, "closed");
});

// --- 5. THE DEFAULTS THAT NEVER APPLIED --------------------------------------

test("an UNSET discovery env var falls back to its default, not to zero", async () => {
  // Number("") is 0 and 0 is finite, so the old blank-check let an unset
  // variable through as a literal 0: a 1000ms deadline instead of 8000, and
  // zero retries instead of two. A provider merely slow — not down — then
  // aborted as `timeout`, which IS an outage mode, with no retry to absorb it.
  let dispatched = 0;
  await callProvider({
    url: "u",
    fetchImpl: async () => { dispatched += 1; return respond(503, {}); },
    sleepImpl: noSleep,
    env: {},                       // nothing set, exactly like production
    breaker: new CircuitBreaker({ threshold: 99 }),
  });
  assert.strictEqual(dispatched, 3, `retries default did not apply: ${dispatched} attempt(s), expected 1 + 2`);
});

test("an explicitly configured zero is still honoured", async () => {
  let dispatched = 0;
  await callProvider({
    url: "u",
    fetchImpl: async () => { dispatched += 1; return respond(503, {}); },
    sleepImpl: noSleep,
    env: { GHOST_AGENCY_DISCOVERY_RETRIES: "0" },
    breaker: new CircuitBreaker({ threshold: 99 }),
  });
  assert.strictEqual(dispatched, 1, "an operator's explicit 0 was overridden by the default");
});
