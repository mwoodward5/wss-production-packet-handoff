"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CANONICAL_SITEFORGE_BUILD_URL,
  DEFAULT_SITEFORGE_TIMEOUT_MS,
  SITEFORGE_JOB_WINDOW_MS,
  dispatchSiteForgePreview,
  pollSiteForgeJob,
  resolveMirrorDonor,
  resolveStatusUrl,
  siteForgeBuildTarget,
  siteForgeBuildUrl,
  siteForgeTimeoutMs,
} = require("../lib/siteforge");

const BUILD_URL_KEYS = [
  "GHOST_AGENCY_SITEFORGE_BUILD_URL",
  "SITEFORGE_BUILD_URL",
  "WOODWARD_SITEFORGE_BUILD_URL",
];

function assertDurableStatusRequest(url, init, canonicalStatusUrl) {
  const requestUrl = new URL(String(url));
  const cacheBust = requestUrl.searchParams.get("_ts");
  assert.match(cacheBust || "", /^\d+-\d+$/);
  requestUrl.searchParams.delete("_ts");
  assert.equal(requestUrl.toString(), canonicalStatusUrl);
  assert.equal(init.method, "GET");
  assert.equal(init.cache, "no-store");
  assert.equal(init.headers["Cache-Control"], "no-cache");
  assert.equal(init.headers.Pragma, "no-cache");
  return cacheBust;
}

test("SiteForge timeout defaults near the 300-second job window", () => {
  assert.equal(SITEFORGE_JOB_WINDOW_MS, 300_000);
  assert.equal(DEFAULT_SITEFORGE_TIMEOUT_MS, 295_000);
  assert.equal(siteForgeTimeoutMs({}), DEFAULT_SITEFORGE_TIMEOUT_MS);
  assert.equal(siteForgeTimeoutMs({ GHOST_AGENCY_SITEFORGE_TIMEOUT_MS: "invalid" }), DEFAULT_SITEFORGE_TIMEOUT_MS);
});

test("SiteForge timeout honors bounded operator configuration", () => {
  assert.equal(siteForgeTimeoutMs({ GHOST_AGENCY_SITEFORGE_TIMEOUT_MS: "180000" }), 180_000);
  assert.equal(siteForgeTimeoutMs({ GHOST_AGENCY_SITEFORGE_TIMEOUT_MS: "1000" }), 5_000);
  assert.equal(siteForgeTimeoutMs({ GHOST_AGENCY_SITEFORGE_TIMEOUT_MS: "360000" }), SITEFORGE_JOB_WINDOW_MS);
});

test("missing rotated donor uses the registered packaged production override", () => {
  const resolved = resolveMirrorDonor({
    donor_id: "unpackaged-rotated-donor",
    source: { path: "github-template-intelligence/mirrors/not-packaged" },
    donor_manifest: { name: "Unpackaged Donor" },
  }, {
    env: { GHOST_AGENCY_MIRROR_DONOR_PATH: "boilerplates/roofing-tekline" },
    backendRoot: path.join(__dirname, ".."),
  });

  assert.equal(resolved.donor.donor_id, "roofing-tekline");
  assert.equal(resolved.donorRel, "boilerplates/roofing-tekline");
  assert.equal(resolved.donor.donor_manifest.name, "Tekline Roofing");
});

test("retired SiteForge host migrates to the canonical V8 build endpoint with a diagnostic", () => {
  const staleEnv = {
    GHOST_AGENCY_SITEFORGE_BUILD_URL: "https://siteforge-app-rocketsites.vercel.app/api/ghost-agency/build-preview",
  };
  const target = siteForgeBuildTarget(staleEnv);

  assert.equal(siteForgeBuildUrl(staleEnv), CANONICAL_SITEFORGE_BUILD_URL);
  assert.equal(target.url, CANONICAL_SITEFORGE_BUILD_URL);
  assert.deepEqual(target.migration, {
    code: "retired_siteforge_build_host_migrated",
    from_host: "siteforge-app-rocketsites.vercel.app",
    canonical_url: CANONICAL_SITEFORGE_BUILD_URL,
  });

  const customUrl = "https://siteforge.internal.example/api/ghost-agency/build-preview";
  assert.deepEqual(siteForgeBuildTarget({ SITEFORGE_BUILD_URL: customUrl }), {
    url: customUrl,
    migration: null,
  });
});

test("SiteForge deployment and example config match the job window", () => {
  const vercelConfig = JSON.parse(readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  const envExample = readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
  const siteForgeRoutes = [
    "api/admin/build-preview.js",
    "api/admin/owner-smoke.js",
    "api/admin/full-run.js",
    "api/cron/nightly-pipeline.js",
  ];

  // api/admin/line.js also carries an explicit 800s entry (drain_emails
  // budget law, PR #570) — assert membership per-route instead of order.
  for (const route of siteForgeRoutes) {
    assert.ok(vercelConfig.functions[route], `missing explicit entry for ${route}`);
  }
  // Build-running surfaces were raised to 800s on 2026-08-31: full mirror
  // builds run 240-260s+ and the old 300s cap killed the function mid-settle
  // (every long build froze as a lost-settle zombie). The catch-all stays 300.
  for (const route of siteForgeRoutes) {
    assert.equal(vercelConfig.functions[route].maxDuration, 800);
  }
  assert.equal(vercelConfig.functions["api/**/*.js"].maxDuration, 300);
  assert.match(envExample, /^GHOST_AGENCY_SITEFORGE_TIMEOUT_MS=295000$/m);
});

test("unconfigured SiteForge remains handoff-only with no send permission", async (t) => {
  const previous = new Map(BUILD_URL_KEYS.map((key) => [key, process.env[key]]));
  for (const key of BUILD_URL_KEYS) delete process.env[key];
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const result = await dispatchSiteForgePreview({
    prospect: { prospect_id: "timeout-test", business_name: "Timeout Test Plumbing" },
    job: { id: "timeout-test-job", packets: { site: {}, report: {} } },
    truthPacket: {},
  });

  assert.equal(result.configured, false);
  assert.equal(result.mode, "handoff_packet");
  assert.equal(result.payload.requirements.privatePreview, true);
  assert.equal(result.payload.requirements.noIndex, true);
  assert.ok(result.payload.requirements.previewAcceptance.some((rule) =>
    rule.includes("does not publish, email, charge"),
  ));
});

test("queued SiteForge dispatch returns the durable handle without holding the operator request", async (t) => {
  const oldFetch = global.fetch;
  const previous = new Map(BUILD_URL_KEYS.map((key) => [key, process.env[key]]));
  process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL = "https://siteforge.example/api/ghost-agency/build-preview";
  delete process.env.SITEFORGE_BUILD_URL;
  delete process.env.WOODWARD_SITEFORGE_BUILD_URL;
  let calls = 0;
  global.fetch = async (_url, init) => {
    calls += 1;
    assert.equal(init.headers["Idempotency-Key"], "queued-test-job");
    assert.equal(init.headers["X-Correlation-Id"], "queued-test-job");
    return new Response(JSON.stringify({ ok: true, status: "queued", pending: true, job_id: "job-42", status_url: "/api/ghost-agency/build-preview/job-42" }), { status: 202 });
  };
  t.after(() => {
    global.fetch = oldFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const result = await dispatchSiteForgePreview({
    prospect: { prospect_id: "queued-test", business_name: "Queued Test Plumbing" },
    job: { id: "queued-test-job", packets: { site: {}, report: {} } },
    truthPacket: {},
  });
  assert.equal(result.pending, true);
  assert.equal(result.statusUrl, "https://siteforge.example/api/ghost-agency/build-preview/job-42");
  assert.equal(calls, 1);
});

test("awaited owner proof follows one initial POST to a terminal durable result with GET only", async (t) => {
  const oldFetch = global.fetch;
  const previous = new Map(BUILD_URL_KEYS.map((key) => [key, process.env[key]]));
  const previousPollInterval = process.env.GHOST_AGENCY_SITEFORGE_POLL_INTERVAL_MS;
  process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL = "https://siteforge.example/api/ghost-agency/build-preview";
  process.env.GHOST_AGENCY_SITEFORGE_POLL_INTERVAL_MS = "250";
  delete process.env.SITEFORGE_BUILD_URL;
  delete process.env.WOODWARD_SITEFORGE_BUILD_URL;
  const methods = [];
  const cacheBusts = [];
  const statusUrl = "https://siteforge.example/api/ghost-agency/build-preview/job-owner-42";
  global.fetch = async (url, init) => {
    methods.push(init.method);
    if (init.method === "POST") {
      assert.equal(String(url), "https://siteforge.example/api/ghost-agency/build-preview");
      assert.equal(init.headers["Idempotency-Key"], "awaited-owner-job");
      return new Response(JSON.stringify({
        ok: true,
        status: "queued",
        pending: true,
        job_id: "job-owner-42",
        status_url: "/api/ghost-agency/build-preview/job-owner-42",
      }), { status: 202 });
    }
    cacheBusts.push(assertDurableStatusRequest(url, init, statusUrl));
    if (methods.length === 2) {
      return new Response(JSON.stringify({
        ok: true,
        status: "running",
        pending: true,
        job_id: "job-owner-42",
      }), { status: 202 });
    }
    return new Response(JSON.stringify({
      ok: true,
      status: "ready",
      pending: false,
      job_id: "job-owner-42",
      renderer: "05-build-v8",
      generation_fingerprint: "owner-proof-terminal-v8",
      qc_passed: true,
      visual_qc_passed: true,
      qc_contract: "public-surface-v2",
      urls: {
        preview_url: "https://siteforge.example/try/job-owner-42/",
        report_url: "https://siteforge.example/try/job-owner-42/scorecard.json",
      },
    }), { status: 200 });
  };
  t.after(() => {
    global.fetch = oldFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (previousPollInterval === undefined) delete process.env.GHOST_AGENCY_SITEFORGE_POLL_INTERVAL_MS;
    else process.env.GHOST_AGENCY_SITEFORGE_POLL_INTERVAL_MS = previousPollInterval;
  });

  const result = await dispatchSiteForgePreview({
    prospect: { prospect_id: "awaited-owner", business_name: "Awaited Owner Plumbing" },
    job: { id: "awaited-owner-job", packets: { site: {}, report: {} } },
    truthPacket: {},
    awaitTerminal: true,
    deadlineAt: Date.now() + 5_000,
  });

  assert.deepEqual(methods, ["POST", "GET", "GET"]);
  assert.equal(new Set(cacheBusts).size, 2);
  assert.equal(result.pending, false);
  assert.equal(result.buildStatus.ready, true);
  assert.equal(result.jobId, "job-owner-42");
  assert.equal(result.statusUrl, statusUrl);
  assert.equal(result.urls.preview_url, "https://siteforge.example/try/job-owner-42/");
});

test("awaited owner proof bounds its initial POST by the same absolute deadline", async (t) => {
  const oldFetch = global.fetch;
  const previous = new Map(BUILD_URL_KEYS.map((key) => [key, process.env[key]]));
  process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL = "https://siteforge.example/api/ghost-agency/build-preview";
  delete process.env.SITEFORGE_BUILD_URL;
  delete process.env.WOODWARD_SITEFORGE_BUILD_URL;
  let calls = 0;
  global.fetch = async (_url, init) => {
    calls += 1;
    return new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  };
  t.after(() => {
    global.fetch = oldFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const started = Date.now();
  await assert.rejects(
    dispatchSiteForgePreview({
      prospect: { prospect_id: "owner-deadline", business_name: "Owner Deadline Plumbing" },
      job: { id: "owner-deadline-job", packets: { site: {}, report: {} } },
      truthPacket: {},
      awaitTerminal: true,
      deadlineAt: started + 50,
    }),
    (error) => error?.name === "AbortError",
  );

  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 1_000);
});

test("expired awaited owner proof does not issue a resumed status GET", async (t) => {
  const oldFetch = global.fetch;
  const previous = new Map(BUILD_URL_KEYS.map((key) => [key, process.env[key]]));
  process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL = "https://siteforge.example/api/ghost-agency/build-preview";
  delete process.env.SITEFORGE_BUILD_URL;
  delete process.env.WOODWARD_SITEFORGE_BUILD_URL;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new Error("expired owner proof must not fetch");
  };
  t.after(() => {
    global.fetch = oldFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const statusUrl = "https://siteforge.example/api/ghost-agency/build-preview/job-expired-resume";
  const result = await dispatchSiteForgePreview({
    prospect: { prospect_id: "expired-resume", business_name: "Expired Resume Plumbing" },
    job: { id: "expired-resume-job", packets: { site: {}, report: {} } },
    truthPacket: {},
    resume: { job_id: "job-expired-resume", status_url: statusUrl },
    awaitTerminal: true,
    deadlineAt: Date.now() - 1,
  });

  assert.equal(calls, 0);
  assert.equal(result.pending, true);
  assert.equal(result.jobId, "job-expired-resume");
  assert.equal(result.statusUrl, statusUrl);
  assert.equal(result.result.status, 408);
  assert.equal(result.result.json.code, "siteforge_deadline_exhausted");
  assert.equal(result.buildStatus.ready, false);
});

test("expired awaited owner proof does not issue its initial POST", async (t) => {
  const oldFetch = global.fetch;
  const previous = new Map(BUILD_URL_KEYS.map((key) => [key, process.env[key]]));
  process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL = "https://siteforge.example/api/ghost-agency/build-preview";
  delete process.env.SITEFORGE_BUILD_URL;
  delete process.env.WOODWARD_SITEFORGE_BUILD_URL;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new Error("expired owner proof must not fetch");
  };
  t.after(() => {
    global.fetch = oldFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const result = await dispatchSiteForgePreview({
    prospect: { prospect_id: "expired-post", business_name: "Expired Post Plumbing" },
    job: { id: "expired-post-job", packets: { site: {}, report: {} } },
    truthPacket: {},
    awaitTerminal: true,
    deadlineAt: Date.now() - 1,
  });

  assert.equal(calls, 0);
  assert.equal(result.pending, false);
  assert.equal(result.jobId, "");
  assert.equal(result.statusUrl, "");
  assert.equal(result.result.status, 408);
  assert.equal(result.result.json.status, "held");
  assert.equal(result.result.json.code, "siteforge_deadline_exhausted");
  assert.equal(result.buildStatus.ready, false);
});

test("resumed SiteForge status new remains pending and preserves its durable handle", async (t) => {
  const oldFetch = global.fetch;
  const previous = new Map(BUILD_URL_KEYS.map((key) => [key, process.env[key]]));
  process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL = "https://siteforge.example/api/ghost-agency/build-preview";
  delete process.env.SITEFORGE_BUILD_URL;
  delete process.env.WOODWARD_SITEFORGE_BUILD_URL;
  const statusUrl = "https://siteforge.example/api/ghost-agency/build-preview/job-new";
  let calls = 0;
  global.fetch = async (url, init) => {
    calls += 1;
    assertDurableStatusRequest(url, init, statusUrl);
    return new Response(JSON.stringify({ ok: true, status: "new", job_id: "job-response-drift" }), { status: 200 });
  };
  t.after(() => {
    global.fetch = oldFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const result = await dispatchSiteForgePreview({
    prospect: { prospect_id: "resumed-new", business_name: "Resumed New Plumbing" },
    job: { id: "resumed-new-job", packets: { site: {}, report: {} } },
    truthPacket: {},
    resume: { job_id: "job-new", status_url: statusUrl },
  });

  assert.equal(calls, 1);
  assert.equal(result.pending, true);
  assert.equal(result.jobId, "job-new");
  assert.equal(result.statusUrl, statusUrl);
  assert.equal(result.buildStatus.pending, true);
  assert.equal(result.buildStatus.ready, false);
  assert.deepEqual(result.buildStatus.blocked, []);
  assert.equal(result.urls.preview_url, "");
  assert.equal(result.urls.report_url, "");
});

test("resumed SiteForge state alias new overrides pending false and preserves its durable handle", async (t) => {
  const oldFetch = global.fetch;
  const previous = new Map(BUILD_URL_KEYS.map((key) => [key, process.env[key]]));
  process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL = "https://siteforge.example/api/ghost-agency/build-preview";
  delete process.env.SITEFORGE_BUILD_URL;
  delete process.env.WOODWARD_SITEFORGE_BUILD_URL;
  const statusUrl = "https://siteforge.example/api/ghost-agency/build-preview/job-state-new";
  let calls = 0;
  global.fetch = async (url, init) => {
    calls += 1;
    assertDurableStatusRequest(url, init, statusUrl);
    return new Response(JSON.stringify({
      ok: true,
      state: "new",
      pending: false,
      job_id: "job-response-drift",
    }), { status: 200 });
  };
  t.after(() => {
    global.fetch = oldFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const result = await dispatchSiteForgePreview({
    prospect: { prospect_id: "resumed-state-new", business_name: "Resumed State New Plumbing" },
    job: { id: "resumed-state-new-job", packets: { site: {}, report: {} } },
    truthPacket: {},
    resume: { job_id: "job-state-new", status_url: statusUrl },
  });

  assert.equal(calls, 1);
  assert.equal(result.pending, true);
  assert.equal(result.jobId, "job-state-new");
  assert.equal(result.statusUrl, statusUrl);
  assert.equal(result.buildStatus.pending, true);
  assert.equal(result.buildStatus.ready, false);
  assert.deepEqual(result.buildStatus.blocked, []);
  assert.equal(result.urls.preview_url, "");
  assert.equal(result.urls.report_url, "");
});

for (const terminalState of ["failed", "blocked", "timed_out"]) {
  test(`resumed terminal SiteForge ${terminalState} job starts one fresh photo-only build`, async (t) => {
    const oldFetch = global.fetch;
    const previous = new Map(BUILD_URL_KEYS.map((key) => [key, process.env[key]]));
    const buildUrl = "https://siteforge.example/api/ghost-agency/build-preview";
    const oldStatusUrl = `${buildUrl}/job-terminal`;
    const newStatusUrl = `${buildUrl}/job-replacement`;
    process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL = buildUrl;
    delete process.env.SITEFORGE_BUILD_URL;
    delete process.env.WOODWARD_SITEFORGE_BUILD_URL;
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body });
      if (calls.length === 1) {
        assertDurableStatusRequest(url, init, oldStatusUrl);
        return new Response(JSON.stringify({
          ok: false,
          status: terminalState,
          pending: false,
          job_id: "job-terminal",
          code: "generation_failed",
        }), { status: 422 });
      }
      assert.equal(String(url), buildUrl);
      assert.equal(init.method, "POST");
      return new Response(JSON.stringify({
        ok: true,
        status: "queued",
        pending: true,
        job_id: "job-replacement",
        status_url: newStatusUrl,
      }), { status: 202 });
    };
    t.after(() => {
      global.fetch = oldFetch;
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    const result = await dispatchSiteForgePreview({
      prospect: { prospect_id: `resumed-${terminalState}`, business_name: "Terminal Resume Plumbing" },
      job: { id: `resumed-${terminalState}-job`, packets: { site: {}, report: {} } },
      truthPacket: {},
      resume: { job_id: "job-terminal", status_url: oldStatusUrl },
    });

    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[1].body).injected_media, undefined);
    assert.equal(result.pending, true);
    assert.equal(result.jobId, "job-replacement");
    assert.equal(result.statusUrl, newStatusUrl);
  });
}

test("resumed ready SiteForge job remains on its original durable handle", async (t) => {
  const oldFetch = global.fetch;
  const previous = new Map(BUILD_URL_KEYS.map((key) => [key, process.env[key]]));
  const buildUrl = "https://siteforge.example/api/ghost-agency/build-preview";
  const statusUrl = `${buildUrl}/job-ready`;
  process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL = buildUrl;
  delete process.env.SITEFORGE_BUILD_URL;
  delete process.env.WOODWARD_SITEFORGE_BUILD_URL;
  let calls = 0;
  global.fetch = async (url, init) => {
    calls += 1;
    assertDurableStatusRequest(url, init, statusUrl);
    return new Response(JSON.stringify({
      ok: true,
      status: "ready",
      pending: false,
      job_id: "job-ready",
      renderer: "05-build-v8",
      generation_fingerprint: "ready-fingerprint",
      qc_passed: true,
      visual_qc_passed: true,
      qc_contract: "public-surface-v2",
      grade: "A",
      preview_url: "https://siteforge.example/try/job-ready/",
      report_url: "https://siteforge.example/try/job-ready/scorecard.json",
    }), { status: 200 });
  };
  t.after(() => {
    global.fetch = oldFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const result = await dispatchSiteForgePreview({
    prospect: { prospect_id: "resumed-ready", business_name: "Ready Resume Plumbing" },
    job: { id: "resumed-ready-job", packets: { site: {}, report: {} } },
    truthPacket: {},
    resume: { job_id: "job-ready", status_url: statusUrl },
  });

  assert.equal(calls, 1);
  assert.equal(result.pending, false);
  assert.equal(result.jobId, "job-ready");
  assert.equal(result.statusUrl, statusUrl);
  assert.equal(result.buildStatus.ready, true);
});

test("resumed terminal SiteForge response with a mismatched job id does not redispatch", async (t) => {
  const oldFetch = global.fetch;
  const previous = new Map(BUILD_URL_KEYS.map((key) => [key, process.env[key]]));
  const buildUrl = "https://siteforge.example/api/ghost-agency/build-preview";
  const statusUrl = `${buildUrl}/job-expected`;
  process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL = buildUrl;
  delete process.env.SITEFORGE_BUILD_URL;
  delete process.env.WOODWARD_SITEFORGE_BUILD_URL;
  let calls = 0;
  global.fetch = async (url, init) => {
    calls += 1;
    assertDurableStatusRequest(url, init, statusUrl);
    return new Response(JSON.stringify({
      ok: false,
      status: "failed",
      pending: false,
      job_id: "job-other",
      code: "generation_failed",
    }), { status: 422 });
  };
  t.after(() => {
    global.fetch = oldFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const result = await dispatchSiteForgePreview({
    prospect: { prospect_id: "resumed-mismatch", business_name: "Mismatched Resume Plumbing" },
    job: { id: "resumed-mismatch-job", packets: { site: {}, report: {} } },
    truthPacket: {},
    resume: { job_id: "job-expected", status_url: statusUrl },
  });

  assert.equal(calls, 1);
  assert.equal(result.pending, false);
  assert.equal(result.jobId, "job-expected");
  assert.equal(result.statusUrl, statusUrl);
});

test("durable SiteForge polling follows a queued job to its final contract", async () => {
  let clock = 0;
  let calls = 0;
  const requestBudgets = [];
  const requestedUrls = [];
  const statusUrl = "https://siteforge.example/api/ghost-agency/build-preview/job-42";
  const result = await pollSiteForgeJob({
    statusUrl,
    timeoutMs: 100,
    intervalMs: 10,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetchJson: async (url, headers, requestTimeoutMs) => {
      const requestUrl = new URL(url);
      requestedUrls.push(requestUrl.toString());
      assert.match(requestUrl.searchParams.get("_ts") || "", /^\d+-\d+$/);
      requestUrl.searchParams.delete("_ts");
      assert.equal(requestUrl.toString(), statusUrl);
      assert.equal(headers["Cache-Control"], "no-cache");
      assert.equal(headers.Pragma, "no-cache");
      requestBudgets.push(requestTimeoutMs);
      calls += 1;
      if (calls === 1) return { ok: true, status: 202, json: { status: "running", pending: true } };
      return {
        ok: true,
        status: 200,
        json: {
          status: "ready",
          pending: false,
          renderer: "05-build-v8",
          preview_url: "https://siteforge.example/try/job-42/",
          report_url: "https://siteforge.example/try/job-42/scorecard.json",
        },
      };
    },
  });

  assert.equal(calls, 2);
  assert.equal(new Set(requestedUrls).size, 2);
  assert.deepEqual(requestBudgets, [2_100, 2_090]);
  assert.equal(result.status, 200);
  assert.equal(result.json.status, "ready");
  assert.equal(result.json.pending, false);
  assert.equal(result.json.preview_url, "https://siteforge.example/try/job-42/");
});

test("durable SiteForge polling returns a resumable pending result at its deadline", async () => {
  let clock = 0;
  const statusUrl = "https://siteforge.example/api/ghost-agency/build-preview/job-pending";
  const result = await pollSiteForgeJob({
    statusUrl,
    timeoutMs: 25,
    intervalMs: 10,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetchJson: async () => ({ ok: true, status: 202, json: { status: "queued", pending: true, job_id: "job-pending" } }),
  });

  assert.equal(result.status, 202);
  assert.equal(result.json.pending, true);
  assert.equal(result.json.status, "building");
  assert.equal(result.json.status_url, statusUrl);
  assert.equal(result.json.preview_url, undefined);
  assert.equal(result.json.report_url, undefined);
});

test("durable SiteForge polling accepts a terminal 200 that crosses the deadline inside network grace", async () => {
  let clock = 0;
  let calls = 0;
  const statusUrl = "https://siteforge.example/api/ghost-agency/build-preview/job-boundary-ready";
  const result = await pollSiteForgeJob({
    statusUrl,
    timeoutMs: 492,
    intervalMs: 10,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetchJson: async (_url, _headers, requestTimeoutMs) => {
      calls += 1;
      assert.equal(requestTimeoutMs, 2_492);
      clock += 800;
      return {
        ok: true,
        status: 200,
        json: {
          status: "ready",
          pending: false,
          job_id: "job-boundary-ready",
          preview_url: "https://siteforge.example/try/job-boundary-ready/",
        },
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(clock, 800);
  assert.equal(result.status, 200);
  assert.equal(result.json.status, "ready");
  assert.equal(result.json.pending, false);
});

test("durable SiteForge polling keeps a timed-out boundary read pending after bounded grace", async () => {
  let clock = 0;
  let calls = 0;
  const statusUrl = "https://siteforge.example/api/ghost-agency/build-preview/job-boundary-timeout";
  const result = await pollSiteForgeJob({
    statusUrl,
    timeoutMs: 492,
    intervalMs: 10,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetchJson: async (_url, _headers, requestTimeoutMs) => {
      calls += 1;
      assert.equal(requestTimeoutMs, 2_492);
      clock += requestTimeoutMs;
      throw new Error("status read timed out");
    },
  });

  assert.equal(calls, 1);
  assert.equal(clock, 2_492);
  assert.equal(result.status, 202);
  assert.equal(result.json.status, "building");
  assert.equal(result.json.pending, true);
  assert.equal(result.json.status_url, statusUrl);
});

test("durable SiteForge polling never starts a new status request after the deadline", async () => {
  let clock = 0;
  let calls = 0;
  const statusUrl = "https://siteforge.example/api/ghost-agency/build-preview/job-boundary-pending";
  const result = await pollSiteForgeJob({
    statusUrl,
    timeoutMs: 492,
    intervalMs: 10,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetchJson: async () => {
      calls += 1;
      clock = 492;
      return {
        ok: true,
        status: 202,
        json: { status: "building", pending: true, job_id: "job-boundary-pending" },
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.status, 202);
  assert.equal(result.json.pending, true);
  assert.equal(result.json.status_url, statusUrl);
});

test("relative durable status URLs resolve against the configured SiteForge host", () => {
  assert.equal(
    resolveStatusUrl({ status_url: "/api/ghost-agency/build-preview/job-42" }, CANONICAL_SITEFORGE_BUILD_URL),
    "https://siteforge-app-seven.vercel.app/api/ghost-agency/build-preview/job-42",
  );
});
