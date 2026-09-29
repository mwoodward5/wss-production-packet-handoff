"use strict";

// Prove the talking-points brief against PRODUCTION rows, not fixtures.
//
// Three questions, answered with numbers rather than opinion:
//   1. WHAT DOES RILEY ACTUALLY GET? Printed in full for real businesses.
//   2. HOW OFTEN IS IT EMPTY? Coverage counted across every live row, because a
//      brief that only works on the demo record is worse than none.
//   3. WHAT DOES IT COST? Bytes added to the tool response and milliseconds
//      added to the tool call, measured — that is the whole point of the change.

require("./brightdata-edit-proof/env").loadEnv();

const { select } = require("../lib/store");
const { rileyBrief, OBJECTIONS } = require("../lib/riley-brief");

const unwrap = (r) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []);

async function allRows() {
  let rows = [];
  for (let offset = 0; offset < 6000; offset += 1000) {
    const page = unwrap(await select(
      "ghost_agency_prospects",
      `?select=*&order=created_at.desc&offset=${offset}&limit=1000`,
    ));
    rows = rows.concat(page);
    if (page.length < 1000) break;
  }
  return rows;
}

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

async function main() {
  const rows = await allRows();
  const live = rows.filter((row) => row.status !== "archived_legacy");
  console.log(`rows: ${rows.length} total, ${live.length} live\n`);

  // ---- 1. what Riley gets, for three real businesses --------------------
  const withMirror = live.filter((row) => row.preview_url);
  const noMirror = live.filter((row) => !row.preview_url);
  const show = [withMirror[0], withMirror[1], noMirror[0]].filter(Boolean);

  for (const row of show) {
    const brief = rileyBrief(row);
    console.log("=".repeat(78));
    console.log(brief.who);
    console.log("-".repeat(78));
    brief.points.forEach((point, index) => {
      console.log(` ${index + 1}. ${point.say}`);
      console.log(`    src: ${point.src}`);
    });
    if (!brief.points.length) console.log("  (no point traces to stored data — brief is empty on purpose)");
    if (brief.answers.length) {
      console.log(" IF THEY ASK WHAT IT MEANS:");
      brief.answers.forEach((answer) => console.log(`    ${answer.on}: ${answer.say.slice(0, 96)}…`));
    }
    if (brief.unknown.length) {
      console.log(" GUARDS:");
      brief.unknown.forEach((line) => console.log(`    ${line}`));
    }
    console.log(` size: ${bytes(brief)} B with objections, ${bytes(rileyBrief(row, { includeObjections: false }))} B without`);
  }

  // ---- 2. coverage over every live row ----------------------------------
  console.log(`\n${"=".repeat(78)}\nCOVERAGE ACROSS ${live.length} LIVE ROWS`);
  const tally = {
    briefs: 0,
    zeroPoints: 0,
    hasReputation: 0,
    hasMirrorPoint: 0,
    hasFault: 0,
    hasQuote: 0,
    hasPride: 0,
    gradeGuarded: 0,
    noNameGuard: 0,
  };
  const pointCounts = [];
  let totalBytes = 0;
  let leanBytes = 0;

  for (const row of live) {
    const brief = rileyBrief(row);
    tally.briefs += 1;
    pointCounts.push(brief.points.length);
    if (!brief.points.length) tally.zeroPoints += 1;
    totalBytes += bytes(brief);
    leanBytes += bytes(rileyBrief(row, { includeObjections: false }));
    for (const point of brief.points) {
      if (point.src.includes("record.rating")) tally.hasReputation += 1;
      if (point.src.includes("preview_url")) tally.hasMirrorPoint += 1;
      if (point.src.includes("website_probe")) tally.hasFault += 1;
      if (point.src.includes("content.reviews[shortest]")) tally.hasQuote += 1;
      if (point.src.includes("owner_behind")) tally.hasPride += 1;
    }
    if (brief.unknown.some((line) => line.includes("do not tell them it is bad"))) tally.gradeGuarded += 1;
    if (brief.unknown.some((line) => line.includes("no name for whoever answers"))) tally.noNameGuard += 1;
  }

  const avg = (list) => (list.reduce((sum, n) => sum + n, 0) / (list.length || 1)).toFixed(2);
  console.log(` briefs built            : ${tally.briefs}`);
  console.log(` points per brief (avg)  : ${avg(pointCounts)}  (min ${Math.min(...pointCounts)}, max ${Math.max(...pointCounts)})`);
  console.log(` briefs with NO points   : ${tally.zeroPoints}`);
  console.log(` rating + review count   : ${tally.hasReputation}`);
  console.log(` a mirror already built  : ${tally.hasMirrorPoint}`);
  console.log(` a measured site fault   : ${tally.hasFault}`);
  console.log(` a customer's own words  : ${tally.hasQuote}`);
  console.log(` owner-pride points      : ${tally.hasPride}   <- 0 until the miner stores an owner-behind extraction`);
  console.log(` "their site is fine" gd : ${tally.gradeGuarded}`);
  console.log(` "we have no name" guard : ${tally.noNameGuard}`);

  // ---- 3. what it costs -------------------------------------------------
  console.log(`\n${"=".repeat(78)}\nCOST`);
  console.log(` avg brief WITH the 11 objection lines : ${Math.round(totalBytes / live.length)} B`);
  console.log(` avg brief WITHOUT them                : ${Math.round(leanBytes / live.length)} B`);
  console.log(` the objection block alone             : ${bytes(OBJECTIONS)} B (identical on every call)`);

  const sample = live.slice(0, 200);
  const runs = 20;
  const started = process.hrtime.bigint();
  for (let i = 0; i < runs; i += 1) for (const row of sample) rileyBrief(row);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const perBrief = elapsedMs / (runs * sample.length);
  console.log(` build time per brief                  : ${perBrief.toFixed(3)} ms  (${runs * sample.length} builds in ${elapsedMs.toFixed(0)} ms)`);
  console.log(" network/database time added           : 0 ms — the row is already in hand when the tool answers.");

  // ---- 4. against the REAL baseline: the live lookup tool ----------------
  // A CPU number means nothing next to a call that spends its time on the
  // wire. So time the production endpoint as VAPI calls it, and measure the
  // brief as a fraction of what that response already weighs.
  // The public host, not GHOST_AGENCY_API_URL — that variable still points at a
  // protected rocketsites preview deployment in the breadcrumb env file, which
  // answers 401 "Protected deployment" to everything. VAPI calls the alias.
  const base = "https://ghost.wss-ai.com";
  const secret = process.env.VAPI_TOOL_SECRET || process.env.VAPI_WEBHOOK_SECRET || process.env.GHOST_AGENCY_ADMIN_TOKEN;
  const target = withMirror[0];
  if (!secret || !target) {
    console.log("\n(no tool secret or no target row — skipped the live endpoint timing)");
    return;
  }

  console.log(`\n${"=".repeat(78)}\nLIVE lookup_prospect, ${base}`);
  const timings = [];
  let payload = null;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const t0 = process.hrtime.bigint();
    const response = await fetch(`${base}/api/vapi-tools/lookup-prospect`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vapi-secret": secret },
      body: JSON.stringify({ prospect_id: target.prospect_id }),
    });
    const body = await response.text();
    timings.push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (attempt === 0) console.log(` HTTP ${response.status}  (first call includes a cold start)`);
    payload = body;
  }
  console.log(` calls in order: ${timings.map((t) => Math.round(t)).join(", ")} ms`);
  timings.shift(); // drop the cold start; VAPI's second tool call is the honest case
  timings.sort((a, b) => a - b);
  const currentBytes = Buffer.byteLength(payload || "", "utf8");
  const briefBytes = bytes(rileyBrief(target));
  const leanBriefBytes = bytes(rileyBrief(target, { includeObjections: false }));
  const median = timings[Math.floor(timings.length / 2)];
  console.log(` warm round trips sorted: ${timings.map((t) => Math.round(t)).join(", ")} ms  (median ${Math.round(median)} ms)`);
  console.log(` response today            : ${currentBytes} B`);
  console.log(` + brief (with objections) : ${briefBytes} B  -> ${currentBytes + briefBytes} B total`);
  console.log(` + brief (points only)     : ${leanBriefBytes} B  -> ${currentBytes + leanBriefBytes} B total`);
  console.log(` added compute             : ${perBrief.toFixed(3)} ms against a ${Math.round(median)} ms call = ${(100 * perBrief / median).toFixed(4)}%`);
  console.log(" Everything the brief reads is already inside the row this endpoint has fetched.");
  console.log(" There is no second query, so the only cost is the bytes above.");
}

main().catch((error) => { console.error("FAILED", error && error.message); process.exitCode = 1; });
