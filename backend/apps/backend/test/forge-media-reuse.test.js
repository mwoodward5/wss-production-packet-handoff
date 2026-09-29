"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const forge = require("../lib/forge.js");

// REGRESSION LOCK (2026-07-29). Owner directive: ambiance hero videos are
// generated ONCE and reused forever. They are deliberately generic — no people,
// no signage, nothing identifying a business — so one clip serves every client
// in a vertical.
//
// media_submit used to call Veo for EVERY site. That is the largest avoidable
// cost in the pipeline (~$0.60/render; ~$18k/month at 1000 sites/day for
// interchangeable footage) and it is what left a real job sitting in media_poll
// for half an hour, blocking a customer's mirror.

test("a donor that ships a hero video needs no generation at all", () => {
  // Both roofing donors carry their own clip; the answer is already on disk.
  assert.match(forge.donorHeroVideo("roofing-riseabove"), /^media\/hero-sky\.mp4$/);
  assert.match(forge.donorHeroVideo("roofing-tekline"), /^media\/hero-video\.mp4$/);
});

test("a donor without a hero reports none, so the vertical cache is consulted", () => {
  assert.equal(forge.donorHeroVideo("plumbing-pressure-lens"), "");
  assert.equal(forge.donorHeroVideo("tree-care-dark"), "");
});

test("an unknown donor never throws — a missing dir must not break a build", () => {
  assert.equal(forge.donorHeroVideo("does-not-exist"), "");
  assert.equal(forge.donorHeroVideo(""), "");
});

test("media_submit prefers donor hero, then vertical cache, and only then Veo", () => {
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "api", "admin", "forge-jobs.js"),
    "utf8",
  );
  // order matters: the two free answers must be checked BEFORE any paid render
  const donorAt = src.indexOf("forge.donorHeroVideo(");
  const cacheAt = src.indexOf("existingAmbianceAsset(");
  const veoAt = src.indexOf("forge.veoSubmit(");
  assert.ok(donorAt > 0 && cacheAt > 0 && veoAt > 0, "all three paths must exist");
  assert.ok(donorAt < cacheAt, "donor hero must be checked before the vertical cache");
  assert.ok(cacheAt < veoAt, "the vertical cache must be checked before paying for a render");
});

test("media_poll cannot hang forever — it has a wall-clock deadline", () => {
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "api", "admin", "forge-jobs.js"),
    "utf8",
  );
  // A poll COUNTER alone is not enough: in production the counter froze at 2
  // across 28 advances, so the 20-poll bail-out could never fire and the job
  // sat in media_poll indefinitely. Elapsed time cannot be lost the same way.
  assert.match(src, /veoStartedAt/, "the submit stage must stamp a start time");
  assert.match(src, /elapsedMs/, "media_poll must measure elapsed wall-clock time");
  assert.match(src, /elapsedMs > 10 \* 60 \* 1000/, "and bail out on it");
});
