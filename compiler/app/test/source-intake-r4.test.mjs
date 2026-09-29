import assert from "node:assert/strict";
import test from "node:test";
import {
  collectSourceIntake,
  extractServiceHeadings,
  fetchJsonWithTimeout,
  fetchTextWithTimeout,
} from "../lib/source-intake.mjs";

test("metadata titles are not treated as services while real page headings remain", () => {
  assert.deepEqual(extractServiceHeadings([{
    metadata: { title: "Roof Repair Experts | Smith Roofing" },
  }], "Roof Repair Experts | Smith Roofing"), []);

  assert.deepEqual(extractServiceHeadings([{
    metadata: { title: "Roof Repair Experts | Smith Roofing" },
    html: "<h1>Roof Repair</h1><h2>Heat Pump Installation</h2>",
  }], "Smith Roofing"), ["Roof Repair", "Heat Pump Installation"]);
});

test("source collection excludes document titles from services", async () => {
  const originalFetch = globalThis.fetch;
  const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;
  try {
    process.env.FIRECRAWL_API_KEY = "offline-test-key";
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.endsWith("/map")) {
        return new Response(JSON.stringify({ success: true, links: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (target.endsWith("/search")) {
        return new Response(JSON.stringify({ success: true, data: { web: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (target.endsWith("/scrape")) {
        return new Response(JSON.stringify({ success: true, data: {
          metadata: { title: "Roof Repair Experts | Smith Roofing" },
          markdown: "# Roof Repair\n## Heat Pump Installation",
          rawHtml: "<h1>Roof Repair</h1><h2>Heat Pump Installation</h2>",
          links: [],
          images: [],
          branding: {},
        } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected offline request: ${target}`);
    };

    const result = await collectSourceIntake({
      sources: { website_url: "https://smith-roofing.example" },
    }, {
      name: "Smith Roofing",
      city: "Portland",
      state: "OR",
      category: "roofing",
    });
    assert.deepEqual(result.found.services, ["Roof Repair", "Heat Pump Installation"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
  }
});

test("request timeout stays active until JSON and text bodies finish", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const request of [fetchJsonWithTimeout, fetchTextWithTimeout]) {
      let requestSignal;
      globalThis.fetch = async (_url, options) => {
        requestSignal = options.signal;
        const stalledBody = () => new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new DOMException("Body read aborted", "AbortError")), { once: true });
        });
        return { ok: true, json: stalledBody, text: stalledBody };
      };

      await assert.rejects(
        request("https://offline.example/source", {}, 20),
        (error) => error?.name === "AbortError",
      );
      assert.equal(requestSignal.aborted, true);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bounded readers preserve successful JSON and text responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => "source body",
    });
    const jsonResult = await fetchJsonWithTimeout("https://offline.example/json", {}, 1000);
    const textResult = await fetchTextWithTimeout("https://offline.example/text", {}, 1000);
    assert.deepEqual(jsonResult.body, { ok: true });
    assert.equal(textResult.body, "source body");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
