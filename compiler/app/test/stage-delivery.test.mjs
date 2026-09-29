import assert from "node:assert/strict";
import test from "node:test";

process.env.SITEFORGE_SERVERLESS = "1";
process.env.SITEFORGE_ADVANCE_DELIVERY_ATTEMPTS = "3";
process.env.SITEFORGE_ADVANCE_DELIVERY_RETRY_MS = "0";

const { postDurableJobAdvance } = await import("../lib/engine-adapter.mjs");

test("awaited stage delivery retries rejection and recognizes a durable terminal worker response", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      return calls.length === 1
        ? new Response("", { status: 503 })
        : new Response(JSON.stringify({ ok: false, terminal: true, status: "blocked" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
    };

    const accepted = await postDurableJobAdvance(
      "job-delivery",
      "https://siteforge.example/",
      "qc",
      "req-qc",
      "signed-token",
      5,
      "req-mobile",
      '"etag-5"',
      true,
    );

    assert.equal(accepted, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://siteforge.example/api/jobs/job-delivery/advance");
    assert.equal(calls[0].options.headers["x-siteforge-job-token"], "signed-token");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      stage: "qc",
      request_id: "req-qc",
      advance_attempt: 5,
      reclaim_from_request_id: "req-mobile",
      lease_etag: '"etag-5"',
    });

    let rejectedCalls = 0;
    globalThis.fetch = async () => {
      rejectedCalls += 1;
      return new Response("", { status: 503 });
    };
    const rejected = await postDurableJobAdvance(
      "job-rejected",
      "https://siteforge.example",
      "qc",
      "req-rejected",
      "signed-token",
      5,
      "req-mobile",
      '"etag-5"',
      true,
    );
    assert.equal(rejected, false);
    assert.equal(rejectedCalls, 3);

    let loopCalls = 0;
    globalThis.fetch = async () => {
      loopCalls += 1;
      return new Response("", { status: 508 });
    };
    const deliveryState = {};
    const deferred = await postDurableJobAdvance(
      "job-loop-detected",
      "https://siteforge.example",
      "capture_mobile",
      "req-mobile",
      "signed-token",
      4,
      "req-desktop",
      '"etag-4"',
      true,
      deliveryState,
    );
    assert.equal(deferred, false);
    assert.equal(loopCalls, 1);
    assert.deepEqual(deliveryState, { lastStatus: 508, loopDetected: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
