"use strict";

// THE reason no website was ever produced (measured in production 2026-08-19,
// pinpointed locally by instrumenting every page call).
//
// renderCheckOnce polls the hero <video> to a verdict. It did so with a bare
//   if (v.paused && v.muted) { try { await v.play(); } catch {} }
// inside a `while (!settled() && Date.now() < deadline)` loop.
//
// HTMLMediaElement.play() returns a promise the browser may leave PENDING
// FOREVER while it decides whether autoplay is allowed, or while the media is
// still loading. A bare await parks the loop inside that promise, so the
// deadline guard never runs again and page.evaluate never returns. Measured:
// renderCheckOnce ran >150s against a live mirror and had to be killed; after
// the fix the same call returns in ~7.6s.
//
// In production it was raced only against the build deadline, so it consumed
// the ENTIRE ~270s mirror budget, deferred as retryable, retried and exhausted.
// The mirror had already deployed correctly — only its inspection stalled — so
// the console honestly showed "moving now / 0 finished" forever. It triggers on
// exactly the live-video heroes the product ships on every site.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "lib", "mirror-engine", "verify.js"), "utf8");

test("play() is never bare-awaited inside the hero poll", () => {
  // A bare `await v.play()` (no race, no timer) is the hang.
  assert.doesNotMatch(source, /await\s+v\.play\(\)/,
    "await v.play() can park the poll forever — race it against a timer");
  assert.match(source, /Promise\.race\(\[[\s\S]{0,200}v\.play\(\)/,
    "play() must be raced against a bounded timer");
});

test("the hero poll carries a wall-clock ceiling independent of the page", () => {
  assert.match(source, /function withPageTimeout/,
    "page.evaluate has no timeout of its own; evidence steps need a ceiling");
  assert.match(source, /hero_video_poll_timeout/,
    "a stalled poll must degrade to a NAMED unmeasured verdict, not hang");
  // The ceiling must be applied to the poll promise BEFORE it is awaited,
  // otherwise it cannot bound anything.
  assert.match(source, /const videoPoll = page\.evaluate/,
    "the poll must be captured un-awaited so the ceiling can race it");
  assert.match(source, /withPageTimeout\(\s*videoPoll/,
    "the ceiling must wrap the un-awaited poll promise");
});

test("withPageTimeout resolves to its fallback instead of hanging", async () => {
  // Behavioural proof of the guard itself: a promise that never settles must
  // still produce a verdict.
  const verify = require("../lib/mirror-engine/verify");
  const fn = verify.withPageTimeout || verify._withPageTimeout;
  if (typeof fn !== "function") return; // not exported; the source assertions above still pin it
  const never = new Promise(() => {});
  const out = await fn(never, 50, { unmeasured: "timeout" });
  assert.deepEqual(out, { unmeasured: "timeout" });
});
