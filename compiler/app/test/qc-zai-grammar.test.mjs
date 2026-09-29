import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { checkGrammarQuality } from "../../qc-audit/qc.mjs";

const ZAI_URL = "https://api.z.ai/api/paas/v4/chat/completions";
const cleanCopy = "<p>We repair roofs throughout Austin.</p>";
const response = (data) => ({ ok: true, json: async () => data });
const zaiResponse = (verdict) => response({ choices: [{ message: { content: JSON.stringify(verdict) } }] });
const anthropicResponse = (verdict) => response({ content: [{ type: "text", text: JSON.stringify(verdict) }] });
const geminiResponse = (verdict) => response({ candidates: [{ content: { parts: [{ text: JSON.stringify(verdict) }] } }] });
const pass = { pass: true, issues: [] };

async function check(env, fetchImpl, html = cleanCopy) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  try {
    return await checkGrammarQuality(dom.window.document, html, { env, fetchImpl });
  } finally {
    dom.window.close();
  }
}

test("Z.ai-only configuration uses the existing GLM JSON contract with a 30-second deadline", async () => {
  const nativeTimeout = AbortSignal.timeout;
  const deadlines = [];
  AbortSignal.timeout = (ms) => { deadlines.push(ms); return nativeTimeout(ms); };
  let calls = 0;
  try {
    const result = await check({ ZAI_API_KEY: "fake-zai-key" }, async (url, options) => {
      calls += 1;
      assert.equal(url, ZAI_URL);
      assert.equal(options.method, "POST");
      assert.equal(options.headers.authorization, "Bearer fake-zai-key");
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.signal.aborted, false);
      const body = JSON.parse(options.body);
      assert.equal(body.model, "glm-5.3-flash");
      assert.equal(body.max_tokens, 1024);
      assert.equal(body.temperature, 0.1);
      assert.deepEqual(body.response_format, { type: "json_object" });
      assert.equal(Object.hasOwn(body, "thinking"), false);
      assert.equal(body.messages[0].role, "user");
      assert.match(body.messages[0].content, /PAGE COPY:\nWe repair roofs throughout Austin\./);
      assert.match(body.messages[0].content, /Do NOT flag standalone UI labels/);
      return zaiResponse(pass);
    });
    assert.equal(result.pass, true);
    assert.equal(calls, 1);
    assert.deepEqual(deadlines, [30_000]);
  } finally {
    AbortSignal.timeout = nativeTimeout;
  }
});

test("configured ZAI_MODEL is honored and Z.ai takes priority over legacy providers", async () => {
  const urls = [];
  const result = await check({ ZAI_API_KEY: "zai", ZAI_MODEL: "configured-glm", ANTHROPIC_API_KEY: "anthropic", GEMINI_API_KEY: "gemini" }, async (url, options) => {
    urls.push(url);
    assert.equal(JSON.parse(options.body).model, "configured-glm");
    return zaiResponse(pass);
  });
  assert.equal(result.pass, true);
  assert.deepEqual(urls, [ZAI_URL]);
});

test("substantive Z.ai rejection stops without trying a more permissive fallback", async () => {
  const urls = [];
  const result = await check({ ZAI_API_KEY: "zai", ANTHROPIC_API_KEY: "anthropic", GEMINI_API_KEY: "gemini" }, async (url) => {
    urls.push(url);
    return zaiResponse({ pass: false, issues: ["Repeated word: the the roof."] });
  });
  assert.equal(result.pass, false);
  assert.match(result.detail, /Repeated word: the the roof/);
  assert.deepEqual(urls, [ZAI_URL]);
});

for (const [label, body] of [
  ["non-JSON content", { choices: [{ message: { content: "not a verdict" } }] }],
  ["missing boolean verdict", { choices: [{ message: { content: '{"issues":[]}' } }] }],
  ["missing choices", {}],
]) {
  test(`Z.ai ${label} fails closed without fallback credentials`, async () => {
    const result = await check({ ZAI_API_KEY: "zai" }, async () => response(body));
    assert.equal(result.pass, false);
    assert.match(result.detail, /failing closed/);
  });
}

test("Z.ai HTTP failure fails closed and does not consume the raw error response", async () => {
  const result = await check({ ZAI_API_KEY: "zai" }, async () => ({
    ok: false,
    status: 429,
    json: async () => { throw new Error("must not read provider error payload"); },
  }));
  assert.equal(result.pass, false);
  assert.match(result.detail, /HTTP 429/);
  assert.match(result.detail, /failing closed/);
});

test("Z.ai transport failure falls back to Anthropic", async () => {
  const urls = [];
  const result = await check({ ZAI_API_KEY: "zai", ANTHROPIC_API_KEY: "anthropic" }, async (url) => {
    urls.push(url);
    if (url === ZAI_URL) throw new Error("connection failed");
    return anthropicResponse(pass);
  });
  assert.equal(result.pass, true);
  assert.deepEqual(urls, [ZAI_URL, "https://api.anthropic.com/v1/messages"]);
});

test("Z.ai then Anthropic transport failures preserve Gemini fallback", async () => {
  const urls = [];
  const result = await check({ ZAI_API_KEY: "zai", ANTHROPIC_API_KEY: "anthropic", GEMINI_API_KEY: "gemini" }, async (url) => {
    urls.push(url);
    if (urls.length < 3) return { ok: false, status: 503 };
    return geminiResponse(pass);
  });
  assert.equal(result.pass, true);
  assert.equal(urls[0], ZAI_URL);
  assert.match(urls[1], /api\.anthropic\.com/);
  assert.match(urls[2], /generativelanguage\.googleapis\.com/);
});

test("Z.ai timeout can fall back directly to Gemini", async () => {
  const urls = [];
  const result = await check({ ZAI_API_KEY: "zai", GEMINI_API_KEY: "gemini" }, async (url) => {
    urls.push(url);
    if (url === ZAI_URL) throw new DOMException("request deadline reached", "TimeoutError");
    return geminiResponse(pass);
  });
  assert.equal(result.pass, true);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /generativelanguage\.googleapis\.com/);
});

test("all provider failures redact raw and encoded credentials from error detail", async () => {
  const env = { ZAI_API_KEY: "fake/zai+key=", ANTHROPIC_API_KEY: "fake/anthropic+key=", GEMINI_API_KEY: "fake/gemini+key=" };
  const secretVariants = Object.values(env).flatMap((key) => [key, encodeURIComponent(key)]);
  const result = await check(env, async () => { throw new Error(secretVariants.join(" ")); });
  assert.equal(result.pass, false);
  assert.match(result.detail, /failing closed/);
  for (const secret of secretVariants) assert.equal(result.detail.includes(secret), false);
});

test("grammar verdict issues also redact configured credentials", async () => {
  const key = "fake-zai-secret";
  const result = await check({ ZAI_API_KEY: key }, async () => zaiResponse({ pass: false, issues: [`Unexpected ${key} in output`] }));
  assert.equal(result.pass, false);
  assert.equal(result.detail.includes(key), false);
  assert.match(result.detail, /\[redacted\]/);
});

test("missing keys and empty page copy fail without provider calls", async () => {
  const never = async () => { assert.fail("no provider call expected"); };
  const noKeys = await check({}, never);
  assert.equal(noKeys.pass, false);
  assert.match(noKeys.detail, /ZAI_API_KEY/);
  const noCopy = await check({ ZAI_API_KEY: "zai" }, never, "");
  assert.equal(noCopy.pass, false);
  assert.match(noCopy.detail, /no visible page copy/);
});
