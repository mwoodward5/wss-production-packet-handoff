"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BROWSER_SCRIPT,
  rowSignature,
  diffRows,
  reconcilePicks,
  nextPollDelay,
  shouldRefresh,
  describeFreshness
} = require("../lib/gallery-live-refresh");

test("rowSignature is stable across top-level key reordering", function () {
  assert.equal(
    rowSignature({ prospectId: "p1", status: "building", city: "Tulsa" }),
    rowSignature({ city: "Tulsa", status: "building", prospectId: "p1" })
  );
});

test("rowSignature is stable across nested key reordering", function () {
  assert.equal(
    rowSignature({ prospectId: "p1", meta: { b: 2, a: 1 } }),
    rowSignature({ meta: { a: 1, b: 2 }, prospectId: "p1" })
  );
});

test("rowSignature distinguishes array order", function () {
  assert.notEqual(
    rowSignature({ prospectId: "p1", values: [1, 2] }),
    rowSignature({ prospectId: "p1", values: [2, 1] })
  );
});

test("rowSignature never throws on null undefined or missing-id rows", function () {
  assert.doesNotThrow(function () {
    rowSignature(null);
    rowSignature(undefined);
    rowSignature({ status: "live" });
  });
  assert.equal(rowSignature(null), "refusal:malformed_row");
  assert.equal(rowSignature(undefined), "refusal:malformed_row");
  assert.match(rowSignature({ status: "live" }), /^\{/);
});

test("rowSignature survives circular malformed data", function () {
  var row = { prospectId: "p1" };
  row.self = row;
  assert.doesNotThrow(function () {
    rowSignature(row);
  });
  assert.match(rowSignature(row), /Circular/);
});

test("diffRows reports unchanged payload as all unchanged and zero changed", function () {
  var prev = [
    { prospectId: "a", status: "building" },
    { prospectId: "b", status: "live" }
  ];
  var next = [
    { status: "building", prospectId: "a" },
    { status: "live", prospectId: "b" }
  ];
  assert.deepEqual(diffRows(prev, next), {
    added: [],
    changed: [],
    removed: [],
    unchanged: ["a", "b"]
  });
});

test("diffRows reports building to live as changed", function () {
  assert.deepEqual(
    diffRows(
      [{ prospectId: "a", status: "building" }],
      [{ prospectId: "a", status: "live" }]
    ),
    { added: [], changed: ["a"], removed: [], unchanged: [] }
  );
});

test("diffRows reports a brand-new row as added", function () {
  assert.deepEqual(
    diffRows(
      [{ prospectId: "a" }],
      [{ prospectId: "a" }, { prospectId: "b" }]
    ),
    { added: ["b"], changed: [], removed: [], unchanged: ["a"] }
  );
});

test("diffRows reports a vanished row as removed", function () {
  assert.deepEqual(
    diffRows(
      [{ prospectId: "a" }, { prospectId: "b" }],
      [{ prospectId: "b" }]
    ),
    { added: [], changed: [], removed: ["a"], unchanged: ["b"] }
  );
});

test("diffRows names missing row ids instead of throwing", function () {
  var diff = diffRows([{ prospectId: "a" }], [{ status: "live" }]);
  assert.equal(diff.refusal, "row_id_missing");
});

test("reconcilePicks preserves selections whose rows remain", function () {
  assert.deepEqual(
    reconcilePicks(
      { a: true, b: true },
      [{ prospectId: "a" }, { prospectId: "b" }]
    ),
    { picked: { a: true, b: true }, dropped: [] }
  );
});

test("reconcilePicks drops and reports a pick whose row vanished", function () {
  assert.deepEqual(
    reconcilePicks(
      { a: true, b: true },
      [{ prospectId: "b" }]
    ),
    { picked: { b: true }, dropped: ["a"] }
  );
});

test("reconcilePicks ignores false entries", function () {
  assert.deepEqual(
    reconcilePicks(
      { a: false, b: true },
      [{ prospectId: "a" }, { prospectId: "b" }]
    ),
    { picked: { b: true }, dropped: [] }
  );
});

test("shouldRefresh declines with a named reason while a dialog is open", function () {
  assert.deepEqual(
    shouldRefresh({
      modalOpen: false,
      dialogOpen: true,
      drawerOpen: false,
      hidden: false,
      inFlight: false
    }),
    { ok: false, reason: "dialog_open" }
  );
});

test("shouldRefresh declines with a named reason while hidden", function () {
  assert.deepEqual(
    shouldRefresh({
      modalOpen: false,
      dialogOpen: false,
      drawerOpen: false,
      hidden: true,
      inFlight: false
    }),
    { ok: false, reason: "tab_hidden" }
  );
});

test("shouldRefresh declines with a named reason while a fetch is in flight", function () {
  assert.deepEqual(
    shouldRefresh({
      modalOpen: false,
      dialogOpen: false,
      drawerOpen: false,
      hidden: false,
      inFlight: true
    }),
    { ok: false, reason: "fetch_in_flight" }
  );
});

test("shouldRefresh declines while the details drawer is open", function () {
  assert.deepEqual(
    shouldRefresh({
      modalOpen: false,
      dialogOpen: false,
      drawerOpen: true,
      hidden: false,
      inFlight: false
    }),
    { ok: false, reason: "drawer_open" }
  );
});

test("shouldRefresh returns ready when all guards are clear", function () {
  assert.deepEqual(
    shouldRefresh({
      modalOpen: false,
      dialogOpen: false,
      drawerOpen: false,
      hidden: false,
      inFlight: false
    }),
    { ok: true, reason: "ready" }
  );
});

test("nextPollDelay resets to base after success", function () {
  assert.equal(
    nextPollDelay({
      consecutiveFailures: 0,
      hidden: false,
      baseMs: 15000,
      maxMs: 300000
    }),
    15000
  );
});

test("nextPollDelay grows on consecutive failures", function () {
  assert.equal(
    nextPollDelay({
      consecutiveFailures: 1,
      hidden: false,
      baseMs: 15000,
      maxMs: 300000
    }),
    30000
  );
  assert.equal(
    nextPollDelay({
      consecutiveFailures: 2,
      hidden: false,
      baseMs: 15000,
      maxMs: 300000
    }),
    60000
  );
  assert.equal(
    nextPollDelay({
      consecutiveFailures: 3,
      hidden: false,
      baseMs: 15000,
      maxMs: 300000
    }),
    120000
  );
});

test("nextPollDelay never exceeds the ceiling", function () {
  assert.equal(
    nextPollDelay({
      consecutiveFailures: 99,
      hidden: false,
      baseMs: 15000,
      maxMs: 300000
    }),
    300000
  );
});

test("nextPollDelay returns null while hidden", function () {
  assert.equal(
    nextPollDelay({
      consecutiveFailures: 0,
      hidden: true,
      baseMs: 15000,
      maxMs: 300000
    }),
    null
  );
});

test("describeFreshness says just now for a fresh load", function () {
  assert.equal(
    describeFreshness(100000, 103000),
    "updated just now"
  );
});

test("describeFreshness counts seconds", function () {
  assert.equal(
    describeFreshness(100000, 112000),
    "updated 12 seconds ago"
  );
});

test("describeFreshness counts minutes", function () {
  assert.equal(
    describeFreshness(100000, 220000),
    "updated 2 minutes ago"
  );
});

test("describeFreshness handles a future timestamp as clock skew sanely", function () {
  assert.equal(
    describeFreshness(110000, 100000),
    "updated just now"
  );
});

test("describeFreshness names background pause", function () {
  assert.equal(
    describeFreshness(
      { at: 100000, pausedReason: "tab_in_background" },
      200000
    ),
    "paused — tab in background"
  );
});

test("browser script uses recursive scheduling rather than setInterval", function () {
  assert.equal(BROWSER_SCRIPT.includes("setInterval"), false);
  assert.equal(BROWSER_SCRIPT.includes("setTimeout"), true);
});

test("browser script is safe to embed inside the existing template literal", function () {
  assert.equal(BROWSER_SCRIPT.includes("`"), false);
  assert.equal(BROWSER_SCRIPT.includes("${"), false);
  assert.equal(BROWSER_SCRIPT.includes("=>"), false);
});

test("browser script refresh lane is GET-only and contains no send endpoint", function () {
  assert.match(
    BROWSER_SCRIPT,
    /api\('\/api\/admin\/gallery-data'\)/
  );
  assert.equal(BROWSER_SCRIPT.includes("send-mirror-proof"), false);
  assert.equal(BROWSER_SCRIPT.includes("method:'POST'"), false);
  assert.equal(BROWSER_SCRIPT.includes('method:"POST"'), false);
});

// ---------------------------------------------------------------------------
// Regression: production paused with "refresh refused: duplicate_row_id".
//
// The browser lane reconciles picks against nextBuilds.concat(nextClients).
// A prospect that is both a customer and a build appears in BOTH lists, so the
// concatenation legitimately repeats an id. Treating that as corruption paused
// the live refresh permanently on real data — the exact staleness this module
// exists to end. First occurrence wins, matching the page's own operator-nav
// dedupe of the same two lists.
// ---------------------------------------------------------------------------

test("a prospect in both builds and clients does not refuse the refresh", () => {
  const shared = { prospectId: "p1", businessName: "Shared Co", status: "mirrored" };
  const builds = [shared, { prospectId: "p2", businessName: "B", status: "mirrored" }];
  const clients = [shared];
  const merged = builds.concat(clients);

  const diff = diffRows([], merged);
  assert.equal(diff.refusal || "", "", "an overlapping prospect is not a malformed payload");
  assert.deepEqual(diff.added.sort(), ["p1", "p2"], "the shared row is counted once, not twice");

  const reconciled = reconcilePicks({ p1: true }, merged);
  assert.equal(reconciled.refusal || "", "");
  assert.equal(reconciled.picked.p1, true, "a pick on the shared row survives the merge");
  assert.deepEqual(reconciled.dropped, [], "nothing is dropped out from under the operator");
});

test("genuine malformed payloads still refuse by name", () => {
  assert.equal(diffRows([], [{ businessName: "no id" }]).refusal, "row_id_missing");
  assert.equal(diffRows([], "not an array").refusal, "malformed_rows");
});

test("the serialized browser lane carries the same dedupe as the tested helper", () => {
  // BROWSER_SCRIPT embeds indexRows via .toString(), so there is ONE
  // implementation. Assert that it is genuinely the serialized function and not
  // a hand-copied twin that could drift away from what these tests cover.
  assert.ok(BROWSER_SCRIPT.includes("function indexRows"),
    "the browser lane must embed the real helper, not a duplicate of it");
  assert.ok(!/result\.refusal\s*=\s*"duplicate_row_id"/.test(BROWSER_SCRIPT),
    "the shipped browser lane must not refuse on a repeated id");
});
