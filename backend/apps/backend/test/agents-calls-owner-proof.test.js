"use strict";

// Owner proof for the Agents & Calls rebuild.
//
// The page is allowed to show Riley's retained call artifacts, but it must not
// turn the browser into a VAPI client. These tests pin both halves: readable
// cards in the self-contained console and an authenticated, read-only artifact
// proxy that owns Riley/retention checks before any transcript or audio leaves
// the server.

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const page = require("../lib/console-page");

const ENDPOINT_PATH = require.resolve("../api/admin/call-artifact");
const ADMIN_TOKEN = "agents-calls-owner-proof-token";
const VAPI_KEY = "vapi-owner-proof-secret";
const RILEY_ID = "riley-owner-proof-assistant";
const CALL_ID = "call-owner-proof-1";

function inlineScripts(html = page) {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

function agentsController(source = inlineScripts().join("\n")) {
  const start = source.indexOf("// ---- Agents & Calls");
  assert.notEqual(start, -1, "Agents & Calls controller marker is missing");
  return source.slice(start);
}

function responseCapture() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    raw: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    end(payload = "") {
      this.raw = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ""));
      const contentType = String(this.headers["content-type"] || "");
      if (/application\/json/i.test(contentType)) this.body = JSON.parse(this.raw.toString("utf8") || "null");
    },
  };
}

function fakeFetchResponse(status, payload, headers = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [String(name).toLowerCase(), String(value)]),
  );
  const bytes = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return normalizedHeaders[String(name).toLowerCase()] || null; } },
    async json() {
      if (Buffer.isBuffer(payload)) throw new Error("binary response");
      return typeof payload === "string" ? JSON.parse(payload) : payload;
    },
    async text() { return bytes.toString("utf8"); },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

function artifactRequest({ method = "GET", token = ADMIN_TOKEN, callId = CALL_ID, audio = false, range = "" } = {}) {
  const query = { callId };
  if (audio) query.audio = "1";
  const params = new URLSearchParams(query);
  return {
    method,
    url: `/api/admin/call-artifact?${params}`,
    query,
    headers: {
      ...(token ? { "x-admin-token": token } : {}),
      ...(range ? { range } : {}),
    },
  };
}

async function withArtifactHarness({
  storedRows = [],
  call,
  recordingBytes = Buffer.from("ID3 owner proof"),
  monoRecordingLocation = "https://signed-media.owner-proof.test/riley-call.mp3?signature=private-signed-value",
} = {}, run) {
  const prior = {
    admin: process.env.GHOST_AGENCY_ADMIN_TOKEN,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    vapiKey: process.env.VAPI_API_KEY,
    rileyId: process.env.VAPI_RILEY_ASSISTANT_ID,
  };
  const originalFetch = global.fetch;
  const requests = [];
  process.env.GHOST_AGENCY_ADMIN_TOKEN = ADMIN_TOKEN;
  process.env.SUPABASE_URL = "https://supabase.owner-proof.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "supabase-owner-proof-key";
  process.env.VAPI_API_KEY = VAPI_KEY;
  process.env.VAPI_RILEY_ASSISTANT_ID = RILEY_ID;
  global.fetch = async (url, init = {}) => {
    const target = String(url);
    requests.push({ url: target, init });
    if (target.startsWith("https://supabase.owner-proof.test/rest/v1/mission_control_customer_calls")) {
      return fakeFetchResponse(200, storedRows, { "content-type": "application/json" });
    }
    if (target === `https://api.vapi.ai/call/${encodeURIComponent(CALL_ID)}`) {
      return call
        ? fakeFetchResponse(200, call, { "content-type": "application/json" })
        : fakeFetchResponse(404, { message: "not found" }, { "content-type": "application/json" });
    }
    if (target === `https://api.vapi.ai/call/${encodeURIComponent(CALL_ID)}/mono-recording`) {
      return fakeFetchResponse(302, "", { location: monoRecordingLocation });
    }
    if (target === monoRecordingLocation) {
      return fakeFetchResponse(init.headers?.Range || init.headers?.range ? 206 : 200, recordingBytes, {
        "content-type": "audio/mpeg",
        "accept-ranges": "bytes",
        "content-length": String(recordingBytes.length),
      });
    }
    if (target === "https://recordings.vapi-owner-proof.test/call.mp3") {
      return fakeFetchResponse(init.headers?.Range || init.headers?.range ? 206 : 200, recordingBytes, {
        "content-type": "audio/mpeg",
        "accept-ranges": "bytes",
        "content-length": String(recordingBytes.length),
      });
    }
    throw new Error(`Unexpected fetch: ${init.method || "GET"} ${target}`);
  };

  delete require.cache[ENDPOINT_PATH];
  try {
    const handler = require(ENDPOINT_PATH);
    return await run({ handler, requests, recordingBytes });
  } finally {
    delete require.cache[ENDPOINT_PATH];
    global.fetch = originalFetch;
    const restore = (name, value) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("GHOST_AGENCY_ADMIN_TOKEN", prior.admin);
    restore("SUPABASE_URL", prior.supabaseUrl);
    restore("SUPABASE_SERVICE_ROLE_KEY", prior.supabaseKey);
    restore("VAPI_API_KEY", prior.vapiKey);
    restore("VAPI_RILEY_ASSISTANT_ID", prior.rileyId);
  }
}

test("console inline controller parses and renders Riley call cards with five-second facts", () => {
  const scripts = inlineScripts();
  assert.ok(scripts.length, "the console must keep its self-contained inline controller");
  scripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: `console-inline-${index}.js` }));
  });

  const source = agentsController(scripts.join("\n"));
  assert.match(source, /\/brand\/riley-avatar\.png/);
  assert.match(source, /class=["']call-avatar["']/);
  assert.match(source, /<time\b[^>]*class=["'][^"']*\bcall-when\b[^"']*["'][^>]*\bdatetime=/i);
  assert.match(source, /\btitle=/, "the relative time needs its exact local time as a tooltip");
  assert.match(source, /function whenText\([^)]+\)[\s\S]*?h ago/);
  assert.match(source, /function durText\(/);
  assert.match(source, /function friendlyCallOutcome\(/);
  assert.match(source, /function callIcon\(/);
  assert.match(source, /<svg\b/);
  for (const meaning of ["inbound", "outbound", "applied", "refused"]) {
    assert.match(source, new RegExp(meaning), `missing the ${meaning} call-card state`);
  }
  assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}]/u, "Agents & Calls should use restrained icons, not emoji");
});

test("call cards expand to full transcript and honest recording states", () => {
  const source = agentsController();
  assert.match(source, /<details\b[^>]*class=["']call-details["'][^>]*data-call-id=/i);
  assert.match(source, /<summary\b/i);
  assert.match(source, /class=["']call-detail-body["']/);
  assert.match(source, /No transcript available for this call\./);
  assert.match(source, /Recording expired/);
  assert.match(source, /No recording is available for this call\./);
  assert.match(source, /function loadCallArtifact\(/);
  assert.match(source, /function loadCallAudio\(/);
  assert.match(source, /\/api\/admin\/call-artifact\?callId=/);
  assert.match(source, /\.blob\(\)/, "audio must be fetched as an authenticated blob");
  assert.match(source, /URL\.createObjectURL\(/);
  assert.ok(/<audio\b[^>]*\bcontrols\b/i.test(source)
    || /createElement\(["']audio["']\)[\s\S]*?\.controls\s*=\s*true/.test(source),
  "expanded retained recordings need native audio controls");
  assert.match(source, /x-admin-token/);
  assert.match(source, /token\(\)/);
});

test("Agents & Calls never puts a provider URL, secret, or full caller number in its rows", () => {
  const source = agentsController();
  assert.match(source, /function safeCallerLast4\(/);
  assert.match(source, /replace\(\/\\D\/g\s*,\s*["']["']\)/,
    "the delivered inline script must strip non-digits before taking the last four");
  assert.doesNotMatch(source, /bits\.push\(esc\(c\.caller\)\)/,
    "the old full-number list rendering must stay removed");
  assert.doesNotMatch(source, /https?:\/\/(?:api\.)?vapi\.ai/i);
  assert.doesNotMatch(source, /recordingUrl/);
  assert.doesNotMatch(source, /process\.env|VAPI_API_KEY/);
  assert.doesNotMatch(source, /fetch\([^)]*https?:\/\//i,
    "the browser may fetch only the same-origin admin proxy");
});

test("Agents & Calls keeps its 390px layout bounded and readable", () => {
  assert.match(page, /\.callstack\s*\{[^}]*overflow-x\s*:\s*hidden/i);
  assert.match(page, /\.callstack\s+\*\s*\{[^}]*box-sizing\s*:\s*border-box/i);
  assert.match(page, /\.call(?:-card)?[^}]*min-width\s*:\s*0/i);
  assert.match(page, /\.call-detail-body[^}]*min-width\s*:\s*0/i);
  assert.match(page, /\.call-transcript[^}]*overflow-wrap\s*:\s*anywhere/i);
  assert.match(page, /audio[^}]*max-width\s*:\s*100%/i);
  const breakpoints = [...page.matchAll(/@media\s*\(max-width\s*:\s*(\d+)px\)/gi)].map((match) => Number(match[1]));
  assert.ok(breakpoints.some((width) => width >= 390 && width <= 640), "390px needs a narrow layout breakpoint");
});

test("call artifact is GET-only and authenticates before any data or provider read", async () => {
  await withArtifactHarness({}, async ({ handler, requests }) => {
    const missing = responseCapture();
    await handler(artifactRequest({ token: "" }), missing);
    assert.equal(missing.statusCode, 401);
    assert.equal(requests.length, 0, "unauthenticated requests must not touch storage or VAPI");

    const post = responseCapture();
    await handler(artifactRequest({ method: "POST" }), post);
    assert.equal(post.statusCode, 405);
    assert.equal(post.body.error, "method_not_allowed");
    assert.equal(requests.length, 0, "non-GET requests must stay read-only");

    const missingId = responseCapture();
    await handler(artifactRequest({ callId: "" }), missingId);
    assert.equal(missingId.statusCode, 400);
    assert.equal(requests.length, 0, "an invalid identifier must fail before external reads");
  });
});

test("metadata exposes the full transcript and a same-origin audio handle, never VAPI data", async () => {
  const fullTranscript = `${"Caller and Riley discussed the requested edit. ".repeat(80)}TRANSCRIPT-END`;
  const call = {
    id: CALL_ID,
    assistantId: RILEY_ID,
    startedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
    endedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    customer: { number: "+1 (949) 555-0199" },
    transcript: fullTranscript,
    artifact: { recording: "https://recordings.vapi-owner-proof.test/call.mp3" },
  };

  await withArtifactHarness({ call }, async ({ handler, requests }) => {
    const res = responseCapture();
    await handler(artifactRequest(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.callId, CALL_ID);
    assert.equal(res.body.transcript, fullTranscript, "the in-place transcript was clipped");
    assert.equal(res.body.transcriptAvailable, true);
    assert.equal(res.body.transcriptTruncated, false);
    assert.equal(res.body.recordingAvailable, true);
    assert.equal(res.body.recordingExpired, false);
    assert.equal(res.body.recordingReason, "available");
    assert.match(res.body.audioUrl, /^\/api\/admin\/call-artifact\?[^#]*callId=/);
    assert.match(res.body.audioUrl, /(?:[?&])audio=1(?:&|$)/);

    const serialized = JSON.stringify(res.body);
    assert.doesNotMatch(serialized, /recordings\.vapi-owner-proof\.test|api\.vapi\.ai/i);
    assert.doesNotMatch(serialized, new RegExp(VAPI_KEY));
    assert.doesNotMatch(serialized, /\+1 \(949\) 555-0199/);
    const vapiRead = requests.find((request) => request.url.startsWith("https://api.vapi.ai/"));
    assert.equal(vapiRead.init.headers.Authorization, `Bearer ${VAPI_KEY}`,
      "the VAPI key belongs only on the server-to-provider read");
  });
});

test("audio bytes are proxied behind admin auth without leaking the VAPI key to storage or media hosts", async () => {
  const call = {
    id: CALL_ID,
    assistantId: RILEY_ID,
    startedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    endedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    artifact: { recording: "https://recordings.vapi-owner-proof.test/call.mp3" },
  };
  await withArtifactHarness({ call }, async ({ handler, requests, recordingBytes }) => {
    const res = responseCapture();
    await handler(artifactRequest({ audio: true }), res);
    assert.ok([200, 206].includes(res.statusCode));
    assert.match(String(res.headers["content-type"] || ""), /^audio\//i);
    assert.match(String(res.headers["cache-control"] || ""), /(?:^|,\s*)no-store(?:,|$)/);
    assert.deepEqual(res.raw, recordingBytes);

    const mediaRead = requests.find((request) => request.url.startsWith("https://signed-media.owner-proof.test/"));
    assert.ok(mediaRead, "the retained recording was not proxied");
    const mediaHeaders = mediaRead.init.headers || {};
    assert.equal(mediaHeaders.Authorization || mediaHeaders.authorization, undefined,
      "the VAPI API key must never be forwarded to a recording host");
  });
});

test("audio resolves VAPI's mono-recording redirect server-side without forwarding authorization", async () => {
  const signedLocation = "https://signed-media.owner-proof.test/riley-call.mp3?signature=private-signed-value";
  const privateArtifactReference = "https://private-artifacts.vapi.ai/riley/call-owner-proof-1.mp3";
  const call = {
    id: CALL_ID,
    assistantId: RILEY_ID,
    status: "ended",
    startedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    endedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    transcript: "Riley: Thanks for calling.\nCaller: Please update the headline.",
    // This private provider reference proves a recording exists; it must never
    // be returned to or fetched by the browser. Playback starts instead at
    // VAPI's authenticated /mono-recording endpoint and one-time redirect.
    artifact: { recording: privateArtifactReference },
  };
  await withArtifactHarness({ call, monoRecordingLocation: signedLocation }, async ({ handler, requests, recordingBytes }) => {
    const metadata = responseCapture();
    await handler(artifactRequest(), metadata);
    assert.equal(metadata.statusCode, 200);
    assert.equal(metadata.body.recordingAvailable, true);
    assert.match(metadata.body.audioUrl, /^\/api\/admin\/call-artifact\?/);
    assert.doesNotMatch(JSON.stringify(metadata.body), /private-artifacts\.vapi\.ai|signed-media\.owner-proof\.test/i);
    assert.doesNotMatch(JSON.stringify(metadata.body), new RegExp(VAPI_KEY));

    const res = responseCapture();
    await handler(artifactRequest({ audio: true, range: "bytes=0-12" }), res);

    assert.equal(res.statusCode, 206);
    assert.match(String(res.headers["content-type"] || ""), /^audio\//i);
    assert.deepEqual(res.raw, recordingBytes);

    const monoIndex = requests.findIndex((request) => request.url ===
      `https://api.vapi.ai/call/${encodeURIComponent(CALL_ID)}/mono-recording`);
    const signedIndex = requests.findIndex((request) => request.url === signedLocation);
    assert.ok(monoIndex >= 0, "the proxy never requested VAPI's mono recording endpoint");
    assert.ok(signedIndex > monoIndex, "the signed recording was fetched before VAPI authorized it");

    const monoRead = requests[monoIndex];
    assert.equal(monoRead.init.headers.Authorization, `Bearer ${VAPI_KEY}`);
    assert.equal(monoRead.init.redirect, "manual", "VAPI's signed redirect must be inspected before following it");

    const signedRead = requests[signedIndex];
    assert.equal(signedRead.init.headers?.Authorization || signedRead.init.headers?.authorization, undefined,
      "the VAPI key leaked to the signed media host");
    assert.equal(signedRead.init.headers?.Range || signedRead.init.headers?.range, "bytes=0-12");

    const returned = `${JSON.stringify(res.headers)}\n${res.raw.toString("utf8")}`;
    assert.doesNotMatch(returned, /api\.vapi\.ai|signed-media\.owner-proof\.test|private-signed-value/i);
    assert.doesNotMatch(returned, new RegExp(VAPI_KEY));
  });
});

test("artifact reads fail closed unless VAPI proves the call belongs to Riley", async () => {
  const otherAssistantCall = {
    id: CALL_ID,
    assistantId: "unrelated-assistant",
    startedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    transcript: "private unrelated transcript",
    artifact: { recording: "https://recordings.vapi-owner-proof.test/call.mp3" },
  };
  await withArtifactHarness({ call: otherAssistantCall }, async ({ handler, requests }) => {
    const res = responseCapture();
    await handler(artifactRequest(), res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "call_not_found");
    assert.doesNotMatch(JSON.stringify(res.body), /unrelated|private transcript/i);
    assert.equal(requests.some((request) => request.url.includes("recordings.vapi-owner-proof.test")), false);
  });
});

test("the fixed 14-day expiry and retention tombstone beat live provider artifacts", async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const call = {
    id: CALL_ID,
    assistantId: RILEY_ID,
    startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    endedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    transcript: "VAPI still has text that retention removed",
    artifact: { recording: "https://recordings.vapi-owner-proof.test/call.mp3" },
  };
  const tombstone = {
    transcript: null,
    recording_url: null,
    artifact_retention_expires_at: past,
    payload: { retention_purged_at: past, retention_policy: "fixed_14_day_vapi_build_retention" },
  };
  await withArtifactHarness({ storedRows: [tombstone], call }, async ({ handler, requests }) => {
    const metadata = responseCapture();
    await handler(artifactRequest(), metadata);
    assert.equal(metadata.statusCode, 200);
    assert.equal(metadata.body.transcript, null);
    assert.equal(metadata.body.transcriptAvailable, false);
    assert.equal(metadata.body.recordingAvailable, false);
    assert.equal(metadata.body.recordingExpired, true);
    assert.equal(metadata.body.recordingReason, "recording_expired");
    assert.equal(metadata.body.audioUrl, null);

    const audio = responseCapture();
    await handler(artifactRequest({ audio: true }), audio);
    assert.equal(audio.statusCode, 410);
    assert.equal(audio.body.error, "recording_expired");
    assert.equal(requests.some((request) => request.url.includes("recordings.vapi-owner-proof.test")), false,
      "a nulled/expired artifact must never be resurrected from VAPI");
  });

  const fifteenDaysAgo = Date.now() - 15 * 86400 * 1000;
  const oldProviderCall = {
    ...call,
    startedAt: new Date(fifteenDaysAgo - 60_000).toISOString(),
    endedAt: new Date(fifteenDaysAgo).toISOString(),
  };
  await withArtifactHarness({ call: oldProviderCall }, async ({ handler, requests }) => {
    const metadata = responseCapture();
    await handler(artifactRequest(), metadata);
    assert.equal(metadata.statusCode, 200);
    assert.equal(metadata.body.recordingExpired, true,
      "a provider artifact older than 14 days escaped retention");
    assert.equal(metadata.body.recordingReason, "recording_expired");
    assert.equal(metadata.body.audioUrl, null);

    const audio = responseCapture();
    await handler(artifactRequest({ audio: true }), audio);
    assert.equal(audio.statusCode, 410);
    assert.equal(audio.body.error, "recording_expired");
    assert.equal(requests.some((request) => request.url.includes("recordings.vapi-owner-proof.test")), false);
  });

  const source = require("node:fs").readFileSync(ENDPOINT_PATH, "utf8");
  assert.match(source, /14\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000|14\s*\*\s*86400\s*\*\s*1000|14\s*\*\s*86400000|RETENTION_DAYS/,
    "the endpoint must enforce the fixed 14-day retention window");
});
