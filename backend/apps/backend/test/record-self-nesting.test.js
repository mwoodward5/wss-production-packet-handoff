"use strict";

// test/record-self-nesting.test.js — A RECORD MUST NEVER CONTAIN A RECORD.
//
// Locks the fix for the defect that produced 224 MB of TOAST on a table holding
// 1.7 MB of useful data. prospectFromRow spreads the whole DB row (correctly —
// columns must beat stale JSON), so the object it returns still carries a
// `record` key. Every write path spread that object into the NEW record, so each
// save wrapped the entire prior blob one level deeper. 333 of 1,122 rows reached
// depth 6+, one at 21 MB, and the console's snapshot query burned 92.5% of all
// database time de-TOASTing it.
//
// The regression these tests guard is subtle: a single save looks fine. It is the
// SECOND and THIRD save that reveal it, which is why the round-trip test matters.

const test = require("node:test");
const assert = require("node:assert");

const { prospectFromRow, recordForPersist } = require("../lib/prospects");

test("recordForPersist strips the container keys and nothing else", () => {
  const out = recordForPersist({
    business_name: "Ace Fence",
    city: "Fort Worth",
    truth_packet: { facts: { name: "Ace Fence" } },
    record: { huge: "x".repeat(1000) },
    payload: { also: "huge" },
  });
  assert.strictEqual(out.record, undefined, "record survived");
  assert.strictEqual(out.payload, undefined, "payload survived");
  assert.strictEqual(out.business_name, "Ace Fence");
  assert.strictEqual(out.city, "Fort Worth");
  assert.deepStrictEqual(out.truth_packet, { facts: { name: "Ace Fence" } });
});

test("recordForPersist tolerates junk without throwing", () => {
  for (const bad of [null, undefined, "", 0, false, "a string", 42]) {
    assert.deepStrictEqual(recordForPersist(bad), {}, `threw or leaked on ${JSON.stringify(bad)}`);
  }
});

test("prospectFromRow still carries `record` — the fix must not change its contract", () => {
  // console-data.js reads prospect.record in two places, so narrowing this would
  // have a far wider blast radius than the bug justifies. The strip belongs at
  // the write sites, not here.
  const row = { prospect_id: "p1", business_name: "Ace", record: { note: "kept" } };
  const p = prospectFromRow(row);
  assert.ok(p.record, "prospectFromRow must still expose record to readers");
  assert.strictEqual(p.note, "kept", "embedded record is still flattened for readers");
});

test("THE REGRESSION: three consecutive saves must not nest", () => {
  // Reproduces the exact production merge shape: read row -> prospectFromRow ->
  // spread into a new record -> persist -> read back -> repeat.
  const save = (row, updates) => {
    const prospect = prospectFromRow(row);
    const record = row.record && typeof row.record === "object" ? row.record : {};
    const mergedRecord = { ...record, ...recordForPersist(prospect), ...updates };
    return { ...row, record: mergedRecord };
  };

  let row = { prospect_id: "p1", business_name: "Ace Fence", record: { seeded: true } };
  row = save(row, { status: "previewed" });
  row = save(row, { status: "packeted" });
  row = save(row, { status: "reported" });

  assert.strictEqual(row.record.record, undefined, "record nested itself");
  assert.strictEqual(row.record.payload, undefined, "payload nested itself");

  // Carry-forward still works — the fix must not lose state.
  assert.strictEqual(row.record.seeded, true, "original record state was dropped");
  assert.strictEqual(row.record.status, "reported", "latest update did not land");
  assert.strictEqual(row.record.business_name, "Ace Fence", "column value did not carry");

  // Depth check: serialise and confirm the key appears nowhere at any level.
  assert.ok(!JSON.stringify(row.record).includes('"record":'), "a nested record key exists somewhere");
});

test("the OLD merge shape demonstrably nested — proving this test can fail", () => {
  // Without recordForPersist, the same three saves nest three deep. If this ever
  // stops nesting, the test above has stopped proving anything.
  const badSave = (row, updates) => {
    const prospect = prospectFromRow(row);
    const record = row.record && typeof row.record === "object" ? row.record : {};
    return { ...row, record: { ...record, ...prospect, ...updates } };
  };
  let row = { prospect_id: "p1", business_name: "Ace", record: { seeded: true } };
  row = badSave(row, { status: "a" });
  row = badSave(row, { status: "b" });
  row = badSave(row, { status: "c" });
  assert.ok(row.record.record, "old shape should nest at depth 1");
  assert.ok(row.record.record.record, "old shape should nest at depth 2");
});

test("every persisted-record merge site imports the helper", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  // Only PERSISTED records matter. A raw `...prospect` inside an in-memory
  // response object is fine — it is never written back as a record, and flagging
  // it produced false positives that would get this guard deleted.
  //
  // So: find every object literal that is assigned to a `record` key (or to a
  // variable whose name ends in "Record"), and assert none of them spreads a
  // row-derived object raw. This is the shape that actually nests.
  const sites = ["lib/full-run.js", "api/webhooks/siteforge.js"];
  const ROW_DERIVED = /\.\.\.(prospect|existing|buildProspect|packetProspect)\s*[,}]/;

  for (const rel of sites) {
    const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    assert.ok(/recordForPersist/.test(src), `${rel} does not import recordForPersist`);

    const lines = src.split(/\r?\n/);
    const offenders = [];
    for (let i = 0; i < lines.length; i += 1) {
      // Opens a persisted-record literal?
      if (!/(^|\s)record:\s*\{\s*$/.test(lines[i]) && !/const \w*[Rr]ecord = \{\s*$/.test(lines[i])) continue;
      // Scan its body by brace depth rather than a fixed character budget.
      let depth = 1;
      for (let j = i + 1; j < lines.length && depth > 0; j += 1) {
        depth += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
        if (depth <= 0) break;
        if (ROW_DERIVED.test(lines[j])) offenders.push(`${rel}:${j + 1}  ${lines[j].trim()}`);
      }
    }
    assert.deepStrictEqual(offenders, [],
      `persisted record(s) still spread a row-derived object raw:\n  ${offenders.join("\n  ")}`);
  }
});
