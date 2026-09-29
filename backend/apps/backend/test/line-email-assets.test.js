"use strict";

// test/line-email-assets.test.js
//
// THE SEND PATH USED TO OPEN A BROWSER PER PROSPECT.
//
// Four screenshots, inside the request that was trying to send the email:
// 28–35s typical, 90s+ at the tail (one prospect's current site took 41,208ms
// to reach networkidle, 1.7% under the timeout, and it is shot twice). Against
// the send route's 210s budget that is six or seven sends per invocation, which
// is the ceiling the whole line runs into.
//
// These tests pin the four properties that let that work move to the render
// gate, which already has a browser open on the mirror:
//
//   1. a capture may reuse an OPEN browser and must never close somebody
//      else's,
//   2. a stored shot is reusable only when it can name the BUILD it is a
//      picture of, and every "cannot tell" falls back to capturing,
//   3. the gate's capture hook cannot change a single fact of the verdict —
//      not by returning, not by throwing,
//   4. `ok` means something was actually captured. It used to be vacuously
//      true for a prospect with no current website, which is the exact
//      "reports success having done nothing" shape this codebase keeps
//      getting burned by.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";

const {
  proofObjectPath,
  proofMetaPath,
  publicProofUrl,
  SHOT_CACHE_CONTROL,
  META_CACHE_CONTROL,
} = require("../lib/proof-storage");
const { ensureLineProofShots, storedShotIsCurrent } = require("../lib/line-proof-shots");
const {
  captureLineEmailAssets,
  automaticProofShotsEnabled,
  automaticProofShotRecord,
  assetsAreCurrent,
  proofShotsForSend,
  MOTION_MIN_MS,
} = require("../lib/line-email-assets");
const { runRenderGate, assertGateIntegrity, FACTS } = require("../lib/render-gate");

const MIRROR = "https://wss-test-flint-plumbing-buda.wss-ai.com/";
const THEIR_SITE = "https://flintplumbing.example/";

test("automatic Line proof shots are ON by default and the exact zero kill switch restores send-time fallback", async () => {
  assert.equal(automaticProofShotsEnabled({}), true);
  assert.equal(automaticProofShotsEnabled({ GHOST_AGENCY_LINE_PROOF_SHOTS: "1" }), true);
  assert.equal(automaticProofShotsEnabled({ GHOST_AGENCY_LINE_PROOF_SHOTS: "0" }), false);

  let called = 0;
  const disabled = await captureLineEmailAssets({
    previewUrl: MIRROR,
    currentWebsite: THEIR_SITE,
    environment: { GHOST_AGENCY_LINE_PROOF_SHOTS: "0" },
    proofShots: async () => { called += 1; return { ok: true, shots: {} }; },
  });
  assert.equal(disabled.ok, false);
  assert.equal(disabled.reason, "automatic_proof_shots_disabled");
  assert.equal(called, 0, "the kill switch must leave capture for the unchanged send-time fallback");
});

test("automatic persistence accepts only a complete old/new record with both SHA-256 digests", () => {
  const complete = {
    build_hash: "build-complete",
    old_captured_url: THEIR_SITE,
    old_shot_sha: "1".repeat(64),
    new_captured_url: MIRROR,
    new_shot_sha: "2".repeat(64),
  };
  assert.deepEqual(automaticProofShotRecord({ ok: true, shots: complete, results: [] }), complete);
  assert.equal(automaticProofShotRecord({
    ok: true,
    shots: { ...complete, old_captured_url: "" },
    results: [],
  }), null);
  assert.deepEqual(automaticProofShotRecord({
    ok: true,
    shots: {
      build_hash: "build-complete",
      new_captured_url: MIRROR,
      new_shot_sha: "2".repeat(64),
    },
    results: [],
  }, { currentWebsite: "" }), {
    build_hash: "build-complete",
    new_captured_url: MIRROR,
    new_shot_sha: "2".repeat(64),
  });
  assert.equal(automaticProofShotRecord({
    ok: true,
    shots: { ...complete, new_shot_sha: "not-a-sha" },
    results: [],
  }), null);
});

// ---------------------------------------------------------------------------
// A fake bucket + a fake browser, so the whole capture runs with no network
// and no chromium.
// ---------------------------------------------------------------------------

function fakeBucket(seed = {}) {
  const objects = new Map(Object.entries(seed));
  const realFetch = global.fetch;
  const calls = { get: [], put: [] };
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if ((options.method || "GET").toUpperCase() === "POST") {
      const key = target.split("/object/")[1] || target;
      objects.set(key, Buffer.from(options.body));
      calls.put.push({ key, cacheControl: (options.headers || {})["Cache-Control"] || "" });
      return { ok: true, status: 200, text: async () => "", headers: new Map() };
    }
    const key = target.split(`/public/wss-proof-assets/`)[1] || "";
    calls.get.push(key);
    const hit = objects.get(`wss-proof-assets/${key}`) || objects.get(key);
    if (!hit) return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => (/content-type/i.test(h) ? "application/json" : "") },
      arrayBuffer: async () => hit.buffer.slice(hit.byteOffset, hit.byteOffset + hit.byteLength),
    };
  };
  return {
    objects,
    calls,
    restore() { global.fetch = realFetch; },
  };
}

/** A browser-shaped stub that records whether anyone closed it. */
function fakeBrowser({ landOn = null } = {}) {
  const state = { closed: 0, pages: 0, openPages: 0, shots: [], gotoOptions: [] };
  return {
    state,
    async newPage() {
      state.pages += 1;
      state.openPages += 1;
      let current = "";
      return {
        async goto(u, options = {}) {
          current = typeof landOn === "function" ? landOn(u) : landOn || u;
          state.gotoOptions.push(options);
          return { status: () => 200 };
        },
        url() { return current; },
        async waitForTimeout() {},
        async screenshot() {
          state.shots.push(current);
          return Buffer.from(`jpeg-bytes-for-${current}`);
        },
        async close() { state.openPages -= 1; },
      };
    },
    async close() { state.closed += 1; },
  };
}

function metaObject({ variant, url, buildHash, capturedUrl, sha = "d".repeat(64) }) {
  return [
    proofMetaPath({ url, variant }),
    Buffer.from(JSON.stringify({
      schema: "wss-proof-shot-meta-v2",
      variant,
      requested_url: url,
      captured_url: capturedUrl || url,
      build_hash: buildHash || null,
      shot_sha256: sha,
    }), "utf8"),
  ];
}

// ---------------------------------------------------------------------------
// 1. THE BROWSER
// ---------------------------------------------------------------------------

test("a capture handed an open browser uses it and never closes it", async () => {
  const bucket = fakeBucket();
  const browser = fakeBrowser();
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-aaa",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));
    assert.equal(browser.state.closed, 0, "the gate still needs its browser — capture must not close it");
    assert.equal(browser.state.openPages, 0, "every page it opened is its own to close");
    assert.equal(browser.state.pages, 4, "old, old-mobile, new, new-mobile");
  } finally {
    bucket.restore();
  }
});

test("each screenshot navigation is bounded by the remaining capture deadline", async () => {
  const bucket = fakeBucket();
  const browser = fakeBrowser();
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-deadline",
      browser,
      now: () => 1_000,
      deadlineAt: 41_000,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));
    assert.equal(browser.state.gotoOptions.length, 4);
    // The AFTER pair (captured first, before anything is secured) keeps the
    // historical envelope: the remaining slice divided across the two
    // navigation attempts, 2.5s reserved. The BEFORE variants run LAST, when
    // the AFTER pair is already secured — they are the only thing left
    // between the row and a refused send, and slow external sites are the
    // expected case for real businesses, so they get the REMAINING budget
    // (extended ceiling above), not that fixed slice.
    const afterSlices = browser.state.gotoOptions.slice(0, 2).map((options) => options.timeout);
    const beforeSlices = browser.state.gotoOptions.slice(2).map((options) => options.timeout);
    assert.deepEqual(afterSlices, [18_750, 18_750]);
    assert.deepEqual(beforeSlices, [36_000, 36_000]);
  } finally {
    bucket.restore();
  }
});

test("our own mirror is shot with the sign-up floater suppressed; their site is shot as it is", async () => {
  const bucket = fakeBucket();
  const browser = fakeBrowser();
  try {
    await ensureLineProofShots({ currentWebsite: THEIR_SITE, previewUrl: MIRROR, browser });
    const ours = browser.state.shots.filter((u) => u.includes("wss-ai.com"));
    const theirs = browser.state.shots.filter((u) => u.includes("flintplumbing.example"));
    assert.equal(ours.length, 2);
    assert.equal(theirs.length, 2);
    assert.ok(ours.every((u) => /wssthumb=1/.test(u)), "our mirror must carry the suppression flag");
    assert.ok(theirs.every((u) => !/wssthumb/.test(u)), "we do not add query parameters to a stranger's site");
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 2. KEYED ON THE BUILD
// ---------------------------------------------------------------------------

test("a stored shot of OUR mirror is reused only when it names the same build", () => {
  const args = { variant: "new", url: MIRROR };
  const digest = "a".repeat(64);
  assert.equal(storedShotIsCurrent({ ...args, meta: { build_hash: "b1", captured_url: `${MIRROR}?wssthumb=1`, shot_sha256: digest }, buildHash: "b1" }).ok, true);
  assert.equal(storedShotIsCurrent({ ...args, meta: { build_hash: "b1", captured_url: MIRROR, shot_sha256: digest }, buildHash: "b2" }).ok, false);
  // The two shapes that used to force a re-shoot on EVERY send, still refused.
  assert.equal(storedShotIsCurrent({ ...args, meta: { build_hash: "b1", captured_url: MIRROR, shot_sha256: digest }, buildHash: "" }).ok, false);
  assert.equal(storedShotIsCurrent({ ...args, meta: { captured_url: MIRROR, shot_sha256: digest }, buildHash: "b1" }).ok, false);
  assert.equal(storedShotIsCurrent({ ...args, meta: null, buildHash: "b1" }).ok, false);
  assert.equal(storedShotIsCurrent({
    ...args,
    meta: { build_hash: "b1", captured_url: "https://other-client.wss-ai.com/", shot_sha256: digest },
    buildHash: "b1",
  }).reason, "identity_preview_host_mismatch");
  assert.equal(storedShotIsCurrent({
    ...args,
    meta: { build_hash: "b1", captured_url: MIRROR, shot_sha256: "a".repeat(16) },
    buildHash: "b1",
  }).reason, "stored_shot_missing_sha256");
});

test("after capture refuses foreign and other-client redirects but accepts its suppression query", async (t) => {
  for (const [name, landed] of [
    ["foreign host", "https://foreign.example/"],
    ["other WSS client", "https://other-client.wss-ai.com/"],
  ]) {
    await t.test(name, async () => {
      const bucket = fakeBucket();
      const browser = fakeBrowser({
        landOn: (url) => String(url).includes("wss-ai.com") ? landed : url,
      });
      try {
        const out = await ensureLineProofShots({ currentWebsite: THEIR_SITE, previewUrl: MIRROR, buildHash: "build-redirect", browser });
        assert.equal(out.ok, false);
        assert.ok(!out.shots.new_captured_url);
        assert.match(out.results.find((result) => result.variant === "new").reason, /^capture_identity_/);
        assert.equal(bucket.calls.put.some((entry) => entry.key === `wss-proof-assets/${proofObjectPath({ url: MIRROR, variant: "new" })}`), false);
      } finally {
        bucket.restore();
      }
    });
  }

  const bucket = fakeBucket();
  const browser = fakeBrowser();
  try {
    const out = await ensureLineProofShots({ currentWebsite: THEIR_SITE, previewUrl: MIRROR, buildHash: "build-query", browser });
    assert.equal(out.ok, true, JSON.stringify(out.results));
    assert.match(out.shots.new_captured_url, /wssthumb=1/);
  } finally {
    bucket.restore();
  }
});

test("an unchanged build reuses its stored shot — and carries the pixel digest the email cache-busts on", async () => {
  const bucket = fakeBucket(Object.fromEntries([
    metaObject({ variant: "new", url: MIRROR, buildHash: "build-aaa", sha: "f".repeat(64) }),
    metaObject({ variant: "new-mobile", url: MIRROR, buildHash: "build-aaa" }),
    metaObject({ variant: "old", url: THEIR_SITE, capturedUrl: THEIR_SITE }),
    metaObject({ variant: "old-mobile", url: THEIR_SITE, capturedUrl: THEIR_SITE }),
  ]));
  const browser = fakeBrowser();
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-aaa",
      browser,
    });
    assert.equal(out.ok, true);
    assert.equal(browser.state.pages, 0, "nothing was re-shot");
    assert.ok(out.results.every((r) => r.skipped === "already_stored"));
    assert.equal(out.shots.new_shot_sha, "f".repeat(64), "a reused shot without its digest un-busts the email <img>");
  } finally {
    bucket.restore();
  }
});

test("an identity-valid legacy sidecar without a full SHA-256 is re-shot instead of looping on incomplete proof", async () => {
  const shortDigest = "a".repeat(16);
  const bucket = fakeBucket(Object.fromEntries([
    metaObject({ variant: "new", url: MIRROR, buildHash: "build-aaa", sha: shortDigest }),
    metaObject({ variant: "new-mobile", url: MIRROR, buildHash: "build-aaa", sha: shortDigest }),
    metaObject({ variant: "old", url: THEIR_SITE, capturedUrl: THEIR_SITE, sha: shortDigest }),
    metaObject({ variant: "old-mobile", url: THEIR_SITE, capturedUrl: THEIR_SITE, sha: shortDigest }),
  ]));
  const browser = fakeBrowser();
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-aaa",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));
    assert.equal(browser.state.pages, 4, "all success-shaped legacy sidecars are replaced once");
    assert.ok(out.results.every((result) => !result.skipped));
    assert.match(out.shots.old_shot_sha, /^[0-9a-f]{64}$/);
    assert.match(out.shots.new_shot_sha, /^[0-9a-f]{64}$/);
  } finally {
    bucket.restore();
  }
});

test("a REBUILT mirror is re-shot even though its URL never changed", async () => {
  const bucket = fakeBucket(Object.fromEntries([
    metaObject({ variant: "new", url: MIRROR, buildHash: "build-aaa" }),
    metaObject({ variant: "new-mobile", url: MIRROR, buildHash: "build-aaa" }),
  ]));
  const browser = fakeBrowser();
  try {
    await ensureLineProofShots({ previewUrl: MIRROR, buildHash: "build-bbb", browser });
    assert.equal(browser.state.pages, 2, "a new build must not ship the old build's screenshot");
  } finally {
    bucket.restore();
  }
});

test("the stored sidecar records which build the picture is of", async () => {
  const bucket = fakeBucket();
  const browser = fakeBrowser();
  try {
    await ensureLineProofShots({ previewUrl: MIRROR, buildHash: "build-ccc", browser });
    const key = proofMetaPath({ url: MIRROR, variant: "new" });
    const stored = JSON.parse(bucket.objects.get(`wss-proof-assets/${key}`).toString("utf8"));
    assert.equal(stored.build_hash, "build-ccc");
    assert.match(stored.shot_sha256, /^[0-9a-f]{64}$/);
  } finally {
    bucket.restore();
  }
});

test("a sidecar is an answer, not a payload — it may not be CDN-cached for a week", async () => {
  const bucket = fakeBucket();
  const browser = fakeBrowser();
  try {
    await ensureLineProofShots({ previewUrl: MIRROR, buildHash: "build-ccc", browser });
    const byKind = (re) => bucket.calls.put.filter((p) => re.test(p.key));
    // MEASURED on the live bucket: a sidecar re-uploaded seconds earlier came
    // back `cf-cache-status: HIT` carrying the PREVIOUS body — so the reuse
    // decision and the before-shot identity gate were both reading an answer
    // that could be a week out of date.
    assert.ok(byKind(/\.json$/).length >= 1);
    for (const put of byKind(/\.json$/)) assert.equal(put.cacheControl, META_CACHE_CONTROL);
    for (const put of byKind(/\.jpg$/)) assert.equal(put.cacheControl, SHOT_CACHE_CONTROL);
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. `ok` MEANS SOMETHING WAS CAPTURED
// ---------------------------------------------------------------------------

test("no current website is not a passing before/after — it is a named refusal", async () => {
  const bucket = fakeBucket();
  const browser = fakeBrowser();
  try {
    const out = await ensureLineProofShots({ currentWebsite: "", previewUrl: MIRROR, browser });
    // The "after" really was captured; the comparison still has no "before".
    assert.ok(String(out.shots.new_captured_url).startsWith(MIRROR));
    assert.equal(out.ok, false, "ok:true here is success reported for a comparison that does not exist");
    assert.match(out.reason, /no_current_website/);
  } finally {
    bucket.restore();
  }
});

test("a 'before' that landed on somebody else's domain is refused, not stored", async () => {
  const bucket = fakeBucket();
  const browser = fakeBrowser({ landOn: "https://parked-domains-r-us.example/expired" });
  try {
    const out = await ensureLineProofShots({ currentWebsite: THEIR_SITE, previewUrl: MIRROR, browser });
    assert.equal(out.ok, false);
    assert.match(out.reason, /no_before_shot/);
    assert.ok(!out.shots.old_captured_url);
    const refused = out.results.find((r) => r.variant === "old");
    assert.match(refused.reason, /capture_identity_/);
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 4. THE GATE'S HOOK CANNOT TOUCH THE VERDICT
// ---------------------------------------------------------------------------

function goodDom(overrides = {}) {
  return {
    ok: true,
    url: MIRROR,
    status: 200,
    title: "Flint Plumbing — Buda, TX",
    innerText:
      "Flint Plumbing\nCall (512) 555-0147\n123 Main St, Buda, TX 78610\n" +
      "Drain cleaning, water heater replacement and sewer repair.",
    hrefs: [],
    imgs: [],
    logos: [{ src: "https://cdn/flint.png", sha256: "a".repeat(64), width: 120, height: 40, bytes: 4096 }],
    jsonld: [{ "@type": "Plumber", name: "Flint Plumbing" }],
    ...overrides,
  };
}

function goodSource(overrides = {}) {
  return {
    prospect_id: "flint_1",
    business_name: "Flint Plumbing",
    vertical: "plumbing",
    phone: "512-555-0147",
    postal_city: "Buda",
    logo_sha256: "a".repeat(64),
    donor_strings: ["Premier Plumbing Co", "(214) 555-9900"],
    ...overrides,
  };
}

/** A reader that behaves like readRenderedDom, hook and all, with no browser. */
function readerFor(dom, browser = fakeBrowser()) {
  return async (url, options = {}) => {
    const out = { ...dom, url };
    if (typeof options.onRendered === "function") {
      try { out.capture = await options.onRendered({ browser, dom: out }); }
      catch (e) { out.capture = { ok: false, reason: `capture_threw: ${e.message}` }; }
    }
    return out;
  };
}

test("the capture hook runs on a PASSING gate, with the gate's own browser, and its result rides out", async () => {
  const browser = fakeBrowser();
  const seen = [];
  const verdict = await runRenderGate({
    url: MIRROR,
    source: goodSource(),
    reader: readerFor(goodDom(), browser),
    build: { buildHash: "build-aaa", currentWebsite: THEIR_SITE },
    capture: async (args) => { seen.push(args); return { ok: true, shots: { new_captured_url: MIRROR } }; },
  });
  assert.equal(verdict.pass, true, verdict.blockedBy);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].browser, browser, "the hook must get the browser that is already open");
  assert.equal(seen[0].build.buildHash, "build-aaa");
  assert.equal(verdict.capture.shots.new_captured_url, MIRROR);
});

test("a FAILING gate never pays for a capture", async () => {
  let called = 0;
  const verdict = await runRenderGate({
    url: MIRROR,
    // The client's own phone is missing from the page: nap_match fails.
    source: goodSource({ phone: "512-555-9999" }),
    reader: readerFor(goodDom()),
    capture: async () => { called += 1; return { ok: true }; },
  });
  assert.equal(verdict.pass, false);
  assert.equal(called, 0, "a row that will never be sent must not spend browser seconds");
  assert.match(verdict.capture.skipped, /^gate_failed:/);
});

test("a capture that throws, or lies, cannot change one fact", async () => {
  const thrown = await runRenderGate({
    url: MIRROR,
    source: goodSource(),
    reader: readerFor(goodDom()),
    capture: async () => { throw new Error("supabase exploded"); },
  });
  assert.equal(thrown.pass, true, "a failed capture is not a failed gate");
  assert.match(thrown.capture.reason, /capture_threw/);

  // And it cannot rescue a page that genuinely failed.
  const lying = await runRenderGate({
    url: MIRROR,
    source: goodSource({ logo_sha256: "b".repeat(64) }),
    reader: readerFor(goodDom()),
    capture: async () => ({ ok: true, pass: true, failed: [], checks: [] }),
  });
  assert.equal(lying.pass, false);
  assert.ok(lying.failed.includes("logo_own_and_unique"));
  assert.equal(lying.failed.length >= 1, true);
});

test("gate integrity still refuses a blind gate that carries a successful capture", () => {
  assert.equal(assertGateIntegrity().facts, FACTS.length);
});

// ---------------------------------------------------------------------------
// 5. THE SEND PATH'S DECISION
// ---------------------------------------------------------------------------

const CURRENT = Object.freeze({
  build_hash: "build-aaa",
  new_captured_url: MIRROR,
  old_captured_url: THEIR_SITE,
  old_shot_sha: "d".repeat(64),
  new_shot_sha: "e".repeat(64),
});

test("assetsAreCurrent says yes only when the pictures can name the build being sent", () => {
  const ok = assetsAreCurrent({ shots: CURRENT, buildHash: "build-aaa", currentWebsite: THEIR_SITE });
  assert.equal(ok.ok, true);

  const cases = [
    [{ shots: null, buildHash: "build-aaa", currentWebsite: THEIR_SITE }, /no_stored_shots/],
    [{ shots: CURRENT, buildHash: "", currentWebsite: THEIR_SITE }, /row_has_no_build_hash/],
    [{ shots: { ...CURRENT, build_hash: "" }, buildHash: "build-aaa", currentWebsite: THEIR_SITE }, /predate/],
    [{ shots: CURRENT, buildHash: "build-zzz", currentWebsite: THEIR_SITE }, /build_changed/],
    [{ shots: { ...CURRENT, new_captured_url: "" }, buildHash: "build-aaa", currentWebsite: THEIR_SITE }, /no_after_shot/],
    [{ shots: { ...CURRENT, old_captured_url: "" }, buildHash: "build-aaa", currentWebsite: THEIR_SITE }, /before_shot_unresolved/],
  ];
  for (const [input, reason] of cases) {
    const verdict = assetsAreCurrent(input);
    assert.equal(verdict.ok, false, JSON.stringify(input));
    assert.match(verdict.reason, reason);
  }

  // A "before" REFUSED on identity is settled for this build: re-shooting the
  // same site produces the same refusal 40s later, and the email's own gate
  // still blocks the send because there is no before_captured_url.
  const refused = assetsAreCurrent({
    shots: { ...CURRENT, old_captured_url: "", before_refused: "capture_identity_capture_domain_mismatch" },
    buildHash: "build-aaa",
    currentWebsite: THEIR_SITE,
  });
  assert.equal(refused.ok, true);
});

test("a send with current gate-captured shots launches no browser", async () => {
  let captured = 0;
  const out = await proofShotsForSend({
    row: { previewUrl: MIRROR, buildHash: "build-aaa", captured: { ok: true, shots: CURRENT } },
    record: {},
    currentWebsite: THEIR_SITE,
    captureShots: async () => { captured += 1; return { shots: {} }; },
  });
  assert.equal(out.launchedBrowser, false);
  assert.equal(captured, 0, "this is the 28–35s per prospect the send path used to pay");
  assert.equal(out.source, "render_gate");
  assert.equal(out.persist, true);
  assert.equal(out.shots.new_captured_url, MIRROR);
});

test("a send consumes the canonical proof_shots row contract without opening a browser", async () => {
  let captured = 0;
  const out = await proofShotsForSend({
    row: { previewUrl: MIRROR, buildHash: "build-aaa", proof_shots: CURRENT },
    record: {},
    currentWebsite: THEIR_SITE,
    captureShots: async () => { captured += 1; return { shots: {} }; },
  });
  assert.equal(out.launchedBrowser, false);
  assert.equal(captured, 0);
  assert.equal(out.source, "render_gate");
  assert.equal(out.shots.old_captured_url, THEIR_SITE);
  assert.equal(out.shots.new_captured_url, MIRROR);
});

test("the kill switch ignores automatic row and record shots and restores send-time capture", async () => {
  let captured = 0;
  const fresh = {
    old_captured_url: THEIR_SITE,
    old_shot_sha: "3".repeat(64),
    new_captured_url: `${MIRROR}?fresh=1`,
    new_shot_sha: "4".repeat(64),
  };
  const out = await proofShotsForSend({
    row: { previewUrl: MIRROR, buildHash: "build-aaa", proof_shots: CURRENT },
    record: { proof_shots: CURRENT },
    currentWebsite: THEIR_SITE,
    environment: { GHOST_AGENCY_LINE_PROOF_SHOTS: "0" },
    captureShots: async () => { captured += 1; return { ok: true, shots: fresh }; },
  });
  assert.equal(captured, 1);
  assert.equal(out.launchedBrowser, true);
  assert.equal(out.source, "send_path_capture");
  assert.equal(out.shots.new_captured_url, fresh.new_captured_url);
  assert.match(out.reason, /automatic_proof_shots_disabled/);
});

test("a send whose stored shots are of a DIFFERENT build still captures — fail closed", async () => {
  let seen = null;
  const out = await proofShotsForSend({
    row: { previewUrl: MIRROR, buildHash: "build-bbb", captured: { ok: true, shots: CURRENT } },
    record: { proof_shots: CURRENT },
    currentWebsite: THEIR_SITE,
    captureShots: async (args) => {
      seen = args;
      return { ok: true, shots: { new_captured_url: MIRROR, old_captured_url: THEIR_SITE } };
    },
  });
  assert.equal(out.launchedBrowser, true);
  assert.equal(seen.buildHash, "build-bbb");
  assert.equal(out.shots.build_hash, "build-bbb", "what it just captured is a picture of THIS build");
  assert.match(out.reason, /build_changed_since_capture/);
});

test("a rebuilt mirror never inherits the previous build's animation", async () => {
  // The GIF's key comes from the preview URL, which does not change on rebuild.
  // Merging a stale anim_sha forward would put the OLD build's loop next to the
  // NEW build's stills in the same email.
  const stale = { ...CURRENT, anim_sha: "1".repeat(64), anim_bytes: 400_000 };

  const rebuilt = await proofShotsForSend({
    row: {
      previewUrl: MIRROR,
      buildHash: "build-bbb",
      captured: { ok: true, shots: { ...CURRENT, build_hash: "build-bbb" } },
    },
    record: { proof_shots: stale },
    currentWebsite: THEIR_SITE,
    captureShots: async () => ({ shots: {} }),
  });
  assert.ok(!rebuilt.shots.anim_sha, "a loop of the previous build is not this build's proof");
  assert.ok(!rebuilt.shots.anim_bytes);

  // …and the send path's own capture, which never makes a loop, must not
  // resurrect one either.
  const captured = await proofShotsForSend({
    row: { previewUrl: MIRROR, buildHash: "build-bbb" },
    record: { proof_shots: stale },
    currentWebsite: THEIR_SITE,
    captureShots: async () => ({ ok: true, shots: { new_captured_url: MIRROR, old_captured_url: THEIR_SITE } }),
  });
  assert.equal(captured.launchedBrowser, true);
  assert.ok(!captured.shots.anim_sha);

  // The SAME build keeps its loop — this is a staleness rule, not a ban.
  const same = await proofShotsForSend({
    row: { previewUrl: MIRROR, buildHash: "build-aaa", captured: { ok: true, shots: CURRENT } },
    record: { proof_shots: stale },
    currentWebsite: THEIR_SITE,
    captureShots: async () => ({ shots: {} }),
  });
  assert.equal(same.shots.anim_sha, "1".repeat(64));
});

test("a fresh identity refusal never inherits the previous build's before shot", async () => {
  const stale = { ...CURRENT, build_hash: "build-aaa" };
  const out = await proofShotsForSend({
    row: { previewUrl: MIRROR, buildHash: "build-bbb" },
    record: { proof_shots: stale },
    currentWebsite: THEIR_SITE,
    captureShots: async () => ({
      ok: true,
      shots: {
        new_captured_url: MIRROR,
        new_shot_sha: "f".repeat(64),
        before_refused: "capture_identity_capture_domain_mismatch",
      },
    }),
  });
  assert.equal(out.launchedBrowser, true);
  assert.equal(out.persist, false);
  assert.equal(out.refuseProofPersistence, true);
  assert.equal(out.shots.before_refused, "capture_identity_capture_domain_mismatch");
  assert.equal(out.shots.old_captured_url, undefined);

  const { proofReadiness } = require("../lib/outreach-email-v2");
  const readiness = proofReadiness({
    cta: {
      previewUrl: MIRROR,
      currentUrl: THEIR_SITE,
      beforeImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=old&s=x&v=old",
      afterImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=new&s=x&v=new",
      beforeImageSource: String(out.shots.old_captured_url || ""),
    },
  });
  assert.equal(readiness.ok, false);
  assert.equal(readiness.reason, "before_image_capture_source_unrecorded");
});

test("a row from before any of this existed behaves exactly as it did before", async () => {
  let captured = 0;
  const out = await proofShotsForSend({
    row: { previewUrl: MIRROR },
    record: { proof_shots: { new_captured_url: MIRROR, old_captured_url: THEIR_SITE } },
    currentWebsite: THEIR_SITE,
    captureShots: async () => { captured += 1; return { ok: true, shots: { new_captured_url: MIRROR } }; },
  });
  assert.equal(captured, 1);
  assert.equal(out.launchedBrowser, true);
  assert.match(out.reason, /row_has_no_build_hash/);
});

// ---------------------------------------------------------------------------
// 6. THE MOTION LOOP IS AN EXTRA, NEVER A BLOCKER
// ---------------------------------------------------------------------------

test("the loop is captured alongside the stills and stamped with the same build", async () => {
  const out = await captureLineEmailAssets({
    browser: { marker: "gate-browser" },
    previewUrl: MIRROR,
    currentWebsite: THEIR_SITE,
    buildHash: "build-aaa",
    proofShots: async (args) => {
      assert.equal(args.browser.marker, "gate-browser");
      assert.equal(args.buildHash, "build-aaa");
      return { ok: true, shots: { new_captured_url: MIRROR, old_captured_url: THEIR_SITE }, results: [] };
    },
    motionShot: async (args) => {
      assert.equal(args.browser.marker, "gate-browser", "the loop uses the same browser as everything else");
      assert.equal(args.buildHash, "build-aaa");
      return { ok: true, sha: "c".repeat(64), bytes: 412_000, lane: "hero", frames: 18, fps: 12.5 };
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.shots.build_hash, "build-aaa");
  assert.equal(out.shots.anim_sha, "c".repeat(64));
  assert.equal(out.shots.anim_bytes, 412_000);
});

test("no loop is a thinner email, never a blocked one", async () => {
  const out = await captureLineEmailAssets({
    previewUrl: MIRROR,
    currentWebsite: THEIR_SITE,
    buildHash: "build-aaa",
    proofShots: async () => ({ ok: true, shots: { new_captured_url: MIRROR, old_captured_url: THEIR_SITE }, results: [] }),
    motionShot: async () => { throw new Error("ffmpeg is not a thing here"); },
  });
  assert.equal(out.ok, true, "the stills are what the email's gate needs");
  assert.ok(!out.shots.anim_sha, "a failed loop must never mint an <img> src");
  assert.match(out.shots.anim_reason, /motion_threw/);
});

test("an unchanged build reuses its stored loop instead of re-encoding it", async () => {
  const { ensureLineMotionShot, gifMetaPath } = require("../lib/line-motion-shot");
  const sha = "9".repeat(64);
  const bucket = fakeBucket({
    [gifMetaPath({ url: MIRROR })]: Buffer.from(JSON.stringify({
      schema: "wss-motion-shot-meta-v3",
      build_hash: "build-aaa",
      gif_sha256: sha,
      bytes: 512_000,
      lane: "hero",
      frames: 18,
      fps: 12.5,
    }), "utf8"),
  });
  try {
    const same = await ensureLineMotionShot({ previewUrl: MIRROR, buildHash: "build-aaa" });
    assert.equal(same.ok, true);
    assert.equal(same.reused, true, "encoding a loop costs 7–8s of browser; the same build has nothing new to record");
    assert.equal(same.sha, sha);
    assert.equal(same.bytes, 512_000);

    // A different build must NOT reuse it. Handed a browser that cannot open a
    // page, the proof is that it went to CAPTURE rather than answering from the
    // stored meta — no network, no chromium, no ambiguity.
    const rebuilt = await ensureLineMotionShot({ previewUrl: MIRROR, buildHash: "build-bbb", browser: {} });
    assert.equal(rebuilt.ok, false);
    assert.match(rebuilt.reason, /^capture_failed/);
  } finally {
    bucket.restore();
  }
});

test("a loop that cannot make budget is skipped rather than started", async () => {
  let asked = 0;
  const clock = (() => { let t = 1_000; return () => (t += 0); })();
  const out = await captureLineEmailAssets({
    previewUrl: MIRROR,
    buildHash: "build-aaa",
    budgetMs: Math.max(1, MOTION_MIN_MS - 1),
    now: clock,
    proofShots: async () => ({ ok: true, shots: { new_captured_url: MIRROR }, results: [] }),
    motionShot: async () => { asked += 1; return { ok: true, sha: "c".repeat(64), bytes: 1 }; },
  });
  assert.equal(asked, 0);
  assert.match(out.shots.anim_reason, /skipped_no_budget/);
});

test("an identity-refused before shot is recorded as a refusal, never as a shot", async () => {
  const out = await captureLineEmailAssets({
    previewUrl: MIRROR,
    currentWebsite: THEIR_SITE,
    buildHash: "build-aaa",
    motion: false,
    proofShots: async () => ({
      ok: false,
      reason: "no_before_shot",
      shots: { new_captured_url: MIRROR },
      results: [{ variant: "old", ok: false, reason: "capture_identity_capture_domain_mismatch" }],
    }),
  });
  assert.equal(out.shots.before_refused, "capture_identity_capture_domain_mismatch");
  assert.ok(!out.shots.old_captured_url);
});

test("the stored object for the loop is a .gif, at the key the email's route reads", () => {
  const key = proofObjectPath({ url: MIRROR, variant: "gif" });
  assert.match(key, /^preview-shots\/gif\/[0-9a-f]{64}\.gif$/);
  assert.match(publicProofUrl(key), /\/wss-proof-assets\/preview-shots\/gif\/[0-9a-f]{64}\.gif$/);
});

// ---------------------------------------------------------------------------
// 7. THE LOOP REACHES THE EMAIL
// ---------------------------------------------------------------------------
//
// composeOutreachEmailV3 has read `afterAnimUrl` since it was written, and no
// row in the store has ever carried one — 0 of 1,000 — so the "after" panel has
// always been a still JPEG. These pin the two halves of the wiring: the signed
// route resolves the loop's bytes, and the composer puts them in the slot.

process.env.GHOST_AGENCY_VISUAL_SECRET = process.env.GHOST_AGENCY_VISUAL_SECRET || "test-visual-secret";
const { signedVisualPath, SPACER_GIF } = require("../lib/preview-visuals");
const proofShotRoute = require("../api/media/preview-shot");
const { composeOutreachEmailV3 } = require("../lib/outreach-email-v3");

// GIF89a header + the bytes a decoder would see. Real enough to prove the route
// streams what was stored rather than the 42-byte spacer.
const GIF_BYTES = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.from([0x2c, 0x00, 0x3b])]);

function mkRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b === undefined ? "" : b; },
  };
}

function queryFor(kind) {
  const rel = signedVisualPath({ kind, previewUrl: MIRROR, currentWebsite: THEIR_SITE, nonce: "flint_1" });
  return Object.fromEntries(new URLSearchParams(rel.split("?")[1]).entries());
}

test("a signed v=gif request streams the stored loop, not the 42-byte spacer", async () => {
  const key = proofObjectPath({ url: MIRROR, variant: "gif" });
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    // The storage path, with the cache-bust query stripped. fetchProofShot
    // carries the caller's `c=<pixel digest>` all the way into the storage
    // read ON PURPOSE — that is the 2026-08-04 stale-thumbnail fix — so the
    // URL no longer ENDS with the object key. The mock matches what the
    // request is FOR, not its cache decoration; matching on endsWith made
    // this test fail the moment the route started doing the right thing.
    const storagePath = String(url).split("?")[0];
    if (!storagePath.endsWith(key)) {
      return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => (/content-type/i.test(h) ? "image/gif" : "") },
      arrayBuffer: async () => GIF_BYTES.buffer.slice(GIF_BYTES.byteOffset, GIF_BYTES.byteOffset + GIF_BYTES.byteLength),
    };
  };
  try {
    const res = mkRes();
    await proofShotRoute({ method: "GET", query: { ...queryFor("gif"), c: "c".repeat(16) } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "image/gif");
    assert.notEqual(Buffer.compare(res.body, SPACER_GIF), 0, "the spacer is what a MISS looks like");
    assert.equal(res.body.subarray(0, 6).toString("ascii"), "GIF89a", "real GIF bytes reach the reader");
  } finally {
    global.fetch = realFetch;
  }
});

test("the loop wins the after slot; without one the email keeps the still", () => {
  const base = {
    businessName: "Flint Plumbing",
    previewUrl: MIRROR,
    beforeImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a&s=b&v=old",
    afterImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=c&s=d&v=new",
    postalAddress: "655 S Main St, Suite 200, Orange, CA 92868",
    unsubUrl: "https://ghost.wss-ai.com/api/outreach/unsubscribe?t=x",
  };
  const anim = "https://ghost.wss-ai.com/api/media/preview-shot?k=e&s=f&v=gif&c=abc123abc123";

  // The composer HTML-escapes every attribute, so match on the parameters
  // rather than the raw string.
  const srcs = (html) => [...String(html).matchAll(/<img[^>]+src="([^"]+)"/g)]
    .map((m) => m[1].replace(/&amp;/g, "&"));

  const withLoop = srcs(composeOutreachEmailV3({ ...base, afterAnimUrl: anim }).html);
  assert.ok(withLoop.includes(anim), `the animated after must render — got ${withLoop.join(" | ")}`);
  assert.ok(!withLoop.includes(base.afterImage), "one after panel, not two");
  assert.ok(withLoop.includes(base.beforeImage), "the before half is untouched");

  const withoutLoop = srcs(composeOutreachEmailV3(base).html);
  assert.ok(withoutLoop.includes(base.afterImage), "no loop must fall back to the still, never to a gap");
  assert.ok(!withoutLoop.some((s) => /v=gif/.test(s)), "and never to an <img> pointing at nothing");
});

test("scrubber-corrupted shared tuples drop to the legacy path instead of refusing", () => {
  const { deliveryProofIdentity } = require("../lib/line-email-assets");
  const out = deliveryProofIdentity({
    sources: [
      {
        site_id: "78ac5c55-ea[redacted-phone]-baaec944ee8a",
        release_id: "3b66954f-b1d2-8b4b-b744-8d30626aa3d3",
        build_hash: "d".repeat(64),
      },
    ],
    buildHash: "d".repeat(64),
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.active, false, "a corrupted-only source set must fall back to legacy live capture");
});
