"use strict";

// THE CAMPAIGN CLOCK, across every surface that shows it.
//
// PR #628 stamped a per-batch stopwatch (mine_funnel stage
// line_campaign_timing_v1) and exposed it as campaignTiming on the console's
// batch payloads. These tests pin the operator-facing half:
//
//   1. api/admin/gallery-data decorates its snapshot with the newest ACTIVE
//      batch's own stopwatch — one bounded row, annotation-only, and the key
//      is simply absent when there is nothing stamped to say.
//   2. The gallery page renders one monospace strip under its intro, turning
//      ISO stamps into "fire HH:MM · first lead +m:ss · … · sent x/y", and
//      hides the strip entirely when the snapshot carries no record.
//   3. The console renders the same one-liner under each batch's header from
//      the campaignTiming /api/admin/line already ships — nothing else in the
//      batch card changes for batches without one.

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const galleryPage = require("../lib/gallery-page");
const servedGalleryPage = require("../lib/gallery-page-final");
const consolePage = require("../lib/console-page");
const {
  createGalleryDataHandler,
  campaignTimingDecoration,
} = require("../api/admin/gallery-data");

// ---------------------------------------------------------------------------
// Harness — the same fake req/res the gallery-owner-proof suite uses, and the
// same function-lifting trick the console-launch-deck suite uses, so the
// tests exercise the EXACT source the pages ship.
// ---------------------------------------------------------------------------

function fakeJsonRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    raw: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(payload = "") {
      this.raw = String(payload || "");
      this.body = this.raw ? JSON.parse(this.raw) : null;
    },
  };
}

function request(token = "") {
  return {
    method: "GET",
    url: "/api/admin/gallery-data",
    headers: token ? { "x-admin-token": token } : {},
  };
}

function inlineScripts(html) {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

/** Lift `function <name>(...) {...}` out of a page's inline script, quote-aware. */
function liftPageFunction(html, name) {
  const script = inlineScripts(html).join("\n");
  const head = script.indexOf(`function ${name}(`);
  assert.notEqual(head, -1, `${name} must exist in the page source`);
  const open = script.indexOf("{", head);
  let depth = 0;
  let quote = "";
  for (let i = open; i < script.length; i += 1) {
    const ch = script[i];
    if (quote) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return script.slice(head, i + 1);
    }
  }
  throw new Error(`unbalanced braces lifting ${name}`);
}

const ESC = (value) => String(value == null ? "" : value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// The gallery's clock text builder, lifted from the served page. `text` is
// the page's own tiny trim-or-fallback helper, mirrored here verbatim.
function galleryClockText() {
  const src = [
    liftPageFunction(galleryPage, "campaignClockText"),
    liftPageFunction(galleryPage, "campaignClockElapsedText"),
    liftPageFunction(galleryPage, "campaignClockTimeOfDay"),
    'function text(value,fallback){var normalized=String(value==null?"":value).trim();return normalized||fallback||"";}',
    "return campaignClockText;",
  ].join("\n");
  // eslint-disable-next-line no-new-func
  return new Function(src)();
}

// The console's clock strip builder, lifted the same way from the controller.
function consoleClockHtml() {
  const src = [
    liftPageFunction(consolePage, "campaignClockHtml"),
    liftPageFunction(consolePage, "campaignClockElapsedText"),
    liftPageFunction(consolePage, "campaignClockTimeOfDay"),
    "return campaignClockHtml;",
  ].join("\n");
  // eslint-disable-next-line no-new-func
  return new Function("esc", src)(ESC);
}

// The page stamps and renders in the browser's local zone; the expected
// "fire HH:MM" is computed the same way, so the suite is timezone-proof.
function localFire(iso) {
  const at = new Date(Date.parse(iso));
  return String(at.getHours()).padStart(2, "0") + ":" + String(at.getMinutes()).padStart(2, "0");
}

const START = "2026-09-02T12:00:00.000Z";
const TIMING_BATCH = {
  batch_id: "line_timing_fixture",
  status: "sending",
  requested: 10,
  mine_funnel: [
    { stage: "1_packet_shelf_v1", entered: 40 },
    {
      stage: "line_campaign_timing_v1",
      startedAt: START,
      firstQualifiedAt: "2026-09-02T12:00:42.000Z",
      firstBuiltAt: "2026-09-02T12:01:10.000Z",
      firstGateAt: "2026-09-02T12:02:00.000Z",
      firstSentAt: "2026-09-02T12:04:32.000Z",
    },
  ],
};
const TIMING_LINE_ROWS = [
  { row_id: "r1", batch_id: "line_timing_fixture", status: "sent", updated_at: "2026-09-02T12:05:00.000Z", payload: { prospectId: "p1", previewUrl: "https://p1.wss-ai.com" } },
  { row_id: "r2", batch_id: "line_timing_fixture", status: "sent", updated_at: "2026-09-02T12:05:30.000Z", payload: { prospectId: "p2", previewUrl: "https://p2.wss-ai.com" } },
  { row_id: "r3", batch_id: "line_timing_fixture", status: "ready", updated_at: "2026-09-02T12:05:45.000Z", payload: { prospectId: "p3", previewUrl: "https://p3.wss-ai.com" } },
  // A DIFFERENT batch's sent row: the clock counts its own campaign only.
  { row_id: "r4", batch_id: "line_someone_else", status: "sent", updated_at: "2026-09-02T12:05:50.000Z", payload: { prospectId: "p4", previewUrl: "https://p4.wss-ai.com" } },
];
const EXPECTED_DECORATION = {
  batchId: "line_timing_fixture",
  status: "sending",
  startedAt: START,
  firstQualifiedAt: "2026-09-02T12:00:42.000Z",
  firstBuiltAt: "2026-09-02T12:01:10.000Z",
  firstGateAt: "2026-09-02T12:02:00.000Z",
  firstSentAt: "2026-09-02T12:04:32.000Z",
  sentCount: 2,
  requested: 10,
};

// A gallery-data select() stub that answers every table the handler reads.
// `timing` is what the bounded campaign-clock query returns for the newest
// active batch; `timingOk:false` makes that one read fail like a store blip.
function gallerySelect({ timing = TIMING_BATCH, timingOk = true } = {}) {
  const queries = [];
  const select = async (table, query) => {
    queries.push({ table, query });
    if (table === "ghost_agency_prospects") return { ok: true, data: [] };
    if (table === "ghost_agency_dashboard_access") return { ok: true, data: [] };
    if (table === "ghost_agency_events") return { ok: true, data: [] };
    if (table === "ghost_agency_email_log") return { ok: true, data: [] };
    if (table === "ghost_agency_line_batch_rows") return { ok: true, data: TIMING_LINE_ROWS };
    if (table === "ghost_agency_line_batches") {
      // Two reads share this table: the 500-batch state annotation (three
      // scalars) and the ONE-row campaign clock (which asks for mine_funnel).
      if (/mine_funnel/.test(String(query))) {
        if (!timingOk) throw new Error("timing source down");
        return { ok: true, data: timing ? [timing] : [] };
      }
      return { ok: true, data: [{ batch_id: "line_timing_fixture", status: "sending", halt_reason: "" }] };
    }
    throw new Error(`unexpected table: ${table}`);
  };
  return { select, queries };
}

// ---------------------------------------------------------------------------
// 1. The payload decoration — present, bounded, and honest about its reads
// ---------------------------------------------------------------------------

test("gallery data decorates the snapshot with the newest active batch's stopwatch", async (t) => {
  const priorToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "clock-token";
  t.after(() => {
    if (priorToken === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorToken;
  });

  const { select, queries } = gallerySelect();
  const res = fakeJsonRes();
  await createGalleryDataHandler({ select })(request("clock-token"), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.campaignTiming, EXPECTED_DECORATION);
  assert.equal(res.body.sources.campaignTimingRead, true, "a landed read reports itself");

  // Bounded by construction: ONE active batch, four columns, nothing else.
  const timingQuery = queries.find(({ table, query }) => table === "ghost_agency_line_batches" && /mine_funnel/.test(String(query)));
  assert.ok(timingQuery, "the campaign clock read must exist");
  assert.match(timingQuery.query, /select=batch_id,status,requested,mine_funnel/);
  assert.match(timingQuery.query, /status=in\.\(building,running,awaiting_approval,approved,sending\)/);
  assert.match(timingQuery.query, /order=updated_at\.desc/);
  assert.match(timingQuery.query, /limit=1/);
});

test("a batch with no stamped stopwatch decorates nothing — the key is simply absent", async (t) => {
  const priorToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "clock-token";
  t.after(() => {
    if (priorToken === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorToken;
  });

  // An active batch whose mine_funnel predates the stopwatch, and a batch
  // that stamps nothing parseable at all — both must degrade to silence.
  for (const timing of [
    { ...TIMING_BATCH, mine_funnel: [{ stage: "1_packet_shelf_v1", entered: 12 }] },
    { ...TIMING_BATCH, mine_funnel: [{ stage: "line_campaign_timing_v1" }] },
    { ...TIMING_BATCH, mine_funnel: [{ stage: "line_campaign_timing_v1", startedAt: "not-a-date" }] },
    null,
  ]) {
    const res = fakeJsonRes();
    await createGalleryDataHandler({ select: gallerySelect({ timing }).select })(request("clock-token"), res);
    assert.equal(res.statusCode, 200);
    assert.equal("campaignTiming" in res.body, false, "no stopwatch means no key, not a null that pages must second-guess");
    assert.equal(res.body.sources.campaignTimingRead, true);
  }
});

test("a failed timing read never degrades the gallery — the clock is annotation", async (t) => {
  const priorToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "clock-token";
  t.after(() => {
    if (priorToken === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorToken;
  });

  const res = fakeJsonRes();
  await createGalleryDataHandler({ select: gallerySelect({ timingOk: false }).select })(request("clock-token"), res);
  assert.equal(res.statusCode, 200, "the catalogue stands with no clock, exactly as before this read existed");
  assert.equal("campaignTiming" in res.body, false);
  assert.equal(res.body.sources.campaignTimingRead, false, "the page is TOLD the read did not land");
});

test("campaignTimingDecoration counts only its own batch's sent rows and keeps unparsable stamps empty", () => {
  assert.equal(campaignTimingDecoration(null, TIMING_LINE_ROWS), null);
  assert.equal(campaignTimingDecoration({}, []), null);
  assert.deepEqual(campaignTimingDecoration(TIMING_BATCH, TIMING_LINE_ROWS), EXPECTED_DECORATION);
  // A stamp that cannot be parsed contributes "", never "Invalid Date".
  const partial = campaignTimingDecoration({
    batch_id: "b",
    status: "running",
    requested: "3",
    mine_funnel: [{ stage: "line_campaign_timing_v1", startedAt: START, firstSentAt: "later, maybe" }],
  }, []);
  assert.deepEqual(partial, {
    batchId: "b",
    status: "running",
    startedAt: START,
    firstQualifiedAt: "",
    firstBuiltAt: "",
    firstGateAt: "",
    firstSentAt: "",
    sentCount: 0,
    requested: 3,
  });
});

// ---------------------------------------------------------------------------
// 2. The gallery strip — ISO deltas to mm:ss, and graceful absence
// ---------------------------------------------------------------------------

test("the gallery clock turns ISO stamps into one monospace sentence", () => {
  const clockText = galleryClockText();
  assert.equal(
    clockText({
      startedAt: START,
      firstQualifiedAt: "2026-09-02T12:00:42.000Z",
      firstBuiltAt: "2026-09-02T12:01:10.000Z",
      firstSentAt: "2026-09-02T12:04:32.000Z",
      sentCount: 6,
      requested: 10,
    }),
    `Campaign clock: fire ${localFire(START)} · first lead +0:42 · first build +1:10 · first email +4:32 · sent 6/10`,
  );
});

test("the math is honest at the edges — hours roll over, pre-start stamps drop, zero goals say nothing", () => {
  const clockText = galleryClockText();
  // An hour-plus milestone reads h:mm:ss, not 61 minutes.
  assert.equal(clockText({ startedAt: START, firstSentAt: "2026-09-02T13:01:01.000Z" }).includes("first email +1:01:01"), true);
  // A stamp older than the start is corrupt, not negative — dropped.
  const early = clockText({ startedAt: START, firstBuiltAt: "2026-09-02T11:59:00.000Z", firstQualifiedAt: "2026-09-02T12:00:42.000Z" });
  assert.match(early, /first lead \+0:42/);
  assert.doesNotMatch(early, /first build/);
  // No requested goal, no "sent 0/0" noise.
  assert.doesNotMatch(clockText({ startedAt: START }), /sent/);
  // A started campaign with nothing else yet still says when it fired.
  assert.equal(clockText({ startedAt: START }), `Campaign clock: fire ${localFire(START)}`);
});

test("the gallery strip hides itself when there is nothing measured to say", () => {
  const clockText = galleryClockText();
  assert.equal(clockText(null), "");
  assert.equal(clockText(undefined), "");
  assert.equal(clockText({}), "");
  assert.equal(clockText({ startedAt: "" }), "");
  assert.equal(clockText({ startedAt: "not-a-date" }), "");

  // And the painter's contract: an empty sentence hides the element, a real
  // one fills it — the strip is display:none, not a blank rail.
  const script = inlineScripts(galleryPage).join("\n");
  assert.match(script, /function paintCampaignClock\(timing\)\{[\s\S]*?campaignClock\.hidden=!sentence;/);
  assert.match(script, /if\(sentence\)campaignClock\.textContent=sentence;/);

  // The strip exists in the served markup, starts hidden, and is monospace.
  for (const [name, html] of [["base", galleryPage], ["served", servedGalleryPage]]) {
    assert.match(html, /<p class="campaign-clock" id="campaignClock" role="status" aria-live="polite" hidden><\/p>/, `${name} markup`);
    assert.match(html, /\.campaign-clock\{[^}]*var\(--mono\)/, `${name} style`);
  }
});

test("the gallery clock rides the SAME snapshot the page already fetches — both loads and live polls", () => {
  const script = inlineScripts(galleryPage).join("\n");
  // The api() wrap is the seam: the initial load and every live-refresh poll
  // call it for /api/admin/gallery-data, and each pass repaints the clock.
  assert.match(script, /var apiForSnapshot=api;\s*api=function\(path,opts\)\{/);
  assert.match(script, /if\(path==="\/api\/admin\/gallery-data"\)\{/);
  assert.match(script, /try\{paintCampaignClock\(payload&&payload\.campaignTiming\);\}catch/);
  // A paint problem is swallowed — the clock may never fail a gallery load.
  assert.match(script, /\/\* the clock is annotation, never a failure \*\//);
});

// ---------------------------------------------------------------------------
// 3. The console strip — the same one line, under each batch's own header
// ---------------------------------------------------------------------------

test("the console renders the batch's stopwatch under its header", () => {
  const clockHtml = consoleClockHtml();
  const html = clockHtml({
    requested: 10,
    counts: { total: 8, sent: 6, queued: 2 },
    campaignTiming: {
      startedAt: START,
      firstQualifiedAt: "2026-09-02T12:00:42.000Z",
      firstBuiltAt: "2026-09-02T12:01:10.000Z",
      firstGateAt: "2026-09-02T12:02:00.000Z",
      firstSentAt: "2026-09-02T12:04:32.000Z",
    },
  });
  assert.match(html, /^<div class="bclock" role="status">/);
  assert.match(html, new RegExp(`fire ${localFire(START)}`));
  assert.match(html, /first lead \+0:42/);
  assert.match(html, /first build \+1:10/);
  assert.match(html, /first email \+4:32/);
  assert.match(html, /sent 6\/10/);
  // The gate stamp travels on the payload but the strip stays one line.
  assert.doesNotMatch(html, /gate/);
});

test("a batch without a timing record renders no clock at all", () => {
  const clockHtml = consoleClockHtml();
  assert.equal(clockHtml({}), "");
  assert.equal(clockHtml({ campaignTiming: null }), "");
  assert.equal(clockHtml({ campaignTiming: {} }), "");
  assert.equal(clockHtml({ campaignTiming: { startedAt: "not-a-date" } }), "");
  // Stamps before the start are corrupt and drop their segment, same as the
  // gallery.
  const early = clockHtml({
    counts: { sent: 1, total: 4 },
    campaignTiming: { startedAt: START, firstBuiltAt: "2026-09-02T11:59:00.000Z", firstQualifiedAt: "2026-09-02T12:00:42.000Z" },
  });
  assert.match(early, /first lead \+0:42/);
  assert.doesNotMatch(early, /first build/);
  // No requested on the payload: the batch's own total is the honest goal.
  assert.match(
    clockHtml({ counts: { sent: 2, total: 5 }, campaignTiming: { startedAt: START } }),
    /sent 2\/5/,
  );
});

test("the clock is wired into the batch card, monospace, and parsed by every existing check", () => {
  const controller = inlineScripts(consolePage)
    .filter((script) => script.includes("function stageIndex("))
    .join("\n");
  assert.ok(controller, "the launch controller script must exist");
  // One line under the head, before the approve deck — never inside it.
  assert.match(controller, /\+'<span class="bchips">'\+chips\+'<\/span><\/div>'\s*\+campaignClockHtml\(b\)\s*\+approveDeckHtml\(b\)/);
  assert.match(consolePage, /\.bclock\{[^}]*var\(--mono\)/);
  // Both surfaces compile as shipped.
  for (const [name, html] of [["gallery", galleryPage], ["console", consolePage]]) {
    inlineScripts(html).forEach((source, index) => {
      assert.doesNotThrow(() => new vm.Script(source, { filename: `campaign-clock-${name}-${index}.js` }));
    });
  }
});
