import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripUnsupportedReviewClaims, withJobStage } from "../lib/engine-adapter.mjs";
import { deriveFacts, normalizeInput } from "../lib/intake-genie-core.mjs";
import { sanitizeSourceAssets } from "../lib/source-intake.mjs";

const PACIFIC_COAST_PROMPT = "My business is called Pacific Coast Auto Detailing. We offer mobile auto detailing services in Mission Viejo and all of South Orange County, CA. Services include full interior & exterior detail, ceramic coating, paint correction, and fleet packages. We are a 5-star rated business with over 200 Google reviews. Our phone is 949-555-0192 and our website is pacificcoastautodetail.com.";

test("exact Pacific Coast prompt drops unsupported rating and review-count claims", () => {
  const cleaned = stripUnsupportedReviewClaims(PACIFIC_COAST_PROMPT);
  assert.doesNotMatch(cleaned, /5-star|200 Google reviews/i);
  assert.match(cleaned, /Pacific Coast Auto Detailing/);
  assert.match(cleaned, /ceramic coating/);
  assert.match(cleaned, /949-555-0192/);
});

test("verified review claims remain available to sourced intake", () => {
  assert.equal(stripUnsupportedReviewClaims(PACIFIC_COAST_PROMPT, { verified: true }), PACIFIC_COAST_PROMPT);
});

test("exact Pacific Coast prompt keeps the business identity, location, trade, phone, website, and services", () => {
  const input = normalizeInput({ prompt: stripUnsupportedReviewClaims(PACIFIC_COAST_PROMPT), build_preview: false });
  const { facts } = deriveFacts(input);
  assert.equal(facts.name, "Pacific Coast Auto Detailing");
  assert.equal(facts.city, "Mission Viejo");
  assert.equal(facts.state, "CA");
  assert.equal(facts.category, "auto detailing");
  assert.equal(facts.phone, "");
  assert.equal(facts.website, "https://pacificcoastautodetail.com/");
  assert.deepEqual(facts.services.slice(0, 4), ["full interior & exterior detail", "ceramic coating", "paint correction", "fleet packages"]);
});

test("placeholder phones and undefined scraper assets never become public proof", () => {
  const input = normalizeInput({ prompt: PACIFIC_COAST_PROMPT, build_preview: false });
  assert.equal(deriveFacts(input).facts.phone, "");
  assert.deepEqual(sanitizeSourceAssets([{ kind: "logo", url: "https://example.com/undefined", approved: true }]), []);
});

test("job stages end with a retryable terminal timeout", async () => {
  await assert.rejects(
    withJobStage("missing-test-job", "qc", () => new Promise(() => {}), 10),
    (error) => error.code === "stage_timeout" && error.stage === "qc" && error.retryable === true,
  );
});

test("serverless job lookup reads a dedicated durable record when process memory is empty", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-job-store-test-${process.pid}`))};
    globalThis.fetch = async (url, options = {}) => {
      if (options.method === "PUT") return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/local.json" }), { status: 200 });
      if (String(url).includes("/sf/jobs/remote-job.json")) return new Response(JSON.stringify({ id: "remote-job", correlation_id: "remote-job", status: "running", current_stage: "qc", updated_at: "2020-01-01T00:00:00.000Z" }), { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const local = engine.createJob("try");
    await engine.persistJobState(local.id);
    const remote = await engine.getDurableJob("remote-job");
    if (remote?.status !== "timed_out" || remote?.error_code !== "job_stale_timeout" || remote?.retryable !== true) process.exit(2);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("serverless public intake uses durable fan-out stages instead of one long capture invocation", () => {
  const intake = readFileSync(new URL("../lib/intake-genie.mjs", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const engine = readFileSync(new URL("../lib/engine-adapter.mjs", import.meta.url), "utf8");
  assert.match(intake, /Engine\.SERVERLESS\s*&&\s*!options\.awaitPreview\s*\?\s*Engine\.startTryOnStaged/);
  assert.match(server, /seg\[3\]\s*===\s*"advance"/);
  assert.match(engine, /capture_desktop/);
  assert.match(engine, /capture_mobile/);
  assert.match(engine, /finalizeScreenshotManifest/);
});

test("serverless stage delivery returns promptly while waitUntil owns exactly one successor request", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    let fetchCalls = 0;
    const backgroundTasks = [];
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Promise(() => {});
    };
    globalThis.__siteforgeWaitUntil = (task) => backgroundTasks.push(task);
    const engine = await import(${JSON.stringify(engineUrl)});
    const startedAt = Date.now();
    const scheduled = await engine.postDurableJobAdvance(
      "prompt-handoff",
      "https://siteforge.example",
      "capture_desktop",
      "req-desktop",
      "signed-token",
      2,
      "req-render",
      '"lease-etag"',
      false,
    );
    const elapsedMs = Date.now() - startedAt;
    if (scheduled !== true) process.exit(2);
    if (fetchCalls !== 1 || backgroundTasks.length !== 1) process.exit(3);
    if (elapsedMs > 100) process.exit(4);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("serverless background delivery preserves a rejected handoff as a clean deferred outcome", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    let fetchCalls = 0;
    const backgroundTasks = [];
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ error: "loop" }), {
        status: 508,
        headers: { "content-type": "application/json" },
      });
    };
    globalThis.__siteforgeWaitUntil = (task) => backgroundTasks.push(task);
    const engine = await import(${JSON.stringify(engineUrl)});
    const deliveryState = {};
    const scheduled = await engine.postDurableJobAdvance(
      "deferred-handoff",
      "https://siteforge.example",
      "capture_mobile",
      "req-mobile",
      "signed-token",
      3,
      "req-desktop",
      '"lease-etag"',
      false,
      deliveryState,
    );
    if (scheduled !== true || fetchCalls !== 1 || backgroundTasks.length !== 1) process.exit(2);
    const delivered = await backgroundTasks[0];
    if (delivered !== false) process.exit(3);
    if (deliveryState.lastStatus !== 508 || deliveryState.loopDetected !== true) process.exit(4);
    globalThis.__siteforgeWaitUntil = () => { throw new Error("adapter unavailable"); };
    const fallbackState = {};
    const fallback = await engine.postDurableJobAdvance(
      "waituntil-fallback",
      "https://siteforge.example",
      "capture_desktop",
      "req-fallback",
      "signed-token",
      2,
      "req-render",
      '"lease-etag"',
      false,
      fallbackState,
    );
    if (fallback !== false || fetchCalls !== 2) process.exit(5);
    if (fallbackState.lastStatus !== 508 || fallbackState.loopDetected !== true) process.exit(6);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("rejected background delivery CAS-expires only its exact queued owner", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_store_mock";
    process.env.SITEFORGE_ADVANCE_LEASE_MS = "1000";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-deferred-owner-${process.pid}`))};
    const freshIso = new Date().toISOString();
    let remoteJob = {
      id: "deferred-owner", staged: true, status: "queued", current_stage: "capture_desktop",
      current_phase: "waiting", next_stage: "capture_desktop", advance_token: "advance-secret",
      advance_request_id: "req-owned", advance_requested_stage: "capture_desktop",
      advance_requested_at: freshIso, advance_attempts: 2, active_stage: null,
      active_stage_request_id: null, updated_at: freshIso,
      stage_payload: { token: "deferred-owner-preview" },
    };
    let conditionalWrites = 0;
    let rejectConditionalWrite = false;
    const backgroundTasks = [];
    globalThis.__siteforgeWaitUntil = (task) => backgroundTasks.push(task);
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      const method = options.method || "GET";
      if (method === "POST" && target.includes("/api/jobs/deferred-owner/advance")) {
        return new Response(JSON.stringify({ error: "loop" }), {
          status: 508,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && target.includes("vercel.com/api/blob?") && decoded.includes("url=sf/jobs/deferred-owner.json")) {
        return new Response(JSON.stringify({
          pathname: "sf/jobs/deferred-owner.json",
          url: "https://mock.private.blob.vercel-storage.com/sf/jobs/deferred-owner.json",
          etag: '"etag-current"',
        }), { status: 200 });
      }
      if (method === "GET" && target.includes("mock.private.blob.vercel-storage.com/sf/jobs/deferred-owner.json")) {
        return new Response(JSON.stringify(remoteJob), { status: 200, headers: { etag: '"etag-current"' } });
      }
      if (method === "PUT" && decoded.includes("pathname=sf/jobs/deferred-owner.json") && options.headers?.["x-if-match"]) {
        conditionalWrites += 1;
        if (rejectConditionalWrite) return new Response("conflict", { status: 412 });
        remoteJob = JSON.parse(String(options.body));
        return new Response(JSON.stringify({
          url: "https://mock.private.blob.vercel-storage.com/sf/jobs/deferred-owner.json",
          etag: '"etag-next"',
        }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const deliver = async (requestId, attempt) => {
      const before = backgroundTasks.length;
      const scheduled = await engine.postDurableJobAdvance(
        "deferred-owner",
        "https://siteforge.example",
        "capture_desktop",
        requestId,
        "advance-secret",
        attempt,
        "req-render",
        '"etag-current"',
        false,
        {},
      );
      if (scheduled !== true || backgroundTasks.length !== before + 1) process.exit(2);
      const delivered = await backgroundTasks.at(-1);
      if (delivered !== false) process.exit(3);
    };

    await deliver("req-owned", 2);
    if (conditionalWrites !== 1) process.exit(4);
    if (Date.now() - Date.parse(remoteJob.advance_requested_at) < 1_500) process.exit(5);
    if (remoteJob.last_stage_delivery_deferred?.status !== 508) process.exit(6);

    remoteJob = {
      ...remoteJob,
      advance_request_id: "req-newer",
      advance_attempts: 3,
      advance_requested_at: new Date().toISOString(),
    };
    await deliver("req-owned", 2);
    if (conditionalWrites !== 1 || remoteJob.advance_request_id !== "req-newer") process.exit(7);

    remoteJob = {
      ...remoteJob,
      advance_request_id: "req-write-fails",
      advance_attempts: 4,
      advance_requested_at: new Date().toISOString(),
    };
    rejectConditionalWrite = true;
    const beforeFailedWrite = remoteJob.advance_requested_at;
    await deliver("req-write-fails", 4);
    if (conditionalWrites !== 2 || remoteJob.advance_requested_at !== beforeFailedWrite) process.exit(8);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("serverless store avoids legacy db.json timer writes", () => {
  const store = readFileSync(new URL("../lib/store.mjs", import.meta.url), "utf8");
  const api = readFileSync(new URL("../../api/index.mjs", import.meta.url), "utf8");
  assert.match(api, /\/tmp\/sf-data-\$\{process\.pid\}/);
  assert.match(store, /if \(SERVERLESS_STORE\(\)\) return;\s*\/\/ debounce writes/);
  assert.match(store, /if \(!SERVERLESS_STORE\(\)\) writeJsonFile\(DB_PATH, db\)/);
  assert.match(store, /if \(!SERVERLESS_STORE\(\)\) flush\(\)/);
});

test("serverless hydration is one-shot and cannot replace a live stage lease", () => {
  const storeUrl = new URL("../lib/store.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-hydrate-once-${process.pid}`))};
    let listReads = 0;
    let snapshotReads = 0;
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href.startsWith("https://blob.vercel-storage.com") && href.includes("prefix=")) {
        listReads += 1;
        return Response.json({
          blobs: [{
            pathname: "sf/db/current.json",
            url: "https://mock.public.blob.vercel-storage.com/sf/db/current.json",
          }],
        });
      }
      if (href.includes("/sf/db/current.json")) {
        snapshotReads += 1;
        return Response.json({
          jobs: [{
            id: "live-stage",
            status: "queued",
            current_stage: "render",
            current_phase: "waiting",
            next_stage: "render",
            advance_attempts: 1,
            advance_request_id: "render-request",
          }],
        });
      }
      return new Response("not found", { status: 404 });
    };
    const store = await import(${JSON.stringify(storeUrl)});
    await Promise.all([store.hydrate(), store.hydrate()]);
    store.update("jobs", "live-stage", {
      status: "running",
      current_stage: "capture_desktop",
      current_phase: "start",
      next_stage: "capture_desktop",
      advance_attempts: 2,
      advance_request_id: "desktop-request",
      active_stage_request_id: "desktop-request",
    });
    await store.hydrate();
    const live = store.get("jobs", "live-stage");
    if (listReads !== 1 || snapshotReads !== 1) process.exit(2);
    if (live?.status !== "running" || live?.current_stage !== "capture_desktop" || live?.current_phase !== "start") process.exit(3);
    if (live?.next_stage !== "capture_desktop" || live?.advance_attempts !== 2) process.exit(4);
    if (live?.advance_request_id !== "desktop-request" || live?.active_stage_request_id !== "desktop-request") process.exit(5);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("durable watchdog honors a fresh in-stage heartbeat", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-heartbeat-watchdog-${process.pid}`))};
    const staleIso = "2020-01-01T00:00:00.000Z";
    globalThis.fetch = async (url, options = {}) => {
      if (options.method === "PUT") return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/x.json" }), { status: 200 });
      if (String(url).includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (String(url).includes("/sf/jobs/beating-job.json")) {
        return new Response(JSON.stringify({
          id: "beating-job", correlation_id: "beating-job", status: "running", current_stage: "capture_desktop",
          updated_at: staleIso, stage_started_at: staleIso, last_event_at: staleIso,
          last_heartbeat_at: new Date().toISOString(),
        }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const job = await engine.getDurableJob("beating-job");
    if (job?.status !== "running" || job?.error_code) process.exit(2);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("startStageHeartbeat persists periodic durable heartbeats while a stage works", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_STAGE_HEARTBEAT_MS = "20";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-heartbeat-beat-${process.pid}`))};
    let heartbeatPuts = 0;
    const heartbeatTargets = new Set();
    let coordinationPuts = 0;
    globalThis.fetch = async (url, options = {}) => {
      if (options.method === "PUT") {
        if (String(url).includes(".heartbeat.")) {
          heartbeatPuts += 1;
          heartbeatTargets.add(String(url));
        }
        else coordinationPuts += 1;
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/x.json" }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const live = engine.createJob("try", { status: "running", current_stage: "capture_desktop", active_stage_request_id: "req-live", advance_attempts: 1 });
    const next = engine.createJob("try", { status: "running", current_stage: "capture_desktop", active_stage_request_id: "req-next", advance_attempts: 1 });
    const released = engine.createJob("try", { status: "queued", current_stage: "capture_desktop", active_stage_request_id: null, advance_attempts: 2 });
    const beat = engine.startStageHeartbeat(live.id, { stage: "capture_desktop", requestId: "req-live", advanceAttempt: 1 });
    const nextBeat = engine.startStageHeartbeat(next.id, { stage: "capture_desktop", requestId: "req-next", advanceAttempt: 1 });
    const releasedBeat = engine.startStageHeartbeat(released.id, { stage: "capture_desktop", requestId: "req-released", advanceAttempt: 1 });
    await new Promise((resolve) => setTimeout(resolve, 130));
    beat.stop();
    nextBeat.stop();
    releasedBeat.stop();
    const putsAtStop = heartbeatPuts;
    if (putsAtStop < 4) process.exit(2);
    if (![...heartbeatTargets].some((target) => target.includes(".heartbeat.req-live.json"))) process.exit(5);
    if (![...heartbeatTargets].some((target) => target.includes(".heartbeat.req-next.json"))) process.exit(6);
    if ([...heartbeatTargets].some((target) => target.includes(".heartbeat.req-released.json"))) process.exit(7);
    if (coordinationPuts !== 0) process.exit(4); // heartbeats cannot overwrite the coordination record
    await new Promise((resolve) => setTimeout(resolve, 60));
    if (heartbeatPuts !== putsAtStop) process.exit(3); // stop() must halt the beat
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("heartbeat sidecars are owner-fenced and stale staged jobs stay reclaimable", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-heartbeat-owner-${process.pid}`))};
    const staleIso = "2020-01-01T00:00:00.000Z";
    const freshIso = new Date().toISOString();
    const jobs = {
      "staged-live": { id: "staged-live", staged: true, status: "running", current_stage: "capture_desktop", active_stage_request_id: "req-live", advance_attempts: 1, updated_at: staleIso, stage_started_at: staleIso, last_heartbeat_at: staleIso },
      "staged-owner-changed": { id: "staged-owner-changed", staged: true, status: "running", current_stage: "capture_desktop", active_stage_request_id: "req-new", advance_attempts: 1, updated_at: staleIso, stage_started_at: staleIso, last_heartbeat_at: staleIso },
      "staged-dead": { id: "staged-dead", staged: true, status: "running", current_stage: "capture_desktop", active_stage_request_id: "req-dead", advance_attempts: 1, updated_at: staleIso, stage_started_at: staleIso, last_heartbeat_at: staleIso },
    };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (options.method === "PUT") return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/x.json" }), { status: 200 });
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      for (const [id, job] of Object.entries(jobs)) {
        if (target.includes("/sf/jobs/" + id + ".heartbeat.")) {
          if (id === "staged-dead") return new Response("not found", { status: 404 });
          return new Response(JSON.stringify({
            job_id: id,
            stage: "capture_desktop",
            request_id: id === "staged-live" ? "req-live" : "req-old",
            attempt: 1,
            at: freshIso,
            blob_sync: { capture_desktop_upload_ms: 321 },
          }), { status: 200 });
        }
        if (target.includes("/sf/jobs/" + id + ".json")) return new Response(JSON.stringify(job), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const live = await engine.getDurableJob("staged-live");
    if (live?.status !== "running" || live.last_heartbeat_at !== freshIso || live.blob_sync?.capture_desktop_upload_ms !== 321) process.exit(2);
    const changed = await engine.getDurableJob("staged-owner-changed");
    if (changed?.status !== "running" || changed.last_heartbeat_at !== staleIso || changed.error_code) process.exit(3);
    const dead = await engine.getDurableJob("staged-dead");
    if (dead?.status !== "running" || dead.error_code) process.exit(4);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("an exact terminal sidecar overrides a stale running QC coordination record", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-terminal-merge-${process.pid}`))};
    const freshIso = new Date().toISOString();
    const job = {
      id: "terminal-merge", staged: true, status: "running", current_stage: "qc", current_phase: "done", next_stage: "qc",
      active_stage: "qc", active_stage_request_id: "req-qc", advance_attempts: 7,
      updated_at: freshIso, stage_started_at: freshIso, last_heartbeat_at: freshIso,
    };
    const terminal = {
      job_id: job.id,
      stage: "qc",
      request_id: "req-qc",
      attempt: 7,
      at: freshIso,
      terminal: {
        status: "blocked",
        current_stage: "job",
        current_phase: "failed",
        finished_at: freshIso,
        result: null,
        error: "Quality gate held preview. Nothing was published.",
        error_code: "visual_qc_incomplete",
        retryable: true,
        next_stage: null,
        active_stage: null,
        active_stage_request_id: null,
      },
    };
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes("/sf/jobs/terminal-merge.terminal.req-qc.7.json")) return new Response(JSON.stringify(terminal), { status: 200 });
      if (target.includes("/sf/jobs/terminal-merge.heartbeat.req-qc.json")) {
        return new Response(JSON.stringify({ job_id: job.id, stage: "qc", request_id: "req-qc", attempt: 7, at: freshIso }), { status: 200 });
      }
      if (target.includes("/sf/jobs/terminal-merge.json")) return new Response(JSON.stringify(job), { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const durable = await engine.getDurableJob("terminal-merge");
    if (durable?.status !== "blocked" || durable.current_stage !== "job" || durable.error_code !== "visual_qc_incomplete") process.exit(2);
    if (durable.active_stage_request_id || durable.next_stage) process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("a worker may write terminal truth after rereading its exact stale queued claim", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_STAGE_HEARTBEAT_MS = "60000";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-terminal-queued-owner-${process.pid}`))};
    const freshIso = new Date().toISOString();
    const queuedJob = {
      id: "terminal-queued-owner", staged: true, status: "queued", current_stage: "mystery", current_phase: "waiting", next_stage: "mystery",
      advance_token: "advance-secret", advance_request_id: "req-old", advance_requested_stage: "mystery",
      active_stage: null, active_stage_request_id: null, updated_at: freshIso, advance_attempts: 1,
      stage_payload: { token: "terminal-queued-owner-preview" },
    };
    let staleQueuedRead = false;
    let terminalWrites = 0;
    let terminalMainWrites = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      if (options.method === "PUT") {
        if (target.includes(".heartbeat.req-old.")) staleQueuedRead = true;
        else if (target.includes(".terminal.req-old.1.json")) terminalWrites += 1;
        else if (staleQueuedRead && decoded.includes("sf/jobs/terminal-queued-owner.json")) terminalMainWrites += 1;
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/terminal-queued-owner.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes("/sf/jobs/terminal-queued-owner.json")) return new Response(JSON.stringify(queuedJob), { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.runDurableTryStage("terminal-queued-owner", {
      suppliedToken: "advance-secret",
      baseUrl: "https://siteforge.example",
      requestedStage: "mystery",
      requestId: "req-old",
      advanceAttempt: 1,
    });
    if (!result?.terminal || result.status !== "failed") process.exit(2);
    if (terminalWrites !== 1 || terminalMainWrites !== 1) process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("a stale staged worker can be reclaimed through Blob propagation lag", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-stage-reclaim-${process.pid}`))};
    const staleIso = "2020-01-01T00:00:00.000Z";
    let remoteJob = {
      id: "staged-reclaim", staged: true, status: "running", current_stage: "mystery", current_phase: "failed", next_stage: "mystery",
      advance_token: "advance-secret", advance_request_id: "req-old", active_stage: "mystery", active_stage_request_id: "req-old",
      stage_started_at: staleIso, last_heartbeat_at: staleIso, updated_at: staleIso, advance_attempts: 1, stage_payload: { token: "reclaim-preview" },
    };
    const remoteHeartbeats = new Map([["req-old", { job_id: remoteJob.id, stage: "mystery", request_id: "req-old", attempt: 1, at: staleIso }]]);
    let reclaimed = false;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      if (options.method === "PUT") {
        if (target.includes(".heartbeat.")) {
          const requestId = target.match(/\.heartbeat\.([^.?]+)\.json/)?.[1] || "";
          remoteHeartbeats.set(requestId, JSON.parse(String(options.body)));
        }
        else if (decoded.includes("sf/jobs/staged-reclaim.json")) {
          remoteJob = JSON.parse(String(options.body));
          if (remoteJob.status === "running" && remoteJob.active_stage_request_id === "req-new") reclaimed = true;
        }
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/staged-reclaim.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes("/sf/jobs/staged-reclaim.heartbeat.")) {
        const requestId = target.match(/\.heartbeat\.([^.?]+)\.json/)?.[1] || "";
        const heartbeat = remoteHeartbeats.get(requestId);
        return heartbeat ? new Response(JSON.stringify(heartbeat), { status: 200 }) : new Response("not found", { status: 404 });
      }
      if (target.includes("/sf/jobs/staged-reclaim.json")) return new Response(JSON.stringify(remoteJob), { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.runDurableTryStage("staged-reclaim", {
      suppliedToken: "advance-secret",
      baseUrl: "https://siteforge.example",
      requestedStage: "mystery",
      requestId: "req-new",
      advanceAttempt: 2,
      reclaimFromRequestId: "req-old",
    });
    if (!reclaimed) process.exit(2);
    if (result?.status !== "failed" || remoteJob.active_stage_request_id) process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("an explicit timeout handoff reclaims a predecessor with a fresh final heartbeat", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-stage-handoff-${process.pid}`))};
    const freshIso = new Date().toISOString();
    let remoteJob = {
      id: "staged-handoff", staged: true, status: "running", current_stage: "mystery", current_phase: "start", next_stage: "mystery",
      advance_token: "advance-secret", advance_request_id: "req-old", active_stage: "mystery", active_stage_request_id: "req-old",
      stage_started_at: freshIso, last_heartbeat_at: freshIso, updated_at: freshIso, advance_attempts: 1, stage_payload: { token: "handoff-preview" },
    };
    const remoteHeartbeats = new Map([["req-old", { job_id: remoteJob.id, stage: "mystery", request_id: "req-old", attempt: 1, at: freshIso }]]);
    const handoff = {
      job_id: remoteJob.id, from_stage: "mystery", to_stage: "mystery", from_request_id: "req-old", from_attempt: 1,
      to_request_id: "req-new", to_attempt: 2, reason: "stage_timeout_retry", at: freshIso,
    };
    let reclaimed = false;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      if (options.method === "PUT") {
        if (target.includes(".heartbeat.")) {
          const requestId = target.match(/\.heartbeat\.([^.?]+)\.json/)?.[1] || "";
          remoteHeartbeats.set(requestId, JSON.parse(String(options.body)));
        } else if (decoded.includes("sf/jobs/staged-handoff.json")) {
          remoteJob = JSON.parse(String(options.body));
          if (remoteJob.status === "running" && remoteJob.active_stage_request_id === "req-new") reclaimed = true;
        }
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/staged-handoff.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes("/sf/jobs/staged-handoff.handoff.")) return new Response(JSON.stringify(handoff), { status: 200 });
      if (target.includes("/sf/jobs/staged-handoff.heartbeat.")) {
        const requestId = target.match(/\.heartbeat\.([^.?]+)\.json/)?.[1] || "";
        const heartbeat = remoteHeartbeats.get(requestId);
        return heartbeat ? new Response(JSON.stringify(heartbeat), { status: 200 }) : new Response("not found", { status: 404 });
      }
      if (target.includes("/sf/jobs/staged-handoff.json")) return new Response(JSON.stringify(remoteJob), { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.runDurableTryStage("staged-handoff", {
      suppliedToken: "advance-secret",
      baseUrl: "https://siteforge.example",
      requestedStage: "mystery",
      requestId: "req-new",
      advanceAttempt: 2,
      reclaimFromRequestId: "req-old",
    });
    if (!reclaimed) process.exit(2);
    if (result?.status !== "failed" || remoteJob.active_stage_request_id) process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("an exact completed-stage handoff advances across a stale predecessor record", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-stage-complete-${process.pid}`))};
    const freshIso = new Date().toISOString();
    let remoteJob = {
      id: "stage-complete", staged: true, status: "running", current_stage: "capture_mobile", current_phase: "start", next_stage: "capture_mobile",
      advance_token: "advance-secret", advance_request_id: "req-mobile", active_stage: "capture_mobile", active_stage_request_id: "req-mobile",
      stage_started_at: freshIso, last_heartbeat_at: freshIso, updated_at: freshIso, advance_attempts: 4, stage_payload: { token: "stage-complete-preview" },
    };
    const marker = {
      job_id: remoteJob.id, from_stage: "capture_mobile", to_stage: "qc",
      from_request_id: "req-mobile", from_attempt: 4, to_request_id: "req-qc", to_attempt: 5,
      reason: "stage_completed", at: freshIso,
    };
    let transitioned = false;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      if (options.method === "PUT") {
        if (decoded.includes("sf/jobs/stage-complete.json")) {
          remoteJob = JSON.parse(String(options.body));
          if (remoteJob.status === "running" && remoteJob.current_stage === "qc" && remoteJob.active_stage_request_id === "req-qc") transitioned = true;
        }
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/stage-complete.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes("/sf/jobs/stage-complete.handoff.")) return new Response(JSON.stringify(marker), { status: 200 });
      if (target.includes("/sf/jobs/stage-complete.heartbeat.")) {
        return new Response(JSON.stringify({ job_id: remoteJob.id, stage: "capture_mobile", request_id: "req-mobile", attempt: 4, at: freshIso }), { status: 200 });
      }
      if (target.includes("/sf/jobs/stage-complete.json")) return new Response(JSON.stringify(remoteJob), { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.runDurableTryStage("stage-complete", {
      suppliedToken: "advance-secret",
      baseUrl: "https://siteforge.example",
      requestedStage: "qc",
      requestId: "req-qc",
      advanceAttempt: 5,
      reclaimFromRequestId: "req-mobile",
    });
    if (!transitioned) process.exit(2);
    if (!result?.retrying || remoteJob.status !== "queued") process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("a stale desktop main record recovers its orphaned mobile handoff with a fresh owner", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-orphaned-mobile-handoff-${process.pid}`))};
    const staleIso = "2020-01-01T00:00:00.000Z";
    const handoff = {
      job_id: "orphaned-mobile-handoff", from_stage: "capture_desktop", to_stage: "capture_mobile",
      from_request_id: "req-desktop", from_attempt: 3, to_request_id: "req-mobile-orphan", to_attempt: 4,
      reason: "stage_completed", at: new Date().toISOString(),
    };
    let remoteJob = {
      id: handoff.job_id, staged: true, status: "running", current_stage: "capture_desktop", current_phase: "capture",
      next_stage: "capture_desktop", advance_token: "advance-secret", advance_request_id: "req-desktop",
      active_stage: "capture_desktop", active_stage_request_id: "req-desktop", advance_attempts: 3,
      stage_started_at: staleIso, last_heartbeat_at: staleIso, updated_at: staleIso, stage_payload: { token: "orphaned-preview" },
    };
    let dispatch = null, mobileClaimed = false;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url), decoded = decodeURIComponent(target), method = options.method || "GET";
      if (method === "GET" && decoded.includes("url=sf/jobs/orphaned-mobile-handoff.json")) {
        return new Response(JSON.stringify({ url: "https://mock.private.blob.vercel-storage.com/sf/jobs/orphaned-mobile-handoff.json", etag: '"main-etag"' }), { status: 200 });
      }
      if (target.includes("mock.private.blob.vercel-storage.com/sf/jobs/orphaned-mobile-handoff.json")) return new Response(JSON.stringify(remoteJob), { status: 200, headers: { etag: '"main-etag"' } });
      if (method === "POST" && target.includes("/api/jobs/orphaned-mobile-handoff/advance")) {
        dispatch = JSON.parse(String(options.body));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (method === "PUT" && decoded.includes("pathname=sf/jobs/orphaned-mobile-handoff.json")) {
        remoteJob = JSON.parse(String(options.body));
        if (remoteJob.status === "running" && remoteJob.current_stage === "capture_mobile" && remoteJob.active_stage_request_id === dispatch?.request_id) mobileClaimed = true;
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/orphaned-mobile-handoff.json", etag: '"next-etag"' }), { status: 200 });
      }
      if (decoded.includes("prefix=sf/jobs/orphaned-mobile-handoff.handoff.req-desktop.3.")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/jobs/orphaned-mobile-handoff.handoff.req-desktop.3.req-mobile-orphan.4.json", url: "https://mock.public.blob.vercel-storage.com/sf/jobs/orphaned-mobile-handoff.handoff.req-desktop.3.req-mobile-orphan.4.json" }] }), { status: 200 });
      }
      if (decoded.includes("prefix=sf/try/orphaned-preview/")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/try/orphaned-preview/asset.txt", url: "https://mock.public.blob.vercel-storage.com/sf/try/orphaned-preview/asset.txt" }] }), { status: 200 });
      }
      if (decoded.includes("prefix=sf/")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes("/sf/jobs/orphaned-mobile-handoff.handoff.")) return new Response(JSON.stringify(handoff), { status: 200 });
      if (target.includes("/sf/jobs/orphaned-mobile-handoff.json")) return new Response(JSON.stringify(remoteJob), { status: 200, headers: { etag: '"main-etag"' } });
      if (target.includes("/sf/try/orphaned-preview/asset.txt")) return new Response("missing", { status: 404 });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const dispatched = await engine.dispatchDurableJobAdvance(handoff.job_id, "https://siteforge.example", { awaitDelivery: true });
    if (!dispatched || dispatch?.stage !== "capture_mobile" || dispatch?.reclaim_from_request_id !== "req-mobile-orphan" || dispatch?.advance_attempt !== 5) process.exit(2);
    const result = await engine.runDurableTryStage(handoff.job_id, {
      suppliedToken: "advance-secret", baseUrl: "https://siteforge.example", requestedStage: "capture_mobile",
      requestId: dispatch.request_id, advanceAttempt: dispatch.advance_attempt, reclaimFromRequestId: dispatch.reclaim_from_request_id,
      leaseEtag: '"next-etag"',
    });
    if (!mobileClaimed || result?.reason === "stage_already_running") process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("cross-stage claims reject missing or mismatched completion markers", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-stage-complete-fence-${process.pid}`))};
    const freshIso = new Date().toISOString();
    const staleIso = "2020-01-01T00:00:00.000Z";
    const remoteJob = {
      id: "stage-complete-fence", staged: true, status: "running", current_stage: "capture_mobile", current_phase: "start", next_stage: "capture_mobile",
      advance_token: "advance-secret", advance_request_id: "req-mobile", active_stage: "capture_mobile", active_stage_request_id: "req-mobile",
      stage_started_at: freshIso, last_heartbeat_at: freshIso, updated_at: freshIso, advance_attempts: 4, stage_payload: { token: "stage-complete-fence-preview" },
    };
    const markers = {
      "wrong-from": { from_stage: "capture_desktop", to_stage: "qc" },
      "wrong-to": { from_stage: "capture_mobile", to_stage: "render" },
      "wrong-owner": { from_stage: "capture_mobile", to_stage: "qc", from_request_id: "req-other" },
      "wrong-attempt": { from_stage: "capture_mobile", to_stage: "qc", to_attempt: 6 },
      "wrong-reason": { from_stage: "capture_mobile", to_stage: "qc", reason: "stage_timeout_retry" },
      "expired": { from_stage: "capture_mobile", to_stage: "qc", at: staleIso },
      "illegal-skip": { from_stage: "capture_desktop", to_stage: "qc", from_request_id: "req-desktop" },
    };
    let coordinationPuts = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (options.method === "PUT") {
        if (!target.includes(".heartbeat.")) coordinationPuts += 1;
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/stage-complete-fence.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes(".handoff.")) {
        const requestId = Object.keys(markers).find((key) => target.includes("req-" + key));
        if (!requestId) return new Response("not found", { status: 404 });
        const override = markers[requestId];
        return new Response(JSON.stringify({
          job_id: remoteJob.id,
          from_stage: "capture_mobile",
          to_stage: "qc",
          from_request_id: "req-mobile",
          from_attempt: 4,
          to_request_id: "req-" + requestId,
          to_attempt: 5,
          reason: "stage_completed",
          at: freshIso,
          ...override,
        }), { status: 200 });
      }
      if (target.includes(".heartbeat.")) {
        return new Response(JSON.stringify({ job_id: remoteJob.id, stage: remoteJob.current_stage, request_id: remoteJob.active_stage_request_id, attempt: 4, at: freshIso }), { status: 200 });
      }
      if (target.includes("/sf/jobs/stage-complete-fence.json")) return new Response(JSON.stringify(remoteJob), { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    for (const requestId of ["missing", ...Object.keys(markers)]) {
      const illegalSkip = requestId === "illegal-skip";
      remoteJob.current_stage = illegalSkip ? "capture_desktop" : "capture_mobile";
      remoteJob.next_stage = remoteJob.current_stage;
      remoteJob.active_stage = remoteJob.current_stage;
      remoteJob.active_stage_request_id = illegalSkip ? "req-desktop" : "req-mobile";
      remoteJob.advance_request_id = remoteJob.active_stage_request_id;
      const result = await engine.runDurableTryStage("stage-complete-fence", {
        suppliedToken: "advance-secret",
        baseUrl: "https://siteforge.example",
        requestedStage: "qc",
        requestId: "req-" + requestId,
        advanceAttempt: 5,
        reclaimFromRequestId: remoteJob.active_stage_request_id,
      });
      if (!result?.stale || result.reason !== "stage_mismatch") process.exit(2);
    }
    if (coordinationPuts !== 0) process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("fresh staged workers reject missing, invalid, expired, skipped, duplicate, and wrong-owner handoffs", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-stage-reclaim-fence-${process.pid}`))};
    const staleIso = "2020-01-01T00:00:00.000Z";
    const freshIso = new Date().toISOString();
    const remoteJob = {
      id: "staged-reclaim-fence", staged: true, status: "running", current_stage: "mystery", current_phase: "failed", next_stage: "mystery",
      advance_token: "advance-secret", advance_request_id: "req-old", active_stage: "mystery", active_stage_request_id: "req-old",
      stage_started_at: freshIso, last_heartbeat_at: freshIso, updated_at: freshIso, advance_attempts: 2, stage_payload: { token: "reclaim-fence-preview" },
    };
    let coordinationPuts = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (options.method === "PUT") {
        if (!target.includes(".heartbeat.")) coordinationPuts += 1;
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/staged-reclaim-fence.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes(".handoff.")) {
        const toRequestId = target.includes("req-wrong-release") ? "req-other" : "req-expired-release";
        if (target.includes("req-wrong-release") || target.includes("req-expired-release")) {
          return new Response(JSON.stringify({
            job_id: remoteJob.id, from_stage: "mystery", to_stage: "mystery", from_request_id: "req-old", from_attempt: 2,
            to_request_id: toRequestId, to_attempt: 3, reason: "stage_timeout_retry",
            at: target.includes("req-expired-release") ? staleIso : freshIso,
          }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }
      if (target.includes(".heartbeat.")) return new Response("not found", { status: 404 });
      if (target.includes("/sf/jobs/staged-reclaim-fence.json")) return new Response(JSON.stringify(remoteJob), { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const cases = [
      { requestId: "req-no-release", advanceAttempt: 3, reclaimFromRequestId: "req-old" },
      { requestId: "req-wrong-release", advanceAttempt: 3, reclaimFromRequestId: "req-old" },
      { requestId: "req-expired-release", advanceAttempt: 3, reclaimFromRequestId: "req-old" },
      { requestId: "req-wrong-owner", advanceAttempt: 3, reclaimFromRequestId: "req-other" },
      { requestId: "req-skipped", advanceAttempt: 4, reclaimFromRequestId: "req-old" },
      { requestId: "req-delayed", advanceAttempt: 1, reclaimFromRequestId: "req-old" },
      { requestId: "req-old", advanceAttempt: 2, reclaimFromRequestId: "req-old" },
    ];
    for (const claim of cases) {
      const result = await engine.runDurableTryStage("staged-reclaim-fence", {
        suppliedToken: "advance-secret",
        baseUrl: "https://siteforge.example",
        requestedStage: "mystery",
        ...claim,
      });
      if (!result?.stale && !result?.already_running) process.exit(2);
    }
    if (coordinationPuts !== 0) process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("an expired queued predecessor can be superseded by its exact next attempt", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_ADVANCE_LEASE_MS = "1000";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-queued-handoff-${process.pid}`))};
    const freshIso = new Date().toISOString();
    const staleIso = "2020-01-01T00:00:00.000Z";
    let remoteJob = {
      id: "queued-handoff", staged: true, status: "queued", current_stage: "mystery", current_phase: "waiting", next_stage: "mystery",
      advance_token: "advance-secret", advance_request_id: "req-queued", active_stage: null, active_stage_request_id: null,
      advance_requested_at: freshIso, updated_at: freshIso, advance_attempts: 2, stage_payload: { token: "queued-handoff-preview" },
    };
    let reclaimed = false;
    let coordinationPuts = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      if (options.method === "PUT") {
        if (!target.includes(".heartbeat.")) {
          coordinationPuts += 1;
          if (decoded.includes("sf/jobs/queued-handoff.json")) {
            remoteJob = JSON.parse(String(options.body));
            if (remoteJob.status === "running" && remoteJob.active_stage_request_id === "req-new") reclaimed = true;
          }
        }
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/queued-handoff.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes("/sf/jobs/queued-handoff.json")) return new Response(JSON.stringify(remoteJob), { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const claim = {
      suppliedToken: "advance-secret",
      baseUrl: "https://siteforge.example",
      requestedStage: "mystery",
      requestId: "req-new",
      advanceAttempt: 3,
      reclaimFromRequestId: "req-queued",
    };
    const fresh = await engine.runDurableTryStage("queued-handoff", claim);
    if (!fresh?.stale || coordinationPuts !== 0) process.exit(2);
    remoteJob.advance_requested_at = staleIso;
    remoteJob.updated_at = staleIso;
    const expired = await engine.runDurableTryStage("queued-handoff", claim);
    if (!reclaimed || expired?.status !== "failed") process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("queued recovery prefers the advance owner and clears stale active-stage ownership", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token_store_mock";
    process.env.SITEFORGE_ADVANCE_LEASE_MS = "1000";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-queued-owner-${process.pid}`))};
    const staleIso = "2020-01-01T00:00:00.000Z";
    let remoteJob = {
      id: "queued-owner", staged: true, status: "queued", current_stage: "capture_desktop", current_phase: "waiting", next_stage: "capture_desktop",
      advance_token: "advance-secret", advance_request_id: "req-queued-owner", advance_requested_stage: "capture_desktop",
      advance_requested_at: staleIso, advance_attempts: 2,
      active_stage: "capture_desktop", active_stage_request_id: "req-stale-running-owner", stage_started_at: staleIso,
      updated_at: staleIso, stage_payload: { token: "queued-owner-preview" },
    };
    let persistedJob = null;
    let postedAdvance = null;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      if ((options.method || "GET") === "GET" && target.includes("vercel.com/api/blob?") && decoded.includes("url=sf/jobs/queued-owner.json")) {
        return new Response(JSON.stringify({
          pathname: "sf/jobs/queued-owner.json",
          url: "https://mock.public.blob.vercel-storage.com/sf/jobs/queued-owner.json",
          etag: '\"etag-old\"',
        }), { status: 200 });
      }
      if (options.method === "POST" && target.includes("/api/jobs/queued-owner/advance")) {
        postedAdvance = JSON.parse(String(options.body));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (options.method === "PUT") {
        if (decoded.includes("fromUrl=https://mock.public.blob.vercel-storage.com/sf/jobs/queued-owner.json")) {
          return new Response(JSON.stringify({
            pathname: "sf/jobs/queued-owner.cas-read.snapshot.json",
            url: "https://mock.public.blob.vercel-storage.com/sf/jobs/queued-owner.cas-read.snapshot.json",
            etag: '\"etag-old\"',
          }), { status: 200 });
        }
        if (decoded.includes("sf/jobs/queued-owner.json") && options.headers?.["x-if-match"]) {
          persistedJob = JSON.parse(String(options.body));
          remoteJob = persistedJob;
          return new Response(JSON.stringify({
            url: "https://mock.public.blob.vercel-storage.com/sf/jobs/queued-owner.json",
            etag: '\"etag-next\"',
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/queued-owner.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (options.method === "POST" && target.includes("blob.vercel-storage.com/delete")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (target.includes("/sf/jobs/queued-owner.cas-read.snapshot.json")) {
        return new Response(JSON.stringify(remoteJob), { status: 200, headers: { etag: '\"etag-old\"' } });
      }
      if (target.includes("/sf/jobs/queued-owner.json")) {
        return new Response(JSON.stringify(remoteJob), { status: 200, headers: { etag: '\"etag-old\"' } });
      }
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.dispatchDurableJobAdvance("queued-owner", "https://siteforge.example", { awaitDelivery: true });
    if (result !== true || !persistedJob || !postedAdvance) process.exit(2);
    if (postedAdvance.reclaim_from_request_id !== "req-queued-owner") process.exit(3);
    if (postedAdvance.reclaim_from_request_id === "req-stale-running-owner") process.exit(4);
    if (persistedJob.active_stage !== null || persistedJob.active_stage_request_id !== null || persistedJob.stage_started_at !== null) process.exit(5);
    if (persistedJob.advance_request_id !== postedAdvance.request_id || postedAdvance.advance_attempt !== 3) process.exit(6);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("dead capture recovery ignores a fresh predecessor heartbeat and reclaims the capture owner", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token_store_mock";
    process.env.SITEFORGE_ADVANCE_LEASE_MS = "1000";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-capture-owner-recovery-${process.pid}`))};
    const staleIso = "2020-01-01T00:00:00.000Z";
    const freshIso = new Date().toISOString();
    let remoteJob = {
      id: "capture-owner-recovery", staged: true, status: "running", current_stage: "capture_desktop", current_phase: "capture",
      next_stage: "capture_desktop", advance_token: "advance-secret", advance_request_id: "req-render-obsolete",
      active_stage: "capture_desktop", active_stage_request_id: "req-capture-dead", advance_attempts: 4,
      stage_started_at: staleIso, updated_at: staleIso,
      // This is a late render heartbeat copied through an old state merge. It
      // must not keep the dead capture lease alive.
      last_heartbeat_at: freshIso, last_heartbeat_stage: "render", last_heartbeat_request_id: "req-render-obsolete", last_heartbeat_attempt: 3,
      stage_payload: { token: "capture-owner-recovery-preview" },
    };
    let persistedJob = null;
    let postedAdvance = null;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url); const decoded = decodeURIComponent(target);
      if ((options.method || "GET") === "GET" && target.includes("vercel.com/api/blob?") && decoded.includes("url=sf/jobs/capture-owner-recovery.json")) {
        return new Response(JSON.stringify({ pathname: "sf/jobs/capture-owner-recovery.json", url: "https://mock.public.blob.vercel-storage.com/sf/jobs/capture-owner-recovery.json", etag: '\"etag-capture-old\"' }), { status: 200 });
      }
      if (options.method === "POST" && target.includes("/api/jobs/capture-owner-recovery/advance")) {
        postedAdvance = JSON.parse(String(options.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (options.method === "PUT") {
        if (decoded.includes("fromUrl=https://mock.public.blob.vercel-storage.com/sf/jobs/capture-owner-recovery.json")) {
          return new Response(JSON.stringify({ pathname: "sf/jobs/capture-owner-recovery.cas-read.snapshot.json", url: "https://mock.public.blob.vercel-storage.com/sf/jobs/capture-owner-recovery.cas-read.snapshot.json", etag: '\"etag-capture-old\"' }), { status: 200 });
        }
        if (decoded.includes("sf/jobs/capture-owner-recovery.json") && options.headers?.["x-if-match"]) {
          persistedJob = JSON.parse(String(options.body)); remoteJob = persistedJob;
          return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/capture-owner-recovery.json", etag: '\"etag-capture-next\"' }), { status: 200 });
        }
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/capture-owner-recovery.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      if (options.method === "POST" && target.includes("blob.vercel-storage.com/delete")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (target.includes("/sf/jobs/capture-owner-recovery.heartbeat.")) return new Response("not found", { status: 404 });
      if (target.includes("/sf/jobs/capture-owner-recovery.cas-read.snapshot.json")) return new Response(JSON.stringify(remoteJob), { status: 200, headers: { etag: '\"etag-capture-old\"' } });
      if (target.includes("/sf/jobs/capture-owner-recovery.json")) return new Response(JSON.stringify(remoteJob), { status: 200, headers: { etag: '\"etag-capture-old\"' } });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.dispatchDurableJobAdvance("capture-owner-recovery", "https://siteforge.example", { awaitDelivery: true });
    if (result !== true || !persistedJob || !postedAdvance) process.exit(2);
    if (postedAdvance.reclaim_from_request_id !== "req-capture-dead") process.exit(3);
    if (postedAdvance.reclaim_from_request_id === "req-render-obsolete") process.exit(4);
    if (persistedJob.status !== "queued" || persistedJob.current_stage !== "capture_desktop") process.exit(5);
    if (persistedJob.active_stage_request_id || persistedJob.last_heartbeat_at || persistedJob.last_heartbeat_request_id) process.exit(6);
    if (persistedJob.advance_request_id !== postedAdvance.request_id || postedAdvance.advance_attempt !== 5) process.exit(7);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("immutable capture handoffs stop stale-main retry rollback at the configured cap", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_ADVANCE_LEASE_MS = "1000";
    process.env.SITEFORGE_CAPTURE_STAGE_MAX_RETRIES = "2";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-capture-retry-cap-${process.pid}`))};
    const staleIso = "2020-01-01T00:00:00.000Z";
    const stalePublicJob = {
      id: "capture-retry-cap", staged: true, status: "running", current_stage: "capture_desktop", current_phase: "capture",
      next_stage: "capture_desktop", advance_token: "advance-secret", advance_request_id: "req-4",
      active_stage: "capture_desktop", active_stage_request_id: "req-4", advance_attempts: 4,
      stage_started_at: staleIso, updated_at: staleIso, stage_retry_counts: { capture_desktop: 0 },
      stage_payload: { token: "capture-retry-cap-preview" },
    };
    let originJob = { ...stalePublicJob, stage_retry_counts: { capture_desktop: 0 } };
    const handoffs = [
      {
        job_id: originJob.id, from_stage: "capture_desktop", to_stage: "capture_desktop",
        from_request_id: "req-2", from_attempt: 2, to_request_id: "req-3", to_attempt: 3,
        reason: "stage_timeout_retry", stage_retry_count: 1, at: new Date().toISOString(),
      },
      {
        job_id: originJob.id, from_stage: "capture_desktop", to_stage: "capture_desktop",
        from_request_id: "req-3", from_attempt: 3, to_request_id: "req-4", to_attempt: 4,
        reason: "stage_timeout_retry", stage_retry_count: 2, at: new Date().toISOString(),
      },
    ];
    let terminalSidecars = 0;
    let conditionalMainWrites = 0;
    let advancePosts = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      const method = options.method || "GET";
      if (method === "GET" && target.includes("vercel.com/api/blob?") && decoded.includes("url=sf/jobs/capture-retry-cap.json")) {
        return new Response(JSON.stringify({
          pathname: "sf/jobs/capture-retry-cap.json",
          url: "https://mock.private.blob.vercel-storage.com/sf/jobs/capture-retry-cap.json",
          etag: '"etag-current"',
        }), { status: 200 });
      }
      if (method === "GET" && target.includes("mock.private.blob.vercel-storage.com/sf/jobs/capture-retry-cap.json")) {
        return new Response(JSON.stringify(originJob), { status: 200, headers: { etag: '"etag-current"' } });
      }
      if (method === "GET" && decoded.includes("prefix=sf/jobs/capture-retry-cap.handoff.req-4.4.")) {
        return new Response(JSON.stringify({ blobs: [] }), { status: 200 });
      }
      if (method === "GET" && decoded.includes("prefix=sf/jobs/capture-retry-cap.handoff.")) {
        return new Response(JSON.stringify({ blobs: handoffs.map((handoff) => ({
          pathname: "sf/jobs/capture-retry-cap.handoff." + handoff.from_request_id + "." + handoff.from_attempt + "." + handoff.to_request_id + "." + handoff.to_attempt + ".json",
          url: "https://mock.public.blob.vercel-storage.com/sf/jobs/capture-retry-cap.handoff." + handoff.from_request_id + "." + handoff.from_attempt + "." + handoff.to_request_id + "." + handoff.to_attempt + ".json",
        })) }), { status: 200 });
      }
      if (method === "GET" && target.includes("/sf/jobs/capture-retry-cap.handoff.")) {
        const found = handoffs.find((handoff) => target.includes("." + handoff.from_request_id + "." + handoff.from_attempt + "." + handoff.to_request_id + "." + handoff.to_attempt + ".json"));
        return found ? new Response(JSON.stringify(found), { status: 200 }) : new Response("not found", { status: 404 });
      }
      if (method === "GET" && target.includes("/sf/jobs/capture-retry-cap.heartbeat.")) {
        return new Response("not found", { status: 404 });
      }
      if (method === "GET" && target.includes("/sf/jobs/capture-retry-cap.json")) {
        return new Response(JSON.stringify(stalePublicJob), { status: 200, headers: { etag: '"etag-stale"' } });
      }
      if (method === "GET" && target.includes("blob.vercel-storage.com?prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (method === "PUT" && target.includes("blob.vercel-storage.com/sf/jobs/capture-retry-cap.terminal.")) {
        terminalSidecars += 1;
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/capture-retry-cap.terminal.req-4.4.json" }), { status: 200 });
      }
      if (method === "PUT" && decoded.includes("pathname=sf/jobs/capture-retry-cap.json") && options.headers?.["x-if-match"]) {
        conditionalMainWrites += 1;
        if (options.headers["x-if-match"] !== '"etag-current"') return new Response("conflict", { status: 412 });
        originJob = JSON.parse(String(options.body));
        return new Response(JSON.stringify({
          url: "https://mock.public.blob.vercel-storage.com/sf/jobs/capture-retry-cap.json",
          etag: '"etag-next"',
        }), { status: 200 });
      }
      if (method === "POST" && target.includes("/api/jobs/capture-retry-cap/advance")) {
        advancePosts += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.dispatchDurableJobAdvance("capture-retry-cap", "https://siteforge.example", { awaitDelivery: true });
    if (result !== false || advancePosts !== 0) process.exit(2);
    if (conditionalMainWrites !== 1 || terminalSidecars !== 1) process.exit(3);
    if (originJob.status !== "failed" || originJob.error_code !== "capture_retry_exhausted") process.exit(4);
    if (originJob.stage_retry_counts?.capture_desktop !== 2 || originJob.retryable !== false) process.exit(5);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("a capture worker may retry after rereading its exact stale queued claim", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_STAGE_HEARTBEAT_MS = "60000";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-handoff-queued-owner-${process.pid}`))};
    const freshIso = new Date().toISOString();
    const queuedJob = {
      id: "handoff-queued-owner", staged: true, status: "queued", current_stage: "capture_desktop", current_phase: "waiting", next_stage: "capture_desktop",
      advance_token: "advance-secret", advance_request_id: "req-old", advance_requested_stage: "capture_desktop",
      active_stage: null, active_stage_request_id: null, updated_at: freshIso, advance_attempts: 1,
      stage_payload: { token: "handoff-queued-owner-preview" },
    };
    let staleQueuedRead = false;
    let handoffWrites = 0;
    let retryMainWrites = 0;
    let successorPosts = 0;
    const backgroundTasks = [];
    globalThis.__siteforgeWaitUntil = (task) => backgroundTasks.push(task);
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      if (options.method === "POST" && target.includes("/api/jobs/")) {
        successorPosts += 1;
        return new Promise(() => {});
      }
      if (options.method === "PUT") {
        if (target.includes(".handoff.req-old.1.")) handoffWrites += 1;
        else if (staleQueuedRead && decoded.includes("sf/jobs/handoff-queued-owner.json")) retryMainWrites += 1;
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/handoff-queued-owner.json" }), { status: 200 });
      }
      if (decoded.includes("prefix=sf/try/handoff-queued-owner-preview/")) {
        return new Response(JSON.stringify({ blobs: [{
          pathname: "sf/try/handoff-queued-owner-preview/index.html",
          url: "https://mock.public.blob.vercel-storage.com/sf/try/handoff-queued-owner-preview/index.html",
        }] }), { status: 200 });
      }
      if (target.includes("/sf/try/handoff-queued-owner-preview/index.html")) {
        staleQueuedRead = true;
        return new Response("download failed", { status: 500 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes("/sf/jobs/handoff-queued-owner.json")) return new Response(JSON.stringify(queuedJob), { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const startedAt = Date.now();
    const result = await engine.runDurableTryStage("handoff-queued-owner", {
      suppliedToken: "advance-secret",
      baseUrl: "https://siteforge.example",
      requestedStage: "capture_desktop",
      requestId: "req-old",
      advanceAttempt: 1,
    });
    const elapsedMs = Date.now() - startedAt;
    if (!result?.retrying || result.status !== "queued") process.exit(2);
    if (handoffWrites !== 1 || retryMainWrites !== 1 || successorPosts !== 1 || backgroundTasks.length !== 1) process.exit(3);
    if (elapsedMs > 1_000) process.exit(4);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("a superseded capture worker cannot queue or launch another retry", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_STAGE_HEARTBEAT_MS = "60000";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-handoff-not-owned-${process.pid}`))};
    const freshIso = new Date().toISOString();
    const runningJob = {
      id: "handoff-not-owned", staged: true, status: "queued", current_stage: "capture_desktop", current_phase: "waiting", next_stage: "capture_desktop",
      advance_token: "advance-secret", advance_request_id: "req-old", active_stage: null, active_stage_request_id: null,
      stage_started_at: null, last_heartbeat_at: freshIso, updated_at: freshIso, advance_attempts: 1,
      stage_payload: { token: "handoff-not-owned-preview" },
    };
    const supersedingJob = {
      ...runningJob,
      status: "queued",
      current_phase: "waiting",
      active_stage: null,
      active_stage_request_id: null,
      advance_request_id: "req-new",
      advance_attempts: 2,
      advance_requested_at: freshIso,
    };
    let superseded = false;
    let coordinationWritesAfterSupersede = 0;
    let successorPostsAfterSupersede = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      if (options.method === "POST" && target.includes("/api/jobs/")) {
        if (superseded) successorPostsAfterSupersede += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (options.method === "PUT") {
        if (superseded && decoded.includes("sf/jobs/handoff-not-owned.json")) coordinationWritesAfterSupersede += 1;
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/handoff-not-owned.json" }), { status: 200 });
      }
      if (decoded.includes("prefix=sf/try/handoff-not-owned-preview/")) {
        return new Response(JSON.stringify({ blobs: [{
          pathname: "sf/try/handoff-not-owned-preview/index.html",
          url: "https://mock.public.blob.vercel-storage.com/sf/try/handoff-not-owned-preview/index.html",
        }] }), { status: 200 });
      }
      if (target.includes("/sf/try/handoff-not-owned-preview/index.html")) {
        superseded = true;
        return new Response("download failed", { status: 500 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes("/sf/jobs/handoff-not-owned.heartbeat.req-old.json")) return new Response("not found", { status: 404 });
      if (target.includes("/sf/jobs/handoff-not-owned.json")) {
        return new Response(JSON.stringify(superseded ? supersedingJob : runningJob), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.runDurableTryStage("handoff-not-owned", {
      suppliedToken: "advance-secret",
      baseUrl: "https://siteforge.example",
      requestedStage: "capture_desktop",
      requestId: "req-old",
      advanceAttempt: 1,
    });
    if (!result?.stale || result.reason !== "stage_handoff_not_owned") process.exit(2);
    if (coordinationWritesAfterSupersede !== 0 || successorPostsAfterSupersede !== 0) process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("a superseded stage worker cannot write a terminal main record", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_STAGE_HEARTBEAT_MS = "60000";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-terminal-not-owned-${process.pid}`))};
    const freshIso = new Date().toISOString();
    const queuedJob = {
      id: "terminal-not-owned", staged: true, status: "queued", current_stage: "mystery", current_phase: "waiting", next_stage: "mystery",
      advance_token: "advance-secret", advance_request_id: "req-old", active_stage: null, active_stage_request_id: null,
      updated_at: freshIso, last_heartbeat_at: freshIso, advance_attempts: 1, stage_payload: { token: "terminal-not-owned-preview" },
    };
    const supersedingJob = {
      ...queuedJob,
      advance_request_id: "req-new",
      advance_attempts: 2,
      advance_requested_at: freshIso,
    };
    let superseded = false;
    let coordinationWritesAfterSupersede = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (options.method === "PUT") {
        if (target.includes(".heartbeat.req-old.")) superseded = true;
        else if (superseded && target.includes("/sf/jobs/terminal-not-owned.json")) coordinationWritesAfterSupersede += 1;
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/terminal-not-owned.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes("/sf/jobs/terminal-not-owned.json")) {
        return new Response(JSON.stringify(superseded ? supersedingJob : queuedJob), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.runDurableTryStage("terminal-not-owned", {
      suppliedToken: "advance-secret",
      baseUrl: "https://siteforge.example",
      requestedStage: "mystery",
      requestId: "req-old",
      advanceAttempt: 1,
    });
    if (!result?.stale || result.reason !== "stage_terminal_not_owned") process.exit(2);
    if (coordinationWritesAfterSupersede !== 0) process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("a stale ETag cannot claim or execute a staged job", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_STAGE_HEARTBEAT_MS = "60000";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-cas-claim-${process.pid}`))};
    const freshIso = new Date().toISOString();
    const remoteJob = {
      id: "cas-claim", staged: true, status: "queued", current_stage: "mystery", current_phase: "waiting", next_stage: "mystery",
      advance_token: "advance-secret", advance_request_id: "req-old", advance_requested_stage: "mystery",
      active_stage: null, active_stage_request_id: null, updated_at: freshIso, advance_attempts: 1,
      stage_payload: { token: "cas-claim-preview" },
    };
    let conditionalWrites = 0;
    let sidecarWrites = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      if (options.method === "PUT") {
        if (decoded.includes("sf/jobs/cas-claim.json") && options.headers?.["x-if-match"] === '"etag-old"') {
          conditionalWrites += 1;
          return new Response(JSON.stringify({ error: { code: "precondition_failed" } }), { status: 412 });
        }
        sidecarWrites += 1;
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-claim.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes("/sf/jobs/cas-claim.json")) {
        return new Response(JSON.stringify(remoteJob), { status: 200, headers: { etag: 'W/"etag-old"' } });
      }
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.runDurableTryStage("cas-claim", {
      suppliedToken: "advance-secret",
      baseUrl: "https://siteforge.example",
      requestedStage: "mystery",
      requestId: "req-old",
      advanceAttempt: 1,
    });
    if (!result?.stale || result.reason !== "job_state_conflict") process.exit(2);
    if (conditionalWrites !== 1 || sidecarWrites !== 0) process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("a CAS read retries a raced public-Blob snapshot and dispatches from fresh state", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_store_mock";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-cas-fresh-read-${process.pid}`))};
    const oldIso = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const staleJob = {
      id: "cas-fresh-read", staged: true, status: "queued", current_stage: "capture_desktop", current_phase: "waiting", next_stage: "capture_desktop",
      advance_token: "advance-secret", advance_request_id: "req-stale", advance_requested_stage: "capture_desktop",
      advance_requested_at: oldIso, active_stage: null, active_stage_request_id: null, updated_at: oldIso, advance_attempts: 3,
      stage_payload: { token: "cas-fresh-read-preview" },
    };
    let remoteJob = {
      ...staleJob,
      advance_request_id: "req-current",
      advance_attempts: 4,
    };
    let headReads = 0;
    let copyWrites = 0;
    let snapshotReads = 0;
    let mutablePublicReads = 0;
    let conditionalMainWrites = 0;
    let deleteAttempts = 0;
    let advancePosts = 0;
    let copiedSourceEtag = "";
    let mainIfMatch = "";
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      const method = options.method || "GET";
      if (method === "GET" && target.includes("vercel.com/api/blob?") && decoded.includes("url=sf/jobs/cas-fresh-read.json")) {
        headReads += 1;
        const etag = headReads === 1 ? '"etag-raced"' : '"etag-current"';
        return new Response(JSON.stringify({
          pathname: "sf/jobs/cas-fresh-read.json",
          url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-fresh-read.json",
          etag,
        }), { status: 200 });
      }
      if (method === "PUT" && target.includes("vercel.com/api/blob?") && decoded.includes("fromUrl=https://mock.public.blob.vercel-storage.com/sf/jobs/cas-fresh-read.json")) {
        copyWrites += 1;
        copiedSourceEtag = options.headers?.["x-if-match"] || "";
        if (copyWrites === 1) {
          return new Response(JSON.stringify({ error: { code: "precondition_failed" } }), { status: 412 });
        }
        return new Response(JSON.stringify({
          pathname: "sf/jobs/cas-fresh-read.cas-read.snapshot.json",
          url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-fresh-read.cas-read.snapshot.json",
          etag: '"etag-current"',
        }), { status: 200 });
      }
      if (method === "GET" && target.includes("/sf/jobs/cas-fresh-read.cas-read.snapshot.json")) {
        snapshotReads += 1;
        return new Response(JSON.stringify(remoteJob), { status: 200, headers: { etag: '"etag-current"' } });
      }
      if (method === "GET" && target.includes("/sf/jobs/cas-fresh-read.json")) {
        mutablePublicReads += 1;
        return new Response(JSON.stringify(staleJob), { status: 200, headers: { etag: 'W/"etag-raced"', age: "922", "cache-control": "public, max-age=2592000" } });
      }
      if (method === "PUT" && decoded.includes("sf/jobs/cas-fresh-read.json") && options.headers?.["x-if-match"]) {
        conditionalMainWrites += 1;
        mainIfMatch = options.headers["x-if-match"];
        if (mainIfMatch !== '"etag-current"') {
          return new Response(JSON.stringify({ error: { code: "precondition_failed" } }), { status: 412 });
        }
        remoteJob = JSON.parse(String(options.body));
        return new Response(JSON.stringify({
          url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-fresh-read.json",
          etag: '"etag-next"',
        }), { status: 200 });
      }
      if (method === "POST" && target.includes("/api/jobs/cas-fresh-read/advance")) {
        advancePosts += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (method === "POST" && target.includes("blob.vercel-storage.com/delete")) {
        deleteAttempts += 1;
        if (deleteAttempts === 1) return new Response("busy", { status: 503 });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (method === "GET" && target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const dispatched = await engine.dispatchDurableJobAdvance("cas-fresh-read", "https://siteforge.example", { awaitDelivery: true });
    if (!dispatched) process.exit(2);
    if (headReads !== 2 || copyWrites !== 2 || snapshotReads !== 1 || mutablePublicReads !== 1) process.exit(3);
    if (copiedSourceEtag !== '"etag-current"' || mainIfMatch !== '"etag-current"') process.exit(4);
    if (conditionalMainWrites !== 1 || advancePosts !== 1 || deleteAttempts !== 2 || remoteJob.advance_attempts !== 5 || remoteJob.advance_request_id === "req-current") process.exit(5);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("the exact dispatcher lease ETag bypasses a lagging public Blob validator", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_STAGE_HEARTBEAT_MS = "60000";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-cas-lease-etag-${process.pid}`))};
    const freshIso = new Date().toISOString();
    let remoteJob = {
      id: "cas-lease-etag", staged: true, status: "queued", current_stage: "mystery", current_phase: "waiting", next_stage: "mystery",
      advance_token: "advance-secret", advance_request_id: "req-current", advance_requested_stage: "mystery",
      active_stage: null, active_stage_request_id: null, updated_at: freshIso, advance_attempts: 1,
      stage_payload: { token: "cas-lease-etag-preview" },
    };
    let currentEtag = '"etag-current"';
    const mainIfMatches = [];
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      if (options.method === "PUT") {
        if (decoded.includes("sf/jobs/cas-lease-etag.json") && options.headers?.["x-if-match"]) {
          mainIfMatches.push(options.headers["x-if-match"]);
          if (options.headers["x-if-match"] !== currentEtag) {
            return new Response(JSON.stringify({ error: { code: "precondition_failed" } }), { status: 412 });
          }
          remoteJob = JSON.parse(String(options.body));
          currentEtag = mainIfMatches.length === 1 ? '"etag-running"' : '"etag-terminal"';
          return new Response(JSON.stringify({
            url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-lease-etag.json",
            etag: currentEtag,
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-lease-etag.sidecar.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (options.method === "POST" && target.includes("blob.vercel-storage.com/delete")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (target.includes("/sf/jobs/cas-lease-etag.json")) {
        return new Response(JSON.stringify(remoteJob), { status: 200, headers: { etag: 'W/"etag-stale-public"' } });
      }
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.runDurableTryStage("cas-lease-etag", {
      suppliedToken: "advance-secret",
      baseUrl: "https://siteforge.example",
      requestedStage: "mystery",
      requestId: "req-current",
      advanceAttempt: 1,
      leaseEtag: '"etag-current"',
    });
    if (result?.status !== "failed" || remoteJob.status !== "failed") process.exit(2);
    if (mainIfMatches[0] !== '"etag-current"' || mainIfMatches[1] !== '"etag-running"') process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("a terminal sidecar survives while stale main-state CAS fails closed", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_STAGE_HEARTBEAT_MS = "60000";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-cas-terminal-${process.pid}`))};
    const freshIso = new Date().toISOString();
    let remoteJob = {
      id: "cas-terminal", staged: true, status: "queued", current_stage: "mystery", current_phase: "waiting", next_stage: "mystery",
      advance_token: "advance-secret", advance_request_id: "req-old", advance_requested_stage: "mystery",
      active_stage: null, active_stage_request_id: null, updated_at: freshIso, advance_attempts: 1,
      stage_payload: { token: "cas-terminal-preview" },
    };
    let currentEtag = '"etag-old"';
    let conditionalWrites = 0;
    let terminalSidecars = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      if (options.method === "PUT") {
        if (decoded.includes("sf/jobs/cas-terminal.json") && options.headers?.["x-if-match"]) {
          conditionalWrites += 1;
          if (conditionalWrites === 1) {
            remoteJob = JSON.parse(String(options.body));
            currentEtag = '"etag-claim"';
            return new Response(JSON.stringify({
              url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-terminal.json",
              etag: currentEtag,
            }), { status: 200 });
          }
          return new Response(JSON.stringify({ error: { code: "precondition_failed" } }), { status: 412 });
        }
        if (target.includes(".terminal.req-old.1.json")) terminalSidecars += 1;
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-terminal.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes("/sf/jobs/cas-terminal.json")) {
        return new Response(JSON.stringify(remoteJob), { status: 200, headers: { etag: currentEtag } });
      }
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.runDurableTryStage("cas-terminal", {
      suppliedToken: "advance-secret",
      baseUrl: "https://siteforge.example",
      requestedStage: "mystery",
      requestId: "req-old",
      advanceAttempt: 1,
    });
    if (!result?.stale || result.reason !== "job_state_conflict") process.exit(2);
    if (conditionalWrites !== 2 || terminalSidecars !== 1 || remoteJob.status !== "running") process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("a stale max-attempt dispatcher cannot terminalize a newer job owner", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.SITEFORGE_MAX_ADVANCE_ATTEMPTS = "15";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-cas-dispatch-${process.pid}`))};
    const freshIso = new Date().toISOString();
    const stalePublicJob = {
      id: "cas-dispatch", staged: true, status: "queued", current_stage: "qc", current_phase: "waiting", next_stage: "qc",
      advance_token: "advance-secret", advance_request_id: "req-newer", advance_requested_stage: "qc",
      active_stage: null, active_stage_request_id: null, updated_at: freshIso, advance_attempts: 15,
      stage_payload: { token: "cas-dispatch-preview" },
    };
    const remoteJob = {
      ...stalePublicJob,
      status: "running",
      current_phase: "start",
      active_stage: "qc",
      active_stage_request_id: "req-live",
      stage_started_at: freshIso,
      last_heartbeat_at: freshIso,
    };
    let conditionalWrites = 0;
    let unconditionalMainWrites = 0;
    let mutablePublicReads = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      if ((options.method || "GET") === "GET" && target.includes("vercel.com/api/blob?") && decoded.includes("url=sf/jobs/cas-dispatch.json")) {
        return new Response(JSON.stringify({
          pathname: "sf/jobs/cas-dispatch.json",
          url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-dispatch.json",
          etag: '\"etag-current\"',
        }), { status: 200 });
      }
      if (options.method === "PUT") {
        if (decoded.includes("fromUrl=https://mock.public.blob.vercel-storage.com/sf/jobs/cas-dispatch.json")) {
          return new Response(JSON.stringify({
            pathname: "sf/jobs/cas-dispatch.cas-read.snapshot.json",
            url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-dispatch.cas-read.snapshot.json",
            etag: '\"etag-current\"',
          }), { status: 200 });
        }
        if (decoded.includes("sf/jobs/cas-dispatch.json") && options.headers?.["x-if-match"]) {
          conditionalWrites += 1;
          return new Response(JSON.stringify({ error: { code: "precondition_failed" } }), { status: 412 });
        }
        if (decoded.includes("sf/jobs/cas-dispatch.json")) unconditionalMainWrites += 1;
        return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-dispatch.json" }), { status: 200 });
      }
      if (target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (target.includes("/sf/jobs/cas-dispatch.cas-read.snapshot.json")) {
        return new Response(JSON.stringify(remoteJob), { status: 200, headers: { etag: '\"etag-current\"' } });
      }
      if (target.includes("/sf/jobs/cas-dispatch.json")) {
        mutablePublicReads += 1;
        return new Response(JSON.stringify(stalePublicJob), { status: 200, headers: { etag: '"etag-stale"' } });
      }
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.dispatchDurableJobAdvance("cas-dispatch", "https://siteforge.example");
    if (result !== false) process.exit(2);
    if (conditionalWrites !== 0 || unconditionalMainWrites !== 0 || mutablePublicReads !== 1 || remoteJob.status !== "running") process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("serverless capture_mobile hands terminal QC in-process with every ownership fence intact", async () => {
  const {
    executeInlineTerminalQcHandoff,
    inlineTerminalQcHandoffPlan,
  } = await import("../lib/engine-adapter.mjs");
  const plan = inlineTerminalQcHandoffPlan({
    serverless: true,
    jobId: "job-inline-qc",
    stage: "capture_mobile",
    nextStage: "qc",
    current: { advance_token: "signed-current-token" },
    job: { advance_token: "stale-job-token" },
    baseUrl: "https://siteforge.example",
    nextRequestId: "req-qc",
    nextAdvanceAttempt: 4,
    requestId: "req-mobile",
    expectedJobEtag: '"etag-qc-4"',
  });

  assert.deepEqual(plan, {
    jobId: "job-inline-qc",
    options: {
      suppliedToken: "signed-current-token",
      baseUrl: "https://siteforge.example",
      requestedStage: "qc",
      requestId: "req-qc",
      advanceAttempt: 4,
      reclaimFromRequestId: "req-mobile",
      leaseEtag: '"etag-qc-4"',
    },
  });
  assert.equal(inlineTerminalQcHandoffPlan({ serverless: false, stage: "capture_mobile", nextStage: "qc" }), null);
  assert.equal(inlineTerminalQcHandoffPlan({ serverless: true, stage: "capture_desktop", nextStage: "capture_mobile" }), null);
  assert.equal(inlineTerminalQcHandoffPlan({ serverless: true, stage: "capture_mobile", nextStage: "render" }), null);

  const originalFetch = globalThis.fetch;
  let httpCalls = 0;
  let invocation = null;
  const terminal = { ok: true, terminal: true, status: "done", result: { preview: "/try/inline-qc/" } };
  try {
    globalThis.fetch = async () => {
      httpCalls += 1;
      throw new Error("terminal QC must not use a recursive HTTP handoff");
    };
    const propagated = await executeInlineTerminalQcHandoff(plan, async (jobId, options) => {
      invocation = { jobId, options };
      return terminal;
    });
    assert.strictEqual(propagated, terminal);
    assert.deepEqual(invocation, plan);
    assert.equal(httpCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("staged advances are leased and QC waits for durable screenshot artifacts", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const engine = readFileSync(new URL("../lib/engine-adapter.mjs", import.meta.url), "utf8");
  assert.match(engine, /advance_request_id/);
  assert.match(engine, /request_id: requestId/);
  assert.match(engine, /const nextRequestId = token\(10\)/);
  assert.match(engine, /advance_request_id: nextRequestId/);
  assert.match(engine, /latestTimestamp\(job\?\.last_heartbeat_at, job\?\.last_event_at, job\?\.updated_at, job\?\.stage_started_at, job\?\.advance_requested_at/);
  assert.match(engine, /startStageHeartbeat\(jobId, \{ stage, requestId, advanceAttempt:/);
  assert.match(engine, /heartbeat\?\.stop\(\);\s*onEmit\(null\)/);
  assert.match(engine, /jobs\/\$\{jobId\}\.heartbeat\.\$\{jobLeasePart\(requestId\)\}\.json/);
  assert.match(engine, /jobs\/\$\{jobId\}\.handoff\./);
  assert.match(engine, /reclaim_from_request_id/);
  assert.match(engine, /lease_etag: strongBlobEtag\(leaseEtag\)/);
  assert.match(server, /leaseEtag: String\(body\.lease_etag \|\| ""\)/);
  assert.match(engine, /suppliedAdvanceAttempt === authoritativeAdvanceAttempt \+ 1/);
  assert.match(engine, /job\.status === "queued"\s*\? \(job\.advance_request_id \|\| job\.active_stage_request_id/);
  assert.match(engine, /: \(job\.active_stage_request_id \|\| job\.advance_request_id/);
  assert.match(engine, /reason: "stage_completed"/);
  assert.match(engine, /nextAdvanceAttempt,\s*requestId,\s*expectedJobEtag/);
  assert.match(engine, /capture_desktop: "capture_mobile"/);
  assert.match(engine, /capture_mobile: "qc"/);
  assert.match(engine, /job\.active_stage === authoritativeStage/);
  assert.match(engine, /jobTerminalPath\(jobId, activeRequestId, activeAttempt\)/);
  const finishStageBody = engine.slice(engine.indexOf("const finishStage = async"), engine.indexOf("\n\n  onEmit", engine.indexOf("const finishStage = async")));
  const handoffWrite = finishStageBody.indexOf("await persistStageHandoff");
  const queuedWrite = finishStageBody.indexOf('update("jobs"');
  const durableWrite = finishStageBody.indexOf("await persistOwnedState");
  const inlineQc = finishStageBody.indexOf("return executeInlineTerminalQcHandoff");
  const successorPost = finishStageBody.indexOf("await postDurableJobAdvance");
  assert.ok(handoffWrite >= 0 && handoffWrite < queuedWrite && queuedWrite < durableWrite && durableWrite < inlineQc && inlineQc < successorPost);
  assert.match(finishStageBody, /const inlineQcHandoff = inlineTerminalQcHandoffPlan\(\{/);
  assert.match(finishStageBody, /heartbeat\?\.stop\(\);\s*heartbeat = null;/);
  assert.match(finishStageBody, /\[stage-inline-terminal-handoff\]/);
  assert.match(finishStageBody, /return executeInlineTerminalQcHandoff\(inlineQcHandoff\)/);
  assert.match(finishStageBody, /const delivered = await postDurableJobAdvance/);
  assert.match(finishStageBody, /pipeline open until the 300-second function limit\.\s*false,/);
  assert.match(finishStageBody, /deliveryState\.loopDetected/);
  assert.match(finishStageBody, /reason: "stage_handoff_deferred"/);
  assert.match(finishStageBody, /Date\.now\(\) - STAGE_ADVANCE_LEASE_MS - 1_000/);
  assert.match(finishStageBody, /if \(!delivered\)/);
  assert.match(finishStageBody, /error_code: "stage_handoff_delivery_failed"/);
  assert.match(finishStageBody, /stage_delivery_outcome_changed/);
  const deliveryBody = engine.slice(engine.indexOf("export async function postDurableJobAdvance"), engine.indexOf("\n\nconst MAX_ADVANCE_ATTEMPTS"));
  assert.match(deliveryBody, /response\.ok \|\| responseBody\?\.terminal === true/);
  assert.match(deliveryBody, /response\.status === 508/);
  assert.match(deliveryBody, /\[stage-delivery-deferred\]/);
  assert.match(deliveryBody, /ADVANCE_DELIVERY_ATTEMPTS/);
  assert.match(deliveryBody, /Serverless stage handoffs use waitUntil/);
  assert.match(deliveryBody, /return false/);
  const terminalWriter = engine.slice(engine.indexOf("async function persistStageTerminal"), engine.indexOf("\n\nexport function startStageHeartbeat"));
  assert.doesNotMatch(terminalWriter, /advance_token|stage_payload/);
  const doneTerminalBody = engine.slice(engine.indexOf("const doneTerminal"), engine.indexOf('return { ok: true, terminal: true, status: "done"', engine.indexOf("const doneTerminal")));
  assert.ok(doneTerminalBody.indexOf("await persistStageTerminal") < doneTerminalBody.indexOf('update("jobs"'));
  const failedTerminalBody = engine.slice(engine.indexOf("const failedTerminal"), engine.indexOf('return { ok: false, terminal: true', engine.indexOf("const failedTerminal")));
  assert.ok(failedTerminalBody.indexOf("await persistStageTerminal") < failedTerminalBody.indexOf('update("jobs"'));
  // Single-flight is heartbeat-liveness based, dead workers are requeued, and
  // retry storms are capped instead of spinning forever.
  assert.match(engine, /function stageLeaseLiveness\(job, stage = job\?\.current_stage\)/);
  assert.match(engine, /last_heartbeat_stage === stage/);
  assert.match(engine, /const liveness = stageLeaseLiveness\(job, job\.current_stage\)/);
  assert.match(engine, /MAX_ADVANCE_ATTEMPTS/);
  assert.match(engine, /advance_retry_exhausted/);
  // Deterministic QC/capture verdicts always write a durable terminal state
  // instead of deferring to a newer claim (the qc/done wedge).
  assert.match(engine, /const deterministicVerdict = err\.code === "visual_qc_incomplete"/);
  assert.match(engine, /!deterministicVerdict && latest\?\.active_stage_request_id/);
  assert.match(engine, /transientStageFailure/);
  assert.match(server, /workerLooksDead/);
  // Transient stage timeouts requeue the same stage (warm retry) and the cold
  // Chromium pack download happens outside every Chromium-backed stage timer.
  assert.match(engine, /stage_timeout_retry/);
  assert.match(engine, /prewarmChromium\(\)\.catch/);
  assert.match(engine, /stage === "capture_desktop" \|\| stage === "capture_mobile" \|\| stage === "qc"/);
  assert.match(engine, /captureScreenshotsForViewport\(outDir, "desktop", \{ signal \}\)/);
  assert.match(engine, /captureScreenshotsForViewport\(outDir, "mobile", \{ signal \}\)/);
  assert.doesNotMatch(engine, /captureOrigin: baseUrl/);
  const transientFailure = engine.slice(engine.indexOf("const transientStageFailure"), engine.indexOf("if (transientStageFailure", engine.indexOf("const transientStageFailure")));
  assert.doesNotMatch(transientFailure, /stage === "capture_/);
  assert.match(transientFailure, /blob_sync_failed/);
  assert.match(engine, /wrapped\.provider_code = error\.code \|\| null/);
  assert.match(engine, /\[stage-retry\]/);
  assert.match(engine, /last_stage_error: retryError/);
  assert.match(engine, /CAPTURE_STAGE_MAX_RETRIES/);
  assert.match(engine, /stage_retry_counts:/);
  assert.match(engine, /const retryDeliveryState = \{\}/);
  assert.match(engine, /retryDeliveryState\.loopDetected/);
  assert.match(engine, /latestRetryState/);
  // First-party screenshot URLs ship in the terminal result for downstream
  // consumers (Ghost outreach thumbnails).
  assert.match(engine, /desktop_hero: blobPublicUrl/);
  assert.match(engine, /screenshots,/);
  assert.match(engine, /stage_already_running/);
  assert.match(engine, /stale_failure_ignored/);
  assert.match(server, /requestId: String\(body\.request_id \|\| ""\)/);
  assert.match(server, /advanceIsLeased/);
  assert.match(engine, /assertScreenshotArtifactsReady\(outDir\);\s*const qc = await withJobStage/);
});

test("withJobStage aborts timed-out work so Chromium can be closed", async () => {
  const { withJobStage } = await import("../lib/engine-adapter.mjs");
  let signal;
  await assert.rejects(
    withJobStage(
      "stage-abort-test",
      "capture_desktop",
      (value) => {
        signal = value;
        return new Promise(() => {});
      },
      10,
      async () => true,
    ),
    (error) => error.code === "stage_timeout",
  );
  assert.equal(signal.aborted, true);
});

test("CAS snapshot body-read failures clean up every snapshot and never advance", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_store_mock";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-cas-body-failure-${process.pid}`))};
    const oldIso = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const job = { id: "cas-body-failure", staged: true, status: "queued", current_stage: "capture_desktop", current_phase: "waiting", next_stage: "capture_desktop", advance_token: "advance-secret", advance_request_id: "req-current", advance_requested_stage: "capture_desktop", advance_requested_at: oldIso, updated_at: oldIso, stage_payload: { token: "preview-token" } };
    let snapshots = 0, deletes = 0, advances = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url), decoded = decodeURIComponent(target), method = options.method || "GET";
      if (method === "GET" && target.includes("blob.vercel-storage.com?prefix=sf")) return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      if (method === "GET" && target.includes("vercel.com/api/blob?") && decoded.includes("url=sf/jobs/cas-body-failure.json")) return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-body-failure.json", etag: '"etag-current"' }), { status: 200 });
      if (method === "PUT" && decoded.includes("fromUrl=https://mock.public.blob.vercel-storage.com/sf/jobs/cas-body-failure.json")) { snapshots += 1; return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-body-failure.cas-read." + snapshots + ".json" }), { status: 200 }); }
      if (method === "GET" && target.includes("cas-body-failure.cas-read")) return { ok: true, status: 200, headers: new Headers(), text: async () => { throw new Error("body unavailable"); } };
      if (method === "POST" && target.includes("blob.vercel-storage.com/delete")) { deletes += 1; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
      if (method === "POST" && target.includes("/api/jobs/cas-body-failure/advance")) { advances += 1; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
      if (method === "GET" && target.includes("/sf/jobs/cas-body-failure.json")) return new Response(JSON.stringify(job), { status: 200, headers: { etag: '"etag-current"' } });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.dispatchDurableJobAdvance("cas-body-failure", "https://siteforge.example", { awaitDelivery: true });
    if (result !== false || snapshots !== 3 || deletes !== 3 || advances !== 0) process.exit(2);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Blob snapshot cleanup retries boundedly and malformed tokens fail closed", () => {
  const blobUrl = new URL("../lib/blob-store.mjs", import.meta.url).href;
  const script = `
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_store_mock";
    let attempts = 0;
    globalThis.fetch = async () => { attempts += 1; return attempts < 3 ? new Response("busy", { status: 429 }) : new Response(JSON.stringify({ ok: true }), { status: 200 }); };
    const blob = await import(${JSON.stringify(blobUrl)});
    const recovered = await blob.blobDeleteUrls(["https://mock.public.blob.vercel-storage.com/sf/jobs/snapshot.json"]);
    if (!recovered.ok || recovered.attempts !== 3 || attempts !== 3) process.exit(2);
    process.env.BLOB_READ_WRITE_TOKEN = "bad";
    const rejected = await blob.blobDeleteUrls(["https://mock.public.blob.vercel-storage.com/sf/jobs/snapshot.json"]);
    if (rejected.ok || rejected.reason !== "invalid_blob_token" || attempts !== 3) process.exit(3);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("CAS cleanup failure fails closed and never posts a duplicate advance", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_store_mock";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-cas-cleanup-failure-${process.pid}`))};
    const oldIso = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const job = { id: "cas-cleanup-failure", staged: true, status: "queued", current_stage: "capture_desktop", current_phase: "waiting", next_stage: "capture_desktop", advance_token: "advance-secret", advance_request_id: "req-current", advance_requested_stage: "capture_desktop", advance_requested_at: oldIso, updated_at: oldIso, stage_payload: { token: "preview-token" } };
    let snapshots = 0, deleteAttempts = 0, advances = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url), decoded = decodeURIComponent(target), method = options.method || "GET";
      if (method === "GET" && target.includes("blob.vercel-storage.com?prefix=sf")) return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      if (method === "GET" && target.includes("vercel.com/api/blob?") && decoded.includes("url=sf/jobs/cas-cleanup-failure.json")) return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-cleanup-failure.json", etag: '"etag-current"' }), { status: 200 });
      if (method === "PUT" && decoded.includes("fromUrl=https://mock.public.blob.vercel-storage.com/sf/jobs/cas-cleanup-failure.json")) { snapshots += 1; return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-cleanup-failure.cas-read." + snapshots + ".json" }), { status: 200 }); }
      if (method === "GET" && target.includes("cas-cleanup-failure.cas-read")) return new Response(JSON.stringify(job), { status: 200 });
      if (method === "POST" && target.includes("blob.vercel-storage.com/delete")) { deleteAttempts += 1; return new Response("unavailable", { status: 503 }); }
      if (method === "POST" && target.includes("/api/jobs/cas-cleanup-failure/advance")) { advances += 1; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
      if (method === "GET" && target.includes("/sf/jobs/cas-cleanup-failure.json")) return new Response(JSON.stringify(job), { status: 200, headers: { etag: '"etag-current"' } });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const result = await engine.dispatchDurableJobAdvance("cas-cleanup-failure", "https://siteforge.example", { awaitDelivery: true });
    if (result !== false || snapshots !== 1 || deleteAttempts !== 3 || advances !== 0) process.exit(2);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("concurrent CAS dispatchers elect one winner, clean both snapshots, and post one advance", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_store_mock";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-cas-concurrent-${process.pid}`))};
    const oldIso = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const job = { id: "cas-concurrent", staged: true, status: "queued", current_stage: "capture_desktop", current_phase: "waiting", next_stage: "capture_desktop", advance_token: "advance-secret", advance_request_id: "req-old", advance_requested_stage: "capture_desktop", advance_requested_at: oldIso, updated_at: oldIso, advance_attempts: 1, stage_payload: { token: "preview-token" } };
    let snapshots = 0, cleanups = 0, mainWrites = 0, advancePosts = 0;
    let releaseWriters; const writersReady = new Promise((resolve) => { releaseWriters = resolve; });
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url), decoded = decodeURIComponent(target), method = options.method || "GET";
      if (method === "GET" && target.includes("blob.vercel-storage.com?prefix=sf")) return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      if (method === "GET" && target.includes("vercel.com/api/blob?") && decoded.includes("url=sf/jobs/cas-concurrent.json")) return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-concurrent.json", etag: '"etag-current"' }), { status: 200 });
      if (method === "PUT" && decoded.includes("fromUrl=https://mock.public.blob.vercel-storage.com/sf/jobs/cas-concurrent.json")) { snapshots += 1; return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-concurrent.cas-read." + snapshots + ".json" }), { status: 200 }); }
      if (method === "GET" && target.includes("cas-concurrent.cas-read")) return new Response(JSON.stringify(job), { status: 200 });
      if (method === "POST" && target.includes("blob.vercel-storage.com/delete")) { cleanups += 1; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
      if (method === "PUT" && decoded.includes("sf/jobs/cas-concurrent.json") && options.headers?.["x-if-match"]) {
        mainWrites += 1;
        if (mainWrites === 2) releaseWriters();
        await writersReady;
        if (mainWrites > 1 && !globalThis.__casWinnerChosen) { globalThis.__casWinnerChosen = true; return new Response(JSON.stringify({ url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-concurrent.json", etag: '"etag-next"' }), { status: 200 }); }
        return new Response(JSON.stringify({ error: { code: "precondition_failed" } }), { status: 412 });
      }
      if (method === "POST" && target.includes("/api/jobs/cas-concurrent/advance")) { advancePosts += 1; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
      if (method === "GET" && target.includes("/sf/jobs/cas-concurrent.json")) return new Response(JSON.stringify(job), { status: 200, headers: { etag: '"etag-current"' } });
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const results = await Promise.all([
      engine.dispatchDurableJobAdvance("cas-concurrent", "https://siteforge.example", { awaitDelivery: true }),
      engine.dispatchDurableJobAdvance("cas-concurrent", "https://siteforge.example", { awaitDelivery: true }),
    ]);
    if (results.filter(Boolean).length !== 1 || snapshots !== 2 || cleanups !== 2 || mainWrites !== 2 || advancePosts !== 1) process.exit(2);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("a dispatcher that loses CAS to a same-attempt worker cannot overwrite that live owner", () => {
  const engineUrl = new URL("../lib/engine-adapter.mjs", import.meta.url).href;
  const script = `
    process.env.SITEFORGE_SERVERLESS = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_store_mock";
    process.env.SITEFORGE_ADVANCE_LEASE_MS = "10";
    process.env.SITEFORGE_DATA_DIR = ${JSON.stringify(path.join(process.env.TEMP || process.cwd(), `sf-cas-worker-claim-${process.pid}`))};
    const staleIso = "2020-01-01T00:00:00.000Z";
    const queuedJob = {
      id: "cas-worker-claim", staged: true, status: "queued", current_stage: "capture_desktop", current_phase: "waiting",
      next_stage: "capture_desktop", advance_token: "advance-secret", advance_request_id: "req-live",
      advance_requested_stage: "capture_desktop", advance_requested_at: staleIso, active_stage: null,
      active_stage_request_id: null, updated_at: staleIso, advance_attempts: 1,
      stage_payload: { token: "cas-worker-claim-preview" },
    };
    let remoteJob = { ...queuedJob };
    let currentEtag = '"etag-queued"';
    let workerClaimed = false;
    let snapshots = 0;
    let cleanups = 0;
    let mainWrites = 0;
    let advancePosts = 0;
    let firstQueuedAttempt = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      const decoded = decodeURIComponent(target);
      const method = options.method || "GET";
      if (method === "GET" && target.includes("vercel.com/api/blob?") && decoded.includes("url=sf/jobs/cas-worker-claim.json")) {
        return new Response(JSON.stringify({
          pathname: "sf/jobs/cas-worker-claim.json",
          url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-worker-claim.json",
          etag: currentEtag,
        }), { status: 200 });
      }
      if (method === "PUT" && decoded.includes("fromUrl=https://mock.public.blob.vercel-storage.com/sf/jobs/cas-worker-claim.json")) {
        snapshots += 1;
        return new Response(JSON.stringify({
          pathname: "sf/jobs/cas-worker-claim.cas-read." + snapshots + ".json",
          url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-worker-claim.cas-read." + snapshots + ".json",
          etag: currentEtag,
        }), { status: 200 });
      }
      if (method === "GET" && target.includes("/sf/jobs/cas-worker-claim.cas-read.")) {
        return new Response(JSON.stringify(remoteJob), { status: 200, headers: { etag: currentEtag } });
      }
      if (method === "POST" && target.includes("blob.vercel-storage.com/delete")) {
        cleanups += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (method === "PUT" && decoded.includes("sf/jobs/cas-worker-claim.json") && options.headers?.["x-if-match"]) {
        mainWrites += 1;
        const proposed = JSON.parse(String(options.body));
        if (mainWrites === 1) {
          firstQueuedAttempt = Number(proposed.advance_attempts || 0);
          workerClaimed = true;
          remoteJob = {
            ...queuedJob,
            status: "running",
            current_phase: "capture",
            active_stage: "capture_desktop",
            active_stage_request_id: "req-live",
            stage_started_at: new Date().toISOString(),
            last_heartbeat_at: staleIso,
          };
          currentEtag = '"etag-running"';
          return new Response(JSON.stringify({ error: { code: "precondition_failed" } }), { status: 412 });
        }
        remoteJob = proposed;
        currentEtag = '"etag-overwritten"';
        return new Response(JSON.stringify({
          url: "https://mock.public.blob.vercel-storage.com/sf/jobs/cas-worker-claim.json",
          etag: currentEtag,
        }), { status: 200 });
      }
      if (method === "GET" && target.includes("/sf/jobs/cas-worker-claim.heartbeat.req-live.json")) {
        return workerClaimed
          ? new Response(JSON.stringify({
            job_id: queuedJob.id,
            stage: "capture_desktop",
            request_id: "req-live",
            attempt: 1,
            at: new Date().toISOString(),
          }), { status: 200 })
          : new Response("not found", { status: 404 });
      }
      if (method === "GET" && target.includes("/sf/jobs/cas-worker-claim.json")) {
        return new Response(JSON.stringify(remoteJob), { status: 200, headers: { etag: currentEtag } });
      }
      if (method === "GET" && target.includes("prefix=sf")) {
        return new Response(JSON.stringify({ blobs: [{ pathname: "sf/anchor.json", url: "https://mock.public.blob.vercel-storage.com/sf/anchor.json" }] }), { status: 200 });
      }
      if (method === "POST" && target.includes("/api/jobs/cas-worker-claim/advance")) {
        advancePosts += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    const engine = await import(${JSON.stringify(engineUrl)});
    const first = await engine.dispatchDurableJobAdvance("cas-worker-claim", "https://siteforge.example", { awaitDelivery: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const second = await engine.dispatchDurableJobAdvance("cas-worker-claim", "https://siteforge.example", { awaitDelivery: true });
    if (first !== false || second !== false) process.exit(2);
    if (firstQueuedAttempt !== 2 || mainWrites !== 1 || advancePosts !== 0) process.exit(3);
    if (snapshots !== 2 || cleanups !== 2) process.exit(4);
    if (
      remoteJob.status !== "running"
      || remoteJob.active_stage_request_id !== "req-live"
      || Number(remoteJob.advance_attempts || 0) !== 1
      || currentEtag !== '"etag-running"'
    ) process.exit(5);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
