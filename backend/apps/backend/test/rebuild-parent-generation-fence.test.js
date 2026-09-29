"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRebuildJobs } = require("../lib/rebuild-jobs");

function harness(loadLineBatch) {
  const jobs = new Map();
  const prospects = new Map([[
    "prospect-1",
    { prospect_id: "prospect-1", business_name: "Example", industry: "roofing", updated_at: "2026-08-29T12:00:00.000Z", record: {} },
  ]]);
  const writes = [];
  const service = createRebuildJobs({
    now: () => new Date("2026-08-29T12:00:00.000Z"),
    loadLineBatch,
    insertRow: async (_table, row) => {
      jobs.set(row.job_id, structuredClone(row));
      return { ok: true, mode: "live_write" };
    },
    select: async (table, query = "") => {
      const params = new URLSearchParams(String(query).replace(/^\?/, ""));
      if (table === "ghost_agency_rebuild_jobs") {
        const id = String(params.get("job_id") || "").replace(/^eq\./, "");
        return { ok: true, data: id && jobs.has(id) ? [structuredClone(jobs.get(id))] : [] };
      }
      const id = String(params.get("prospect_id") || "").replace(/^eq\./, "");
      return { ok: true, data: prospects.has(id) ? [structuredClone(prospects.get(id))] : [] };
    },
    conditionalUpdate: async (table, _column, id, guards, patch) => {
      writes.push({ table, id, guards, patch: structuredClone(patch) });
      if (table !== "ghost_agency_rebuild_jobs") return { ok: true, updated: true, rows: [] };
      const current = jobs.get(id);
      if (!current || (guards.status && current.status !== String(guards.status).replace(/^eq\./, ""))) {
        return { ok: true, updated: false, rows: [] };
      }
      if (guards["result->>claim"]
        && String(current.result?.claim || "") !== String(guards["result->>claim"]).replace(/^eq\./, "")) {
        return { ok: true, updated: false, rows: [] };
      }
      const next = { ...current, ...structuredClone(patch) };
      jobs.set(id, next);
      return { ok: true, updated: true, rows: [structuredClone(next)] };
    },
    recordEvent: async () => ({ ok: true }),
    captureLineEmailAssets: async () => { throw new Error("must_not_capture"); },
    wakeLineForCompletedHero: async () => { throw new Error("must_not_wake"); },
  });
  return { service, jobs, writes };
}

function waitingBatch(status = "building") {
  return {
    batchId: "line-1",
    status,
    rows: [{
      rowId: "line-1:0",
      prospectId: "prospect-1",
      status: "qualified",
      heroRemaster: { required: true, pending: true, jobId: "hero-1" },
    }],
  };
}

async function enqueueLineRebuild(h) {
  return h.service.enqueueRebuildJob({
    prospectId: "prospect-1",
    lineHandle: { batchId: "line-1", rowId: "line-1:0" },
    heroJobId: "hero-1",
    heroClipSha256: "a".repeat(64),
  });
}

test("halted or superseded parent retires a queued rebuild before Mirror", async () => {
  for (const batch of [waitingBatch("halted"), { ...waitingBatch(), rows: [] }]) {
    const h = harness(async () => ({ ok: true, batch }));
    const queued = await enqueueLineRebuild(h);
    let mirrorCalls = 0;
    const result = await h.service.runRebuildJob(queued.jobId, {
      mirrorProspect: async () => { mirrorCalls += 1; return { ok: true }; },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /^parent_line_(?:batch_halted|generation_superseded)$/);
    assert.equal(mirrorCalls, 0);
    assert.equal(h.jobs.get(queued.jobId).status, "failed");
  }
});

test("a parent halted during Mirror cannot publish proof or wake its old row", async () => {
  let reads = 0;
  const h = harness(async () => ({ ok: true, batch: reads++ === 0 ? waitingBatch() : waitingBatch("halted") }));
  const queued = await enqueueLineRebuild(h);
  const result = await h.service.runRebuildJob(queued.jobId, {
    mirrorProspect: async () => ({ ok: true, previewUrl: "https://preview.example", buildHash: "build-1" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "parent_line_batch_halted");
  assert.equal(h.jobs.get(queued.jobId).status, "failed");
  assert.equal(h.writes.some((entry) => entry.table === "ghost_agency_prospects"), false);
});
