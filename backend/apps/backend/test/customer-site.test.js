"use strict";

// The customer dashboard's two missing facts: WHERE THEIR SITE IS and WHAT
// THEIR REPORT SAYS. See lib/customer-site.js for the measurements behind each
// rule. These tests fail against the code as it stood on 2026-08-08, when
// lib/customer-site.js and api/connect/site.js did not exist and the dashboard
// rendered a hardcoded "Your managed site" string with no link on it.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PROSPECT_COLUMNS,
  clientIdFromRow,
  mirrorHostSlug,
  reportUrlFromRow,
  resolveCustomerSurface,
  siteHost,
  siteUrlFromRow,
  weakestCategories,
} = require("../lib/customer-site");

const REPORT = "https://callprep.wss-ai.com/report/d5a8a810-b39b-4d9a-886f-e694465a0d7b";
const SITE = "https://wss-test-poor-john-s-plumbing-parkville.wss-ai.com/";
const SLUG = "wss-test-poor-john-s-plumbing-parkville";

/** The grade Poor John's report actually returns, read 2026-08-08. */
function poorJohnsFacts() {
  return {
    ok: true,
    reason: "",
    facts: {
      grade: "B",
      score: 83,
      categories: {
        googleBusinessProfile: { grade: "B+", score: 89 },
        onlineReputation: { grade: "B+", score: 89 },
        socialMedia: { grade: "F", score: 40 },
        websitePerformance: { grade: "B-", score: 81 },
        seo: { grade: "A", score: 95 },
        security: { grade: "C", score: 75 },
        geo: { grade: "B+", score: 88 },
        businessIntelligence: { grade: "F", score: 40 },
      },
    },
  };
}

function prospectRow(overrides = {}) {
  return {
    prospect_id: SLUG,
    business_name: "Poor John's Plumbing",
    preview_url: SITE,
    report_url: REPORT,
    record: {},
    ...overrides,
  };
}

/**
 * A store stub with the two tables this path reads. `queries` records every
 * filter string so a test can prove the slug that got used came from the token
 * and not from somewhere else.
 */
function fakeStore({ access = [], prospects = [], queries = [] } = {}) {
  return async function select(table, query) {
    queries.push(`${table}?${query}`);
    if (table === "ghost_agency_dashboard_access") return { ok: true, data: access };
    if (table === "ghost_agency_prospects") {
      if (/prospect_id=eq\./.test(query)) {
        const id = decodeURIComponent(/prospect_id=eq\.([^&]+)/.exec(query)[1]);
        return { ok: true, data: prospects.filter((row) => row.prospect_id === id) };
      }
      return { ok: true, data: prospects };
    }
    return { ok: true, data: [] };
  };
}

const accessRow = {
  job_id: `prospect-${SLUG}`,
  owner_email: "contactus@poorjohns.com",
  business_name: "Poor John's Plumbing",
  site_slug: SLUG,
  visibility_business: "poorjohns.com",
};

// ---------------------------------------------------------------------------
// ITEM 1 — the site URL
// ---------------------------------------------------------------------------

test("the site URL is read column first, then record, then build_dispatch", () => {
  assert.equal(siteUrlFromRow({ preview_url: SITE, record: { preview_url: "https://other.wss-ai.com/" } }), SITE);
  assert.equal(siteUrlFromRow({ record: { preview_url: SITE } }), SITE);
  assert.equal(siteUrlFromRow({ record: { build_dispatch: { preview_url: SITE } } }), SITE);
  assert.equal(siteUrlFromRow({ record: {} }), "");
});

test("a non-https site URL is refused rather than upgraded", () => {
  assert.equal(siteUrlFromRow({ preview_url: "http://wss-test-foo.wss-ai.com/" }), "");
  assert.equal(siteUrlFromRow({ preview_url: "javascript:alert(1)" }), "");
  assert.equal(siteUrlFromRow({ preview_url: "wss-test-foo.wss-ai.com" }), "");
  assert.equal(siteUrlFromRow({ preview_url: "https://user:pw@wss-test-foo.wss-ai.com/" }), "");
  // ...and falls through to a usable one rather than giving up on the row.
  assert.equal(siteUrlFromRow({ preview_url: "http://x.wss-ai.com/", record: { preview_url: SITE } }), SITE);
});

test("the printed host drops www and the scheme", () => {
  assert.equal(siteHost("https://www.poorjohns.com/plumbing"), "poorjohns.com");
  assert.equal(siteHost(SITE), `${SLUG}.wss-ai.com`);
  assert.equal(siteHost("not a url"), "");
});

test("a mirror host resolves to its slug and a foreign host does not", () => {
  assert.equal(mirrorHostSlug(SITE), SLUG);
  assert.equal(mirrorHostSlug("https://poorjohns.com/"), "");
  assert.equal(mirrorHostSlug(""), "");
});

test("the site card links the customer's real site", async () => {
  const surface = await resolveCustomerSurface({
    siteSlug: SLUG,
    select: fakeStore({ access: [accessRow], prospects: [prospectRow({ report_url: null })] }),
  });
  assert.equal(surface.site.available, true);
  assert.equal(surface.site.url, SITE);
  assert.equal(surface.site.host, `${SLUG}.wss-ai.com`);
  assert.equal(surface.businessName, "Poor John's Plumbing");
});

test("a row with no site yet says so and offers no link at all", async () => {
  const surface = await resolveCustomerSurface({
    siteSlug: SLUG,
    select: fakeStore({ access: [accessRow], prospects: [prospectRow({ preview_url: null, report_url: null })] }),
  });
  assert.equal(surface.site.available, false);
  assert.equal(surface.site.url, "");
  assert.equal(surface.site.reason, "no_site_on_file");
});

test("a login bound to no site says that, and never borrows another business's", async () => {
  const queries = [];
  const surface = await resolveCustomerSurface({ siteSlug: "", select: fakeStore({ queries }) });
  assert.equal(surface.site.reason, "no_site_bound_to_this_login");
  assert.equal(surface.report.reason, "no_site_bound_to_this_login");
  assert.equal(queries.length, 0, "an unbound login must not query any business's rows");
});

test("two sites claiming one login refuses instead of guessing", async () => {
  const surface = await resolveCustomerSurface({
    siteSlug: SLUG,
    select: fakeStore({
      access: [accessRow],
      prospects: [prospectRow(), prospectRow({ prospect_id: `${SLUG}-2`, business_name: "Someone Else" })],
    }),
  });
  assert.equal(surface.site.available, false);
  assert.equal(surface.site.reason, "multiple_sites_claim_this_login");
  assert.equal(surface.report.available, false);
});

test("a cleared preview URL still resolves through the namespaced job id", async () => {
  const surface = await resolveCustomerSurface({
    siteSlug: SLUG,
    select: fakeStore({
      access: [accessRow],
      prospects: [prospectRow({ preview_url: null, record: { preview_url: SITE } })],
    }),
    fetchReport: async () => poorJohnsFacts(),
  });
  assert.equal(surface.site.url, SITE);
  assert.equal(surface.report.grade, "B");
});

test("the prospect select list only names columns the table has", async () => {
  // The first deploy of this module asked for a `reference` column that
  // ghost_agency_prospects does not have. PostgREST answered 42703, the read
  // returned no rows, and the live dashboard told a customer with a site
  // answering 200 that their website "isn't on file here yet". Every test was
  // green. This pins the list; anything added to it must exist on the table.
  assert.equal(PROSPECT_COLUMNS, "prospect_id,business_name,preview_url,report_url,record");
  assert.doesNotMatch(PROSPECT_COLUMNS, /\breference\b/);
  const queries = [];
  await resolveCustomerSurface({
    siteSlug: SLUG,
    select: fakeStore({ access: [accessRow], prospects: [prospectRow({ report_url: null })], queries }),
  });
  const asked = queries.filter((q) => q.startsWith("ghost_agency_prospects"));
  assert.ok(asked.length > 0);
  for (const q of asked) assert.doesNotMatch(q, /reference/);
});

test("a read that FAILED is never reported as an empty table", async () => {
  // lib/store.js shapes: a 400 from PostgREST, and a store that is not
  // configured at all. Neither means "this customer has no website".
  for (const failure of [
    { ok: false, mode: "live_select_failed", status: 400, error: { code: "42703" } },
    { ok: false, mode: "dry_run", skipped: "supabase_not_configured", data: [] },
  ]) {
    const surface = await resolveCustomerSurface({
      siteSlug: SLUG,
      select: async (table) => (table === "ghost_agency_prospects" ? failure : { ok: true, data: [accessRow] }),
    });
    assert.equal(surface.site.available, false, failure.mode);
    assert.equal(surface.site.reason, "lookup_failed", failure.mode);
    assert.notEqual(surface.site.reason, "no_site_on_file");
    assert.equal(surface.report.reason, "lookup_failed", failure.mode);
  }
});

test("a store that throws produces an honest failure, never a blank success", async () => {
  const surface = await resolveCustomerSurface({
    siteSlug: SLUG,
    select: async (table) => {
      if (table === "ghost_agency_prospects") throw new Error("supabase down");
      return { ok: true, data: [accessRow] };
    },
  });
  assert.equal(surface.site.reason, "lookup_failed");
  assert.equal(surface.report.reason, "lookup_failed");
  assert.equal(surface.report.grade, "");
});

test("the Client ID prefers a registered reference over the derived one", () => {
  assert.equal(clientIdFromRow({ prospect_id: SLUG, reference: "PVLNGW" }), "PVLNGW");
  const derived = clientIdFromRow({ prospect_id: SLUG });
  assert.match(derived, /^WSS-[0-9A-F]{6}$/);
  assert.equal(clientIdFromRow({}), "");
});

// ---------------------------------------------------------------------------
// ITEM 3 — the report grade
// ---------------------------------------------------------------------------

test("a dead report link never becomes a button", () => {
  assert.equal(reportUrlFromRow({ report_url: REPORT }), REPORT);
  assert.equal(reportUrlFromRow({ record: { report_url: REPORT } }), REPORT);
  // The 17 stored links that are a build artefact on the retired rocketsites host.
  assert.equal(reportUrlFromRow({ report_url: `https://siteforge-app-rocketsites.vercel.app/try/${SLUG}/scorecard.json` }), "");
  // The build-slug-as-uuid shape: right host, impossible id.
  assert.equal(reportUrlFromRow({ report_url: `https://callprep.wss-ai.com/report/${SLUG}` }), "");
  assert.equal(reportUrlFromRow({}), "");
});

test("the weakest areas are the lowest scored, ascending, capped and stably ordered", () => {
  const weak = weakestCategories(poorJohnsFacts().facts);
  assert.equal(weak.length, 3);
  assert.deepEqual(weak.map((w) => w.key), ["socialMedia", "businessIntelligence", "security"]);
  assert.deepEqual(weak.map((w) => w.score), [40, 40, 75]);
  assert.equal(weak[0].label, "Social Media");
  assert.equal(weak[0].grade, "F");
  // The 5 live reports that carry exactly one scored category must render.
  const single = weakestCategories({ categories: { onlineReputation: { grade: "C", score: 74 } } });
  assert.deepEqual(single, [{ key: "onlineReputation", label: "Online Reputation", grade: "C", score: 74 }]);
  assert.deepEqual(weakestCategories({}), []);
});

test("the grade comes from the report, not from our own database copy", async () => {
  // The two scorers disagree on 8 of 8 measured scores. This row carries the DB
  // opinion (C+ / 77) and the report says B / 83. The card must say B.
  const surface = await resolveCustomerSurface({
    siteSlug: SLUG,
    select: fakeStore({
      access: [accessRow],
      prospects: [prospectRow({
        record: { build_ready: { qualification: { composite_signal: { grade: "C+", score: 77 } } } },
      })],
    }),
    fetchReport: async ({ reportUrl }) => {
      assert.equal(reportUrl, REPORT, "the grade must be read from the link the customer clicks");
      return poorJohnsFacts();
    },
  });
  assert.equal(surface.report.available, true);
  assert.equal(surface.report.grade, "B");
  assert.equal(surface.report.score, 83);
  assert.equal(surface.report.scored, 8);
  assert.equal(surface.report.url, REPORT);
  assert.notEqual(surface.report.grade, "C+");
  assert.notEqual(surface.report.score, 77);
});

test("an unreadable report shows NO grade, keeps the link, and names the reason", async () => {
  for (const reason of ["timeout", "http_404", "callprep_not_configured", "invalid_json"]) {
    const surface = await resolveCustomerSurface({
      siteSlug: SLUG,
      select: fakeStore({ access: [accessRow], prospects: [prospectRow()] }),
      fetchReport: async () => ({ ok: false, facts: null, reason }),
    });
    assert.equal(surface.report.available, false, reason);
    assert.equal(surface.report.grade, "", reason);
    assert.equal(surface.report.score, null, reason);
    assert.deepEqual(surface.report.weakest, [], reason);
    assert.equal(surface.report.reason, reason);
    assert.equal(surface.report.url, REPORT, "the customer can still open their own report");
  }
});

test("a 200 with nothing scored is not an F", async () => {
  // Six of twenty live reports answer 200 with overall_grade null and score 0.
  const surface = await resolveCustomerSurface({
    siteSlug: SLUG,
    select: fakeStore({ access: [accessRow], prospects: [prospectRow()] }),
    fetchReport: async () => ({ ok: false, facts: null, reason: "no_report_grade" }),
  });
  assert.equal(surface.report.available, false);
  assert.equal(surface.report.grade, "");
  assert.notEqual(surface.report.grade, "F");
  assert.equal(surface.report.reason, "no_report_grade");
});

test("a report reader that throws is caught, and still yields no grade", async () => {
  const surface = await resolveCustomerSurface({
    siteSlug: SLUG,
    select: fakeStore({ access: [accessRow], prospects: [prospectRow()] }),
    fetchReport: async () => { throw new Error("boom"); },
  });
  assert.equal(surface.report.available, false);
  assert.equal(surface.report.grade, "");
  assert.equal(surface.report.reason, "report_unreadable");
});

test("no report on file is a different sentence from an unreadable one", async () => {
  const surface = await resolveCustomerSurface({
    siteSlug: SLUG,
    select: fakeStore({ access: [accessRow], prospects: [prospectRow({ report_url: null })] }),
    fetchReport: async () => { throw new Error("must not be called"); },
  });
  assert.equal(surface.report.available, false);
  assert.equal(surface.report.reason, "no_report_on_file");
  assert.equal(surface.report.url, "");
});

// ---------------------------------------------------------------------------
// The endpoint's scope rule
// ---------------------------------------------------------------------------

test("a tenant token reads its own site and cannot name another", async () => {
  process.env.CONNECT_APP_TOKEN = "test-connect-token-for-scope-checks";
  const { signScopeToken } = require("../lib/dashboard-link");
  const store = require("../lib/store");
  const originalSelect = store.select;
  const seen = [];
  store.select = async (table, query) => {
    seen.push(`${table}?${query}`);
    if (table === "ghost_agency_dashboard_access") return { ok: true, data: [accessRow] };
    return { ok: true, data: [prospectRow({ report_url: null })] };
  };
  try {
    delete require.cache[require.resolve("../api/connect/site.js")];
    const handler = require("../api/connect/site.js");
    const res = mockRes();
    await handler({
      method: "GET",
      headers: { "x-connect-token": signScopeToken(SLUG) },
      query: { slug: "some-other-customers-site" },
    }, res);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.site.url, SITE);
    assert.ok(seen.some((q) => q.includes(encodeURIComponent(SLUG))), "must query its own slug");
    assert.ok(!seen.some((q) => q.includes("some-other-customers-site")), "must never query the slug the browser asked for");
  } finally {
    store.select = originalSelect;
    delete require.cache[require.resolve("../api/connect/site.js")];
  }
});

test("no token gets nothing", async () => {
  process.env.CONNECT_APP_TOKEN = "test-connect-token-for-scope-checks";
  delete require.cache[require.resolve("../api/connect/site.js")];
  const handler = require("../api/connect/site.js");
  const res = mockRes();
  await handler({ method: "GET", headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).ok, false);
  delete require.cache[require.resolve("../api/connect/site.js")];
});

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(payload) { this.body = String(payload == null ? "" : payload); },
  };
}
