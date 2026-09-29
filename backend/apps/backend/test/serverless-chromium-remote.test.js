"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const browser = require("../lib/serverless-chromium");

test("remote browser auto-enables only when Firecrawl is configured", () => {
  assert.equal(browser.remoteBrowserEnabled({}), false);
  assert.equal(browser.remoteBrowserEnabled({ FIRECRAWL_API_KEY: "fc-test" }), true);
  assert.equal(browser.remoteBrowserEnabled({ FIRECRAWL_API_KEY: "fc-test", GHOST_AGENCY_REMOTE_BROWSER: "false" }), false);
});

// Was: "render capacity matches ten-row factory waves". Ten was the assumption
// that broke production on 2026-08-19 — the queue worker and the rescue cron
// each claimed a ten-session wave, so ~20 remote browsers were live at once and
// the render gate failed with net::ERR_INSUFFICIENT_RESOURCES / "browser has
// been closed". Every mirror deployed and then failed to render, so no site was
// ever produced. The default is now a pool that survives two concurrent passes;
// the 20 ceiling remains for an operator who has proven headroom.
test("render capacity is starvation-safe while local fallback stays memory-bounded", () => {
  assert.equal(browser.renderConcurrency(undefined, {}), 2);
  assert.equal(browser.renderConcurrency(undefined, { FIRECRAWL_API_KEY: "fc-test" }), 3);
  assert.equal(browser.renderConcurrency("99", { FIRECRAWL_API_KEY: "fc-test" }), 20);
  assert.equal(browser.localRenderConcurrency("99"), 4);
});

test("Firecrawl browser session connects over CDP and is explicitly destroyed", async () => {
  const calls = [];
  const fakeBrowser = {
    closed: 0,
    async close() { this.closed += 1; },
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method, body: options.body || "" });
    if (options.method === "POST") {
      return {
        ok: true,
        status: 200,
        async json() {
          return { success: true, id: "session-123", cdpUrl: "wss://cdp-proxy.firecrawl.dev/cdp/session-123" };
        },
      };
    }
    return { ok: true, status: 200, async json() { return { success: true }; } };
  };
  const connected = [];
  const remote = await browser.createFirecrawlBrowser({
    apiKey: "fc-test",
    fetchImpl,
    connectOverCDP: async (url) => { connected.push(url); return fakeBrowser; },
  });

  assert.equal(remote.sessionId, "session-123");
  assert.deepEqual(connected, ["wss://cdp-proxy.firecrawl.dev/cdp/session-123"]);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].body, /"streamWebView":false/);

  await remote.destroy();
  assert.equal(fakeBrowser.closed, 1);
  assert.equal(calls.at(-1).method, "DELETE");
  assert.match(calls.at(-1).url, /\/v2\/browser\/session-123$/);
});

test("invalid Firecrawl session is cleaned up before failing", async () => {
  const methods = [];
  const fetchImpl = async (_url, options = {}) => {
    methods.push(options.method);
    if (options.method === "POST") {
      return { ok: true, status: 200, async json() { return { id: "bad-session", cdpUrl: "" }; } };
    }
    return { ok: true, status: 200, async json() { return { success: true }; } };
  };

  await assert.rejects(
    () => browser.createFirecrawlBrowser({ apiKey: "fc-test", fetchImpl, connectOverCDP: async () => ({}) }),
    /firecrawl_browser_create_invalid_response/,
  );
  assert.deepEqual(methods, ["POST", "DELETE"]);
});
