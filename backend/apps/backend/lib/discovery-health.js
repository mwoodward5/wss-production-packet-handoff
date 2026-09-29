"use strict";

// lib/discovery-health.js — HONEST FAILURE FOR THE DISCOVERY PROVIDER.
//
// Owner, 2026-07-30, from the live Command Center: mine.run returned
// "Error: timeout" on EVERY variant (batch 5 and batch 1, roofing and plumbing,
// Fort Worth and Dallas) while the heartbeat passed and the status pill showed
// "CAN'T REACH SERVER (SERVER 503) — RETRYING…". Parsing was perfect every
// time. So the miner logic was never the problem: an upstream 503 in the
// discovery lane was being reported as a generic timeout.
//
// THE DEFECT. lib/lead-miner.js searchPlacesPage() called fetch() with NO
// AbortSignal. A provider that accepts the connection and never answers leaves
// that promise pending forever, so the only thing that ever fires is the
// caller's own outer timer — and the operator is told "timeout" when the truth
// is "the discovery provider is returning 503". A timeout masquerading as a
// generic failure is exactly the reality-misreporting defect this engine
// exists to end. (GHOST_AGENCY_MINER_FETCH_TIMEOUT_MS already existed but
// guards the WEBSITE PROBE fetch, not discovery.)
//
// This module adds, with no live network in the tests:
//   · a hard request deadline, so a hang becomes a named error fast
//   · classification, so 503/502/504/network are "provider unavailable" and
//     are never confused with a quota error or a bad query
//   · bounded retry with backoff for transient states only
//   · a circuit breaker, so a sustained outage surfaces on the miner card as
//     "provider down — retrying" instead of a stale "mine.run failed"
//
// It deliberately does NOT try to repair the provider, rotate a key, or invent
// a fallback. A down provider is a human/infra action; the engine's job is to
// say so precisely.

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 2;          // 3 attempts total
const DEFAULT_BREAKER_THRESHOLD = 3;
const DEFAULT_BREAKER_COOLDOWN_MS = 60000;

function intFromEnv(name, fallback, min, max, env = process.env) {
  // AN UNSET VARIABLE IS NOT THE NUMBER ZERO.
  //
  // Found 2026-08-06 while tracing why one Places error killed whole runs.
  // The blank check used to be `Number.isFinite(Number(""))` — and Number("")
  // is 0, which IS finite. So an unset variable read as a literal 0 and the
  // stated defaults on lines below NEVER applied in production:
  //   GHOST_AGENCY_DISCOVERY_TIMEOUT_MS -> 0, clamped up to the 1000ms floor,
  //     giving a ONE-SECOND deadline where 8000 was intended;
  //   GHOST_AGENCY_DISCOVERY_RETRIES    -> 0, so the "bounded retry with
  //     backoff for transient states" this module was written to add has
  //     never actually run.
  // Together those manufacture the exact failure being chased: a Places call
  // slower than one second aborts as `timeout`, timeout is a genuine outage
  // mode, and with zero retries there is nothing to absorb it before it
  // counts against the breaker.
  const raw = String(env[name] ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * What a provider response MEANS. The distinction that matters operationally:
 * "unavailable" is the provider's fault and is retryable; "quota" is our
 * account and is NOT retryable by hammering; "error" is the request.
 */
function classifyStatus(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 429) return "quota";
  if (status === 408 || status === 425 || status === 502 || status === 503 || status === 504) return "unavailable";
  if (status >= 500) return "unavailable";
  return "error";
}

const RETRYABLE = new Set(["unavailable", "network", "timeout"]);

// WHICH FAILURES ARE EVIDENCE THAT *THE PROVIDER* IS DOWN.
//
// Added 2026-08-06 after a live Kansas City run ended 6_nap_verification
// "in 8 out 0 {places_error:1, provider_down:7}" while the provider was
// demonstrably healthy. Reproduced against real Places with a referrer-
// restricted key: three 403s in a row opened this breaker and the next five
// leads were never attempted. The same shape was recorded earlier in a
// five-metro run — San Antonio burned 3 real 403s and the remaining 35
// candidates across ALL FIVE metros were reported as provider_down.
//
// The defect was that callProvider() counted EVERY non-ok result as a provider
// failure. A 4xx is the opposite of an outage: the provider answered, promptly
// and correctly, about ONE request. A 404 "no match for this business", a 400
// on a malformed query built from a scraped page <title>, and a 403 on a key
// restriction are all facts about a single lead or about our own configuration
// — never grounds for refusing to attempt the other forty-nine.
//
// So only these modes may open the breaker. `quota` is included deliberately:
// a 429 is account-wide, every subsequent lead will also 429, and continuing
// to call actively burns the remaining allowance. Everything in the "error"
// class is excluded, and excluded cheaply — "error" is not in RETRYABLE, so a
// 4xx returns after ONE attempt with no backoff. Nothing can hang on it; the
// worst case is N fast, honest, individually-named per-lead refusals, which is
// exactly the diagnosis this funnel was failing to produce.
const OUTAGE_MODES = new Set(["unavailable", "timeout", "network", "quota"]);

/**
 * The provider's OWN words for a failure, e.g.
 *   "PERMISSION_DENIED/API_KEY_HTTP_REFERRER_BLOCKED: Requests from referer <empty> are blocked."
 *
 * describe() names the CLASS of failure ("discovery provider error — 403"),
 * which is what the miner card renders, and its exact strings are asserted by
 * tests. This is the other half: the specific, actionable sentence. It is
 * returned alongside rather than folded in, so a refusal can carry the reason
 * without changing what the card says.
 */
function providerFault(json) {
  const err = json && typeof json === "object" ? (json.error && typeof json.error === "object" ? json.error : json) : null;
  if (!err || typeof err !== "object") return null;
  const message = typeof err.message === "string" ? err.message.trim() : "";
  const gStatus = typeof err.status === "string" ? err.status.trim() : "";
  const details = Array.isArray(err.details) ? err.details : [];
  const reason = details.map((d) => (d && typeof d.reason === "string" ? d.reason.trim() : "")).find(Boolean) || "";
  const head = [gStatus, reason].filter(Boolean).join("/");
  const text = [head, message].filter(Boolean).join(": ");
  return text ? text.slice(0, 300) : null;
}

/** A named, operator-readable sentence. Never "timeout" on its own. */
function describe(mode, status) {
  switch (mode) {
    case "unavailable": return `discovery provider unavailable — ${status || "5xx"}`;
    case "timeout": return "discovery provider unavailable — no response before deadline";
    case "network": return "discovery provider unreachable — connection failed";
    case "quota": return `discovery provider quota exceeded — ${status || 429}`;
    case "breaker_open": return "discovery provider down — retrying";
    case "no_key": return "discovery provider not configured — GOOGLE_PLACES_API_KEY is unset";
    default: return `discovery provider error — ${status || "unknown"}`;
  }
}

/**
 * Consecutive-failure circuit breaker. Deliberately tiny and synchronous: the
 * miner card needs a STATE it can render, not a metrics pipeline.
 */
class CircuitBreaker {
  constructor({ threshold = DEFAULT_BREAKER_THRESHOLD, cooldownMs = DEFAULT_BREAKER_COOLDOWN_MS, now = () => Date.now() } = {}) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.failures = 0;
    this.openedAt = null;
  }

  get open() {
    if (this.openedAt === null) return false;
    if (this.now() - this.openedAt >= this.cooldownMs) return false; // half-open: allow a probe
    return true;
  }

  recordSuccess() { this.failures = 0; this.openedAt = null; }

  recordFailure() {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = this.now();
    return this.open;
  }

  /**
   * Start of a mine run. Clears the CONSECUTIVE-failure tally when the breaker
   * is not currently open, and leaves an open breaker completely alone.
   *
   * Why this exists. `failures` is a count of consecutive failures, but it was
   * only ever reset by a SUCCESS. Once a run had tripped the breaker, the tally
   * stayed at or above the threshold for the life of the process, so the very
   * next failure — in a different run, in a different metro, minutes later —
   * re-opened it instantly. That is the arithmetic behind the Kansas City
   * funnel: {places_error: 1, provider_down: 7}. One error cannot reach a
   * threshold of three from a standing start; it reached it because the tally
   * was already at two, carried in from an earlier run.
   *
   * The fix is scoping, not deletion. An OPEN breaker still outlives the run —
   * three console clicks during a real 503 storm must still fail fast, which
   * was the whole reason this is module-level — but a fresh run gets a fresh
   * assessment instead of inheriting a grudge.
   */
  beginRun() {
    if (this.open) return this.status();
    this.failures = 0;
    this.openedAt = null;
    return this.status();
  }

  /** What the miner card renders. */
  status() {
    if (this.open) return { state: "open", label: describe("breaker_open"), failures: this.failures, retryInMs: Math.max(0, this.cooldownMs - (this.now() - this.openedAt)) };
    if (this.failures > 0) return { state: "half-open", label: describe("breaker_open"), failures: this.failures };
    return { state: "closed", label: "provider healthy", failures: 0 };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One provider call, with deadline + bounded retry + breaker.
 *
 * `fetchImpl` is injected so tests NEVER touch the live provider.
 * Returns { ok, mode, status, json, attempts, error } — never throws for a
 * provider condition, so callers cannot accidentally turn a 503 into a stack.
 */
async function callProvider({
  url,
  init = {},
  fetchImpl = globalThis.fetch,
  timeoutMs,
  retries,
  breaker = null,
  env = process.env,
  sleepImpl = sleep,
} = {}) {
  const deadline = timeoutMs ?? intFromEnv("GHOST_AGENCY_DISCOVERY_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1000, 30000, env);
  const maxRetries = retries ?? intFromEnv("GHOST_AGENCY_DISCOVERY_RETRIES", DEFAULT_RETRIES, 0, 5, env);

  // PREFLIGHT. A breaker that is open must fail immediately: hammering a
  // provider that just 503'd three times in a row wastes the operator's time
  // and the provider's recovery.
  if (breaker && breaker.open) {
    // attempts: 0 is load-bearing — the cost ledger reads it to avoid billing
    // the operator for HTTP requests that were never dispatched.
    return {
      ok: false, mode: "breaker_open", status: null, error: describe("breaker_open"),
      fault: null, attempts: 0, countedAgainstProvider: false, breaker: breaker.status(),
    };
  }

  let attempts = 0;
  let last = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    attempts += 1;
    let response = null;
    let mode = null;
    let status = null;
    const deadlineController = new AbortController();
    const upstreamSignal = init.signal;
    const forwardAbort = () => deadlineController.abort(upstreamSignal.reason);
    if (upstreamSignal) {
      if (upstreamSignal.aborted) forwardAbort();
      else upstreamSignal.addEventListener("abort", forwardAbort, { once: true });
    }
    const deadlineTimer = setTimeout(() => deadlineController.abort(), deadline);
    try {
      response = await fetchImpl(url, { ...init, signal: deadlineController.signal });
      status = response.status;
      mode = classifyStatus(status);
    } catch (e) {
      const name = String((e && e.name) || "");
      mode = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
    } finally {
      clearTimeout(deadlineTimer);
      if (upstreamSignal) upstreamSignal.removeEventListener("abort", forwardAbort);
    }

    if (mode === "ok") {
      const json = await response.json().catch(async () => ({ error: await response.text().catch(() => "") }));
      if (breaker) breaker.recordSuccess();
      return { ok: true, mode: "ok", status, json, attempts, breaker: breaker ? breaker.status() : null };
    }

    const json = response ? await response.json().catch(() => null) : null;
    last = { ok: false, mode, status, json, error: describe(mode, status), fault: providerFault(json), attempts };

    if (!RETRYABLE.has(mode) || attempt === maxRetries) break;
    // Exponential backoff with a small floor; bounded by construction.
    await sleepImpl(Math.min(2000, 250 * 2 ** attempt));
  }

  // ONLY an outage may open the breaker. A 4xx means the provider answered
  // about ONE request; it is attributed to that lead and the run continues.
  // Note it does not call recordSuccess() either: a 403 proves the endpoint is
  // reachable, but that is orthogonal evidence and must not silently reset a
  // genuine outage tally that a real 503 storm is accumulating.
  const countedAgainstProvider = OUTAGE_MODES.has(last.mode);
  if (breaker && countedAgainstProvider) breaker.recordFailure();
  return { ...last, attempts, countedAgainstProvider, breaker: breaker ? breaker.status() : null };
}

module.exports = {
  CircuitBreaker,
  callProvider,
  classifyStatus,
  describe,
  providerFault,
  OUTAGE_MODES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RETRIES,
  DEFAULT_BREAKER_THRESHOLD,
};
