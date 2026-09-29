"use strict";

// Finding 6 + 7: a transient 5xx while probing an already-created/live
// deployment must be retryable (the next bounded attempt re-probes the SAME
// tagged deployment and ships it), instead of terminating a good build — and
// its ~$1 deploy — with the retry budget unspent. Deterministic failures stay
// terminal.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isMirrorDeadline } = require("../lib/line-mirror-resume");

test("transient resume/fresh probe 5xx is retryable", () => {
  // Separator is an em-dash, matching the engine's err() reason shape.
  assert.equal(isMirrorDeadline("vercel_error (status 502) — resume_probe_retryable:http_503"), true);
  assert.equal(isMirrorDeadline("vercel_error (status 502) — fresh_probe_retryable:http_429"), true);
  // The pre-existing deadline dialect still matches.
  assert.equal(isMirrorDeadline("mirror_deadline (status 504) — caller_abort_or_checkpoint_reserve"), true);
});

test("deterministic deploy failures stay terminal (NOT retryable)", () => {
  assert.equal(isMirrorDeadline("vercel_error (status 502) — resume_refused:deployment_wrong_project"), false);
  assert.equal(isMirrorDeadline("vercel_error (status 502) — resume_refused:deployment_metadata_ambiguous"), false);
  assert.equal(isMirrorDeadline("resume_unavailable"), false);
  assert.equal(isMirrorDeadline("deployed_verification_failed"), false);
  assert.equal(isMirrorDeadline("bytes_differ"), false);
  assert.equal(isMirrorDeadline(""), false);
});
