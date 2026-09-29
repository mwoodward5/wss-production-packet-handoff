"use strict";

// /campaign-status — the standalone campaign status page. Pins:
//   · the public HTML shell (brand frame, gallery-style token gate, poller,
//     15s auto-refresh) renders with NO token and leaks no data
//   · the JSON flavor is the only data path and sits behind the admin gate
//   · the stopwatch math: ISO milestones -> T+mm:ss deltas (truncating,
//     minutes uncapped), exactly as scripts/time-campaign.cjs measures them
//   · the bank_draw drawn-vs-mined split and per-stage elapsedMs projection
//   · the /campaign-status rewrite in vercel.json (rewrites are safe to
//     extend: siteforge-timeout.test.js pins env/functions entries only —
//     that pin is re-asserted here as a guardrail for this very edit)

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const PAGE = require("../lib/campaign-status-page");
const {
  ACTIVE_BATCH_STATUSES,
  campaignCounts,
  campaignSnapshot,
  createCampaignStatusDataHandler,
  currentCampaign,
  deltaMs,
  formatTPlus,
  timingStrip,
} = require("../lib/campaign-status-data");
const route = require("../api/admin/campaign-status");
const { createCampaignStatusRoute } = route;

const TOKEN = "status-test-token";

/** Point the admin gate at a known token for one test, then restore it. */
function authed(t) {
  const previous = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = TOKEN;
  t.after(() => {
    if (previous === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = previous;
  });
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    raw: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); },
    end(payload = "") {
      this.raw = String(payload || "");
      const type = this.headers["content-type"] || "";
      this.body = type.includes("application/json") && this.raw ? JSON.parse(this.raw) : this.raw;
    },
  };
}

function request({ method = "GET", url = "/api/admin/campaign-status", token = "", accept = "" } = {}) {
  const headers = {};
  if (token) headers["x-admin-token"] = token;
  if (accept) headers.accept = accept;
  return { method, url, headers };
}

// The durable hydrated batch shape line-persistence.listBatches returns,
// fixture-populated across the whole row ladder so every count bucket moves.
function fixtureBatch(overrides = {}) {
  return {
    batchId: "line_test_current",
    lane: "live",
    target: "concrete:austin",
    requested: 10,
    status: "sending",
    pickState: "complete",
    haltReason: "",
    version: 7,
    startedAt: "2026-09-02T20:00:00.000Z",
    createdAt: "2026-09-02T19:59:58.000Z",
    updatedAt: "2026-09-02T20:18:12.000Z",
    settledAt: "2026-09-02T20:14:02.000Z",
    sentAt: null,
    mineFunnel: [
      { stage: "bank_draw", entered: 6, survived: 5, rejected: { bank_skip: 1 }, elapsedMs: 12_345 },
      { stage: "quota_source_0_concrete", entered: 4, survived: 2, mode: "mine", source_target: "concrete", elapsedMs: 301_000 },
      { stage: "quota_contract_finished_sites_v1", requested: 10, selected: 7, elapsedMs: 90_000 },
      { stage: "line_start_watch_v1", claimed_at: "2026-09-02T20:00:01.000Z" },
      {
        stage: "line_campaign_timing_v1",
        startedAt: "2026-09-02T20:00:00.000Z",
        firstQualifiedAt: "2026-09-02T20:01:35.000Z",
        firstBuiltAt: "2026-09-02T20:04:50.000Z",
        firstGateAt: "2026-09-02T20:09:02.000Z",
        firstSentAt: "2026-09-02T20:14:00.400Z",
      },
    ],
    rows: [
      { status: "picked" },
      { status: "qualified" },
      { status: "mirrored" },
      { status: "gate_passed" },
      { status: "ready" },
      { status: "queued" },
      { status: "sent" },
      { status: "sent" },
      { status: "gate_failed" },
      { status: "rejected" },
    ],
    ...overrides,
  };
}

function listBatchesReturning(batches) {
  const list = async (options = {}) => {
    list.lastOptions = options;
    return { ok: true, batches };
  };
  list.lastOptions = null;
  return list;
}

test("the HTML shell renders with no token and carries the WSS brand frame", async () => {
  const res = fakeRes();
  await route(request({ url: "/campaign-status", accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.body, PAGE, "the route serves the page module verbatim");

  // Brand frame: ink banner, gradient shelf, inline W mark, studio footer
  // (the operator deck homage from #609, copied inline — no linked assets).
  assert.match(PAGE, /--bg:#08080B/, "the ink banner's ground token");
  assert.match(PAGE, /background:\s*radial-gradient\(60rem 28rem at 85% -8%,rgba\(124,108,246,\.20\),transparent 62%\)/);
  assert.match(PAGE, /\.brandshelf\{height:3px;border-radius:3px;background:linear-gradient\(90deg,#4A6CF7 0%,#7C6CF6 55%,#34D399 100%\)/);
  assert.match(PAGE, /aria-label="WSS Labs"/);
  assert.match(PAGE, /stop-color="#4A6CF7"/);
  assert.match(PAGE, /fill="#34D399"/);
  assert.match(PAGE, /fill="#131318"/);
  assert.match(PAGE, /WSS Labs<\/b> &mdash; American AI web studio &#127482;&#127480;/);
  assert.doesNotMatch(PAGE, /<link[^>]+stylesheet/i, "the brand frame must not link external assets");
  assert.doesNotMatch(PAGE, /<img/i, "the W mark must be inline SVG, never a fetched image");

  // Compact operator page hygiene.
  assert.match(PAGE, /<meta http-equiv="refresh" content="15" \/>/, "15s auto-refresh");
  assert.match(PAGE, /<meta name="robots" content="noindex" \/>/);
});

test("the HTML shell gates data behind the in-browser token, never the URL", () => {
  // The gallery's gate pattern: password input, localStorage, x-admin-token
  // header. The only query param the poller ever writes is format=json.
  assert.match(PAGE, /id="accessGate"/);
  assert.match(PAGE, /id="tokenInput" type="password"/);
  assert.match(PAGE, /KEY="wsl_admin_token"/, "the same browser slot the gallery uses");
  assert.match(PAGE, /headers:\{"x-admin-token":token\(\),"Accept":"application\/json"\}/);
  assert.match(PAGE, /searchParams\.set\("format","json"\)/);
  assert.doesNotMatch(PAGE, /searchParams\.set\("token"/i, "the token must never ride the URL");
  // No batch data ships inside the shell.
  assert.doesNotMatch(PAGE, /line_test_current/);
});

test("the JSON flavor requires the admin token", async (t) => {
  authed(t);
  const handler = createCampaignStatusDataHandler({ listBatches: listBatchesReturning([fixtureBatch()]) });

  const denied = fakeRes();
  await handler(request({ url: "/api/admin/campaign-status?format=json" }), denied);
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.body.error, "unauthorized");

  const wrong = fakeRes();
  await handler(request({ url: "/api/admin/campaign-status?format=json", token: "not-it" }), wrong);
  assert.equal(wrong.statusCode, 401);

  const allowed = fakeRes();
  await handler(request({ url: "/api/admin/campaign-status?format=json", token: TOKEN }), allowed);
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body.ok, true);
});

test("the unconfigured server refuses JSON reads rather than pretending", async (t) => {
  const previous = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  t.after(() => {
    if (previous === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = previous;
  });

  const handler = createCampaignStatusDataHandler({ listBatches: listBatchesReturning([fixtureBatch()]) });
  const res = fakeRes();
  await handler(request({ url: "/api/admin/campaign-status?format=json" }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "server_auth_unconfigured");
});

test("the route negotiates the JSON flavor by query flag and by Accept header", async (t) => {
  authed(t);
  const fixtureRoute = createCampaignStatusRoute({ listBatches: listBatchesReturning([fixtureBatch()]) });

  // Query flag wins even when the Accept header says html (curl + poller).
  const byQuery = fakeRes();
  await fixtureRoute(request({ url: "/campaign-status?format=json", token: TOKEN, accept: "text/html" }), byQuery);
  assert.equal(byQuery.statusCode, 200);
  assert.match(byQuery.headers["content-type"], /application\/json/);
  assert.equal(byQuery.body.ok, true);
  assert.equal(byQuery.body.campaign.batchId, "line_test_current");

  // A plain Accept: application/json with no query flag is JSON too.
  const byAccept = fakeRes();
  await fixtureRoute(request({ url: "/campaign-status", token: TOKEN, accept: "application/json" }), byAccept);
  assert.equal(byAccept.statusCode, 200);
  assert.match(byAccept.headers["content-type"], /application\/json/);

  // A navigating browser still gets the HTML shell.
  const browser = fakeRes();
  await fixtureRoute(request({ url: "/campaign-status", accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }), browser);
  assert.equal(browser.statusCode, 200);
  assert.match(browser.headers["content-type"], /text\/html/);

  // The negotiation helper is exported for exactly this pinning.
  assert.equal(route.wantsJson(request({ url: "/x?format=json" })), true);
  assert.equal(route.wantsJson(request({ url: "/x", accept: "application/json" })), true);
  assert.equal(route.wantsJson(request({ url: "/x", accept: "*/*" })), false);
  assert.equal(route.wantsJson(request({ url: "/x", accept: "text/html,*/*;q=0.8" })), false);

  // Anything but GET is rejected up front (methodGuard).
  const post = fakeRes();
  await fixtureRoute(request({ method: "POST", url: "/campaign-status" }), post);
  assert.equal(post.statusCode, 405);
});

test("the full JSON payload reads the newest non-halted batch end to end", async (t) => {
  authed(t);
  const list = listBatchesReturning([
    fixtureBatch({ batchId: "line_test_current" }),
    fixtureBatch({ batchId: "line_test_older", startedAt: "2026-09-01T20:00:00.000Z" }),
  ]);
  const res = fakeRes();
  await createCampaignStatusDataHandler({ listBatches: list })(
    request({ url: "/api/admin/campaign-status?format=json", token: TOKEN }),
    res,
  );

  // The current campaign is the first non-halted batch in newest-first order,
  // and the read only ever asks for non-halted statuses — a parked batch is
  // never shown as "current".
  assert.deepEqual(list.lastOptions.statuses, ACTIVE_BATCH_STATUSES);
  assert.ok(!list.lastOptions.statuses.includes("halted"));

  const campaign = res.body.campaign;
  assert.equal(campaign.batchId, "line_test_current");
  assert.equal(campaign.status, "sending");
  assert.equal(campaign.lane, "live");
  assert.equal(campaign.target, "concrete:austin");
  assert.equal(campaign.requested, 10);
  assert.equal(campaign.haltReason, null);

  // Counts: five disjoint buckets that sum to total across the whole ladder.
  assert.deepEqual(campaign.counts, { total: 10, working: 3, gatePassed: 3, sent: 2, failed: 2 });
  const sum = campaign.counts.working + campaign.counts.gatePassed + campaign.counts.sent + campaign.counts.failed;
  assert.equal(sum, campaign.counts.total);

  // The #628 stopwatch strip: raw ISO stamps plus server-computed deltas.
  const timing = campaign.campaignTiming;
  assert.equal(timing.startedAt, "2026-09-02T20:00:00.000Z");
  assert.equal(timing.firstSentAt, "2026-09-02T20:14:00.400Z");
  assert.equal(timing.deltas.firstQualified.label, "T+01:35");
  assert.equal(timing.deltas.firstBuilt.label, "T+04:50");
  assert.equal(timing.deltas.firstGate.label, "T+09:02");
  assert.equal(timing.deltas.firstSent.label, "T+14:00", "deltas truncate, never round ahead of truth");

  // The #629 bank draw: drawn from the bank vs mined fresh.
  assert.equal(campaign.bankDraw.drawn, 5);
  assert.equal(campaign.bankDraw.requested, 6);
  assert.equal(campaign.bankDraw.elapsed, "T+00:12");
  assert.equal(campaign.mined, 2, "sum of quota_source_* survived");

  // Per-stage elapsedMs from the mine funnel, without the timing record row.
  const stages = campaign.funnel;
  assert.ok(stages.every((row) => row.stage !== "line_campaign_timing_v1"));
  const bank = stages.find((row) => row.stage === "bank_draw");
  assert.equal(bank.elapsed, "T+00:12");
  const source = stages.find((row) => row.stage === "quota_source_0_concrete");
  assert.equal(source.elapsedMs, 301_000);
  assert.equal(source.elapsed, "T+05:01");
  const watch = stages.find((row) => row.stage === "line_start_watch_v1");
  assert.equal(watch.elapsedMs, undefined, "a stage without a stamp shows no elapsed, not a fake one");
});

test("a store with no non-halted batch reports no active campaign, not an error", async (t) => {
  authed(t);
  const res = fakeRes();
  await createCampaignStatusDataHandler({ listBatches: listBatchesReturning([]) })(
    request({ url: "/api/admin/campaign-status?format=json", token: TOKEN }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.campaign, null);
});

test("a failed batch read surfaces as 503, never as an empty campaign", async (t) => {
  authed(t);
  const failing = async () => ({ ok: false, error: "read_failed" });
  const res = fakeRes();
  await createCampaignStatusDataHandler({ listBatches: failing })(
    request({ url: "/api/admin/campaign-status?format=json", token: TOKEN }),
    res,
  );
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "campaign_status_unavailable");
});

test("timing math: ISO -> T+mm:ss, truncating, minutes uncapped", () => {
  assert.equal(formatTPlus(0), "T+00:00");
  assert.equal(formatTPlus(95_000), "T+01:35");
  assert.equal(formatTPlus(840_400), "T+14:00");
  assert.equal(formatTPlus(5_412_000), "T+90:12", "a 90-minute delta stays mm:ss, matching the spec");
  assert.equal(formatTPlus(Number.NaN), "");
  assert.equal(formatTPlus(-1), "");

  const start = "2026-09-02T20:00:00.000Z";
  assert.equal(deltaMs(start, "2026-09-02T20:00:30.000Z"), 30_000);
  assert.equal(deltaMs(start, ""), null);
  assert.equal(deltaMs("", start), null);
  assert.equal(deltaMs(start, "not-a-time"), null);
  assert.equal(deltaMs("2026-09-02T20:01:00.000Z", start), 0, "a stamp before start clamps to zero, never negative");

  const strip = timingStrip(
    [{ stage: "line_campaign_timing_v1", startedAt: start, firstQualifiedAt: "2026-09-02T20:02:05.000Z" }],
    start,
  );
  assert.equal(strip.firstBuiltAt, null, "a milestone not yet stamped stays null");
  assert.deepEqual(strip.deltas.firstQualified, { ms: 125_000, label: "T+02:05" });
  assert.equal(strip.deltas.firstSent, undefined, "no delta is invented for a pending milestone");
});

test("the stage-name literals stay pinned to their writers", () => {
  // This page reads the funnel with literal stage names so its cold start
  // stays light; these cross-checks keep the literals honest against the
  // modules that own the names. The owning modules pull the whole mirror
  // graph, so the pin reads their frozen declarations from source and, when
  // the graph is installed, double-checks the runtime constant too.
  const data = require("../lib/campaign-status-data");
  const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  const continuation = read("lib/line-continuation.js");
  const bankSource = read("lib/prospect-bank.js");
  const quotaSource = read("lib/line-quota.js");
  assert.match(continuation, /const CAMPAIGN_TIMING_STAGE = "line_campaign_timing_v1"/);
  assert.match(bankSource, /const BANK_DRAW_STAGE = "bank_draw"/);
  assert.match(quotaSource, /const QUOTA_SOURCE_PREFIX = "quota_source_"/);
  assert.equal(data.CAMPAIGN_TIMING_STAGE, "line_campaign_timing_v1");
  assert.equal(data.BANK_DRAW_STAGE, "bank_draw");
  assert.equal(data.QUOTA_SOURCE_PREFIX, "quota_source_");

  try {
    const { CAMPAIGN_TIMING_STAGE } = require("../lib/line-continuation");
    assert.equal(CAMPAIGN_TIMING_STAGE, data.CAMPAIGN_TIMING_STAGE);
    const bank = require("../lib/prospect-bank");
    const drawn = bank.bankDrawFunnelStage({ drawn: [{ prospectId: "p1" }], skipped: [] }, { requested: 4 });
    assert.equal(drawn.stage, data.BANK_DRAW_STAGE);
  } catch {
    // Full mirror-engine graph not installed in this checkout (ajv et al.);
    // the source pins above already locked the contract.
  }
});

test("campaignCounts buckets the whole durable row ladder", () => {
  const counts = campaignCounts([
    { status: "picked" }, { status: "qualified" }, { status: "mirrored" },
    { status: "gate_passed" }, { status: "ready" }, { status: "queued" },
    { status: "sent" }, { status: "error" }, { status: "gate_failed" }, { status: "rejected" },
    { status: undefined }, {},
  ]);
  assert.deepEqual(counts, { total: 12, working: 3, gatePassed: 3, sent: 1, failed: 3 });
  assert.equal(campaignCounts([]).total, 0);
  assert.equal(campaignSnapshot(null), null);
});

test("currentCampaign throws the 503 only when the read itself fails", async () => {
  const fine = await currentCampaign(listBatchesReturning([fixtureBatch()]));
  assert.equal(fine.batchId, "line_test_current");
  const empty = await currentCampaign(listBatchesReturning([]));
  assert.equal(empty, null);
  await assert.rejects(
    () => currentCampaign(async () => { throw new Error("boom"); }),
    /temporarily unavailable/,
  );
});

test("/campaign-status is registered as a rewrite and the timeout pin still holds", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  const rewrite = (vercel.rewrites || []).find((entry) => entry.source === "/campaign-status");
  assert.deepEqual(rewrite, { source: "/campaign-status", destination: "/api/admin/campaign-status" });

  // Guardrail for this exact edit: siteforge-timeout pins functions/env, and
  // this PR must not have disturbed any of those pinned entries.
  assert.equal(vercel.functions["api/admin/build-preview.js"].maxDuration, 800);
  assert.equal(vercel.functions["api/admin/owner-smoke.js"].maxDuration, 800);
  assert.equal(vercel.functions["api/admin/full-run.js"].maxDuration, 800);
  assert.equal(vercel.functions["api/admin/line.js"].maxDuration, 800);
  assert.equal(vercel.functions["api/cron/nightly-pipeline.js"].maxDuration, 800);
  assert.equal(vercel.functions["api/**/*.js"].maxDuration, 300);
  assert.equal(vercel.env.GHOST_AGENCY_MIRROR_TIMEOUT_MS, "600000");
});
