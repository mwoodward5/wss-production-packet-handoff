"use strict";

// THE REPLY DESK.
//
// Sending from this page is intentionally possible, so this proof treats the
// browser controller as part of the delivery boundary. A visible button is not
// enough: held work stays manual to load, every send takes two presses, the
// server's read-back is what the operator sees, and no third send route exists.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const page = require("../lib/replies-page");
const repliesPageHandler = require("../api/admin/replies");
const heldDraftsHandler = require("../api/admin/held-drafts");
const replyQueueHandler = require("../api/admin/reply-queue");

function inlineScripts(html = page) {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

function fakeTextRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(payload = "") { this.body = String(payload || ""); },
  };
}

function fakeJsonRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    raw: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(payload = "") {
      this.raw = String(payload || "");
      this.body = this.raw ? JSON.parse(this.raw) : null;
    },
  };
}

function mockJsonResponse(status, payload = []) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

async function withBackendMocks(fetchImpl, work) {
  const keys = [
    "GHOST_AGENCY_ADMIN_TOKEN",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "GHOST_AGENCY_RESEND_FROM",
    "GHOST_AGENCY_EMAIL_FROM",
    "CALLPREP_SUPABASE_URL",
    "CALLPREP_SUPABASE_SERVICE_ROLE_KEY",
  ];
  const priorFetch = global.fetch;
  const prior = new Map(keys.map((key) => [key, {
    present: Object.prototype.hasOwnProperty.call(process.env, key),
    value: process.env[key],
  }]));
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "reply-owner-proof-token";
  process.env.SUPABASE_URL = "https://mock.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role";
  process.env.RESEND_API_KEY = "mock-resend-key";
  process.env.GHOST_AGENCY_RESEND_FROM = "WSS Labs <hello@example.test>";
  process.env.GHOST_AGENCY_EMAIL_FROM = "WSS Labs <hello@example.test>";
  delete process.env.CALLPREP_SUPABASE_URL;
  delete process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY;
  global.fetch = fetchImpl;
  try {
    return await work();
  } finally {
    global.fetch = priorFetch;
    for (const [key, old] of prior) {
      if (old.present) process.env[key] = old.value;
      else delete process.env[key];
    }
  }
}

function adminRequest(method, body) {
  return {
    method,
    url: method === "GET" ? "/api/admin/reply-queue" : "/api/admin/reply-queue",
    headers: { "x-admin-token": "reply-owner-proof-token" },
    ...(body === undefined ? {} : { body }),
  };
}

function literalAdminPaths(script) {
  return [...script.matchAll(/["'](\/api\/admin\/[a-z0-9-]+)["']/gi)].map((match) => match[1]);
}

function namedFunctionSource(source, name) {
  const found = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(found, `missing function ${name}`);
  const start = found.index;
  const open = source.indexOf("{", start);
  assert.ok(open > start, `missing body for ${name}`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated function ${name}`);
}

test("reply desk inline controller parses and keeps the operator token in one header", () => {
  const scripts = inlineScripts();
  assert.ok(scripts.length > 0, "reply desk needs an inline controller");
  scripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: `replies-inline-${index}.js` }));
  });

  const script = scripts.join("\n");
  assert.match(script, /["']wsl_admin_token["']/);
  assert.match(script, /headers\[["']x-admin-token["']\]\s*=\s*token\(\)/);
  assert.match(script, /return fetch\(path\s*,\s*opts\)/);
  assert.doesNotMatch(script, /location\.(?:hash|search)\b|URLSearchParams|searchParams|decodeURIComponent\(/);
  assert.doesNotMatch(page, /[?&#](?:t|token|admin_token)=/i);
  assert.doesNotMatch(script, /headers\[["']authorization["']\]/i);
});

test("the authenticated reads are exact and held drafts never load automatically", () => {
  const scripts = inlineScripts();
  const script = scripts.join("\n");
  const paths = new Set(literalAdminPaths(script));
  assert.deepEqual([...paths].sort(), [
    "/api/admin/approve-held-drafts",
    "/api/admin/held-drafts",
    // The shared operator-nav snippet at the top of every console page polls
    // the live-run ticker. It is a READ — the three assertions below hold it
    // to that: it lives outside the reply desk's own controller, there is
    // exactly one call site, and that call carries no method and no body.
    "/api/admin/line",
    "/api/admin/outreach-pause",
    "/api/admin/reply-queue",
  ]);
  const desk = scripts.find((source) => source.includes("/api/admin/reply-queue"));
  assert.ok(desk, "the reply desk's own controller block is gone");
  assert.doesNotMatch(desk, /\/api\/admin\/line\b/,
    "the reply desk itself must not reach the line route");
  const linePolls = [...script.matchAll(/fetch\(\s*["']\/api\/admin\/line["']\s*,\s*(\{[\s\S]{0,200}?\})\s*\)/g)]
    .map((match) => match[1]);
  assert.equal(linePolls.length, 1, "the nav's line ticker has exactly one call site");
  assert.doesNotMatch(linePolls[0], /\bmethod\b|\bbody\b/i, "the nav's line poll is a read, not a write");

  assert.match(page, /id=["']loadHeldBtn["']/);
  assert.match(page, /Load held drafts/);
  assert.match(script, /function\s+loadHeld(?:Drafts)?\s*\(/);
  assert.match(script, /loadHeldBtn\.addEventListener\(["']click["']/);
  assert.equal((script.match(/\/api\/admin\/held-drafts/g) || []).length, 1,
    "the heavy held-draft GET must have one call site");

  const functionName = (script.match(/function\s+(loadHeld(?:Drafts)?)\s*\(/) || [])[1];
  assert.ok(functionName, "held loader must be a named, auditable function");
  const references = script.match(new RegExp(`\\b${functionName}\\b`, "g")) || [];
  assert.equal(references.length, 2,
    "held loader may appear only in its definition and the manual button binding");
  assert.doesNotMatch(script, /(?:Promise\.all|setInterval|setTimeout)\([^)]*\/api\/admin\/held-drafts/);
  assert.match(page, /(?:Loading held drafts|Checking release evidence)/i);
});

test("the page uses only the two existing gated POST paths and their exact bodies", () => {
  const script = inlineScripts().join("\n");
  const postPaths = [...script.matchAll(/\bpost\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(postPaths)].sort(), [
    "/api/admin/approve-held-drafts",
    "/api/admin/reply-queue",
  ]);

  const replyPost = script.slice(
    script.indexOf('post("/api/admin/reply-queue"'),
    script.indexOf('post("/api/admin/reply-queue"') + 420,
  );
  assert.match(replyPost, /draftId\s*:/);
  assert.match(replyPost, /action\s*:\s*["']approve["']/);
  assert.match(replyPost, /body\s*:/);
  const rejectAction = script.indexOf('action:"reject"');
  assert.ok(rejectAction > 0, "reject must use the queue's existing action value");
  const rejectPost = script.slice(Math.max(0, rejectAction - 180), rejectAction + 120);
  assert.match(rejectPost, /post\(["']\/api\/admin\/reply-queue["']/);
  assert.match(rejectPost, /draftId\s*:/);

  const heldPost = script.slice(
    script.indexOf('post("/api/admin/approve-held-drafts"'),
    script.indexOf('post("/api/admin/approve-held-drafts"') + 520,
  );
  assert.match(heldPost, /prospectIds\s*:\s*\[[^\]]+\]/);
  assert.match(heldPost, /dryRun\s*:\s*false/);
  assert.match(script, /HELD_SEND_CONFIRMATION\s*=\s*["']SEND_APPROVED_HELD_DRAFTS["']/);
  assert.match(heldPost, /confirmation\s*:\s*HELD_SEND_CONFIRMATION/);

  // Counted inside the reply desk's OWN controller block. The shared
  // operator-nav snippet at the top of the page has a fetch of its own (the
  // read-only live-run ticker, pinned as a read in the reads test above);
  // folding it into this count would say nothing about the send boundary,
  // which is what this assertion exists to guard.
  const desk = inlineScripts().find((source) => source.includes("/api/admin/reply-queue"));
  assert.ok(desk, "the reply desk's own controller block is gone");
  assert.equal((desk.match(/\bfetch\s*\(/g) || []).length, 1,
    "all reply-desk traffic must go through the one authenticated api helper");
  assert.doesNotMatch(script, /\/api\/(?:send|email|run-campaign|full-run)|api\.resend\.com/i);
});

test("every send is a 20-second two-click action whose expiry is announced", () => {
  const script = inlineScripts().join("\n");
  assert.match(page, /CONFIRM SEND — click again/);
  assert.match(script, /ARM_WINDOW_MS\s*=\s*20000/);
  assert.match(script, /setTimeout\(function\s*\(\)\s*\{[\s\S]{0,700}\},\s*ARM_WINDOW_MS\)/);
  assert.match(page, /Confirmation window expired — nothing was sent/i);
  assert.match(page, /aria-live=[\\"'](?:polite|assertive)[\\"']/);
  assert.match(script, /armed/);

  assert.match(script, /function\s+sendButton\([^)]*\)[\s\S]{0,1200}dataset\.armed[^;]*!==["']true["'][\s\S]{0,300}arm\(/);
  assert.match(script, /sendButton\(["']Send reply["']/);
  assert.match(script, /sendButton\(["']Release and send["']/);
});

test("the live delivery pause is visible and disables every send control", () => {
  const script = inlineScripts().join("\n");
  assert.match(page, /id=["']pauseRail["']/);
  assert.match(script, /api\(["']\/api\/admin\/outreach-pause["']\)/);
  assert.match(script, /deliveryPause/);
  assert.match(page, /Sending (?:is )?paused|ALL SEND(?:S|ING) (?:IS |ARE )?(?:STOPPED|HALTED)/i);
  assert.match(script, /dataset\.sendAction\s*=\s*["']true["']/);
  assert.match(script, /querySelectorAll\(["']\[data-send-action\]["']\)/);
  assert.match(script, /button\.disabled\s*=\s*!live\s*\|\|\s*blocked/);
  assert.match(script, /state\.pause\.active===true/);
});

test("an unknown clear-looking pause disables sends and cannot reach POST", async () => {
  const script = inlineScripts().join("\n");
  const sendControl = {
    dataset: { busy: "false", resolved: "false", baseLabel: "Send reply" },
    disabled: false,
    title: "",
    replaceChildren() {},
  };
  const context = vm.createContext({
    state: { pause: { active: null, known: false, reason: "", at: "", error: "" } },
    document: {
      querySelectorAll: () => [sendControl],
      createTextNode: (value) => ({ value }),
    },
    disarmAll() {},
    setButtonBusy() {},
    setResult() {},
    authFailure: () => false,
    serverReason: (error) => String(error?.message || "server_refused"),
    icon: () => ({}),
    text: (value, fallback = "") => String(value == null ? "" : value).trim() || fallback,
    errorWithStatus(message, status, payload) {
      const error = new Error(message);
      error.status = status;
      error.payload = payload;
      return error;
    },
    postCalls: 0,
    post() {
      context.postCalls += 1;
      return Promise.resolve({ ok: true, action: "sent" });
    },
  });
  vm.runInContext([
    namedFunctionSource(script, "readPausePayload"),
    namedFunctionSource(script, "pauseState"),
    namedFunctionSource(script, "sendingLive"),
    namedFunctionSource(script, "updateSendAvailability"),
    namedFunctionSource(script, "resolveReply"),
  ].join("\n"), context);

  const readable = context.readPausePayload({
    deliveryPause: { active: false, known: false, reason: "", at: null },
  });
  context.updateSendAvailability();
  assert.equal(context.state.pause.known, false);
  assert.equal(sendControl.disabled, true,
    "active:false is not permission to send when the server says known:false");

  context.refreshPause = () => Promise.resolve(readable);
  context.resolveReply(
    { draftId: "draft-unknown-pause" },
    sendControl,
    {},
    { classList: { add() {} }, querySelector: () => null },
    { value: "A fully reviewed reply.", disabled: false },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.postCalls, 0,
    "an unreadable pause state must fail before the reply-queue POST");
});

test("results report server read-back and refusals in red, never click optimism", () => {
  const script = inlineScripts().join("\n");
  assert.match(page, /role=[\\"']status[\\"']|aria-live=[\\"']polite[\\"']/);
  assert.match(page, /role=[\\"']alert[\\"']|aria-live=[\\"']assertive[\\"']/);
  assert.match(script, /(?:reason|blocked|error)/);
  assert.match(script, /(?:result|status)[^;\n]{0,220}(?:bad|refus|error)|(?:bad|refus|error)[^;\n]{0,220}(?:result|status)/i);
  assert.doesNotMatch(page, />\s*Sent!\s*</i);
  assert.match(page, /refus/i);
});

test("draft bodies stay fully readable and editable without expanding PII", () => {
  const script = inlineScripts().join("\n");
  assert.match(script, /createElement\(["']textarea["']\)/);
  assert.doesNotMatch(script, /(?:\.maxLength\s*=|setAttribute\(["']maxlength["'])/i,
    "the operator must see and edit the whole outbound draft");
  assert.match(script, /(?:inbound|message|reply|whatTheyWrote)/i);
  assert.doesNotMatch(script, /\.slice\([^)]*body|body[^;\n]*\.slice\(/i,
    "reply copy must not be reduced to a blind snippet");

  assert.doesNotMatch(page, /href=["']tel:/i);
  assert.doesNotMatch(script, /\.phone(?:Number)?\b|\[["']phone(?:Number)?["']\]/i);
  assert.doesNotMatch(script, /[?&](?:select|phone|email)=/i,
    "the page must not add a PII query beside the existing queue responses");
});

test("reply queue GET enriches each draft with its business and original reply preview", async () => {
  const calls = [];
  let providerCalls = 0;
  await withBackendMocks(async (url, init = {}) => {
    const target = new URL(String(url));
    const method = init.method || "GET";
    const table = target.pathname.split("/").pop();
    calls.push({ method, table, url: target.toString() });
    if (target.hostname === "api.resend.com") {
      providerCalls += 1;
      return mockJsonResponse(200, { id: "must-not-send" });
    }
    if (method === "GET" && table === "ghost_agency_events") {
      return mockJsonResponse(200, [
        {
          id: "event-draft-1",
          type: "reply.draft",
          created_at: "2026-08-08T12:01:00.000Z",
          payload: {
            draftId: "draft-1",
            prospectId: "prospect-1",
            inboundId: "inbound-1",
            fromEmail: "private-owner@example.test",
            subject: "Re: website",
            body: "Here is the reviewed draft.",
            approval: "pending",
          },
        },
        {
          id: "event-received-1",
          type: "reply.received",
          created_at: "2026-08-08T12:00:00.000Z",
          payload: {
            prospectId: "prospect-1",
            inboundId: "inbound-1",
            preview: "Yes, please show me the new site.",
          },
        },
      ]);
    }
    if (method === "GET" && table === "ghost_agency_prospects") {
      return mockJsonResponse(200, [{ prospect_id: "prospect-1", business_name: "Clearwater Plumbing" }]);
    }
    throw new Error(`Unexpected mocked request: ${method} ${target}`);
  }, async () => {
    const res = fakeJsonRes();
    await replyQueueHandler(adminRequest("GET"), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.pending, 1);
    assert.equal(res.body.drafts[0].businessName, "Clearwater Plumbing");
    assert.equal(res.body.drafts[0].originalReply, "Yes, please show me the new site.");
  });

  assert.equal(providerCalls, 0);
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((call) => call.method === "GET"), "a queue read must not write or send");
  const prospectRead = calls.find((call) => call.table === "ghost_agency_prospects");
  assert.ok(prospectRead, "business-name enrichment must read the prospect table");
  assert.match(prospectRead.url, /select=prospect_id,business_name/);
  assert.doesNotMatch(prospectRead.url, /(?:owner_)?email|phone/i,
    "name enrichment must not expand the queue payload with contact fields");
});

test("reply approval refuses active and unreadable delivery pauses before any provider call", async () => {
  const cases = [
    {
      name: "active",
      pauseStatus: 200,
      pauseRows: [{
        type: "outreach.delivery_pause",
        payload: { active: true, reason: "owner_stop_button" },
        created_at: "2026-08-08T12:02:00.000Z",
      }],
      expectedStatus: 409,
      expectedError: "owner_stop_button",
    },
    {
      name: "unreadable",
      pauseStatus: 503,
      pauseRows: [],
      expectedStatus: 503,
      expectedError: "delivery_pause_status_unavailable",
    },
  ];

  for (const scenario of cases) {
    const calls = [];
    let providerCalls = 0;
    await withBackendMocks(async (url, init = {}) => {
      const target = new URL(String(url));
      const method = init.method || "GET";
      const table = target.pathname.split("/").pop();
      calls.push({ method, table, url: target.toString() });
      if (target.hostname === "api.resend.com") {
        providerCalls += 1;
        return mockJsonResponse(200, { id: "must-not-send" });
      }
      if (method === "GET" && table === "ghost_agency_events") {
        if (target.searchParams.get("type") === "eq.outreach.delivery_pause") {
          return mockJsonResponse(scenario.pauseStatus, scenario.pauseRows);
        }
        return mockJsonResponse(200, [{
          id: "event-draft-1",
          type: "reply.draft",
          created_at: "2026-08-08T12:01:00.000Z",
          payload: {
            draftId: "draft-1",
            prospectId: "prospect-1",
            fromEmail: "private-owner@example.test",
            subject: "Re: website",
            body: "A gated draft.",
            approval: "pending",
          },
        }]);
      }
      if (method === "GET" && table === "ghost_agency_suppressions") return mockJsonResponse(200, []);
      throw new Error(`Unexpected mocked request: ${method} ${target}`);
    }, async () => {
      const res = fakeJsonRes();
      await replyQueueHandler(adminRequest("POST", {
        draftId: "draft-1",
        action: "approve",
        body: "A gated draft.",
      }), res);

      assert.equal(res.statusCode, scenario.expectedStatus, scenario.name);
      assert.equal(res.body.error, scenario.expectedError, scenario.name);
    });

    assert.equal(providerCalls, 0, `${scenario.name}: provider was reached`);
    assert.ok(calls.some((call) => call.url.includes("outreach.delivery_pause")),
      `${scenario.name}: durable pause was not read`);
    assert.ok(calls.every((call) => call.method === "GET"),
      `${scenario.name}: refusal wrote an event or called a provider`);
  }
});

test("held GET returns safe staged rows and performs no staging or sending", async () => {
  const calls = [];
  let providerCalls = 0;
  await withBackendMocks(async (url, init = {}) => {
    const target = new URL(String(url));
    const method = init.method || "GET";
    const table = target.pathname.split("/").pop();
    calls.push({ method, table, url: target.toString() });
    if (target.hostname === "api.resend.com") {
      providerCalls += 1;
      return mockJsonResponse(200, { id: "must-not-send" });
    }
    if (method === "GET" && table === "ghost_agency_prospects") {
      return mockJsonResponse(200, [{ prospect_id: "prospect-held-1", business_name: "Safe Roofing" }]);
    }
    if (method === "GET" && table === "ghost_agency_outbound_review_drafts") {
      // Include forbidden contact fields in the mock to prove the response
      // shaper drops them even if a future store client returns extra columns.
      return mockJsonResponse(200, [{
        draft_id: "held-draft-1",
        prospect_id: "prospect-held-1",
        recipient_email: "private-held@example.test",
        phone: "+15550100199",
        subject: "A useful subject",
        body: "The complete held draft.",
        approval_status: "awaiting_explicit_later_approval",
        created_at: "2026-08-08T11:00:00.000Z",
      }]);
    }
    throw new Error(`Unexpected mocked request: ${method} ${target}`);
  }, async () => {
    const res = fakeJsonRes();
    const req = { ...adminRequest("GET"), url: "/api/admin/held-drafts" };
    await heldDraftsHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.sendsPerformed, 0);
    assert.equal(res.body.draftsAvailable, true);
    assert.equal(res.body.drafts.length, 1);
    assert.deepEqual(Object.keys(res.body.drafts[0]).sort(), [
      "approvalStatus",
      "body",
      "businessName",
      "createdAt",
      "draftId",
      "prospectId",
      "subject",
    ]);
    assert.equal(res.body.drafts[0].businessName, "Safe Roofing");
    assert.doesNotMatch(JSON.stringify(res.body), /private-held|recipient_email|\+15550100199|"phone"/i);
  });

  assert.equal(providerCalls, 0);
  assert.ok(calls.every((call) => call.method === "GET"), "held GET staged or sent work");
  const draftRead = calls.find((call) => call.table === "ghost_agency_outbound_review_drafts");
  assert.ok(draftRead);
  assert.doesNotMatch(draftRead.url, /recipient_email|phone/i);
});

test("held POST remains a zero-send staging surface", async () => {
  const calls = [];
  let providerCalls = 0;
  await withBackendMocks(async (url, init = {}) => {
    const target = new URL(String(url));
    const method = init.method || "GET";
    const table = target.pathname.split("/").pop();
    calls.push({ method, table, url: target.toString() });
    if (target.hostname === "api.resend.com") {
      providerCalls += 1;
      return mockJsonResponse(200, { id: "must-not-send" });
    }
    if (method === "GET" && table === "ghost_agency_prospects") return mockJsonResponse(200, []);
    throw new Error(`Unexpected mocked request: ${method} ${target}`);
  }, async () => {
    const preview = fakeJsonRes();
    await heldDraftsHandler({
      ...adminRequest("POST", { stage: false }),
      url: "/api/admin/held-drafts",
    }, preview);
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.body.status, "preview_only");
    assert.equal(preview.body.sendsPerformed, 0);

    const stageAttempt = fakeJsonRes();
    await heldDraftsHandler({
      ...adminRequest("POST", { stage: true }),
      url: "/api/admin/held-drafts",
    }, stageAttempt);
    assert.equal(stageAttempt.statusCode, 422);
    assert.equal(stageAttempt.body.status, "held");
    assert.equal(stageAttempt.body.sendsPerformed, 0);
  });

  assert.equal(providerCalls, 0);
  assert.ok(calls.every((call) => call.method === "GET"),
    "held-drafts POST must not become a delivery endpoint");
});

test("the public shell is GET-only, no-store, and /replies rewrites to it", async () => {
  const res = fakeTextRes();
  await repliesPageHandler({ method: "GET", url: "/replies", headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["Content-Type"], /text\/html/);
  assert.match(res.headers["Cache-Control"], /no-store/);
  assert.equal(res.body, page);
  assert.match(res.body, /type=["']password["']/);

  const rejected = fakeTextRes();
  await repliesPageHandler({ method: "POST", url: "/replies", headers: {} }, rejected);
  assert.equal(rejected.statusCode, 405);

  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.ok(config.rewrites.some((rule) => (
    rule.source === "/replies" && rule.destination === "/api/admin/replies"
  )), "vercel.json must expose the Reply Desk at /replies");
});

test("the page speaks plain words: title, big quote, empty state, translated statuses", () => {
  // Plain-words pass 2026-08-16. The owner is a layman: "Reply Desk",
  // "operator token", "halted" and raw codes like "suppressed" are his
  // complaints, so the page names itself in English, quotes the business in
  // big type, tells him the truth when nothing arrived yet, and translates
  // the machine's stop words into what they mean for him.
  assert.match(page, /What businesses said/);
  assert.match(page, /reply-quote/);
  assert.match(page, /No replies yet\./);
  assert.match(page, /The moment a business owner answers, it lands here\./);
  assert.match(page, /ALL SENDING IS STOPPED/);
  assert.match(page, /You asked us to stop — we stopped/);
  assert.match(page, /Asked us to stop/);
  assert.match(page, /statusChip/, "statuses must read through the shared operator voice");
  assert.doesNotMatch(page, /Operator access|Admin token/);
  assert.doesNotMatch(page, /Reply Desk/);
});

test("reply desk carries console tokens and a 390px-safe layout", () => {
  for (const token of ["--carbon", "--ice", "--signal", "--hair", "--mono", "--sans"]) {
    assert.match(page, new RegExp(token));
  }
  assert.match(page, /<meta\s+name=["']viewport["'][^>]*width=device-width/i);
  assert.match(page, /\*\s*\{\s*box-sizing\s*:\s*border-box/i);
  assert.match(page, /overflow-x\s*:\s*hidden/i);
  assert.match(page, /min-width\s*:\s*0/i);
  const mobileBreakpoints = [...page.matchAll(/@media\s*\(max-width\s*:\s*(\d+)px\)/gi)]
    .map((match) => Number(match[1]));
  assert.ok(mobileBreakpoints.some((width) => width >= 390 && width <= 600),
    "390px needs a narrow-screen breakpoint");
  assert.match(page, /grid-template-columns\s*:\s*1fr/i);
  assert.doesNotMatch(page, /<script[^>]+\bsrc=/i);
  assert.doesNotMatch(page, /<link[^>]+\bhref=["']https?:/i);
});
