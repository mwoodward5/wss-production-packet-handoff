"use strict";

/**
 * test/funnel-rejection-reasons.test.js — SHOW WHY THE LEADS DIED.
 *
 * The miner has always computed, per stage AND per reason, exactly why every
 * candidate was eliminated. Both of those measurements were then thrown away:
 *
 *   A. The console's funnel drew a bar per stage and dropped `s.rejected`
 *      entirely. A real run on 2026-08-06 rendered as an anonymous grey bar
 *      reading "email · 0" while the API response in the same request carried
 *        1_discovery  20->14  directory_or_social 4, duplicate_domain 2
 *        4_brand/logo 13-> 6  no_own_domain_logo 4, logo_not_https 1, ...
 *        5_email       6-> 0  no_email_published 4, third_party_domain 2
 *      The operator could see THAT the run died and not WHAT killed it, which
 *      is the difference between "this market has no email addresses" and
 *      "our own grader is too strict".
 *
 *   B. The mine.run event stored the funnel but not the `rejects` array, so
 *      nothing was queryable after the fact. Aggregate yield is 3.2% (4,684
 *      Firecrawl results -> 150 build-ready) and nobody can attribute it;
 *      stage 8 refuses ~32% of leads that EACH already cost a paid Google
 *      Places call, and the reject DETAIL naming what the dry-run build
 *      objected to was exactly the field that was dropped.
 *
 * Both are now rendered and persisted. The persisted form is GROUPED and
 * BOUNDED — a 500-lead run eliminates thousands of candidates, and an
 * unbounded blob in the event store is how a diagnostic becomes an outage.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { summarizeRejects } = require("../lib/lead-miner");

// ---------------------------------------------------------------------------
// PART B — THE EVIDENCE OUTLIVES THE RESPONSE
// ---------------------------------------------------------------------------

test("summarizeRejects groups by stage AND reason with exact counts, biggest killer first", () => {
  const out = summarizeRejects([
    { stage: "4_brand_logo_and_accent", candidate: "a.example", reason: "no_own_domain_logo_candidate" },
    { stage: "4_brand_logo_and_accent", candidate: "b.example", reason: "no_own_domain_logo_candidate" },
    { stage: "4_brand_logo_and_accent", candidate: "c.example", reason: "logo_not_https" },
    { stage: "5_email", candidate: "d.example", reason: "no_email_published" },
    { stage: "4_brand_logo_and_accent", candidate: "e.example", reason: "no_own_domain_logo_candidate" },
  ]);

  assert.equal(out.total, 5);
  assert.equal(out.groupsTruncated, 0);
  assert.deepEqual(
    out.groups.map((g) => [g.stage, g.reason, g.count]),
    [
      ["4_brand_logo_and_accent", "no_own_domain_logo_candidate", 3],
      ["4_brand_logo_and_accent", "logo_not_https", 1],
      ["5_email", "no_email_published", 1],
    ],
    "the biggest killer must sort first so it survives the group cap",
  );
  // The same reason at two different stages is two different findings.
  const split = summarizeRejects([
    { stage: "2_homepage_fetch", reason: "http_403", candidate: "x" },
    { stage: "4_brand_logo_and_accent", reason: "http_403", candidate: "y" },
  ]);
  assert.equal(split.groups.length, 2);
});

test("the reject DETAIL survives — it is the whole answer to 'what did the build object to?'", () => {
  const out = summarizeRejects([
    {
      stage: "8_dry_run_build_proof",
      candidate: "ramonroofing.example",
      reason: "dry_run_invalid_request",
      detail: "photos[2].url must be https, got http://ramonroofing.example/img/crew.jpg",
    },
    { stage: "6_nap_verification", candidate: "liberty.example", reason: "out_of_metro_state", detail: "queried Jackson MS -> resolved Jackson MI" },
  ]);
  const dry = out.groups.find((g) => g.reason === "dry_run_invalid_request");
  assert.equal(dry.examples[0].candidate, "ramonroofing.example");
  assert.match(dry.examples[0].detail, /must be https/);
  const fence = out.groups.find((g) => g.reason === "out_of_metro_state");
  assert.match(fence.examples[0].detail, /queried Jackson MS -> resolved Jackson MI/);
});

test("the payload is BOUNDED: a 500-lead run cannot write an unbounded blob into the event store", () => {
  const rejects = [];
  for (let i = 0; i < 6000; i++) {
    rejects.push({
      stage: `stage_${i % 9}`,
      reason: `reason_${i % 120}`,
      candidate: `candidate-${i}.example.com/`.repeat(20),
      detail: `x`.repeat(4000),
    });
  }
  const out = summarizeRejects(rejects);

  // Counts stay EXACT even though the examples are sampled.
  assert.equal(out.total, 6000);
  assert.ok(out.groups.length <= 40, `groups capped, got ${out.groups.length}`);
  assert.ok(out.groupsTruncated > 0, "the operator is told that groups were dropped");
  for (const group of out.groups) {
    assert.ok(group.examples.length <= 3, "at most three examples per group");
    for (const example of group.examples) {
      assert.ok(example.detail.length <= 160, "detail is truncated");
      assert.ok(example.candidate.length <= 120, "candidate is truncated");
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(out));
  assert.ok(bytes < 40000, `serialized reject summary must stay small, got ${bytes} bytes`);
});

test("an example carrying neither a candidate nor a detail is not stored — the count already says it", () => {
  const out = summarizeRejects([{ stage: "1_discovery_firecrawl", reason: "directory_or_social" }]);
  assert.equal(out.groups[0].count, 1);
  assert.deepEqual(out.groups[0].examples, []);
});

test("a missing or malformed rejects array degrades to an empty summary rather than throwing", () => {
  for (const input of [undefined, null, [], "nope", [null, undefined]]) {
    const out = summarizeRejects(input);
    assert.ok(Array.isArray(out.groups));
    assert.equal(out.groups.length, 0);
  }
});

// The event itself. Driven through the real mineLeads entry point on the one
// path that spends nothing: a metro given without a state is refused at stage 0
// before a single Firecrawl or Places call, and that refusal is a reject with a
// detail. Before this change the mine.run payload carried the funnel and no
// rejects at all.
test("mine.run PERSISTS the rejects, with their details, not just the stage counts", async () => {
  const storePath = require.resolve("../lib/store");
  const minerPath = require.resolve("../lib/lead-miner");
  const originalStore = require.cache[storePath];
  const originalMiner = require.cache[minerPath];
  const previousKey = process.env.GOOGLE_PLACES_API_KEY;
  const events = [];
  try {
    process.env.GOOGLE_PLACES_API_KEY = "test-key-not-used-on-this-path";
    require.cache[storePath] = {
      id: storePath,
      filename: storePath,
      loaded: true,
      exports: {
        recordEvent: async (type, payload) => { events.push({ type, payload }); return { mode: "live_write" }; },
        select: async () => ({ ok: true, data: [] }),
        selectRows: async () => ({ mode: "not_requested", rows: [] }),
        upsertRow: async () => ({ ok: true }),
      },
    };
    delete require.cache[minerPath];
    const miner = require(minerPath);
    const out = await miner.mineLeads({
      industry: "plumbing",
      location: "Jackson",           // no state — refused before anything is paid for
      limit: 5,
      persist: false,
      env: { GOOGLE_PLACES_API_KEY: "k", FIRECRAWL_API_KEY: "k" },
      fetchImpl: async () => { throw new Error("no network call may happen on this path"); },
    });
    assert.equal(out.ok, false);
    assert.equal(out.mode, "metro_state_unstated");

    const run = events.filter((e) => e.type === "mine.run").pop();
    assert.ok(run, "the refused run must still be recorded");
    assert.ok(run.payload.funnel, "the funnel was already persisted and still is");
    assert.ok(run.payload.rejects, "THE REGRESSION: rejects were computed and then dropped on the floor");
    assert.equal(run.payload.rejects.total, 1);
    const group = run.payload.rejects.groups[0];
    assert.equal(group.stage, "0_vertical_donor_gate");
    assert.equal(group.reason, "metro_state_unstated");
    assert.equal(group.count, 1);
    // The detail is the operator's actual fix: the string they typed.
    assert.equal(group.examples[0].detail, "Jackson");
  } finally {
    process.env.GOOGLE_PLACES_API_KEY = previousKey;
    if (previousKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    delete require.cache[minerPath];
    if (originalMiner) require.cache[minerPath] = originalMiner;
    if (originalStore) require.cache[storePath] = originalStore;
    else delete require.cache[storePath];
  }
});

// ---------------------------------------------------------------------------
// PART A — THE OPERATOR CAN SEE IT
// ---------------------------------------------------------------------------
//
// Both console pages ship as one JavaScript string, so their renderers are
// lifted out of the page source and RUN here against a real funnel shape. A
// class name appearing in the markup is not proof that the renderer emits it.

/** Lift `function <name>(...) {...}` out of a page source, quote-aware. */
function liftFunction(source, name) {
  const head = source.indexOf(`function ${name}(`);
  assert.notEqual(head, -1, `${name} must exist in the page source`);
  const open = source.indexOf("{", head);
  let depth = 0;
  let quote = "";
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(head, i + 1);
    }
  }
  throw new Error(`unbalanced braces lifting ${name}`);
}

const ESC = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The real shape from the 2026-08-06 run quoted at the top of this file.
const REAL_RUN = [
  { stage: "1_discovery_firecrawl", entered: 20, survived: 14, rejected: { directory_or_social: 4, duplicate_domain: 2 } },
  { stage: "2_homepage_fetch", entered: 14, survived: 13, rejected: { http_403: 1 } },
  { stage: "3_website_axis_ceiling", entered: 13, survived: 13, rejected: {} },
  {
    stage: "4_brand_logo_and_accent",
    entered: 13,
    survived: 6,
    rejected: { no_own_domain_logo: 4, logo_not_https: 1, accent_unmeasurable: 1, logo_not_header_grade: 1 },
  },
  { stage: "5_email", entered: 6, survived: 0, rejected: { no_email_published: 4, third_party_domain: 2 } },
];

test("the Command Center funnel names every killer with its count, biggest first", () => {
  const page = require("../lib/console-page");
  const src = `${liftFunction(page, "killChips")}\n${liftFunction(page, "funnelHtml")}\nreturn funnelHtml;`;
  const funnelHtml = new Function("esc", src)(ESC);

  const html = funnelHtml({ mineFunnel: REAL_RUN });

  // Every reason the run measured is on screen, with its exact count.
  for (const [reason, count] of [
    ["directory or social", 4], ["duplicate domain", 2], ["http 403", 1],
    ["no own domain logo", 4], ["logo not https", 1], ["accent unmeasurable", 1],
    ["logo not header grade", 1], ["no email published", 4], ["third party domain", 2],
  ]) {
    assert.ok(
      html.includes(`<i class="kchip" title="${reason}">${reason}<b>${count}</b></i>`),
      `"${reason} ${count}" must be rendered — it is what the run measured`,
    );
  }
  // Biggest killer first inside a stage: 4 before 1 at stage 4.
  assert.ok(
    html.indexOf("no own domain logo") < html.indexOf("accent unmeasurable"),
    "the reason that killed the most must be read first",
  );
  // A stage that killed nobody stays quiet — no empty chip rail.
  const axis = html.slice(html.indexOf("website axis ceiling"), html.indexOf("brand logo and accent"));
  assert.ok(!axis.includes("kchip"), "a stage with no rejections must not draw a rail");
  // The bars are untouched: this adds to the funnel, it does not redesign it.
  assert.ok(html.includes('<span class="mbar">'));
  assert.ok(html.includes('<span class="mnum num">0</span>'), "stage 5 still reports 0 survivors");
});

// A real batch in the store ("plumbing in Columbus, OH") carries a 78-character
// reason key with the offending URL inside it. Rendered whole on a 390px
// viewport it pushed the document to 519px and put the entire console into
// horizontal scroll. The COUNT is never truncated — that is the number the
// operator is reading — and the full reason stays on hover.
const LONG_REASON = "logo_fetch_failed:brand_asset_fetch_404_from_https://www.parson-plumbing.com/qux/logo.png";

test("a reason key long enough to break the layout is truncated, never its count", () => {
  const page = require("../lib/console-page");
  const funnelHtml = new Function("esc", `${liftFunction(page, "killChips")}\n${liftFunction(page, "funnelHtml")}\nreturn funnelHtml;`)(ESC);
  const html = funnelHtml({
    mineFunnel: [{ stage: "4_brand_logo_and_accent", entered: 20, survived: 3, rejected: { [LONG_REASON]: 17 } }],
  });
  // Slice FROM the chip: the bar above it also closes an <i>.
  const chipAt = html.indexOf('<i class="kchip"');
  const chip = html.slice(chipAt, html.indexOf("</i>", chipAt) + 4);
  const visible = chip.slice(chip.indexOf(">") + 1, chip.indexOf("<b>"));
  assert.ok(visible.length <= 46, `visible label must be capped, got ${visible.length}: ${visible}`);
  assert.ok(chip.includes("<b>17</b>"), "the count survives truncation intact");
  assert.ok(chip.includes(`title="${LONG_REASON.replace(/_/g, " ")}"`), "the full reason must stay reachable on hover");

  const line = require("../lib/line-console-page");
  const host = { innerHTML: "" };
  const renderFunnel = new Function("esc", "el", `${liftFunction(line, "renderFunnel")}\nreturn renderFunnel;`)(ESC, () => host);
  renderFunnel({ mineFunnel: [{ stage: "4_brand_logo_and_accent", entered: 20, survived: 3, rejected: { [LONG_REASON]: 17 } }] });
  const lineAt = host.innerHTML.indexOf('<span class="kchip"');
  const lineChip = host.innerHTML.slice(lineAt, host.innerHTML.indexOf("</span>", lineAt) + 7);
  const lineVisible = lineChip.slice(lineChip.indexOf(">") + 1, lineChip.indexOf("<b>"));
  assert.ok(lineVisible.length <= 46, `visible label must be capped, got ${lineVisible.length}`);
  assert.ok(lineChip.includes("<b>17</b>"));
});

test("the Command Center still renders nothing when there is no funnel at all", () => {
  const page = require("../lib/console-page");
  const src = `${liftFunction(page, "killChips")}\n${liftFunction(page, "funnelHtml")}\nreturn funnelHtml;`;
  const funnelHtml = new Function("esc", src)(ESC);
  assert.equal(funnelHtml({}), "");
  assert.equal(funnelHtml({ mineFunnel: [] }), "");
  assert.equal(funnelHtml({ mineFunnel: [{ stage: "0_x", entered: 0, survived: 0, rejected: {} }] }), "");
});

test("the operator line console shows the mine funnel and its reasons — it dropped both", () => {
  const page = require("../lib/line-console-page");
  const src = `${liftFunction(page, "renderFunnel")}\nreturn renderFunnel;`;
  const renderFunnel = new Function("esc", "el", src)(ESC, () => host);
  const host = { innerHTML: "" };

  renderFunnel({ mineFunnel: REAL_RUN });
  for (const [reason, count] of [["no own domain logo", 4], ["no email published", 4], ["http 403", 1]]) {
    assert.ok(
      host.innerHTML.includes(`<span class="kchip" title="${reason}">${reason}<b>${count}</b></span>`),
      `"${reason} ${count}" must reach the operator control surface`,
    );
  }
  assert.ok(host.innerHTML.includes("Mine funnel"));

  // No batch, or a batch that mined nothing, clears the block rather than
  // leaving a stale funnel from the previous run on screen.
  renderFunnel(null);
  assert.equal(host.innerHTML, "");
  renderFunnel({ mineFunnel: REAL_RUN });
  assert.ok(host.innerHTML.length > 0);
  renderFunnel({ mineFunnel: null });
  assert.equal(host.innerHTML, "");
});

test("both pages carry the styles the reason chips need, and paint them", () => {
  const command = require("../lib/console-page");
  const line = require("../lib/line-console-page");
  for (const [name, page] of [["console-page", command], ["line-console-page", line]]) {
    assert.match(page, /\.kchip\{/, `${name} must style the reason chip`);
    assert.match(page, /\.mkill\{/, `${name} must style the reason rail`);
  }
  // The line console has to actually call it on every repaint.
  assert.match(line, /function paint\(\)\{\s*renderStages\(state\.batch\);\s*renderFunnel\(state\.batch\);/);
});

// Guard against the file being moved out from under the lift helper above.
test("the page sources this test lifts from are where it thinks they are", () => {
  assert.equal(path.basename(require.resolve("../lib/console-page")), "console-page.js");
  assert.equal(path.basename(require.resolve("../lib/line-console-page")), "line-console-page.js");
});
