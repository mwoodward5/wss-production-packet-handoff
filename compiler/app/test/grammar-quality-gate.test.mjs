import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { checkGrammarQuality, extractVisibleCopy } from "../../qc-audit/qc.mjs";

// Regression guard for the confirmed gap: checkGrammarBatch() used to be a
// hardcoded stub (`return { pass: true }`) that only ran in --batch mode,
// which the single-preview build-preview path never invokes. checkGrammarQuality
// is the real, per-build check wired into the plain (non-batch) runQualityAudit
// path. These tests prove it actually calls out to a model and gates on the
// verdict — not another stub — by injecting a fake fetch implementation so no
// real network access or API key is required to prove the logic.

function docFor(bodyHtml) {
  return new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`).window.document;
}

function fakeAnthropicFetch(verdictJson) {
  return async () => ({
    ok: true,
    json: async () => ({ content: [{ type: "text", text: JSON.stringify(verdictJson) }] }),
  });
}

test("extractVisibleCopy strips scripts/styles and collapses whitespace", () => {
  const doc = docFor(`<script>window.x=1;</script><style>.a{color:red}</style><p>Hello   world.</p>`);
  assert.equal(extractVisibleCopy(doc), "Hello world.");
});

test("extractVisibleCopy separates copy across adjacent visible elements", () => {
  const doc = docFor(`
    <main>
      <p><span>1</span><span>core services</span></p>
      <p><span>TX</span><span>Austin based</span></p>
      <p><strong>WSS Labs</strong><script>window.bad = "leak";</script><span>built</span></p>
    </main>
  `);
  assert.equal(extractVisibleCopy(doc), "1 core services TX Austin based WSS Labs built");
});

test("extractVisibleCopy does not add spaces before punctuation or inside connectors", () => {
  const doc = docFor(`
    <p><span>Hello</span><span>,</span><span> Austin</span><span>-based</span><span> teams.</span></p>
    <p><span>$</span><span>20</span><span>/</span><span>month</span><span>.</span></p>
  `);
  assert.equal(extractVisibleCopy(doc), "Hello, Austin-based teams. $20/month.");
});

test("extractVisibleCopy preserves decimals split across inline nodes", () => {
  const doc = docFor(`<p>Rated <span>4</span><span>.</span><span>9</span> stars.</p>`);
  assert.equal(extractVisibleCopy(doc), "Rated 4.9 stars.");
});

test("extractVisibleCopy preserves email addresses split across inline nodes", () => {
  const doc = docFor(`<p>Email <span>hello</span><span>@</span><span>example</span><span>.</span><span>com</span>.</p>`);
  assert.equal(extractVisibleCopy(doc), "Email hello@example.com.");
});

test("extractVisibleCopy preserves thousands-separated numbers split across inline nodes", () => {
  const doc = docFor(`<p>Trusted by <span>1</span><span>,</span><span>000</span> customers.</p>`);
  assert.equal(extractVisibleCopy(doc), "Trusted by 1,000 customers.");
});

test("grammar check fails closed with no API key configured (never silently passes)", async () => {
  const doc = docFor("<p>Clean, well-formed copy.</p>");
  const result = await checkGrammarQuality(doc, "", { env: {}, fetchImpl: async () => { throw new Error("should not be called"); } });
  assert.equal(result.name, "grammar-quality");
  assert.equal(result.pass, false);
  assert.match(result.detail, /no ANTHROPIC_API_KEY or GEMINI_API_KEY/);
});

test("grammar prompt exempts valid UI fragments while retaining concrete defect checks", async () => {
  const doc = docFor(`<b>TX</b><span>Austin based</span><b>3</b><span>core services</span>`);
  let sentPrompt = "";
  const fetchImpl = async (_url, options) => {
    sentPrompt = JSON.parse(options.body).messages[0].content;
    return {
      ok: true,
      json: async () => ({ content: [{ type: "text", text: JSON.stringify({ pass: true, issues: [] }) }] }),
    };
  };
  const result = await checkGrammarQuality(doc, "", { env: { ANTHROPIC_API_KEY: "test-key" }, fetchImpl });

  assert.equal(result.pass, true);
  assert.ok(sentPrompt.includes("Do NOT flag standalone UI labels, stat value/label pairs, navigation labels, or short headings solely for being sentence fragments."));
  assert.ok(sentPrompt.includes('Valid flattened UI examples include "TX Austin based" (state value + label) and "3 core services" (stat value + label).'));
  assert.ok(sentPrompt.includes('Still flag actually glued text such as "1core services", real broken punctuation, duplicated words, or otherwise malformed copy.'));
  assert.ok(sentPrompt.includes("PAGE COPY:\nTX Austin based 3 core services"));
});

test("grammar check catches the exact defect class: jammed words like 'a Austin-based'", async () => {
  const doc = docFor("<h1>Welcome</h1><p>We are a Austin-based fencing company plumbing installs done right.</p>");
  const fetchImpl = fakeAnthropicFetch({
    pass: false,
    issues: ["\"a Austin-based\" is missing a verb (should read \"is an Austin-based\")", "\"company plumbing\" reads as two glued sentences"],
  });
  const result = await checkGrammarQuality(doc, "", { env: { ANTHROPIC_API_KEY: "test-key" }, fetchImpl });
  assert.equal(result.pass, false);
  assert.match(result.detail, /a Austin-based/);
});

test("grammar check passes clean copy through the same model call path", async () => {
  const doc = docFor("<h1>Welcome</h1><p>We are an Austin-based fencing company offering professional installs.</p>");
  const fetchImpl = fakeAnthropicFetch({ pass: true, issues: [] });
  const result = await checkGrammarQuality(doc, "", { env: { ANTHROPIC_API_KEY: "test-key" }, fetchImpl });
  assert.equal(result.pass, true);
  assert.match(result.detail, /no grammar breaks/);
});

test("grammar check falls back to GEMINI_API_KEY when ANTHROPIC_API_KEY is absent", async () => {
  const doc = docFor("<p>Some copy.</p>");
  const fetchImpl = async (url) => {
    assert.match(String(url), /generativelanguage\.googleapis\.com/);
    assert.match(String(url), /models\/gemini-3\.5-flash-lite:generateContent/);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ pass: true, issues: [] }) }] } }] }) };
  };
  const result = await checkGrammarQuality(doc, "", { env: { GEMINI_API_KEY: "gk" }, fetchImpl });
  assert.equal(result.pass, true);
});

test("grammar check falls back to Gemini when the configured Anthropic credential is rejected", async () => {
  const doc = docFor("<p>Clean copy with a complete sentence.</p>");
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("api.anthropic.com")) return { ok: false, status: 401 };
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ pass: true, issues: [] }) }] } }] }),
    };
  };
  const result = await checkGrammarQuality(doc, "", {
    env: { ANTHROPIC_API_KEY: "stale-key", GEMINI_API_KEY: "working-key" },
    fetchImpl,
  });
  assert.equal(result.pass, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /api\.anthropic\.com/);
  assert.match(calls[1], /generativelanguage\.googleapis\.com/);
});

test("grammar check fails closed on a broken/unparseable model response, never a silent pass", async () => {
  const doc = docFor("<p>Some copy.</p>");
  const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: "not json at all" }] }) });
  const result = await checkGrammarQuality(doc, "", { env: { ANTHROPIC_API_KEY: "k" }, fetchImpl });
  assert.equal(result.pass, false);
  assert.match(result.detail, /failing closed/);
});

test("grammar check fails closed on an HTTP error from the model API", async () => {
  const doc = docFor("<p>Some copy.</p>");
  const fetchImpl = async () => ({ ok: false, status: 500 });
  const result = await checkGrammarQuality(doc, "", { env: { ANTHROPIC_API_KEY: "k" }, fetchImpl });
  assert.equal(result.pass, false);
  assert.match(result.detail, /failing closed/);
});
