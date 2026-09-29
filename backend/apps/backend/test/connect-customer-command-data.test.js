"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const calls = require("../api/connect/_customer-calls");
const command = require("../api/connect/_customer-command");

const SLUG = "wss-test-poor-john-s-plumbing-parkville";
const SITE = `https://${SLUG}.wss-ai.com/`;
const RILEY = "riley-command-center-test";
const NOW = Date.parse("2026-08-11T18:00:00.000Z");

function prospect(prospectId, site = SITE, extra = {}) {
  return {
    prospect_id: prospectId,
    preview_url: site,
    record: {
      preview_url: site,
      build_dispatch: { ready: true, qc_passed: true, visual_qc_passed: true },
    },
    ...extra,
  };
}

function event(callId, prospectId, summary, extra = {}) {
  return {
    id: `event-${callId}`,
    type: calls.CALL_EVENT,
    payload: { actor: calls.RILEY_EVENT_ACTOR, status: "ok", prospect_id: prospectId, call_id: callId, summary },
    created_at: "2026-08-11T17:00:00.000Z",
    ...extra,
  };
}

function headers(values = {}) {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { get(name) { return normalized.get(String(name).toLowerCase()) || null; } };
}

function jsonResponse(body, status = 200, values = {}) {
  const raw = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers({ "content-type": "application/json", "content-length": Buffer.byteLength(raw), ...values }),
    text: async () => raw,
    json: async () => body,
  };
}

function providerCall(id, prospectId, extra = {}) {
  return {
    id,
    assistantId: RILEY,
    metadata: { prospect_id: prospectId },
    createdAt: "2026-08-11T16:59:00.000Z",
    ...extra,
  };
}

function selectFor({ events = [], prospects = {}, edits = [], failTable = "" } = {}) {
  return async (table, query = "") => {
    if (table === failTable) return { ok: false, mode: "live_select_failed", data: [] };
    if (table === "ghost_agency_events") return { ok: true, mode: "live_select", data: events };
    if (table === "ghost_agency_edit_jobs") return { ok: true, mode: "live_select", data: edits };
    if (table === "ghost_agency_prospects") {
      const match = String(query).match(/prospect_id=eq\.([^&]+)/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        return { ok: true, mode: "live_select", data: prospects[id] || [] };
      }
      return { ok: true, mode: "live_select", data: Object.values(prospects).flat() };
    }
    throw new Error(`unexpected table ${table}`);
  };
}

test("call list proves tenant prospect and Riley provider identity before counting", async () => {
  const rows = [
    event("call-booked", "mine", {
      outcome: "booked",
      request: "Drain repair for 816-555-0110, owner@example.com, https://private.example/lead",
      direction: "inbound",
      duration_seconds: 91,
    }),
    event("call-no-answer", "mine", { outcome: "no_answer", notes: "No pickup" }),
    event("call-foreign", "theirs", { outcome: "booked", request: "Foreign job" }),
    event("call-untrusted-actor", "mine", { outcome: "booked" }, {
      payload: { actor: "some.other.agent", prospect_id: "mine", call_id: "call-untrusted-actor", summary: { outcome: "booked" } },
    }),
  ];
  const provider = {
    "call-booked": providerCall("call-booked", "mine", {
      transcript: "Customer: please call me back",
      artifact: { recording: "https://audio.example.test/call-booked.mp3" },
      compliance: { consent: true },
    }),
    "call-no-answer": providerCall("call-no-answer", "mine"),
  };
  const requested = [];
  const fetchImpl = async (url, init) => {
    requested.push({ url: String(url), init });
    const id = decodeURIComponent(String(url).split("/").pop());
    return jsonResponse(provider[id] || {}, provider[id] ? 200 : 404);
  };
  const result = await calls.loadTenantCalls({
    siteSlug: SLUG,
    now: NOW,
    env: { VAPI_API_KEY: "secret", VAPI_RILEY_ASSISTANT_ID: RILEY },
    fetchImpl,
    select: selectFor({
      events: rows,
      prospects: {
        mine: [prospect("injected", "https://someone-else.wss-ai.com/"), prospect("mine")],
        theirs: [prospect("theirs", "https://someone-else.wss-ai.com/")],
      },
    }),
  });

  assert.equal(result.complete, true);
  assert.equal(result.answered, 1, "no-answer completion is not an answered call");
  assert.equal(result.answerCoverage, "complete");
  assert.deepEqual(result.items.map((item) => item.id), ["call-booked", "call-no-answer"]);
  assert.equal(result.items[0].answered, true);
  assert.equal(result.items[1].answered, false);
  assert.equal(result.items[0].transcriptAvailable, true);
  assert.equal(result.items[0].recordingAvailable, false, "generic consent cannot unlock recording");
  assert.doesNotMatch(JSON.stringify(result), /816-555|owner@example|private\.example|call-foreign/);
  assert.equal(requested.length, 2, "foreign and untrusted events never reach the provider");
  assert.ok(requested.every((request) => request.init.headers.Authorization === "Bearer secret"));
});

test("assistant or provider prospect mismatch is omitted from list", async () => {
  const rows = [event("wrong-assistant", "mine", { outcome: "booked" }), event("wrong-prospect", "mine", { outcome: "booked" })];
  const provider = {
    "wrong-assistant": providerCall("wrong-assistant", "mine", { assistantId: "not-riley" }),
    "wrong-prospect": providerCall("wrong-prospect", "someone-else"),
  };
  const result = await calls.loadTenantCalls({
    siteSlug: SLUG,
    now: NOW,
    env: { VAPI_API_KEY: "secret", VAPI_RILEY_ASSISTANT_ID: RILEY },
    fetchImpl: async (url) => jsonResponse(provider[decodeURIComponent(String(url).split("/").pop())]),
    select: selectFor({ events: rows, prospects: { mine: [prospect("mine")] } }),
  });
  assert.equal(result.answered, 0);
  assert.deepEqual(result.items, []);
});

test("completed or unknown outcome omits Calls answered instead of inventing a KPI", async () => {
  for (const outcome of ["completed", "mystery_state"]) {
    const row = event(`call-${outcome}`, "mine", { outcome });
    const result = await calls.loadTenantCalls({
      siteSlug: SLUG,
      now: NOW,
      env: { VAPI_API_KEY: "secret", VAPI_RILEY_ASSISTANT_ID: RILEY },
      fetchImpl: async () => jsonResponse(providerCall(`call-${outcome}`, "mine")),
      select: selectFor({ events: [row], prospects: { mine: [prospect("mine")] } }),
    });
    assert.equal(Object.prototype.hasOwnProperty.call(result, "answered"), false);
    assert.equal(result.answerCoverage, "incomplete");
    assert.equal(Object.prototype.hasOwnProperty.call(result.items[0], "answered"), false);
  }
});

test("overview preserves known site, report, and edits when calls are unavailable", async () => {
  const surface = {
    site: { available: true, url: SITE, host: `${SLUG}.wss-ai.com`, reason: "" },
    report: {
      available: true,
      url: "https://callprep.wss-ai.com/report/poor-johns",
      grade: "B",
      score: 83,
      weakest: [{ label: "Local listings", score: 61 }],
      reason: "",
    },
  };
  const overview = await command.loadCustomerOverview({
    siteSlug: SLUG,
    surface,
    now: NOW,
    select: selectFor({
      failTable: "ghost_agency_events",
      prospects: { mine: [prospect("mine")] },
      edits: [{
        site_slug: SLUG,
        status: "done",
        result: { summary: "Updated the service list." },
        created_at: "2026-08-10T15:00:00Z",
        updated_at: "2026-08-10T15:01:00Z",
      }],
    }),
  });
  assert.deepEqual(overview.siteStatus, { state: "ready", label: "Site is ready" });
  assert.deepEqual(overview.lastEdit, { at: "2026-08-10T15:01:00.000Z", summary: "Updated the service list." });
  assert.equal(overview.reportAction.label, "Improve Local listings");
  assert.equal(overview.sources.site, true);
  assert.equal(overview.sources.edits, true);
  assert.equal(overview.sources.calls, false);
  assert.equal(overview.calls.complete, false);
  assert.equal(Object.prototype.hasOwnProperty.call(overview.calls, "answered"), false);
});

test("last edit is DONE, tenant-only, newest, sanitized, and summary-only", async () => {
  const overview = await command.loadCustomerOverview({
    siteSlug: SLUG,
    surface: { site: { available: true }, report: { available: false, reason: "no_report_on_file" } },
    now: NOW,
    select: selectFor({
      events: [],
      prospects: { mine: [prospect("mine")] },
      edits: [
        { site_slug: "someone-else", status: "done", result: { summary: "Foreign edit" }, updated_at: "2026-08-11T17:59:00Z" },
        { site_slug: SLUG, status: "running", result: { summary: "Not done" }, updated_at: "2026-08-11T17:58:00Z" },
        { site_slug: SLUG, status: "done", result: { summary: "Changed hours; email owner@example.com." }, updated_at: "2026-08-11T17:57:00Z" },
        { site_slug: SLUG, status: "done", result: { say: "Internal say must not become the summary" }, updated_at: "2026-08-10T17:00:00Z" },
      ],
    }),
  });
  assert.equal(overview.lastEdit.summary, "Changed hours; email [contact omitted].");
  assert.equal(overview.editActivity.length, 2);
  assert.equal(overview.editActivity[1].summary, "Editor made an edit.");
  assert.doesNotMatch(JSON.stringify(overview), /Foreign edit|Not done|Internal say/);
  assert.equal(overview.calls.answered, 0, "successful empty call source is a real zero");
});

test("artifact detail re-proves event, prospect, provider metadata, Riley, and retention", async () => {
  const ownEvent = event("call-detail", "mine", { outcome: "message_taken", request: "Needs a water heater quote" });
  const base = {
    callId: "call-detail",
    siteSlug: SLUG,
    now: NOW,
    select: selectFor({ events: [ownEvent], prospects: { mine: [prospect("mine")] } }),
    env: { VAPI_API_KEY: "secret", VAPI_RILEY_ASSISTANT_ID: RILEY },
  };
  const generic = await calls.loadCustomerCallArtifact({
    ...base,
    fetchImpl: async () => jsonResponse(providerCall("call-detail", "mine", {
      transcript: [{ role: "assistant", message: "How can I help?" }, { role: "customer", message: "Water heater" }],
      artifact: { recording: "https://audio.example.test/call.mp3" },
      compliance: { consent: true },
    })),
  });
  assert.equal(generic.response.transcriptAvailable, true);
  assert.match(generic.response.transcript, /assistant: How can I help/);
  assert.equal(generic.response.recordingAvailable, false);
  assert.equal(generic.response.recordingReason, "recording_consent_not_recorded");
  assert.equal(generic.response.audioPath, null);

  const explicit = await calls.loadCustomerCallArtifact({
    ...base,
    fetchImpl: async () => jsonResponse(providerCall("call-detail", "mine", {
      artifact: { recording: "https://audio.example.test/call.mp3" },
      compliance: { recordingConsent: true },
    })),
  });
  assert.equal(explicit.response.recordingAvailable, true);
  assert.equal(explicit.response.audioPath, "/api/connect/site?callId=call-detail&audio=1");

  for (const changed of [
    { assistantId: "not-riley" },
    { metadata: { prospect_id: "someone-else" } },
    { id: "different-call" },
  ]) {
    await assert.rejects(
      calls.loadCustomerCallArtifact({ ...base, fetchImpl: async () => jsonResponse(providerCall("call-detail", "mine", changed)) }),
      (error) => error.statusCode === 404 && error.code === "call_not_found",
    );
  }
});

test("foreign and nonexistent artifact IDs are the same 404 and never call VAPI", async () => {
  let providerReads = 0;
  const fetchImpl = async () => { providerReads += 1; return jsonResponse({}); };
  for (const [callId, rows, prospects] of [
    ["missing", [], {}],
    ["foreign", [event("foreign", "theirs", { outcome: "booked" })], { theirs: [prospect("theirs", "https://other.wss-ai.com/")] }],
    ["expired", [event("expired", "mine", { outcome: "booked" }, { created_at: "2026-07-01T00:00:00Z" })], { mine: [prospect("mine")] }],
  ]) {
    await assert.rejects(
      calls.loadCustomerCallArtifact({ callId, siteSlug: SLUG, select: selectFor({ events: rows, prospects }), now: NOW, fetchImpl, env: { VAPI_API_KEY: "secret", VAPI_RILEY_ASSISTANT_ID: RILEY } }),
      (error) => error.statusCode === 404 && error.code === "call_not_found",
    );
  }
  assert.equal(providerReads, 0);
});

test("audio proxy keeps the VAPI key off signed media and enforces same-origin response", async () => {
  const seen = [];
  const audio = Buffer.from("small-audio-body");
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    if (String(url).includes("api.vapi.ai")) {
      return { status: 302, ok: false, headers: headers({ location: "https://signed.audio.example.test/clip.mp3" }) };
    }
    return {
      status: 206,
      ok: true,
      headers: headers({ "content-type": "audio/mpeg", "content-length": audio.length, "content-range": `bytes 0-${audio.length - 1}/${audio.length}`, "accept-ranges": "bytes" }),
      arrayBuffer: async () => audio,
      body: null,
    };
  };
  const res = mockRes();
  await calls.proxyCustomerAudio({
    req: { headers: { range: "bytes=0-15" } },
    res,
    callId: "call-detail",
    fetchImpl,
    env: { VAPI_API_KEY: "secret" },
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].init.headers.Authorization, "Bearer secret");
  assert.equal(Object.prototype.hasOwnProperty.call(seen[1].init.headers, "Authorization"), false);
  assert.equal(seen[1].init.headers.Range, "bytes=0-15");
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers["content-type"], "audio/mpeg");
  assert.deepEqual(res.rawBody, audio);
  assert.equal(calls.safeRecordingUrl("http://127.0.0.1/private"), null);
  assert.equal(calls.safeRecordingUrl("https://[::1]/private"), null);
});

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    rawBody: null,
    headersSent: false,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    write(chunk) { this.rawBody = Buffer.concat([this.rawBody || Buffer.alloc(0), Buffer.from(chunk)]); return true; },
    end(payload) {
      if (Buffer.isBuffer(payload)) this.rawBody = payload;
      else if (payload != null) this.body = String(payload);
      this.headersSent = true;
    },
  };
}

async function withSiteHandler(stubs, run) {
  const paths = {
    site: require.resolve("../api/connect/site"),
    connect: require.resolve("../lib/connect"),
    customerSite: require.resolve("../lib/customer-site"),
    store: require.resolve("../lib/store"),
    command: require.resolve("../api/connect/_customer-command"),
    calls: require.resolve("../api/connect/_customer-calls"),
  };
  const saved = new Map(Object.values(paths).map((path) => [path, require.cache[path]]));
  require.cache[paths.connect] = { id: paths.connect, filename: paths.connect, loaded: true, exports: { resolveConnectScope: stubs.resolveConnectScope } };
  require.cache[paths.customerSite] = { id: paths.customerSite, filename: paths.customerSite, loaded: true, exports: { resolveCustomerSurface: stubs.resolveCustomerSurface } };
  require.cache[paths.store] = { id: paths.store, filename: paths.store, loaded: true, exports: { select: stubs.select || (async () => ({ ok: true, data: [] })) } };
  require.cache[paths.command] = { id: paths.command, filename: paths.command, loaded: true, exports: { loadCustomerOverview: stubs.loadCustomerOverview } };
  require.cache[paths.calls] = { id: paths.calls, filename: paths.calls, loaded: true, exports: { loadCustomerCallArtifact: stubs.loadCustomerCallArtifact, proxyCustomerAudio: stubs.proxyCustomerAudio } };
  delete require.cache[paths.site];
  try {
    await run(require(paths.site));
  } finally {
    for (const [path, mod] of saved) {
      if (mod) require.cache[path] = mod;
      else delete require.cache[path];
    }
  }
}

test("site handler preserves legacy surface, adds overview, and pins tenant slug", () => withSiteHandler({
  resolveConnectScope: () => ({ mode: "tenant", siteSlug: SLUG }),
  resolveCustomerSurface: async ({ siteSlug }) => ({ businessName: "Poor John's", clientId: "PJ-1", site: { available: true, url: SITE, reason: "", siteSlug }, report: { available: false, reason: "no_report_on_file" } }),
  loadCustomerOverview: async ({ siteSlug }) => ({ siteSlug, sources: { calls: true } }),
  loadCustomerCallArtifact: async () => { throw new Error("must not run"); },
  proxyCustomerAudio: async () => { throw new Error("must not run"); },
}, async (handler) => {
  const res = mockRes();
  await handler({ method: "GET", headers: {}, query: { slug: "someone-else" } }, res);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.businessName, "Poor John's");
  assert.equal(body.site.siteSlug, SLUG);
  assert.equal(body.overview.siteSlug, SLUG);
  assert.equal(res.headers["cache-control"], "no-store");
}));

test("site handler keeps method guard and hides broad-scope call artifacts", () => withSiteHandler({
  resolveConnectScope: () => ({ mode: "full" }),
  resolveCustomerSurface: async () => ({}),
  loadCustomerOverview: async () => ({}),
  loadCustomerCallArtifact: async () => { throw new Error("must not run"); },
  proxyCustomerAudio: async () => { throw new Error("must not run"); },
}, async (handler) => {
  const post = mockRes();
  await handler({ method: "POST", headers: {}, query: {} }, post);
  assert.equal(post.statusCode, 405);
  const artifact = mockRes();
  await handler({ method: "GET", headers: {}, query: { slug: SLUG, callId: "call-detail" } }, artifact);
  assert.equal(artifact.statusCode, 404);
  assert.deepEqual(JSON.parse(artifact.body), { ok: false, error: "call_not_found" });
}));
