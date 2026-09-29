"use strict";
// selectRows accepted a `filter` option and threw it away. Every caller that
// asked for one kind of row got the newest rows of EVERY kind instead — most
// visibly the console's batch history, which showed ONE batch while 360
// snapshots across 74 batches sat in the table. Two finished sites looked like
// they had vanished when they were only waiting for approval.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

function loadStoreWithCapture() {
  // Fresh module each time so the fetch stub is the one it closes over.
  const p = require.resolve("../lib/store.js");
  delete require.cache[p];
  const seen = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://store-filter-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  const store = require(p);
  return {
    store,
    seen,
    restore() {
      global.fetch = realFetch;
      if (prevUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = prevUrl;
      if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
      delete require.cache[p];
    },
  };
}

test("a filter option actually reaches the query", async () => {
  const h = loadStoreWithCapture();
  try {
    await h.store.selectRows("ghost_agency_events", {
      filter: "type=eq.line.batch",
      order: "created_at.desc",
      limit: 200,
    });
    const url = h.seen[0] || "";
    assert.ok(url.includes("type=eq.line.batch"), `filter was dropped from: ${url}`);
    assert.ok(url.includes("order=created_at.desc"), "order must still be sent");
    assert.ok(url.includes("limit=200"), "limit must still be sent");
  } finally { h.restore(); }
});

test("several filter clauses all survive", async () => {
  const h = loadStoreWithCapture();
  try {
    await h.store.selectRows("ghost_agency_events", {
      filter: "type=eq.line.batch&created_at=lt.2026-08-10T00%3A00%3A00Z",
    });
    const url = h.seen[0] || "";
    assert.ok(url.includes("type=eq.line.batch"), "first clause missing");
    assert.ok(/created_at=lt/.test(url), "second clause missing");
  } finally { h.restore(); }
});

test("a filter can never rewrite select, order, limit or offset", async () => {
  // Otherwise a caller could quietly widen a row cap or change the column list
  // through what looks like an innocuous filter string.
  const h = loadStoreWithCapture();
  try {
    await h.store.selectRows("ghost_agency_events", {
      select: "id",
      order: "created_at.desc",
      limit: 5,
      filter: "limit=9999&select=*&order=id.asc&type=eq.line.batch",
    });
    const url = new URL(h.seen[0]);
    assert.equal(url.searchParams.get("limit"), "5", "filter overrode the row cap");
    assert.equal(url.searchParams.get("select"), "id", "filter overrode the select list");
    assert.equal(url.searchParams.get("order"), "created_at.desc", "filter overrode the ordering");
    assert.equal(url.searchParams.get("type"), "eq.line.batch", "the legitimate clause was lost");
  } finally { h.restore(); }
});

test("no filter option leaves the query exactly as before", async () => {
  const h = loadStoreWithCapture();
  try {
    await h.store.selectRows("ghost_agency_prospects", { limit: 10 });
    const url = new URL(h.seen[0]);
    assert.equal(url.searchParams.get("limit"), "10");
    assert.equal(url.searchParams.get("select"), "*");
    assert.equal([...url.searchParams.keys()].sort().join(","), "limit,select");
  } finally { h.restore(); }
});

void path;
