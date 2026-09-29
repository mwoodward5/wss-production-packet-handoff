"use strict";

// lib/preview-liveness.js — IS THE PREVIEW ACTUALLY SERVING?
//
// WHY THIS FILE EXISTS.
//
// Steps 2 and 3 of the cold sequence are follow-ups whose entire proposition is
// a claim about the present tense: the site "is ready to review", the preview
// was "kept available". Step 1 earns that claim — it is gated on a build having
// happened, on the shots existing, on the host being ours and on the URL being
// bound to this prospect. But those gates all run against a DATABASE ROW, and
// the row is written once, at build time. A follow-up goes out FIVE DAYS after
// step 1, and the last one FOURTEEN. Nothing in between re-checked that the
// host still answers.
//
// It has not been a theoretical gap. These previews live on per-prospect Vercel
// projects, and on 2026-07-29 a purge deleted 240 of them in one pass. Every
// prospect whose project went with it kept a row saying `preview_url:
// https://<slug>.wss-ai.com/`, kept passing the host guard (it is our domain),
// kept passing the identity binding (the slug is still theirs) — and would have
// been mailed "the preview is ready to review" pointing at a 404.
//
// An email that makes a false present-tense claim about the recipient's OWN
// business is the most expensive thing this pipeline can send. So the follow-up
// path asks the one question the row cannot answer: does it serve right now.
//
// WHAT THIS IS NOT. It is not a quality check, a render gate, or a content
// audit. It answers exactly "did this URL return 200", nothing more, and it is
// deliberately incapable of answering anything else — a body is never read, so
// nothing about the page can leak into a decision here.

const { isApprovedPreviewUrl } = require("./preview-host-guard");

/**
 * THE TIMEOUT, AND WHY IT IS 4000ms.
 *
 * A live mirror is static HTML on Vercel's edge; a warm read is tens of
 * milliseconds and a cold alias resolution is well under a second. The number
 * that matters is not the typical read, it is the BATCH CEILING: the drip cron
 * is capped at 20 prospects (GHOST_AGENCY_DRIP_BATCH, hard-clamped to 100 in
 * api/cron/drip-scheduler.js) and every prospect has a DIFFERENT host, so the
 * cache below cannot amortise them. 20 x 4s = 80s of worst-case probing inside
 * a function whose maxDuration is 300s (vercel.json). That fits with room to
 * spare, and the pathological case — every host in the batch hanging — is
 * exactly the case where sending is wrong anyway.
 *
 * A dead host does not usually cost the ceiling: a deleted Vercel project
 * answers 404 immediately, and a hostname with no DNS fails in milliseconds.
 * The 4s budget is spent only by a host that accepts a connection and then
 * stalls, which is itself a reason not to send.
 *
 * THERE IS NO RETRY, on purpose. A retry would double the ceiling to buy a
 * second opinion about a host that just failed, and the safe answer is already
 * available for free: do not send this follow-up today. The drip scheduler will
 * offer the same prospect again on its next pass.
 */
const DEFAULT_TIMEOUT_MS = 4000;
const MAX_TIMEOUT_MS = 10000;

/**
 * CACHE TTL. Two prospects can legitimately share a host (a rebuilt mirror
 * keeps its slug), and a single run can compose the same prospect twice. Ten
 * minutes is long enough to cover any one batch and short enough that a warm
 * lambda re-probes a host that has since come back.
 *
 * CACHE HITS INCLUDE FAILURES, deliberately. A host that 404s once will 404 for
 * every other compose in the same batch; re-asking spends the timeout budget
 * again for the same nothing. This is the "do not hammer one host" rule in both
 * directions — a live host is asked once, and a dead one is asked once.
 */
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 256;

const MODULE_CACHE = new Map();

function boundedTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.round(parsed), MAX_TIMEOUT_MS);
}

/**
 * THE URL WE ARE WILLING TO REQUEST.
 *
 * This module turns a stored database field into an outbound HTTP request, which
 * is the shape of every SSRF that ever shipped. lib/email.js already refuses a
 * preview on an unapproved host before it gets here, but a guard that depends on
 * its caller having run another guard is not a guard. So the allowlist is
 * re-applied at the point of the request, from the same single source of truth
 * (lib/preview-host-guard.js): https only, wss-ai.com only, no credentials in
 * the URL, nothing else is ever fetched.
 */
function probeTarget(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:") return "";
  if (url.username || url.password) return "";
  if (!isApprovedPreviewUrl(url.toString())) return "";
  return url.toString();
}

/**
 * checkPreviewLive({...}) -> { ok, status, reason, cached, url }
 *
 * NEVER THROWS, NEVER REJECTS, AND FAILS CLOSED. `ok` is true for exactly one
 * outcome — the host answered 200. Every other outcome, including every kind of
 * network failure, is `ok: false` with a reason, because "we could not tell" and
 * "it is down" have the same correct consequence: do not claim it is up.
 *
 * That is the opposite of lib/report-grade.js, whose unreachable case drops a
 * decorative grade and sends anyway. The difference is what the email says
 * without the answer: an email with no grade card is still true, and an email
 * saying "your preview is ready to review" about a host we could not reach may
 * not be.
 *
 * WHY GET AND NOT HEAD. The claim is about what the recipient will see when
 * they click, and what they issue is a GET. Static hosts and edge middleware
 * are also free to answer HEAD with a 405 they would never give a GET, which
 * would fail a perfectly live preview. The response BODY IS NEVER READ — the
 * status line is the whole answer, and the stream is cancelled immediately so a
 * multi-megabyte page is not pulled into a lambda for nothing.
 *
 * Redirects are followed (fetch's default): a mirror that 301s to its canonical
 * form is live, and the status that matters is the one at the end of the chain.
 *
 * @param {string}   url       the preview URL the email will link.
 * @param {function} fetch     injectable; defaults to the ambient fetch READ AT
 *                             CALL TIME so a test can stub globalThis.fetch.
 * @param {Map}      cache     injectable; defaults to the module-level cache.
 */
async function checkPreviewLive({
  url = "",
  fetch: fetchImpl = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cache = MODULE_CACHE,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now,
} = {}) {
  const target = probeTarget(url);
  const fail = (reason, status = 0, cached = false) => ({
    ok: false, status, reason, cached, url: target,
  });

  if (!target) return fail("no_probeable_preview_url");

  const nowMs = Number(typeof now === "function" ? now() : now);
  const clock = Number.isFinite(nowMs) ? nowMs : Date.now();
  const store = cache instanceof Map ? cache : null;
  const ttl = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_TTL_MS;

  if (store && store.has(target)) {
    const entry = store.get(target);
    if (entry && clock - entry.at < ttl) {
      return { ...entry.result, cached: true };
    }
    store.delete(target);
  }

  const remember = (result) => {
    if (store) {
      if (store.size >= MAX_CACHE_ENTRIES) {
        const oldest = store.keys().next();
        if (!oldest.done) store.delete(oldest.value);
      }
      store.set(target, { at: clock, result: { ...result, cached: false } });
    }
    return result;
  };

  const doFetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
  if (typeof doFetch !== "function") return fail("fetch_unavailable");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
  try {
    let response;
    try {
      // RACE THE SIGNAL, DO NOT MERELY PASS IT. Aborting is a request to the
      // transport; a transport that ignores it leaves this await pending and the
      // documented ceiling becomes someone else's promise. Same reasoning, same
      // shape as lib/report-grade.js.
      response = await Promise.race([
        doFetch(target, {
          method: "GET",
          redirect: "follow",
          headers: { Accept: "text/html,*/*" },
          signal: controller.signal,
        }),
        new Promise((_, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true },
          );
        }),
      ]);
    } catch {
      return remember(fail(controller.signal.aborted ? "timeout" : "fetch_failed"));
    }

    // Drop the body without reading it. A preview page is real HTML and this
    // function has no use for a single byte of it.
    try {
      if (response && response.body && typeof response.body.cancel === "function") {
        response.body.cancel().catch(() => {});
      }
    } catch {
      /* a stub response with no body stream is fine */
    }

    if (!response || typeof response.status !== "number") return remember(fail("invalid_response"));
    if (response.status !== 200) return remember(fail(`http_${response.status}`, response.status));
    return remember({ ok: true, status: 200, reason: "", cached: false, url: target });
  } catch {
    // Belt and braces. A throw out of this function would take a send down over
    // a probe; the fail-closed answer is a refusal, not an exception.
    return fail("unexpected_error");
  } finally {
    clearTimeout(timer);
  }
}

/** Test seam, and an operational reset. */
function clearPreviewLivenessCache(cache = MODULE_CACHE) {
  if (cache instanceof Map) cache.clear();
}

module.exports = {
  checkPreviewLive,
  clearPreviewLivenessCache,
  probeTarget,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TTL_MS,
  MAX_CACHE_ENTRIES,
};
