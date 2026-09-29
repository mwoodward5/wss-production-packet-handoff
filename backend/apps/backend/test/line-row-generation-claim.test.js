"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { ROW_TABLE, createLinePersistence } = require("../lib/line-persistence");

test("an exact row delivery cannot lease a newer durable generation", async () => {
  const selections = [];
  let updates = 0;
  const persistence = createLinePersistence({
    now: () => new Date("2026-08-24T12:00:00.000Z"),
    randomUUID: () => "00000000-0000-4000-8000-000000000001",
    selectRows: async (table, selection) => {
      selections.push({ table, selection });
      // Deliberately behave like a loose adapter and return a newer row even
      // though the caller requested generation 4. The local guard must still
      // refuse to lease it.
      return {
        mode: "live_select",
        rows: [{
          batch_id: "batch-generation",
          row_id: "batch-generation:0",
          row_index: 0,
          prospect_id: "opaque-prospect",
          status: "qualified",
          version: 5,
          lease_token: null,
          lease_expires_at: null,
          attempt_count: 0,
        }],
      };
    },
    conditionalUpdate: async () => {
      updates += 1;
      return { ok: true, mode: "live_update", updated: true, rows: [] };
    },
  });

  const claimed = await persistence.claimRows({
    batchId: "batch-generation",
    rowId: "batch-generation:0",
    expectedVersion: 4,
    workerId: "delivery-1",
    limit: 1,
    statuses: ["qualified"],
  });

  assert.equal(claimed.ok, true);
  assert.deepEqual(claimed.rows, []);
  assert.equal(updates, 0);
  assert.equal(selections.length, 1);
  assert.equal(selections[0].table, ROW_TABLE);
  assert.match(selections[0].selection.filter, /(?:^|&)version=eq\.4(?:&|$)/);
});
