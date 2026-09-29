"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { compileGenieContent } = require("../lib/line-adapters");
const { stagePageHubBuildPacket, canonicalJson } = require("../lib/pagehub-build-packet");

// Selection-only fixtures: they prove which staged Packet2 bytes reach the
// compiler. They are not business content and must never be certified.
const RECEIVED_AT = new Date("2026-09-29T00:00:00Z");

function stagedRow(id, name, url) {
  const snapshot = { version: "2.0", business: { businessName: name, domainUrl: url } };
  const staged = stagePageHubBuildPacket({}, snapshot, RECEIVED_AT);
  assert.equal(staged.status, "staged");
  return { prospect_id: id, business_name: name, current_website: url, record: staged.record };
}

test("each saved row compiles its own staged Packet2 and a foreign import fails closed", async () => {
  const rowA = stagedRow("p2-bind-row-a", "Acme A", "https://a.example");
  const rowB = stagedRow("p2-bind-row-b", "Acme B", "https://b.example");
  const calls = [];
  let persisted = 0;
  const deps = {
    env: { VERCEL_ENV: "production" },
    certificationKey: "test-only-packet2-line-certification-key",
    callIntakeGenie: async (prospect, options) => {
      calls.push({ prospect, options });
      return { ok: false, status: 422, error: "test_stop_after_capture" };
    },
    conditionalUpdate: async () => {
      persisted += 1;
      throw new Error("persistence must not run in a packet-selection test");
    },
  };

  const resultA = await compileGenieContent(rowA, deps);
  const resultB = await compileGenieContent(rowB, deps);
  assert.notEqual(resultA?.ok, true);
  assert.notEqual(resultB?.ok, true);
  assert.equal(calls.length, 2);

  for (const [i, row] of [rowA, rowB].entries()) {
    const { prospect, options } = calls[i];
    const staged = row.record.pagehub_build_packet;
    const expected = Buffer.from(canonicalJson(staged.snapshot), "utf8");
    assert.equal(prospect.prospect_id, row.prospect_id);
    assert.equal(options.packet2Import.snapshot_sha256, staged.snapshot_sha256);
    const decoded = Buffer.from(options.packet2Import.snapshot_base64, "base64");
    assert.equal(Buffer.compare(decoded, expected), 0);
  }
  assert.notEqual(calls[0].options.packet2Import.snapshot_sha256, calls[1].options.packet2Import.snapshot_sha256);

  const injected = await compileGenieContent(rowB, { ...deps, packet2Import: calls[0].options.packet2Import });
  assert.deepEqual(injected, { ok: false, retryable: false, reason: "packet2_import_staged_snapshot_mismatch" });
  assert.equal(calls.length, 2, "the compiler is never called with row A's packet for row B");
  assert.equal(persisted, 0);
});
