"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const test = require("node:test");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const fs = require("node:fs");
const path = require("node:path");

function restore() {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

function response() {
  return {
    statusCode: 200,
    setHeader() {},
    end(body = "") { this.body = body; },
  };
}

function jsonResponse(status, json = []) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => json,
  };
}

function signedRequest(raw, secretBytes, id = "msg-resend-reliability") {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac("sha256", secretBytes)
    .update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`, "utf8"), Buffer.from(raw, "utf8")]))
    .digest("base64");
  return {
    method: "POST",
    body: Buffer.from(raw, "utf8"),
    headers: {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1, ${signature}`,
    },
  };
}

function configure() {
  const secretBytes = Buffer.from("resend-reliability-secret");
  process.env.GHOST_AGENCY_RESEND_WEBHOOK_SECRET = `whsec_${secretBytes.toString("base64")}`;
  delete process.env.RESEND_WEBHOOK_SECRET;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  return secretBytes;
}

test.afterEach(restore);

test("checked-in schema preserves the durable svix_id uniqueness guard", () => {
  const schema = fs.readFileSync(
    path.join(__dirname, "..", "supabase", "resend-webhook-idempotency.sql"),
    "utf8",
  );
  assert.match(schema, /add column if not exists svix_id text/i);
  assert.match(schema, /create unique index if not exists ghost_agency_events_svix_id_unique_idx/i);
  assert.match(schema, /where svix_id is not null/i);
});

test("Resend verifies the exact signed bytes and rejects a parsed body", async () => {
  const secretBytes = configure();
  const raw = '{\n  "type": "email.delivered",\n  "data": {}\n}';
  const handler = require("../api/webhooks/resend");
  global.fetch = async () => jsonResponse(201);

  const accepted = response();
  await handler(signedRequest(raw, secretBytes), accepted);
  assert.equal(accepted.statusCode, 200);
  assert.equal(JSON.parse(accepted.body).received, true);

  const parsedBody = response();
  await handler({
    ...signedRequest(raw, secretBytes, "msg-parsed-body"),
    body: { type: "email.delivered", data: {} },
  }, parsedBody);
  assert.equal(parsedBody.statusCode, 400);
  assert.equal(JSON.parse(parsedBody.body).error, "resend_webhook_raw_body_required");
});

test("Resend consumes Vercel's request stream before its lazy body getter", async () => {
  const secretBytes = configure();
  const raw = '{"type":"email.delivered","data":{}}';
  const signed = signedRequest(raw, secretBytes, "msg-vercel-lazy-body");
  const request = Readable.from([Buffer.from(raw, "utf8")]);
  request.method = "POST";
  request.headers = signed.headers;
  Object.defineProperty(request, "body", {
    get() {
      throw new Error("the lazy body getter must not be touched");
    },
  });
  const handler = require("../api/webhooks/resend");
  global.fetch = async () => jsonResponse(201);

  const captured = response();
  await handler(request, captured);

  assert.equal(captured.statusCode, 200, captured.body);
  assert.equal(JSON.parse(captured.body).received, true);
});

test("Resend returns a retriable failure when the event ledger write fails", async () => {
  const secretBytes = configure();
  const handler = require("../api/webhooks/resend");
  global.fetch = async (url, init = {}) => {
    if (init.method === "POST" && String(url).includes("ghost_agency_events")) return jsonResponse(503, { code: "XX000" });
    return jsonResponse(200, []);
  };

  const captured = response();
  await handler(signedRequest('{"type":"email.delivered","data":{}}', secretBytes), captured);
  assert.equal(captured.statusCode, 503);
  assert.equal(JSON.parse(captured.body).error, "resend_webhook_persistence_failed");
});

test("Resend returns a retriable failure when a required suppression write fails", async () => {
  const secretBytes = configure();
  const handler = require("../api/webhooks/resend");
  global.fetch = async (url, init = {}) => {
    if (init.method === "POST" && String(url).includes("ghost_agency_suppressions")) {
      return jsonResponse(503, { code: "XX000" });
    }
    return jsonResponse(200, []);
  };

  const captured = response();
  await handler(signedRequest(
    '{"type":"email.complained","data":{"to":["owner@example.test"]}}',
    secretBytes,
  ), captured);
  assert.equal(captured.statusCode, 503);
  assert.equal(JSON.parse(captured.body).error, "resend_webhook_persistence_failed");
});

test("Resend persists svix_id and does not write a sequential duplicate", async () => {
  const secretBytes = configure();
  const handler = require("../api/webhooks/resend");
  const eventWrites = [];
  let duplicateLookup = false;
  global.fetch = async (url, init = {}) => {
    const target = String(url);
    if (init.method === "POST" && target.includes("ghost_agency_events")) {
      eventWrites.push(JSON.parse(init.body));
      return jsonResponse(201, []);
    }
    if (target.includes("ghost_agency_events") && target.includes("svix_id")) {
      return jsonResponse(200, duplicateLookup ? [{ id: "already-recorded" }] : []);
    }
    return jsonResponse(200, []);
  };

  const raw = '{"type":"email.delivered","data":{}}';
  const first = response();
  await handler(signedRequest(raw, secretBytes, "msg-sequential-duplicate"), first);
  assert.equal(first.statusCode, 200);
  assert.equal(eventWrites.length, 1);
  assert.equal(eventWrites[0].payload.svix_id, "msg-sequential-duplicate");

  duplicateLookup = true;
  const second = response();
  await handler(signedRequest(raw, secretBytes, "msg-sequential-duplicate"), second);
  assert.equal(second.statusCode, 200);
  assert.equal(JSON.parse(second.body).duplicate, true);
  assert.equal(eventWrites.length, 1);
});

test("signed email.received retrieves the latest reply and durably suppresses STOP", async () => {
  const secretBytes = configure();
  process.env.RESEND_API_KEY = "resend-receiving-test";
  delete process.env.ANTHROPIC_API_KEY;
  const handler = require("../api/webhooks/resend");
  const writes = [];
  let receivedEmailFetches = 0;

  global.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target === "https://api.resend.com/emails/receiving/inbound-email-1") {
      receivedEmailFetches += 1;
      assert.equal(init.method, "GET");
      assert.equal(init.headers.authorization, "Bearer resend-receiving-test");
      assert.equal(init.headers["user-agent"], "ghost-agency/consent-first-replies");
      return jsonResponse(200, {
        id: "inbound-email-1",
        from: "Owner <owner@reply.example>",
        subject: "Re: website",
        text: "STOP\n\nOn Tue, Mark wrote:\nNot interested? Reply STOP and you won't hear from me again.",
      });
    }

    const parsed = new URL(target);
    const table = parsed.pathname.split("/").pop();
    if ((!init.method || init.method === "GET") && table === "ghost_agency_events") {
      return jsonResponse(200, []);
    }
    if ((!init.method || init.method === "GET") && table === "ghost_agency_prospects") {
      return jsonResponse(200, [{
        prospect_id: "prospect-inbound-1",
        business_name: "Reply Roofing",
        email: "owner@reply.example",
        status: "contacted",
        record: { existing: true },
      }]);
    }
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      writes.push({ table, body });
      return jsonResponse(201, [body]);
    }
    throw new Error(`Unexpected request: ${init.method || "GET"} ${target}`);
  };

  const raw = JSON.stringify({
    type: "email.received",
    data: {
      email_id: "inbound-email-1",
      from: "owner@reply.example",
      to: ["hello@go.wss-ai.com"],
      subject: "Re: website",
    },
  });
  const captured = response();
  await handler(signedRequest(raw, secretBytes, "msg-inbound-stop"), captured);

  assert.equal(captured.statusCode, 200, captured.body);
  const payload = JSON.parse(captured.body);
  assert.equal(payload.action, "suppressed");
  assert.equal(payload.intent, "opt_out");
  assert.equal(receivedEmailFetches, 1);
  const suppression = writes.find((write) => write.table === "ghost_agency_suppressions");
  assert.equal(suppression.body.email, "owner@reply.example");
  assert.equal(suppression.body.reason, "reply_opt_out");
  const prospect = writes.find((write) => write.table === "ghost_agency_prospects");
  assert.equal(prospect.body.status, "do_not_contact");
  assert.equal(
    writes.some((write) => write.table === "ghost_agency_events" && write.body.type === "reply.draft"),
    false,
  );
});
