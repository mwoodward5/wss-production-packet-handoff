"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

test("archiveSiteSource", async (t) => {
  t.after(() => {
    global.fetch = originalFetch;
    restoreEnv();
  });

  await t.test("rejects a missing siteSlug or empty files without any network call", async () => {
    const { archiveSiteSource } = require("../lib/site-source-archive");
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    assert.equal((await archiveSiteSource({ siteSlug: "", files: { "index.html": Buffer.from("x") } })).ok, false);
    assert.equal((await archiveSiteSource({ siteSlug: "acme", files: {} })).ok, false);
    assert.equal(called, false);
  });

  await t.test("uploads every file to wss-site-sources/<slug>/<rel> and reports a clean summary", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const { archiveSiteSource } = require("../lib/site-source-archive");
    const seen = [];
    global.fetch = async (url, options) => {
      seen.push({ url: String(url), method: options.method, contentType: options.headers["Content-Type"] });
      return { ok: true, json: async () => ({}) };
    };
    const files = {
      "index.html": Buffer.from("<html></html>"),
      "assets/logo.png": Buffer.from([1, 2, 3]),
      "hero-video.mp4": Buffer.from([4, 5, 6]),
    };
    const result = await archiveSiteSource({ siteSlug: "acme-plumbing", files });
    assert.deepEqual(result, { ok: true, archived: 3, total: 3, errors: [] });
    assert.equal(seen.length, 3);
    assert.ok(seen.every((s) => s.method === "POST"));
    assert.ok(seen.some((s) => s.url.includes("/storage/v1/object/wss-site-sources/acme-plumbing/index.html") && s.contentType === "text/html"));
    assert.ok(seen.some((s) => s.url.endsWith("/assets/logo.png") && s.contentType === "image/png"));
    assert.ok(seen.some((s) => s.url.endsWith("/hero-video.mp4") && s.contentType === "video/mp4"));
  });

  await t.test("a per-file upload failure is captured, not thrown, and does not stop the rest", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const { archiveSiteSource } = require("../lib/site-source-archive");
    global.fetch = async (url) => ({ ok: !String(url).endsWith("broken.css"), status: 500, json: async () => ({}) });
    const result = await archiveSiteSource({
      siteSlug: "acme-plumbing",
      files: { "index.html": Buffer.from("ok"), "broken.css": Buffer.from("bad") },
    });
    assert.equal(result.ok, false);
    assert.equal(result.archived, 1);
    assert.equal(result.total, 2);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].error, /broken\.css/);
  });

  // -----------------------------------------------------------------------
  // PRUNE — the archive has to mean "what we deployed", not "everything we
  // ever deployed". Measured cause: wss-test-rimrock-plumbing-billings served
  // /privacy 404 while privacy.html sat in the bucket, so the editor refused
  // to create the page ("already exists") that no visitor could reach.
  // -----------------------------------------------------------------------

  /** Stand-in Supabase Storage: list returns `existing`, delete records calls. */
  function storageDouble(existing, sink = {}) {
    sink.deleted = sink.deleted || [];
    sink.listed = sink.listed || [];
    return async (url, options = {}) => {
      const u = String(url);
      if (u.includes("/storage/v1/object/list/")) {
        const body = JSON.parse(options.body);
        sink.listed.push(body.prefix);
        if (body.offset) return { ok: true, json: async () => [] };
        const under = existing[body.prefix] || [];
        return { ok: true, json: async () => under };
      }
      if (options.method === "DELETE") {
        sink.deleted.push(...JSON.parse(options.body).prefixes);
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    };
  }

  await t.test("prune removes exactly the archived files the deploy no longer ships, and names them", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const { archiveSiteSource } = require("../lib/site-source-archive");
    const sink = {};
    global.fetch = storageDouble({
      "acme-plumbing": [
        { name: "index.html", id: "1" },
        { name: "about.html", id: "2" },
        { name: "privacy.html", id: "3" },
        { name: "assets", id: null },
      ],
      "acme-plumbing/assets": [{ name: "app.js", id: "4" }, { name: "old.css", id: "5" }],
    }, sink);

    const result = await archiveSiteSource({
      siteSlug: "acme-plumbing",
      prune: true,
      files: {
        "index.html": Buffer.from("<html></html>"),
        "about.html": Buffer.from("<html></html>"),
        "assets/app.js": Buffer.from("x"),
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.pruned.ok, true);
    assert.deepEqual(result.pruned.removed.sort(), ["assets/old.css", "privacy.html"]);
    assert.deepEqual(sink.deleted.sort(), ["acme-plumbing/assets/old.css", "acme-plumbing/privacy.html"]);
    // it walked the subdirectory rather than treating it as a file
    assert.ok(sink.listed.includes("acme-plumbing/assets"));
  });

  await t.test("prune is opt-in: without it nothing is listed and nothing is deleted", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const { archiveSiteSource } = require("../lib/site-source-archive");
    const sink = {};
    global.fetch = storageDouble({ "acme-plumbing": [{ name: "privacy.html", id: "3" }] }, sink);
    const result = await archiveSiteSource({ siteSlug: "acme-plumbing", files: { "index.html": Buffer.from("x") } });
    assert.equal(result.pruned, undefined);
    assert.deepEqual(sink.deleted, []);
    assert.deepEqual(sink.listed, []);
  });

  await t.test("a deployed set with no index.html prunes nothing and says why", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const { archiveSiteSource } = require("../lib/site-source-archive");
    const sink = {};
    global.fetch = storageDouble({ "acme-plumbing": [{ name: "index.html", id: "1" }] }, sink);
    const result = await archiveSiteSource({ siteSlug: "acme-plumbing", prune: true, files: { "about.html": Buffer.from("x") } });
    assert.equal(result.pruned.skipped, "no_index_html_in_deployed_set");
    assert.deepEqual(sink.deleted, []);
  });

  await t.test("a prune that would take more than half the archive refuses and reports the count", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const { archiveSiteSource } = require("../lib/site-source-archive");
    const sink = {};
    global.fetch = storageDouble({
      "acme-plumbing": [
        { name: "index.html", id: "1" }, { name: "a.html", id: "2" },
        { name: "b.html", id: "3" }, { name: "c.html", id: "4" }, { name: "d.html", id: "5" },
      ],
    }, sink);
    const result = await archiveSiteSource({ siteSlug: "acme-plumbing", prune: true, files: { "index.html": Buffer.from("x") } });
    assert.equal(result.pruned.skipped, "would_remove_more_than_half_the_archive");
    assert.equal(result.pruned.candidates, 4);
    assert.deepEqual(sink.deleted, []);
  });

  await t.test("an upload error anywhere cancels the prune — the deployed set is not trustworthy", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const { archiveSiteSource } = require("../lib/site-source-archive");
    const sink = {};
    const storage = storageDouble({ "acme-plumbing": [{ name: "index.html", id: "1" }, { name: "stale.html", id: "2" }] }, sink);
    global.fetch = async (url, options) => {
      if (String(url).endsWith("broken.css")) return { ok: false, status: 500, json: async () => ({}) };
      return storage(url, options);
    };
    const result = await archiveSiteSource({
      siteSlug: "acme-plumbing",
      prune: true,
      files: { "index.html": Buffer.from("x"), "broken.css": Buffer.from("y") },
    });
    assert.equal(result.pruned.skipped, "upload_errors_present");
    assert.deepEqual(sink.deleted, []);
  });

  await t.test("a listing failure is reported, never thrown, and deletes nothing", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const { archiveSiteSource } = require("../lib/site-source-archive");
    const deleted = [];
    global.fetch = async (url, options = {}) => {
      if (String(url).includes("/object/list/")) return { ok: false, status: 503, json: async () => ({}) };
      if (options.method === "DELETE") { deleted.push(1); return { ok: true, json: async () => ({}) }; }
      return { ok: true, json: async () => ({}) };
    };
    const result = await archiveSiteSource({ siteSlug: "acme-plumbing", prune: true, files: { "index.html": Buffer.from("x") } });
    assert.equal(result.ok, true);          // the upload still succeeded
    assert.equal(result.pruned.ok, false);
    assert.match(result.pruned.error, /archive list failed/);
    assert.deepEqual(deleted, []);
  });

  await t.test("missing Supabase credentials fail closed per-file, never throw", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { archiveSiteSource } = require("../lib/site-source-archive");
    global.fetch = async () => { throw new Error("should never be called without credentials"); };
    const result = await archiveSiteSource({ siteSlug: "acme-plumbing", files: { "index.html": Buffer.from("ok") } });
    assert.equal(result.ok, false);
    assert.equal(result.archived, 0);
    assert.match(result.errors[0].error, /SUPABASE_URL/);
  });
});
