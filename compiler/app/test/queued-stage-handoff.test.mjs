import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("a signed handoff advances when Blob briefly returns the queued predecessor", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-queued-handoff-${process.pid}`))};
    const freshIso = new Date().toISOString();
    let remoteJob = {
      id: "queued-handoff", staged: true, status: "queued", current_stage: "render", current_phase: "waiting", next_stage: "render",
      advance_token: "advance-secret", advance_request_id: "req-render", active_stage: null, active_stage_request_id: null,
      advance_requested_at: freshIso, updated_at: freshIso, advance_attempts: 4, stage_payload: { token: "queued-handoff-preview" },
    };
    const marker = {
      job_id: remoteJob.id, from_stage: "render", to_stage: "capture_desktop",
      from_request_id: "req-render", from_attempt: 4, to_request_id: "req-desktop", to_attempt: 5,
      reason: "stage_completed", at: freshIso,
    };
    let claimedSuccessor = false;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url); const decoded = decodeURIComponent(target);
      if (options.method === "PUT") {
        if (decoded.includes("sf/jobs/queued-handoff.json")) {
          remoteJob = JSON.parse(String(options.body));
          if (remoteJob.status === "running" && remoteJob.current_stage === "capture_desktop" && remoteJob.active_stage_request_id === "req-desktop") claimedSuccessor = true;
        }
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/queued-handoff.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      if (target.includes("/sf/jobs/queued-handoff.handoff.")) return new Response(JSON.stringify(marker), { status: 200 });
      if (target.includes("/sf/jobs/queued-handoff.json")) return new Response(JSON.stringify(remoteJob), { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    await engine.runDurableTryStage("queued-handoff", {
      suppliedToken: "advance-secret", baseUrl: "https://siteforge.example", requestedStage: "capture_desktop",
      requestId: "req-desktop", advanceAttempt: 5, reclaimFromRequestId: "req-render",
    });
    if (!claimedSuccessor) process.exit(2);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
