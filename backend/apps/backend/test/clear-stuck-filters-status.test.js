"use strict";

// The operator's "Stop this run" reported "0 cleared" while a batch kept running
// (measured in production 2026-08-19, twice). TWO independent defects:
//
//  1. clear_stuck passed `status: "in.(...)"` to store.selectRows, which honors
//     ONLY select/order/limit/filter — the predicate was silently dropped and an
//     arbitrary unordered page of rows was read.
//  2. It then gated the halt loop on `stuck.ok`, but selectRows NEVER returns an
//     `ok` field: success is { mode:"live_select", table, rows }. So the loop was
//     skipped every single time, whatever the query returned.
//
// Also: 'pending' is not in the table's status CHECK constraint
// (supabase/line-batches.sql) — the real non-terminal states are building/running.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "api", "admin", "line.js"), "utf8");
const start = source.indexOf('action === "clear_stuck"');
assert.ok(start > 0, "clear_stuck handler must exist");
// Scope to the handler by its structural end, not a byte count: a CRLF
// checkout inflates every line by one byte and a fixed window slid the
// asserted phrases out of scope (measured in a worktree, 2026-08-20).
const nextAction = source.indexOf("action ===", start + 10);
const body = source.slice(start, nextAction > 0 ? nextAction : source.length);

test("clear_stuck filters by status through the supported `filter` option", () => {
  assert.match(body, /filter:\s*"status=in\.\(building,running\)"/,
    "status must be passed via `filter`; a bare `status:` option is dropped by selectRows");
  assert.doesNotMatch(body, /\n\s*status:\s*"in\.\([^"]*pending/,
    "'pending' is not a valid batch status in the schema");
});

test("clear_stuck reads the NEWEST batches so the operator's live run is covered", () => {
  assert.match(body, /order:\s*"updated_at\.desc"/,
    "without ordering, an arbitrary page of rows can exclude the live batch");
});

test("clear_stuck does NOT gate the halt loop on a non-existent `ok` field", () => {
  assert.doesNotMatch(body, /stuck\s*&&\s*stuck\.ok/,
    "selectRows never returns `ok` on success — gating on it skips the halt loop entirely");
  assert.match(body, /Array\.isArray\(stuck\.rows\)/,
    "gate on the shape selectRows actually returns");
});

test("clear_stuck counts only rows it really halted, and still guards the write", () => {
  assert.match(body, /status:\s*"in\.\(building,running\)"/,
    "the conditional write guard must remain so settled work is never touched");
  assert.match(body, /r\.ok === true && r\.updated === true/,
    "conditionalUpdate returns ok:true with updated:false when nothing matched");
  assert.match(body, /halt_reason:\s*"owner_cleared_stuck_batch"/);
});
