"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const page = require("../lib/line-console-page");
const consolePage = require("../lib/console-page");

test("every control the operator line renders is wired to a real endpoint", () => {
  // The defect this guards: the previous console shipped five handlers whose
  // markup had been deleted, and one panel (owner proof) whose trigger button
  // had been deleted while its output frame stayed. A control that renders and
  // cannot run is worse than no control, because the operator believes it ran.
  const ids = new Set([...page.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
  const read = new Set([...page.matchAll(/el\("([A-Za-z0-9_-]+)"\)/g)].map((m) => m[1]));
  const orphans = [...read].filter((id) => !ids.has(id));
  assert.deepEqual(orphans, [], `the page reads element ids that no markup renders: ${orphans.join(", ")}`);

  // Every <button> must either carry a launch attribute or have a handler.
  const buttons = [...page.matchAll(/<button[^>]*id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
  for (const id of buttons) {
    const wired = new RegExp(`el\\("${id}"\\)\\.onclick`).test(page) || /data-launch/.test(page);
    assert.ok(wired, `button #${id} renders but nothing binds it`);
  }
});

test("the three launch buttons are 50 / 100 / 500 and each starts the line", () => {
  assert.match(page, /data-launch="50"[^>]*id="mine50">Mine 50</);
  assert.match(page, /data-launch="100"[^>]*id="mine100">Mine 100</);
  assert.match(page, /data-launch="500"[^>]*id="mine500">Mine 500</);
  assert.match(page, /post\(\{action:"start",count:count,target:[^}]*lane:lane\}\)/);
});

test("the browser launches once and only polls server-owned build continuation", () => {
  const script = page.slice(page.indexOf("<scr" + "ipt>"));
  const starts = [...script.matchAll(/action:"start"/g)];
  assert.equal(starts.length, 1, "the browser must not re-POST action:start to continue a batch");
  assert.doesNotMatch(script, /post\(\{action:"start",batchId:/);
  assert.match(page, /var BUILD_LIVE=\{queued:true,building:true,running:true\}/);
  assert.match(page, /var watchId=\(state\.batch&&state\.batch\.batchId\)\|\|state\.activeBatchId/);
  assert.match(page, /api\("\/api\/admin\/line"\+q\)/);
  assert.match(page, /The server owns continuation; this page will poll its status/);
});

test("the send button cannot be armed by the page itself", () => {
  // The single Approve & send button's state is derived FROM the server's batch
  // status (settled/approved + queued), never from a local flag the page could
  // flip on its own. settled/approved both read batch.status.
  assert.match(page, /var settled=!!batch&&\(batch\.status==="awaiting_approval"\|\|approved\)/);
  assert.match(page, /sendBtn\.disabled=sending/);
  // The whole approve/send card is hidden unless a real send is possible, so an
  // empty or gate-blocked batch never renders a live send control.
  assert.match(page, /var show=settled&&queued>0/);
  assert.match(page, /card\.style\.display=show\?"":"none"/);
  // One deliberate action approves (echoing the batch's own id, which the
  // operator just confirmed by name) and then sends.
  assert.match(page, /post\(\{action:"approve",batchId:b\.batchId,typedBatchId:b\.batchId\}\)/);
});

test("approved sends resume safely, report exact counters, and stop without progress", () => {
  assert.match(page, /var alreadyApproved=b\.status==="approved"/);
  assert.match(page, /var approval=alreadyApproved[\s\S]*Promise\.resolve\(\{ok:true,batch:b,resumed:true\}\)[\s\S]*post\(\{action:"approve"/);
  assert.match(page, /var SEND_PASS_DELAY_MS=1200/);
  assert.match(page, /var MAX_SEND_PASSES=20/);
  assert.match(page, /if\(remaining>=run\.previousRemaining\)/);
  assert.match(page, /delay\(SEND_PASS_DELAY_MS\)\.then\(sendPass\)/);
  assert.match(page, /Attempted: .*Sent: .*Failed: .*Remaining:/);
  assert.match(page, /Retry remaining /);
  assert.match(page, /No automatic retry was made\. Use the explicit Retry button\./);
});

test("there is no auto-send anywhere on the page", () => {
  const script = page.slice(page.indexOf("<scr" + "ipt>"));
  // the only place action:"send" appears is inside the sendBtn click handler
  const sendOccurrences = [...script.matchAll(/action:"send"/g)];
  assert.equal(sendOccurrences.length, 1, "action:'send' appears more than once");
  const handlerStart = script.indexOf('el("sendBtn").onclick');
  const handlerEnd = script.indexOf('el("gateGo").onclick');
  assert.ok(
    sendOccurrences[0].index > handlerStart && sendOccurrences[0].index < handlerEnd,
    "a send is issued from outside the explicit send button handler",
  );
  // and no timer may fire it
  assert.doesNotMatch(script, /setInterval\([^)]*send/i);
  assert.doesNotMatch(script, /setTimeout\([^)]*action:"send"/i);
});

test("the page polls only while visible", () => {
  // A background console polling forever is what exhausted the project's disk
  // I/O budget on 2026-07-29 and 503'd this very dashboard.
  assert.match(page, /if\(!document\.hidden\)refresh\(\)/);
});

test("per-row PASS/FAIL renders the fact name and its reason", () => {
  assert.match(page, /esc\(f\.fact\)/);
  assert.match(page, /f\.pass\?"PASS":"FAIL"/);
  assert.match(page, /esc\(f\.reason\)/);
  assert.match(page, /mirrorHint\(r\)/);
});

test("halted batches expose zero actionable work and queued rows as delivery-blocked", () => {
  assert.match(page, /b\.status==="halted"\?"HALTED":b\.status/);
  assert.match(page, /0 actionable · automatic recovery disabled/);
  assert.match(page, /esc\(b\.haltReason\|\|"halt reason unavailable"\)/);
  assert.doesNotMatch(page, /disabled · "\+\(b\.haltReason/);
  assert.match(page, /BUILD PASS · DELIVERY BLOCKED/);
  assert.match(page, /Build passed\. Delivery is blocked because this run is HALTED\./);
  assert.match(page, /var show=settled&&queued>0/);
});

test("a row with no render facts shows a status-aware dispatch hint, never the old generic string", () => {
  // The old fallback ("the render gate has not run on this row yet") hid the
  // real phase for every row that had no render facts — including rows that
  // failed before a Mirror dispatch was ever staged. It must be gone.
  assert.doesNotMatch(page, /the render gate has not run on this row yet/);
  assert.match(page, /Mirror dispatch never started; the row failed before the build phase\./);
  assert.match(page, /Mirror dispatch has not started yet; the row is waiting to enter the build phase\./);
  assert.match(page, /Mirror build was not requested:/);
  assert.match(page, /Hero work blocked: no durable job identity/);
});

test("row detail drawer exposes raw debug fields from the same row snapshot", () => {
  assert.match(page, /id="rowDetail"/);
  assert.match(page, /id="rowDetailGrid"/);
  assert.match(page, /id="rowDetailRaw"/);
  assert.match(page, /data-detail=/);
  assert.match(page, /Row detail/);
  assert.match(page, /Failure reason/);
  assert.match(page, /Mirror dispatch/);
  assert.match(page, /Deploy\/report URL/);
  assert.match(page, /Send job ID/);
  assert.match(page, /gateResult/);
  assert.match(page, /openRowDetail\(/);
  assert.match(page, /closeRowDetail\(/);
});

test("390px layout and operator controls remain usable", () => {
  assert.match(page, /@media\(max-width:420px\)/);
  assert.match(page, /\.rows,\.rows tbody,\.rows tr,\.rows td\{display:block;width:100%\}/);
  assert.match(page, /data-label="Business"/);
  assert.match(page, /data-label="Actions"/);
  assert.match(page, /\.btn\{min-height:44px/);
  assert.match(page, /input,select\{min-height:44px/);
  assert.match(page, /\.halt-btn\{min-height:44px/);
});

test("dynamic status, Facts disclosure, and token dialog are accessible", () => {
  assert.match(page, /id="launchOut" role="status" aria-live="polite"/);
  assert.match(page, /id="sendOut" role="status" aria-live="polite"/);
  assert.match(page, /id="authGate" role="dialog" aria-modal="true"/);
  assert.match(page, /aria-expanded="'\+\(open\?"true":"false"\)\+'"/);
  assert.match(page, /aria-controls="facts-'\+i\+'"/);
  assert.match(page, /b\.setAttribute\("aria-expanded",open\?"true":"false"\)/);
  assert.match(page, /setTimeout\(function\(\)\{el\("tok"\)\.focus\(\);\},0\)/);
  assert.match(page, /state\.gateReturnFocus/);
  assert.match(page, /restore\.focus\(\)/);
});

test("the progress strip counts stages reached, not current status", () => {
  assert.match(page, /var reached=\(r\.reached\|\|\[\]\)\.slice\(\)/);
});

test("the endpoint exposes reached[] so the strip has something truthful to count", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "api", "admin", "line.js"), "utf8");
  assert.match(source, /reached: \(row\.history \|\| \[\]\)\.map/);
});

test("the approved admin console has no legacy operator-line controls", () => {
  assert.doesNotMatch(consolePage, /id="lineConsoleLink"/);
  assert.doesNotMatch(consolePage, /function doCampaign\(/);
  assert.doesNotMatch(consolePage, /function doAdvance\(/);
  assert.doesNotMatch(consolePage, /getElementById\("campBtn"\)/);
  assert.doesNotMatch(consolePage, /getElementById\("advBtn"\)/);
  assert.doesNotMatch(consolePage, /id="approveBtn"/);
  assert.doesNotMatch(consolePage, /id="sendBtn"/);
});

test("Vercel serves the operator line at /line", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.ok(
    config.rewrites.some((r) => r.source === "/line" && r.destination === "/api/admin/line-console"),
    "expected /line to rewrite to /api/admin/line-console",
  );
});

test("the console page ships no secrets", () => {
  assert.doesNotMatch(page, /sk_live|sk_test|SUPABASE_SERVICE_ROLE_KEY|re_[A-Za-z0-9]{20}/);
});
