"use strict";

// PRODUCTION ROOT CAUSE, 2026-08-19: no site was ever produced because the
// render gate could not open a page.
//
//   render_error: page.goto: net::ERR_INSUFFICIENT_RESOURCES
//   first attempt failed: Target page, context or browser has been closed
//   route_render: non_200_paths:/=0
//
// The mirror deployed correctly, then failed to RENDER, so every path reported
// status 0, the build was "not revealable", the phase burned its full ~270s
// budget, deferred, retried and exhausted. Two causes, both pinned here:
//   1. the remote browser pool was 10 PER PASS while the queue worker and the
//      rescue cron both ran passes — ~20 concurrent sessions, i.e. starvation;
//   2. the Firecrawl session TTL (240s) expired UNDER an in-flight render,
//      because a legitimate mirror build runs to the ~270s mirror budget.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const chromium = require("../lib/serverless-chromium");
const source = fs.readFileSync(path.join(__dirname, "..", "lib", "serverless-chromium.js"), "utf8");

test("the remote browser pool defaults small enough to survive two concurrent passes", () => {
  assert.ok(
    chromium.DEFAULT_REMOTE_RENDER_CONCURRENCY <= 4,
    `remote render concurrency ${chromium.DEFAULT_REMOTE_RENDER_CONCURRENCY} starves the provider when the queue and cron both claim a wave`,
  );
  // The operator ceiling stays available for when this is proven healthy.
  assert.equal(chromium.MAX_REMOTE_RENDER_CONCURRENCY, 20);
});

test("the env override still bounds concurrency to the ceiling", () => {
  assert.equal(chromium.renderConcurrency("3", { FIRECRAWL_API_KEY: "k" }), 3);
  assert.equal(chromium.renderConcurrency("999", { FIRECRAWL_API_KEY: "k" }), 20);
  // Junk falls back to the (now safe) default rather than something unbounded.
  assert.equal(chromium.renderConcurrency("", { FIRECRAWL_API_KEY: "k" }), chromium.DEFAULT_REMOTE_RENDER_CONCURRENCY);
});

test("a remote session outlives the mirror build budget that borrowed it", () => {
  const ttl = Number((source.match(/ttl:\s*(\d+)/) || [])[1]);
  const activityTtl = Number((source.match(/activityTtl:\s*(\d+)/) || [])[1]);
  // The worker deadline is 282s in production and the mirror budget ~270s.
  assert.ok(ttl >= 300, `session ttl ${ttl}s expires under an in-flight render`);
  assert.ok(activityTtl >= 240, `activityTtl ${activityTtl}s reaps a session that is merely slow`);
});

test("the permit dead-man does not release a slot while its render can still run", () => {
  const hold = Number((source.match(/MAX_PERMIT_HOLD_MS\s*=\s*([\d_]+)/) || [])[1].replace(/_/g, ""));
  // Releasing before the 300s function ceiling hands the slot to another caller
  // while the first render is still executing — that is how the pool
  // over-subscribes itself.
  assert.ok(hold >= 280_000, `permit hold ${hold}ms releases while a render may still be running`);
  assert.ok(hold < 300_000, "a leaked permit must still be reclaimed before the function dies");
});
