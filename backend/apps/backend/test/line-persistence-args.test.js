"use strict";

// test/line-persistence-args.test.js
//
// upsertRow's signature is (table, ROW, conflictColumns). Both writes in
// api/admin/line.js had the row and the conflict column swapped, so each call
// POSTed the literal string "prospect_id" as the row body. Nothing threw: the
// send completed, the email went out, and proof_shots / client_id / report_url
// all persisted to nothing. Two separate defects tonight were really this one.
//
// Pinning the shape of the arguments is cheap; discovering this again from a
// blank Riley lookup is not.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "api", "admin", "line.js"), "utf8");

test("every prospect upsert call in the line passes an OBJECT as the row", () => {
  const calls = [...SOURCE.matchAll(/(?:upsertRow|writeProspect)\(\s*([A-Za-z_$][\w$]*|"[^"]+")\s*,\s*([^\s])/g)];
  assert.ok(calls.length >= 2, "expected the line to persist at least twice");
  for (const [, table, secondArg] of calls) {
    // The comment above each call spells the signature out as
    // "upsertRow(table, ROW, conflictColumns)" — prose, not a call site.
    if (table === "table") continue;
    assert.ok(
      secondArg.trim().startsWith("{"),
      `upsertRow(${table}, …) must take the ROW second, got: ${secondArg.trim().slice(0, 40)}`,
    );
  }
});

test("the conflict column is passed third, as a string", () => {
  const calls = [...SOURCE.matchAll(/(?:upsertRow|writeProspect)\([\s\S]{0,400}?\}\s*,\s*("(?:[^"]+)")\s*\)/g)];
  assert.ok(calls.length >= 2, "each persist must name its conflict column");
  for (const [, conflict] of calls) {
    assert.equal(conflict, '"prospect_id"');
  }
});
