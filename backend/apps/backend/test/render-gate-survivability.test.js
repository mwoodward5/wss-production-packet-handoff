"use strict";

/**
 * test/render-gate-survivability.test.js
 *
 * THE RUN THIS FILE EXISTS BECAUSE OF
 * ---------------------------------------------------------------------------
 * 2026-08-07. Two live ten-lead runs produced three sites, then two. Every
 * casualty in the event log read exactly:
 *
 *   ["content=injected","optimization_108=scored","editable=archived","render=failed"]
 *
 * and three of them read "render=unavailable","route_render=unavailable"
 * instead — arriving inside 84ms of each other (09:13:48.057 / .102 / .141),
 * never staggered. All five of the "render=failed" pages were then rendered
 * off a developer box, one at a time and five at a time, and every one came
 * back `status: passed, problems: []`. The pages were never the defect.
 *
 * Three separate things were wrong, and this file holds all three shut:
 *
 *  1. THE GATE WOULD NOT SAY WHAT IT SAW. checks.render already carried
 *     problems[]/reason; lib/full-run.js mapped it to `${k}=${v.status}` and
 *     threw the sentence away. Ten identical labels, no cause anywhere.
 *  2. LAUNCHES RACED. @sparticuz/chromium's executablePath() returns
 *     /tmp/chromium the moment the file EXISTS, while lambdafs.inflate is
 *     still streaming ~150MB into it — so a second launch starting alongside
 *     the first gets a half-written binary. Permits fix it.
 *  3. NOTHING RETRIED. One lost race killed the lead for good, and an
 *     "unavailable" manifest was memoised so it could never recover on that
 *     instance.
 *
 * None of this weakens a fact. A retry re-measures the SAME page against the
 * SAME rules, and the second verdict is the one that stands.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const chromium = require("../lib/serverless-chromium");
const verify = require("../lib/mirror-engine/verify");
const renderGate = require("../lib/render-gate");
const { causeOfEachFailure } = require("../lib/full-run");
const { describeRefusal } = require("../lib/line-adapters");

// ---------------------------------------------------------------------------
// 1. The browser permit — the fix for the /tmp extraction race
// ---------------------------------------------------------------------------

test("the browser permit never lets two launches overlap at the default limit", async () => {
  const sem = chromium.createSemaphore(() => 1);
  let live = 0;
  let peak = 0;
  const work = async () => {
    const release = await sem.acquire();
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live -= 1;
    release();
  };
  await Promise.all([work(), work(), work(), work(), work()]);
  assert.equal(peak, 1, "a limit of 1 must mean one browser at a time — the race needs only two");
  assert.equal(sem._debug().held, 0, "every permit must come back");
});

test("a permit released twice does not corrupt the count", async () => {
  const sem = chromium.createSemaphore(() => 1);
  const release = await sem.acquire();
  release();
  release();
  assert.equal(sem._debug().held, 0);
  // Still usable afterwards — a double release must not open a second slot.
  const again = await sem.acquire();
  assert.equal(sem._debug().held, 1);
  again();
});

test("the render pool is tuned SEPARATELY from the build pool", () => {
  // The owner's rule: a browser is expensive, a deploy is not, so they must not
  // share a valve. Rows keep deploying five-wide while browsers go one at a
  // time; collapsing these two knobs is what produced 3/10.
  const { BUILD_CONCURRENCY_ENV } = require("../lib/line-runner");
  assert.notEqual(chromium.RENDER_CONCURRENCY_ENV, BUILD_CONCURRENCY_ENV);
  // main 6ed753a doubled the default to accelerate the 50-site line; the
  // SEPARATION from the build pool is the law this test guards.
  assert.equal(chromium.DEFAULT_RENDER_CONCURRENCY, 2);
  assert.equal(chromium.renderConcurrency(undefined), 2, "an unset env is the tuned default, not none and not the build width");
  assert.equal(chromium.renderConcurrency("3"), 3);
  assert.equal(chromium.renderConcurrency("999"), chromium.MAX_RENDER_CONCURRENCY, "a typo cannot open a hundred browsers");
  assert.equal(chromium.renderConcurrency("banana"), 2);
  assert.equal(chromium.renderConcurrency("0"), 2);
});

test("the serverless binary is extracted ONCE however many browsers ask for it", async () => {
  // The race, stated plainly: @sparticuz/chromium@143 executablePath() returns
  // /tmp/chromium as soon as the file EXISTS, and lambdafs.inflate creates it
  // with createWriteStream before streaming ~150MB into it. Two callers, one
  // half-written binary, one "chromium_launch_failed" with no explanation.
  chromium._resetExecutablePathOnce();
  let extractions = 0;
  const spart = {
    executablePath: async () => {
      extractions += 1;
      await new Promise((r) => setTimeout(r, 20));
      return "/tmp/chromium";
    },
  };
  const paths = await Promise.all(Array.from({ length: 6 }, () => chromium.serverlessExecutablePath(spart)));
  assert.equal(extractions, 1, "six simultaneous launches must share ONE extraction");
  assert.deepEqual(paths, Array(6).fill("/tmp/chromium"));
});

test("a failed extraction is not cached as the permanent answer", async () => {
  chromium._resetExecutablePathOnce();
  let calls = 0;
  const flaky = {
    executablePath: async () => {
      calls += 1;
      if (calls === 1) throw new Error("ENOSPC: no space left on device");
      return "/tmp/chromium";
    },
  };
  await assert.rejects(() => chromium.serverlessExecutablePath(flaky), /ENOSPC/);
  assert.equal(await chromium.serverlessExecutablePath(flaky), "/tmp/chromium", "the next caller gets a clean attempt");
  chromium._resetExecutablePathOnce();
});

// ---------------------------------------------------------------------------
// 2. Retry policy — what a second look can and cannot change
// ---------------------------------------------------------------------------

test("a re-render is attempted for timing failures and refused for byte failures", () => {
  // Could plausibly clear on a second look: the browser, the network, the clock.
  for (const problem of [
    "render_error: Timeout 45000ms exceeded",
    "failed_requests:1",
    "hero_video_not_playing (readyState=1 paused=true)",
    "console_errors:2",
    "page_errors:1:Error: boom",
  ]) {
    assert.equal(verify.worthRetrying({ status: "failed", problems: [problem] }), true, problem);
  }
  // Properties of the deployed bytes. Identical on the tenth render as the
  // first — retrying only burns a browser and delays an honest casualty.
  for (const problem of [
    "rendered_raw_tokens:{{PHONE}}",
    "entity_residue_in_rendered_text:/=&#038;",
    "route_collisions:/services=/about",
    "missing_hash_targets:/#quote",
    "broken_prose:/:dangling_connector",
    "injected_content_not_in_rendered_dom:/",
    "non_200_paths:/faq=404",
    "empty_rendered_body:/",
  ]) {
    assert.equal(verify.worthRetrying({ status: "failed", problems: [problem] }), false, problem);
  }
  // A chromium that never opened measured nothing at all — always look again.
  assert.equal(verify.worthRetrying({ status: "unavailable", reason: "chromium_launch_failed: …" }), true);
  // And a pass is a pass. Never re-roll a green verdict.
  assert.equal(verify.worthRetrying({ status: "passed", problems: [] }), false);
  // One static problem in the set is enough to make the whole verdict final.
  assert.equal(
    verify.worthRetrying({ status: "failed", problems: ["failed_requests:1", "rendered_raw_tokens:{{PHONE}}"] }),
    false,
    "a real token defect must not be re-rolled just because a flake rode along with it",
  );
});

test("readRenderedDom looks twice, and the SECOND look is the verdict", async () => {
  const url = "https://wss-test-example.wss-ai.com/";
  const body = "a".repeat(80);
  let calls = 0;
  // A launcher whose FIRST browser dies the way a lost extraction race dies.
  const flaky = {
    launch: async () => {
      calls += 1;
      if (calls === 1) throw new Error("Failed to launch: /tmp/chromium is not an executable");
      return stubBrowser({ status: 200, innerText: body });
    },
  };
  const dom = await renderGate.readRenderedDom(url, { launcher: flaky });
  assert.equal(calls, 2, "exactly one retry — not zero, not a loop");
  assert.equal(dom.ok, true, "a recovered render is a build, not a casualty");
  assert.equal(dom.attempts, 2);
  assert.match(dom.first_attempt_reason, /chromium_launch_failed/);
});

test("a page that is genuinely dead fails twice and names BOTH attempts", async () => {
  let calls = 0;
  const dead = {
    launch: async () => {
      calls += 1;
      return stubBrowser({ status: 500, innerText: "" });
    },
  };
  const dom = await renderGate.readRenderedDom("https://wss-test-example.wss-ai.com/", { launcher: dead });
  assert.equal(calls, 2);
  assert.equal(dom.ok, false, "a retry must never turn a dead page into a pass");
  assert.match(dom.reason, /http_500/);
  assert.match(dom.reason, /first attempt/, "the casualty carries its whole history, not just the last line");

  // And the gate still fails ALL EIGHT facts on it. Survivability changed how
  // many times we look, never what counts as proof.
  const verdict = renderGate.evaluateRenderGate({ dom, source: {} });
  assert.equal(verdict.pass, false);
  assert.equal(verdict.failed.length, renderGate.FACTS.length);
});

test("the gate integrity self-check still holds after the retry was added", () => {
  assert.deepEqual(renderGate.assertGateIntegrity(), { ok: true, facts: renderGate.FACTS.length });
});

// ---------------------------------------------------------------------------
// 3. The refusal must say what the gate SAW
// ---------------------------------------------------------------------------

test("causeOfEachFailure carries the browser's own words, not just a status label", () => {
  const cause = causeOfEachFailure({
    content: { status: "injected" },
    brand: { status: "passed" },
    render: {
      status: "failed",
      problems: ["hero_video_not_playing (readyState=1 paused=true)", "failed_requests:1"],
      first_attempt: { status: "unavailable", reason: "chromium_launch_failed: half-written /tmp/chromium" },
    },
    route_render: { status: "unavailable", reason: "chromium_launch_failed: local: … | serverless: …" },
    deep_link: { status: "failed", failures: [{ probe: "spa_deep_link", reason: "http_404" }] },
  });

  assert.equal(cause.brand, undefined, "a passing gate has nothing to explain");
  assert.match(cause.render, /hero_video_not_playing/);
  assert.match(cause.render, /failed_requests:1/);
  assert.match(cause.render, /first attempt unavailable/, "a retry that changed the answer is the most useful line in the record");
  assert.match(cause.route_render, /chromium_launch_failed/);
  assert.match(cause.deep_link, /http_404/);
  // The exact shape of the 3/10 run: a status with nothing behind it must say
  // so out loud rather than look like an explanation.
  assert.match(cause.content, /no recorded cause/);
});

test("a dead lead's row names its cause instead of wearing mirror_build_not_revealable", () => {
  const named = describeRefusal({
    reason: "not_revealable",
    detail: ["content=injected", "render=failed"],
    cause: { render: "hero_video_not_playing (readyState=1 paused=true)" },
  });
  assert.match(named, /render=failed/);
  assert.match(named, /hero_video_not_playing/);

  // But we do not invent detail for a refusal we never observed. A dispatcher
  // that refused before reaching a gate keeps the bare historical string.
  assert.equal(describeRefusal(null), "mirror_build_not_revealable");
});

// ---------------------------------------------------------------------------
// helpers — a chromium-shaped stub, no browser required
// ---------------------------------------------------------------------------

function stubBrowser({ status = 200, innerText = "" } = {}) {
  return {
    async newPage() {
      return {
        async goto() { return { status: () => status }; },
        async evaluate() {
          return { title: "", innerText, hrefs: [], imgs: [], jsonldRaw: [] };
        },
        request: { async get() { return { ok: () => false }; } },
      };
    },
    async close() { return undefined; },
  };
}


test("causeOfEachFailure serializes object problem/reason evidence and preserves strings", () => {
  const objectCause = causeOfEachFailure({
    render: {
      status: "failed",
      problems: [{ code: "page_error", detail: { status: 503 } }],
      reason: { code: "chromium_failed", retryable: true },
      first_attempt: { status: "failed", problems: [{ code: "first_problem" }], reason: { code: "first_reason" } },
    },
  }).render;
  assert.match(objectCause, /\{"code":"page_error","detail":\{"status":503\}\}/);
  assert.match(objectCause, /\{"code":"chromium_failed","retryable":true\}/);
  assert.match(objectCause, /\{"code":"first_problem"\}/);
  assert.equal(objectCause.includes("[object Object]"), false);

  const stringCause = causeOfEachFailure({ render: { status: "failed", problems: ["plain problem"], reason: "plain reason" } }).render;
  assert.match(stringCause, /plain problem/);
  assert.match(stringCause, /plain reason/);
});
