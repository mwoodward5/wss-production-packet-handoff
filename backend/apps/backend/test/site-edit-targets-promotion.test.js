const test = require("node:test");
const assert = require("node:assert");

// Store original require.cache entries
let originalStoreCacheEntry;
let originalSiteEditorCacheEntry;
let originalForgeCacheEntry;

test.beforeEach(() => {
  // Save original cache entries
  originalStoreCacheEntry = require.cache[require.resolve("../lib/store")];
  originalSiteEditorCacheEntry = require.cache[require.resolve("../lib/site-editor")];
  originalForgeCacheEntry = require.cache[require.resolve("../lib/forge")];

  // Clear require cache for the module under test and its dependencies
  delete require.cache[require.resolve("../lib/site-edit-targets")];
  delete require.cache[require.resolve("../lib/store")];
  delete require.cache[require.resolve("../lib/site-editor")];
  delete require.cache[require.resolve("../lib/forge")];
});

test.afterEach(() => {
  // Restore original cache entries
  if (originalStoreCacheEntry) {
    require.cache[require.resolve("../lib/store")] = originalStoreCacheEntry;
  }
  if (originalSiteEditorCacheEntry) {
    require.cache[require.resolve("../lib/site-editor")] = originalSiteEditorCacheEntry;
  }
  if (originalForgeCacheEntry) {
    require.cache[require.resolve("../lib/forge")] = originalForgeCacheEntry;
  }
});

// Match the query contract used by store.select in resolveSiteEditTarget.
function parseProspectIdFromQuery(query) {
  const match = String(query || "").match(/(?:^|&)prospect_id=eq\.([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

test("targetFromPromotion returns correct target if valid promotion exists", (t) => {
  const { targetFromPromotion } = require("../lib/site-edit-targets");
  const record = {
    voice_edit_promotion: {
      projectName: "ghost-test-project",
      aliasHost: "ghost-test-project.wss-ai.com",
    },
  };
  const target = targetFromPromotion(record);
  assert.deepStrictEqual(target, {
    projectName: "ghost-test-project",
    aliasHost: "ghost-test-project.wss-ai.com",
  });
});

test("targetFromPromotion returns null if no valid promotion exists", (t) => {
  const { targetFromPromotion } = require("../lib/site-edit-targets");
  assert.equal(targetFromPromotion({}), null);
  assert.equal(targetFromPromotion({ voice_edit_promotion: null }), null);
  assert.equal(
    targetFromPromotion({ voice_edit_promotion: { projectName: "" } }),
    null
  );
  assert.equal(
    targetFromPromotion({ voice_edit_promotion: { aliasHost: "" } }),
    null
  );
});

test("resolveSiteEditTarget promotes SiteForge-built site on first edit", async (t) => {
  const mockStore = {
    select: async (table, criteria) => {
      const siteSlug = parseProspectIdFromQuery(criteria);
      if (
        table === "ghost_agency_prospects" &&
        siteSlug === "siteforge-built-prospect"
      ) {
        return {
          ok: true,
          data: [
            {
              id: "prospect-123",
              prospect_id: "prospect-123-uuid",
              record: {
                build_dispatch: { jobId: "siteforge-job-1" },
              },
            },
          ],
        };
      }
      return { ok: true, data: [] };
    },
    conditionalUpdate: async (table, idColumn, idValue, guards, patch) => {
      assert.equal(table, "ghost_agency_prospects");
      assert.equal(idValue, "prospect-123");
      assert.deepEqual(guards, { "record->>voice_edit_promotion": "is.null" });
      assert.ok(patch.record.voice_edit_promotion);
      assert.ok(patch.preview_url.startsWith("https://ghost-siteforge-built-prospect"));
      return { ok: true, updated: true, rows: [{ id: "prospect-123", ...patch }] };
    },
  };

  const mockSiteEditor = {
    listAll: async (prospectId) => {
      assert.equal(prospectId, "prospect-123-uuid");
      return ["index.html"];
    },
    download: async (prospectId, file) => {
      assert.equal(prospectId, "prospect-123-uuid");
      assert.equal(file, "index.html");
      return "<html><body>SiteForge Content</body></html>";
    },
  };

  const mockForge = {
    vercelDeploy: async ({ files, projectName, aliasHost }) => {
      assert.ok(files["index.html"]);
      assert.ok(projectName.startsWith("ghost-siteforge-built-prospect"));
      assert.ok(aliasHost.startsWith("ghost-siteforge-built-prospect"));
      return { url: `https://${aliasHost}/`, alias: `https://${aliasHost}/`, aliasError: null };
    },
  };

  // Stubbing modules using require.cache
  require.cache[require.resolve("../lib/store")] = { exports: mockStore };
  require.cache[require.resolve("../lib/site-editor")] = { exports: mockSiteEditor };
  require.cache[require.resolve("../lib/forge")] = { exports: mockForge };

  const { resolveSiteEditTarget } = require("../lib/site-edit-targets");
  const target = await resolveSiteEditTarget("siteforge-built-prospect");

  assert.ok(target);
  assert.ok(target.projectName.startsWith("ghost-siteforge-built-prospect"));
  assert.ok(target.aliasHost.startsWith("ghost-siteforge-built-prospect"));
});

test("resolveSiteEditTarget fails closed if no archived files for promotion", async (t) => {
  const mockStore = {
    select: async (table, criteria) => {
      const siteSlug = parseProspectIdFromQuery(criteria);
      if (
        table === "ghost_agency_prospects" &&
        siteSlug === "no-archive-prospect"
      ) {
        return {
          ok: true,
          data: [
            {
              id: "prospect-456",
              prospect_id: "prospect-456-uuid",
              record: {
                build_dispatch: { jobId: "siteforge-job-2" },
              },
            },
          ],
        };
      }
      return { ok: true, data: [] };
    },
    conditionalUpdate: async () => {
      assert.fail("conditionalUpdate should not be called if promotion fails");
    },
  };

  const mockSiteEditor = {
    listAll: async (prospectId) => {
      assert.equal(prospectId, "prospect-456-uuid");
      return []; // No archived files
    },
    download: async () => {
      assert.fail("Download should not be called if no archived files");
    },
  };

  const mockForge = {
    vercelDeploy: async () => {
      assert.fail("Vercel deploy should not be called if no archived files");
    },
  };

  require.cache[require.resolve("../lib/store")] = { exports: mockStore };
  require.cache[require.resolve("../lib/site-editor")] = { exports: mockSiteEditor };
  require.cache[require.resolve("../lib/forge")] = { exports: mockForge };

  const { resolveSiteEditTarget } = require("../lib/site-edit-targets");
  const target = await resolveSiteEditTarget("no-archive-prospect");

  assert.equal(target, null);
});

test("resolveSiteEditTarget fails closed if Vercel deployment fails", async (t) => {
  const mockStore = {
    select: async (table, criteria) => {
      const siteSlug = parseProspectIdFromQuery(criteria);
      if (
        table === "ghost_agency_prospects" &&
        siteSlug === "deploy-fail-prospect"
      ) {
        return {
          ok: true,
          data: [
            {
              id: "prospect-789",
              prospect_id: "prospect-789-uuid",
              record: {
                build_dispatch: { jobId: "siteforge-job-3" },
              },
            },
          ],
        };
      }
      return { ok: true, data: [] };
    },
    conditionalUpdate: async () => {
      assert.fail("conditionalUpdate should not be called if deployment fails");
    },
  };

  const mockSiteEditor = {
    listAll: async (prospectId) => {
      assert.equal(prospectId, "prospect-789-uuid");
      return ["index.html"];
    },
    download: async (prospectId, file) => {
      assert.equal(prospectId, "prospect-789-uuid");
      assert.equal(file, "index.html");
      return "<html><body>SiteForge Content</body></html>";
    },
  };

  const mockForge = {
    vercelDeploy: async () => {
      return { url: null, aliasError: "Deployment failed" }; // Simulate Vercel failure
    },
  };

  require.cache[require.resolve("../lib/store")] = { exports: mockStore };
  require.cache[require.resolve("../lib/site-editor")] = { exports: mockSiteEditor };
  require.cache[require.resolve("../lib/forge")] = { exports: mockForge };

  const { resolveSiteEditTarget } = require("../lib/site-edit-targets");
  const target = await resolveSiteEditTarget("deploy-fail-prospect");

  assert.equal(target, null);
});

test("resolveSiteEditTarget fails closed when deploy succeeds but alias is not bound", async (t) => {
  const mockStore = {
    select: async (table, criteria) => {
      const siteSlug = parseProspectIdFromQuery(criteria);
      if (
        table === "ghost_agency_prospects" &&
        siteSlug === "alias-fail-prospect"
      ) {
        return {
          ok: true,
          data: [
            {
              id: "prospect-999",
              prospect_id: "prospect-999-uuid",
              record: {
                build_dispatch: { jobId: "siteforge-job-4" },
              },
            },
          ],
        };
      }
      return { ok: true, data: [] };
    },
    conditionalUpdate: async () => {
      assert.fail("conditionalUpdate MUST NOT be called when alias is not bound — preview_url would 404");
    },
  };

  const mockSiteEditor = {
    listAll: async (prospectId) => {
      assert.equal(prospectId, "prospect-999-uuid");
      return ["index.html"];
    },
    download: async () => "<html><body>SiteForge Content</body></html>",
  };

  const mockForge = {
    vercelDeploy: async ({ aliasHost }) => {
      // Deploy went READY (url truthy) but alias POST failed — the exact
      // shape forge.js returns on alias failure.
      return { url: "https://ghost-alias-fail.vercel.app", alias: null, aliasError: "cert_lag" };
    },
  };

  require.cache[require.resolve("../lib/store")] = { exports: mockStore };
  require.cache[require.resolve("../lib/site-editor")] = { exports: mockSiteEditor };
  require.cache[require.resolve("../lib/forge")] = { exports: mockForge };

  const { resolveSiteEditTarget } = require("../lib/site-edit-targets");
  const target = await resolveSiteEditTarget("alias-fail-prospect");

  assert.equal(target, null);
});

test("resolveSiteEditTarget fails closed when the promotion race is lost (updated:false)", async (t) => {
  const mockStore = {
    select: async (table, criteria) => {
      const siteSlug = parseProspectIdFromQuery(criteria);
      if (
        table === "ghost_agency_prospects" &&
        siteSlug === "race-lost-prospect"
      ) {
        return {
          ok: true,
          data: [
            {
              id: "prospect-race",
              prospect_id: "prospect-race-uuid",
              record: {
                build_dispatch: { jobId: "siteforge-job-5" },
              },
            },
          ],
        };
      }
      return { ok: true, data: [] };
    },
    conditionalUpdate: async (table, idColumn, idValue, guards) => {
      assert.equal(table, "ghost_agency_prospects");
      assert.deepEqual(guards, { "record->>voice_edit_promotion": "is.null" });
      // Simulate the atomic guard rejecting the write: a concurrent request
      // already stamped voice_edit_promotion, so the filter matches 0 rows.
      return { ok: true, updated: false, rows: [] };
    },
  };

  const mockSiteEditor = {
    listAll: async () => ["index.html"],
    download: async () => "<html><body>SiteForge Content</body></html>",
  };

  const mockForge = {
    vercelDeploy: async ({ aliasHost }) => ({
      url: `https://${aliasHost}/`,
      alias: `https://${aliasHost}/`,
      aliasError: null,
    }),
  };

  require.cache[require.resolve("../lib/store")] = { exports: mockStore };
  require.cache[require.resolve("../lib/site-editor")] = { exports: mockSiteEditor };
  require.cache[require.resolve("../lib/forge")] = { exports: mockForge };

  const { resolveSiteEditTarget } = require("../lib/site-edit-targets");
  const target = await resolveSiteEditTarget("race-lost-prospect");

  assert.equal(target, null);
});
