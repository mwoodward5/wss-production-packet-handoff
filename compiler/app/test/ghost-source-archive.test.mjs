import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { archiveSiteSourceToGhost } from "../lib/ghost-source-archive.mjs";

function makeOutDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "ghost-source-archive-"));
  writeFileSync(path.join(dir, "index.html"), "<html><body>hi</body></html>");
  mkdirSync(path.join(dir, "media"));
  writeFileSync(path.join(dir, "media", "logo.png"), Buffer.from([1, 2, 3]));
  mkdirSync(path.join(dir, "screenshots", "desktop"), { recursive: true });
  writeFileSync(path.join(dir, "screenshots", "desktop", "hero.png"), Buffer.from([9, 9, 9]));
  return dir;
}

test("archiveSiteSourceToGhost", async (t) => {
  await t.test("skips (no-op) when credentials are not configured", async () => {
    const dir = makeOutDir();
    try {
      const result = await archiveSiteSourceToGhost({
        siteSlug: "acme-plumbing",
        dir,
        env: {},
        fetchImpl: async () => { throw new Error("must not fetch when unconfigured"); },
      });
      assert.equal(result.skipped, true);
      assert.equal(result.ok, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("skips when siteSlug or dir is missing", async () => {
    const result = await archiveSiteSourceToGhost({
      siteSlug: "",
      dir: "/tmp/whatever",
      env: { GHOST_AGENCY_SOURCE_ARCHIVE_SUPABASE_URL: "https://x.supabase.co", GHOST_AGENCY_SOURCE_ARCHIVE_SUPABASE_KEY: "key" },
      fetchImpl: async () => { throw new Error("must not fetch"); },
    });
    assert.equal(result.skipped, true);
  });

  await t.test("uploads every file except screenshots/, using the ghost path convention", async () => {
    const dir = makeOutDir();
    const calls = [];
    try {
      const result = await archiveSiteSourceToGhost({
        siteSlug: "acme-plumbing",
        dir,
        env: {
          GHOST_AGENCY_SOURCE_ARCHIVE_SUPABASE_URL: "https://project.supabase.co/",
          GHOST_AGENCY_SOURCE_ARCHIVE_SUPABASE_KEY: "service-role-key",
        },
        fetchImpl: async (url, options) => {
          calls.push({ url, options });
          return new Response("{}", { status: 200 });
        },
      });
      assert.equal(result.skipped, false);
      assert.equal(result.ok, true);
      assert.equal(result.archived, 2); // index.html + media/logo.png — screenshots/ skipped
      const urls = calls.map((c) => c.url).sort();
      assert.deepEqual(urls, [
        "https://project.supabase.co/storage/v1/object/wss-site-sources/acme-plumbing/index.html",
        "https://project.supabase.co/storage/v1/object/wss-site-sources/acme-plumbing/media/logo.png",
      ]);
      for (const call of calls) {
        assert.equal(call.options.method, "POST");
        assert.equal(call.options.headers.Authorization, "Bearer service-role-key");
        assert.equal(call.options.headers.apikey, "service-role-key");
        assert.equal(call.options.headers["x-upsert"], "true");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("never throws — records per-file errors instead", async () => {
    const dir = makeOutDir();
    try {
      const result = await archiveSiteSourceToGhost({
        siteSlug: "acme-plumbing",
        dir,
        env: {
          GHOST_AGENCY_SOURCE_ARCHIVE_SUPABASE_URL: "https://project.supabase.co",
          GHOST_AGENCY_SOURCE_ARCHIVE_SUPABASE_KEY: "service-role-key",
        },
        fetchImpl: async () => new Response("nope", { status: 500 }),
      });
      assert.equal(result.ok, false);
      assert.equal(result.archived, 0);
      assert.equal(result.errors.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
