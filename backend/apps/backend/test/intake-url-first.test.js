"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { callIntakeGenie, discoveredFacts, prospectRequest, sourceUrls } = require("../lib/intake-genie-client");

test("URL-first intake keeps each public source separate and never invents a fallback", () => {
  const prospect = {
    prospect_id: "tattoo-1",
    website: "https://ink.example",
    gbp_url: "https://google.com/maps/place/ink",
    instagram_url: "https://instagram.com/ink",
    facebook_url: "https://facebook.com/ink",
    yelp_url: "https://yelp.com/biz/ink",
  };
  const sources = sourceUrls(prospect);
  assert.equal(sources.website_url, prospect.website);
  assert.equal(sources.instagram_url, prospect.instagram_url);
  assert.equal(sources.facebook_url, prospect.facebook_url);
  assert.equal(sources.yelp_url, prospect.yelp_url);
  const request = prospectRequest(prospect);
  assert.equal(request.intake_mode, "url_first");
  assert.equal(request.truth_law, "source_or_owner_only");
  assert.equal(request.prospect_hints.name, "");
});

test("manual intake is explicitly fallback-only", () => {
  const request = prospectRequest({ prospect_id: "manual-1", business_name: "Owner supplied" });
  assert.equal(request.intake_mode, "manual_fallback");
  assert.deepEqual(request.corrections, {});
});

test("discovered facts expose sources, conflicts, and owner corrections", () => {
  const view = discoveredFacts({
    facts: { phone: "111", hours: "9-5" },
    evidence: [
      { field: "phone", value: "111", source: "website", confidence: 0.9 },
      { field: "phone", value: "222", source: "gbp", confidence: 0.95 },
    ],
    corrections: { phone: "333" },
    missing_facts: ["email"],
  });
  const phone = view.facts.find((row) => row.field === "phone");
  assert.equal(phone.conflict, true);
  assert.equal(phone.corrected, true);
  assert.equal(phone.value, "333");
  assert.deepEqual(view.missing, ["email"]);
  assert.match(view.truthLaw, /remain missing/);
});

test("Intake Genie composes caller cancellation with its local timeout", async (t) => {
  const originalFetch = global.fetch;
  const originalBaseUrl = process.env.INTAKE_GENIE_BASE_URL;
  const originalToken = process.env.INTAKE_GENIE_TOKEN;
  process.env.INTAKE_GENIE_BASE_URL = "https://intake.example";
  process.env.INTAKE_GENIE_TOKEN = "test-token";
  t.after(() => {
    global.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.INTAKE_GENIE_BASE_URL;
    else process.env.INTAKE_GENIE_BASE_URL = originalBaseUrl;
    if (originalToken === undefined) delete process.env.INTAKE_GENIE_TOKEN;
    else process.env.INTAKE_GENIE_TOKEN = originalToken;
  });

  let receivedSignal;
  let lateCompletions = 0;
  global.fetch = async (_url, options) => new Promise((resolve, reject) => {
    receivedSignal = options.signal;
    const timer = setTimeout(() => {
      lateCompletions += 1;
      resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      });
    }, 100);
    options.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      const error = new Error("caller cancelled intake");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });

  const controller = new AbortController();
  const request = callIntakeGenie(
    { prospect_id: "cancelled-intake", website: "https://customer.example" },
    { signal: controller.signal },
  );
  controller.abort();
  const result = await request;

  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(receivedSignal);
  assert.notEqual(receivedSignal, controller.signal);
  assert.equal(receivedSignal.aborted, true);
  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(lateCompletions, 0);
});
