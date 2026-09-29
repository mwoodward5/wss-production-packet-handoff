"use strict";

// test/line-proof-shots-after-recovery.test.js — THE no_after_shot FORENSICS.
//
// Two live smoke batches (2026-09-02) lost EVERY after shot to one undiagnosable
// label: the row said "capture_incomplete:no_after_shot" while the guard that
// actually fired sat in capture.results and was thrown away. Worse, one of the
// firing guards was itself manufactured: a thrown goto loses the main-document
// response object, and the shared-identity check refused the shot for the
// MISSING RESPONSE — deterministically, on every retry — even when the page had
// committed and painted.
//
// These tests pin the recovery and the naming:
//   1. a lost response is re-proven by the bounded server-side refetch (via:
//      "refetch"), and the provenance travels to the result and the sidecar;
//   2. a refetched identity that MISMATCHES is still refused, by name;
//   3. an unreachable refetch is still refused, by name;
//   4. a navigation that never committed gets the same second attempt the
//      "before" shot has always had;
//   5. a flaky shutter is retried once, and a real shutter failure is NAMED
//      (capture_failed: screenshot_failed: ...) instead of a bare throw;
//   6. the top-level reason carries the failing variant's cause
//      (no_after_shot:new=<named guard>) while still matching /no_after_shot/,
//      so every existing reader keeps working and the next run is diagnosable.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ensureLineProofShots,
  mainDocumentResponseIdentity,
} = require("../lib/line-proof-shots");
const { proofMetaPath } = require("../lib/proof-storage");

const MIRROR = "https://wss-test-after-recovery.wss-ai.com/";
const THEIR_SITE = "https://plumbing.example/";
const SHARED = Object.freeze({
  site_id: "site_01afterfix",
  release_id: "release_000001",
  build_hash: "a".repeat(64),
});

// ---------------------------------------------------------------------------
// A fake bucket (same shape as the video-hero suite's) with an OPTIONAL
// behavior for a server-side GET of the mirror itself — the refetch path.
// ---------------------------------------------------------------------------
function fakeBucket({ onMirrorFetch } = {}) {
  const objects = new Map();
  const calls = { mirrorFetches: 0 };
  const realFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if ((options.method || "GET").toUpperCase() === "POST") {
      const key = target.split("/object/")[1] || target;
      objects.set(key, Buffer.from(options.body));
      return { ok: true, status: 200, text: async () => "", headers: new Map() };
    }
    if (target.includes("/public/wss-proof-assets/")) {
      return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    // Anything else is a mirror/refetch GET.
    calls.mirrorFetches += 1;
    if (onMirrorFetch) return onMirrorFetch(target, options);
    throw new Error(`unexpected fetch: ${target}`);
  };
  return { objects, calls, restore() { global.fetch = realFetch; } };
}

function identityHeaders(buildHash = SHARED.build_hash) {
  return new Map([
    ["x-wss-site-id", SHARED.site_id],
    ["x-wss-release-id", SHARED.release_id],
    ["x-wss-build-hash", buildHash],
  ]);
}

// ---------------------------------------------------------------------------
// A role-aware browser fake: "before" pages settle normally; MIRROR pages
// reproduce the live mechanics under test — a goto that throws (after commit,
// which loses the response object, or before commit, which is re-navigable),
// and a shutter that can fail.
// ---------------------------------------------------------------------------
function mixedBrowser({
  mirrorGotoThrows = true,
  mirrorCommits = true,
  mirrorGotoThrowsTwice = false,
  mirrorShotFailures = 0,
} = {}) {
  const state = { pages: [], mirrorScreenshotAttempts: [] };
  const makePage = () => {
    const page = {
      role: null,
      gotos: [],
      waits: [],
      shotsAttempted: 0,
      shots: [],
      current: "about:blank",
      routeHandler: null,
      emulateMediaCalls: [],
      async route(_pattern, handler) { this.routeHandler = handler; },
      async emulateMedia(options) { this.emulateMediaCalls.push(options); },
      async goto(url, options = {}) {
        if (!this.role) this.role = /wss-ai\.com/.test(url) ? "mirror" : "before";
        this.gotos.push({ url, waitUntil: String(options.waitUntil || "") });
        const attempt = this.gotos.length;
        const throws = mirrorGotoThrows
          && (attempt === 1 || (attempt === 2 && mirrorGotoThrowsTwice));
        if (throws && this.role === "mirror") {
          if (mirrorCommits) this.current = url; // document committed; the WAIT threw
          throw new Error(`Timeout ${options.timeout}ms exceeded waiting for domcontentloaded`);
        }
        this.current = url;
        return { status: () => 200 };
      },
      async waitForFunction() {},
      async evaluate() {},
      async waitForTimeout(ms) { this.waits.push(ms); },
      async screenshot() {
        if (this.role === "mirror") {
          state.mirrorScreenshotAttempts.push(`${this.current}#${this.shotsAttempted + 1}`);
          this.shotsAttempted += 1;
          if (this.shotsAttempted <= mirrorShotFailures) {
            throw new Error("page.screenshot: Unable to capture screenshot");
          }
        }
        const buffer = Buffer.from(`jpeg-bytes-for-${this.role}-${this.current}-${this.shots.length}`);
        this.shots.push(buffer);
        return buffer;
      },
      async close() {},
      url() { return this.current; },
    };
    return page;
  };
  return {
    state,
    async newPage() { const page = makePage(); state.pages.push(page); return page; },
    async close() {},
  };
}

function mirrorPage(browser) { return browser.state.pages.find((page) => page.role === "mirror"); }

// A mirror GET that answers with the shared identity headers (the refetch).
const refetchAnswers = (buildHash) => () => ({
  ok: true,
  status: 200,
  headers: identityHeaders(buildHash),
});

// ---------------------------------------------------------------------------
// 1. THE REFETCH RESCUE — a lost response no longer manufactures a refusal.
// ---------------------------------------------------------------------------

test("a committed page whose goto threw is identity-proven by the server-side refetch", async () => {
  const bucket = fakeBucket({ onMirrorFetch: refetchAnswers(SHARED.build_hash) });
  const browser = mixedBrowser({ mirrorCommits: true });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: SHARED.build_hash,
      proofIdentity: SHARED,
      browser,
    });

    assert.equal(out.ok, true, JSON.stringify({ reason: out.reason, results: out.results }));
    const after = out.results.find((r) => r.variant === "new");
    assert.equal(after.ok, true);
    assert.equal(after.response_identity_via, "refetch", "the report names the identity provenance");
    assert.equal(after.capture_wait_degraded, "navigation_timeout", "the lost response is named, not silent");
    assert.equal(bucket.calls.mirrorFetches, 2, "one bounded refetch per lost-response variant");
  } finally {
    bucket.restore();
  }
});

test("the refetched identity and its provenance are stored in the sidecar", async () => {
  const bucket = fakeBucket({ onMirrorFetch: refetchAnswers(SHARED.build_hash) });
  const browser = mixedBrowser({ mirrorCommits: true });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: SHARED.build_hash,
      proofIdentity: SHARED,
      browser,
    });
    assert.equal(out.ok, true, out.reason);
    const metaKeys = [...bucket.objects.keys()].filter((k) => k.endsWith(".json"));
    assert.ok(metaKeys.length >= 1, "sidecars written");
    const sharedMetas = metaKeys
      .map((k) => JSON.parse(bucket.objects.get(k).toString("utf8")))
      .filter((m) => m.schema === "wss-proof-shot-meta-v3");
    assert.ok(sharedMetas.length >= 1, "v3 sidecars written for the shared new variants");
    for (const meta of sharedMetas) {
      assert.equal(meta.response_identity_via, "refetch");
      assert.equal(meta.build_hash, SHARED.build_hash);
    }
    // And the sidecar keys are the proofIdentity-derived meta paths.
    const wanted = proofMetaPath({ url: MIRROR, variant: "new", proofIdentity: SHARED });
    assert.ok(metaKeys.some((k) => k.endsWith(wanted.replace(/^.*\/(new\/)/, "$1"))), wanted);
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 2. THE CONTRACT DOES NOT WEAKEN — a bad or unreachable refetch refuses.
// ---------------------------------------------------------------------------

test("a refetched identity that MISMATCHES the shared tuple is still refused, by name", async () => {
  const bucket = fakeBucket({ onMirrorFetch: refetchAnswers("b".repeat(64)) });
  const browser = mixedBrowser({ mirrorCommits: true });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: SHARED.build_hash,
      proofIdentity: SHARED,
      browser,
    });
    assert.equal(out.ok, false);
    assert.match(out.reason, /no_after_shot/);
    assert.match(out.reason, /new=capture_identity_response_build_hash_mismatch/,
      "the top-level reason names the failing guard");
    const after = out.results.find((r) => r.variant === "new");
    assert.equal(after.reason, "capture_identity_response_build_hash_mismatch");
    const stored = [...bucket.objects.keys()].filter((k) => /\.jpg$/.test(k) && /\/new\//.test(k));
    assert.equal(stored.length, 0, "a mismatched release is never stored");
  } finally {
    bucket.restore();
  }
});

test("an unreachable refetch is refused as response_identity_missing, named at the top level", async () => {
  const bucket = fakeBucket({
    onMirrorFetch: () => { throw new Error("connection reset"); },
  });
  const browser = mixedBrowser({ mirrorCommits: true });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: SHARED.build_hash,
      proofIdentity: SHARED,
      browser,
    });
    assert.equal(out.ok, false);
    assert.match(out.reason, /new=capture_identity_response_identity_missing/);
    const after = out.results.find((r) => r.variant === "new");
    assert.equal(after.reason, "capture_identity_response_identity_missing");
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. THE SECOND ATTEMPT — a navigation that never committed is re-navigated.
// ---------------------------------------------------------------------------

test("a mirror navigation that never commits gets the same second attempt the before shot has", async () => {
  const bucket = fakeBucket();
  const browser = mixedBrowser({ mirrorCommits: false });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-second-attempt",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify({ reason: out.reason, results: out.results }));
    assert.equal(mirrorPage(browser).gotos.length, 2, "exactly one retry after the thrown first attempt");
    const after = out.results.find((r) => r.variant === "new");
    assert.match(String(after.capture_wait_degraded || ""), /navigation_threw/,
      "the first attempt's failure is named in the report");
    // Legacy mode never reads response identity — assert no mirror GET at all.
    assert.equal(bucket.calls.mirrorFetches, 0);
  } finally {
    bucket.restore();
  }
});

test("a page that fails to navigate twice is shot at about:blank and refused on identity, by name", async () => {
  const bucket = fakeBucket();
  const browser = mixedBrowser({ mirrorCommits: false, mirrorGotoThrowsTwice: true });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-nowhere",
      browser,
    });
    assert.equal(out.ok, false);
    // The degraded shot to nowhere is STILL refused — recovery never overrides
    // the fail-closed identity checks — and the refusal is named end to end.
    assert.match(out.reason, /new=capture_identity_preview_host_not_approved/);
    assert.equal(mirrorPage(browser).gotos.length, 2);
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 4. THE SHUTTER IS NAMED — one retry, then a named failure, never a bare throw.
// ---------------------------------------------------------------------------

test("a flaky screenshot is retried once on the same page and the shot completes", async () => {
  const bucket = fakeBucket();
  const browser = mixedBrowser({ mirrorShotFailures: 1 });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-shutter-retry",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify({ reason: out.reason, results: out.results }));
    const newPageAttempts = browser.state.pages
      .filter((page) => page.role === "mirror")
      .map((page) => page.shotsAttempted);
    assert.deepEqual(newPageAttempts, [2, 2], "exactly one same-page retry per mirror variant");
  } finally {
    bucket.restore();
  }
});

test("a screenshot that fails twice is a named capture_failed, not a bare error", async () => {
  const bucket = fakeBucket();
  const browser = mixedBrowser({ mirrorShotFailures: 99 });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-shutter-dead",
      browser,
    });
    assert.equal(out.ok, false);
    assert.match(out.reason, /new=capture_failed:\s*screenshot_failed:/);
    const after = out.results.find((r) => r.variant === "new");
    assert.match(after.reason, /^capture_failed:\s*screenshot_failed:/);
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 5. THE HAPPY PATH IS PROVENANCED — a real response object needs no refetch.
// ---------------------------------------------------------------------------

test("a healthy main-document response records provenance and performs no mirror GET", async () => {
  const bucket = fakeBucket();
  try {
    // A mirror whose navigation SETTLES and returns the header-bearing
    // response: identity comes off the document itself, no refetch, no doubt.
    const healthy = mixedBrowser({ mirrorGotoThrows: false });
    const originalNewPage = healthy.newPage.bind(healthy);
    healthy.newPage = async () => {
      const page = await originalNewPage();
      const goto = page.goto.bind(page);
      page.goto = async (url, options) => {
        const response = await goto(url, options);
        if (page.role === "mirror") {
          return {
            status: () => 200,
            allHeaders: async () => Object.fromEntries(identityHeaders(SHARED.build_hash)),
          };
        }
        return response;
      };
      return page;
    };
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: SHARED.build_hash,
      proofIdentity: SHARED,
      browser: healthy,
    });
    assert.equal(out.ok, true, out.reason);
    const after = out.results.find((r) => r.variant === "new");
    assert.equal(after.response_identity_via, "main_document_response");
    assert.equal(bucket.calls.mirrorFetches, 0, "the refetch must not run when the response is present");
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 5b. THE CLOSED-PAGE TRAP — the actual 2026-09-02 production break.
// captureOne closes its page, and the caller then reads the response identity.
// response.allHeaders() is a CDP round trip: on the closed page it throws
// "Target page, context or browser has been closed" — the read threw, and the
// shot was refused (capture_identity_response_identity_unreadable) on every
// retry, in every lane, for every shared-identity mirror. Pinned here:
// the read must fall back to the LOCAL headers() snapshot, to the snapshot
// captureOne recorded while the page was open, and only then to the refetch.
// ---------------------------------------------------------------------------

test("a response whose allHeaders dies with the page falls back to its local headers snapshot", async () => {
  const bucket = fakeBucket();
  try {
    // captureOne takes its own snapshot while the page is open; the local
    // headers() survives even after allHeaders() is dead.
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: SHARED.build_hash,
      proofIdentity: SHARED,
      browser: closedPageBrowser({ localHeadersSurvive: true }),
    });
    assert.equal(out.ok, true, JSON.stringify({ reason: out.reason, results: out.results }));
    const after = out.results.find((r) => r.variant === "new");
    assert.equal(after.response_identity_via, "main_document_response");
    assert.equal(bucket.calls.mirrorFetches, 0, "no refetch needed: the local snapshot held");
  } finally {
    bucket.restore();
  }
});

test("a fully dead response object is identity-proven by captureOne's while-open snapshot", async () => {
  const bucket = fakeBucket();
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: SHARED.build_hash,
      proofIdentity: SHARED,
      browser: closedPageBrowser({ localHeadersSurvive: false }),
    });
    assert.equal(out.ok, true, JSON.stringify({ reason: out.reason, results: out.results }));
    const after = out.results.find((r) => r.variant === "new");
    assert.equal(after.response_identity_via, "captured_response_snapshot");
    assert.equal(bucket.calls.mirrorFetches, 0);
  } finally {
    bucket.restore();
  }
});

// A mirror whose response object dies exactly when the page closes — the
// production sequence: captureOne snapshots while open, then its finally
// closes the page, then the caller reads the identity.
function closedPageBrowser({ localHeadersSurvive }) {
  const browser = mixedBrowser({ mirrorGotoThrows: false });
  const originalNewPage = browser.newPage.bind(browser);
  browser.newPage = async () => {
    const page = await originalNewPage();
    const originalClose = page.close.bind(page);
    const dead = { value: false };
    page.close = async () => { dead.value = true; await originalClose(); };
    const originalGoto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const response = await originalGoto(url, options);
      if (page.role !== "mirror") return response;
      const headers = () => {
        if (dead.value && !localHeadersSurvive) {
          throw new Error("Target page, context or browser has been closed");
        }
        return Object.fromEntries(identityHeaders(SHARED.build_hash));
      };
      return {
        status: () => 200,
        allHeaders: async () => {
          throw new Error("Target page, context or browser has been closed");
        },
        headers,
      };
    };
    return page;
  };
  return browser;
}

// ---------------------------------------------------------------------------
// 6. UNIT — the refetch reader itself, including its bounds.
// ---------------------------------------------------------------------------

test("mainDocumentResponseIdentity reads direct headers, refetches on null, and refuses non-https", async () => {
  const direct = await mainDocumentResponseIdentity({
    response: { headers: () => ({ "x-wss-build-hash": "c".repeat(64) }) },
  });
  assert.equal(direct.site_id, "");
  assert.equal(direct.build_hash, "c".repeat(64));
  assert.equal(direct.via, "main_document_response");

  let refetchCalls = 0;
  const refetched = await mainDocumentResponseIdentity({
    response: null,
    requestedUrl: "https://wss-test-unit.wss-ai.com/",
    fetchImpl: async () => {
      refetchCalls += 1;
      return {
        ok: true,
        status: 200,
        headers: new Map([
          ["x-wss-site-id", "site_unit"],
          ["x-wss-release-id", "release_unit"],
          ["x-wss-build-hash", "d".repeat(64)],
        ]),
      };
    },
  });
  assert.equal(refetchCalls, 1);
  assert.equal(refetched.site_id, "site_unit");
  assert.equal(refetched.via, "refetch");

  const notHttps = await mainDocumentResponseIdentity({
    response: null,
    requestedUrl: "http://insecure.example/",
    fetchImpl: async () => { throw new Error("must not be called"); },
  });
  assert.equal(notHttps.site_id, "");
  assert.equal(notHttps.via, "refetch_failed");

  const threw = await mainDocumentResponseIdentity({
    response: null,
    requestedUrl: "https://wss-test-unit.wss-ai.com/",
    fetchImpl: async () => { throw new Error("econnreset"); },
  });
  assert.equal(threw.via, "refetch_failed");
  assert.match(threw.reason || "", /refetch_threw/);
});
