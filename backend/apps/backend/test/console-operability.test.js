"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const page = require("../lib/console-page");

// Owner instruction 2026-08-04: blend operations pages into the console. The
// old guard here forbade ANY tab shell, dating from when a broken tab
// prototype shipped dead per-section polling. The console now carries a real
// tab bar (Command Center / Operations / Line Detail); the two new tabs are
// same-origin iframes lazy-loaded on first activation, sharing the single
// 30s console-data poll below rather than adding section-specific polling of
// their own. This test now pins THAT shape instead of banning tabs outright.
test("blended tabs load lazily and add no section-specific polling of their own", () => {
  assert.match(page, /class="tabbar"/);
  assert.match(page, /class="tabpanel/);
  assert.match(page, /data-tabid="command"/);
  assert.match(page, /data-tabid="operations"/);
  assert.match(page, /data-tabid="line"/);
  // Still retired: the old broken tab prototype's identifiers and its
  // per-section polling function never come back.
  assert.doesNotMatch(page, /class="tabs"/);
  assert.doesNotMatch(page, /activeTab\b/);
  assert.doesNotMatch(page, /function sectionRequests\(/);
  // The new tabs must not introduce a second poll loop. (Arcade integration
  // 2026-09-03: the hero adds three documented visible-only feeds — vapi-calls
  // 7s, gallery-data 60s, revenue-summary 120s — pinned in
  // console-arcade-hero.test.js. Lazy tabs still add none.)
  assert.equal((page.match(/window\.setInterval\(/g) || []).length, 4);
});

test("approved command center exposes exactly 10 / 50 / 100 / 500 capped queue campaigns", () => {
  // Buttons only: the shared operator nav's enterprise CSS also mentions
  // data-n selectors, and counting raw data-n matches broke the pin the day
  // that layer landed. The four BUTTONS are the contract.
  const counts = [...page.matchAll(/<button\b[^>]*data-n="(\d+)"[^>]*>/g)].map((match) => Number(match[1]));
  assert.deepEqual(counts, [10, 50, 100, 500]);
  // Buttons render disabled until a mine target (vertical + location) is set.
  // 2026-08-16 plain-words redesign: "Run N sites" deliberately renamed
  // "Build N" (owner instruction — the reader is a layman, not a developer).
  assert.match(page, /data-n="10" disabled>Build 10<\/button>/);
  assert.match(page, /data-n="100" disabled>Build 100<\/button>/);
  assert.match(page, /data-n="500" disabled>Build 500<\/button>/);
  // The selected lane is frozen at the campaign's first click. Each bounded
  // quota goes through the canonical queue endpoint, and only returned batch
  // ids are retained for server-owned continuation.
  assert.match(page, /var campaignLane=currentLane\(\)/);
  assert.match(page, /post\("\/api\/admin\/line",\{action:"start",count:quota,target:t,lane:campaignLane\}\)/);
  assert.match(page, /retainCampaignBatch\(result\)/);
  assert.match(page, /waitForWave\(waveIds\)/);
  assert.doesNotMatch(page, /continueBuild|again\.action="start"/);
  assert.match(page, /id="laneMode"[^>]*data-lane="sandbox"/);
  assert.deepEqual([...page.matchAll(/action:"([^"]+)"/g)].map((match) => match[1]).sort(), ["approve", "send", "start"]);
});

test("approve & send stay sandbox-only and behind an explicit confirm", () => {
  // Owner instruction 2026-08-04: one-click approve&send per batch. The live
  // lane must remain unreachable from this page, the approval must carry the
  // typed batch id contract, and a confirm() gate precedes any send.
  // "live" is now a mode the operator can select, but it may never be a
  // hardcoded lane on an outbound start call, and the live send must sit behind
  // a confirm that names who actually receives the mail.
  assert.doesNotMatch(page, /lane:"live"/);
  assert.match(page, /LIVE batch: approve and send every queued email to the REAL prospects/);
  assert.match(page, /typedBatchId:id/);
  assert.match(page, /window\.confirm\(/);
});

test("admin token is sent only in x-admin-token and never read from the URL", () => {
  const authHeaders = [...page.matchAll(/opts\.headers\["([^"]+)"\]/g)].map((match) => match[1]);
  assert.deepEqual(authHeaders, ["x-admin-token"]);
  assert.match(page, /opts\.headers\["x-admin-token"\]=token\(\)/);
  // Arcade integration 2026-09-03: the ONE sanctioned URL read is the
  // ?demo=arcade display flag — never a credential. Strip that single line
  // and the law stands unchanged.
  assert.equal((page.match(/location\.(?:hash|search)/g) || []).length, 1, "only the demo flag reader touches location");
  assert.match(page, /ARCADE_DEMO=[^\n]*demo=arcade/);
  const withoutDemoFlag = page.replace(/var ARCADE_DEMO=[^\n]*\n/, "");
  assert.doesNotMatch(withoutDemoFlag, /location\.(?:hash|search)/);
  assert.doesNotMatch(withoutDemoFlag, /URLSearchParams/);
  assert.doesNotMatch(page, /[?#&]t=/);
  assert.doesNotMatch(page, /[?&](?:token|admin_token)=/i);
  assert.doesNotMatch(page, /headers\["authorization"\]/i);
});

test("approved command center polls every 30 seconds only while visible", () => {
  assert.match(page, /window\.setInterval\(function\(\)\{if\(!document\.hidden&&token\(\)\)load\(\)\.catch\(function\(\)\{\}\);\},30000\)/);
  // Arcade integration 2026-09-03: the demo route joins the guard (demo mode
  // fetches nothing); the visibility law itself is unchanged.
  assert.match(page, /document\.addEventListener\("visibilitychange",function\(\)\{if\(ARCADE_DEMO\|\|document\.hidden\|\|!token\(\)\)return;load\(\)\.catch\(function\(\)\{\}\);\}\)/);
});
