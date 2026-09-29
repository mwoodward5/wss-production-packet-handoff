"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

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

function configure() {
  const secretBytes = Buffer.from("resend-atomic-dedupe-secret");
  process.env.GHOST_AGENCY_RESEND_WEBHOOK_SECRET = `whsec_${secretBytes.toString("base64")}`;
  delete process.env.RESEND_WEBHOOK_SECRET;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  return secretBytes;
}

function signedRequest(raw, secretBytes, id) {
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

test.afterEach(restore);

test("simultaneous Resend deliveries atomically acknowledge one event and one duplicate", async () => {
  const secretBytes = configure();
  const handler = require("../api/webhooks/resend");
  const writes = [];
  let resolveFirstWrite;
  global.fetch = async (url, init = {}) => {
    const target = String(url);
    if (init.method === "POST" && target.includes("ghost_agency_events")) {
      writes.push(JSON.parse(init.body));
      if (writes.length === 1) {
        return new Promise((resolve) => { resolveFirstWrite = resolve; });
      }
      resolveFirstWrite(jsonResponse(201, [{ id: "stored-event" }]));
      return jsonResponse(409, { code: "23505", message: "duplicate key value" });
    }
    return jsonResponse(200, []);
  };

  const raw = '{"type":"email.delivered","data":{}}';
  const first = response();
  const second = response();
  await Promise.all([
    handler(signedRequest(raw, secretBytes, "msg-atomic-duplicate"), first),
    handler(signedRequest(raw, secretBytes, "msg-atomic-duplicate"), second),
  ]);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].svix_id, "msg-atomic-duplicate");
  assert.equal(writes[0].payload.svix_id, "msg-atomic-duplicate");
  assert.equal(
    [JSON.parse(first.body), JSON.parse(second.body)].filter((body) => body.duplicate === true).length,
    1,
  );
});

test("a Resend event storage failure remains retriable", async () => {
  const secretBytes = configure();
  const handler = require("../api/webhooks/resend");
  global.fetch = async (url, init = {}) => {
    if (init.method === "POST" && String(url).includes("ghost_agency_events")) {
      return jsonResponse(503, { code: "XX000" });
    }
    return jsonResponse(200, []);
  };

  const captured = response();
  await handler(signedRequest('{"type":"email.delivered","data":{}}', secretBytes, "msg-storage-failure"), captured);

  assert.equal(captured.statusCode, 503);
  assert.equal(JSON.parse(captured.body).error, "resend_webhook_persistence_failed");
});
