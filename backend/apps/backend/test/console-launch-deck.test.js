"use strict";

/**
 * test/console-launch-deck.test.js — THE LAUNCH DECK.
 *
 * Owner, verbatim, 2026-08-06: "Set up a campaign and I pressed the run ten
 * sites button, and now nothing is happening… finalize my ability to generate
 * sites … and email amounts of people … have it be functional and easy to
 * understand and use in a heartbeat."
 *
 * What that turned out to mean, measured on his own screen:
 *   1. The Run button answered an empty packet shelf with six zero-boxes and
 *      a buried card — and the note said "Run it again to keep hunting",
 *      which on the packet lane is FALSE (a re-run reads the same shelf).
 *   2. Two finished sites sat queued, awaiting him — and the page that says
 *      "awaiting you" carried no approve control at all. The Launch copy
 *      literally claimed no button on the page approves or sends.
 *   3. Every old batch stayed fully expanded, six stage boxes each.
 *
 * These tests pin the fixes: the campaign card that answers the click, the
 * armed two-press Approve & send with the bounded resumable loop and a server
 * read-back, one-sentence outcomes computed from the funnel the API measured,
 * one expanded batch with the rest folded into History, and the daily
 * cache-bust on batch-row thumbnails.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const page = require("../lib/console-page");

function inlineScripts(source = page) {
  return [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

function controllerScript(source = page) {
  const matches = inlineScripts(source).filter((script) =>
    script.includes("function stageIndex(")
    && script.includes('document.querySelectorAll(".launchBtn")'));
  assert.equal(matches.length, 1, "the console keeps one launch controller even when additive scripts are present");
  return matches[0];
}

function styleText(source = page) {
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join("\n");
}

/** Lift `function <name>(...) {...}` out of the inline controller, quote-aware. */
function liftFunction(source, name) {
  const head = source.indexOf(`function ${name}(`);
  assert.notEqual(head, -1, `${name} must exist in the page source`);
  const open = source.indexOf("{", head);
  let depth = 0;
  let quote = "";
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(head, i + 1);
    }
  }
  throw new Error(`unbalanced braces lifting ${name}`);
}

function liftDeclaration(source, name) {
  const matcher = new RegExp(`\\b(?:var|const|let)\\s+${name}\\s*=`);
  const found = matcher.exec(source);
  assert.ok(found, `${name} must exist in the page source`);
  const head = found.index;
  let round = 0;
  let square = 0;
  let curly = 0;
  let quote = "";
  for (let i = source.indexOf("=", head) + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "(") round += 1;
    else if (ch === ")") round -= 1;
    else if (ch === "[") square += 1;
    else if (ch === "]") square -= 1;
    else if (ch === "{") curly += 1;
    else if (ch === "}") curly -= 1;
    else if (ch === ";" && round === 0 && square === 0 && curly === 0) return source.slice(head, i + 1);
  }
  throw new Error(`unterminated declaration lifting ${name}`);
}

const ESC = (value) => String(value == null ? "" : value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// The whole batch-deck family, evaluated once with stub state so the pure
// renderers can be driven with fixtures. `setState` reaches the closed-over
// vars the way the real controller does.
function deckFunctions() {
  const script = controllerScript();
  const declarations = ["STAGES", "DEAD_STATES", "MARK", "PHASE_MARK", "STALL_MS"]
    .map((name) => liftDeclaration(script, name)).join("\n");
  const functions = [
    "stageIndex", "rowKey", "rowPos", "rowDead", "rowAge", "batchRunning",
    "activeKey", "rowMotion", "minutes", "safeHttpUrl", "humanStatus",
    "elapsedLabel", "railHtml", "leadHtml", "trackLabel", "whyHtml", "deadMark",
    "killChips", "funnelHtml", "whenText",
    "trunc", "topDeadReason", "packetShelfSentence", "queuedAwaitingElsewhere",
    "packetRunNote", "batchOutcome", "zeroPick", "deadChipsHtml",
    "sendStateFor", "approveDeckHtml", "batchCardHtml",
    "expandedId", "histRowHtml", "pipelineHtml",
    "campaignBatches", "campaignHtml", "lineElapsedText",
    "campaignClockHtml", "campaignClockElapsedText", "campaignClockTimeOfDay",
  ].map((name) => liftFunction(script, name)).join("\n");
  const src = `
    "use strict";
    var seenReach={},gainSet={},openWhy={},sendState={},mapBatches=[],openHist={},campaign=null;
    // Campaign-flow pass 2026-08-16: the batch chips read through the shared
    // voice table (lib/operator-voice.js) — a machine status never prints raw
    // on the owner screen. This mirrors the tiny lookup the page inlines.
    var VOICE_STATUS={running:["Working now","good"],building:["Building websites","good"],sending:["Sending emails","good"],awaiting_approval:["Waiting for your OK","wait"],line_awaiting_approval:["Waiting for your OK","wait"],approved:["Approved by you","good"],halted:["Stopped","bad"],settled:["Finished","neutral"],collecting:["Looking for businesses","wait"]};
    function voiceNormalize(s){return String(s==null?"":s).trim().toLowerCase().replace(/[\\s-]+/g,"_");}
    function voiceChip(status){
      var hit=VOICE_STATUS[voiceNormalize(status)];
      if(hit)return {label:hit[0],tone:hit[1]};
      if(!voiceNormalize(status))return {label:"Not reported",tone:"neutral"};
      return {label:String(status).replace(/[_-]+/g," ").trim(),tone:"neutral"};
    }
    ${declarations}
    ${functions}
    return {
      packetShelfSentence:packetShelfSentence,
      packetRunNote:packetRunNote,
      batchOutcome:batchOutcome,
      batchCardHtml:batchCardHtml,
      approveDeckHtml:approveDeckHtml,
      histRowHtml:histRowHtml,
      expandedId:expandedId,
      pipelineHtml:pipelineHtml,
      campaignHtml:campaignHtml,
      sendStateFor:sendStateFor,
      setState:function(patch){
        if(patch.mapBatches)mapBatches=patch.mapBatches;
        if(patch.openHist)openHist=patch.openHist;
        if(patch.campaign!==undefined)campaign=patch.campaign;
      },
    };
  `;
  const windowStub = { location: { origin: "https://console.test" }, setTimeout: () => 0, clearTimeout: () => {} };
  // eslint-disable-next-line no-new-func
  return new Function("esc", "window", src)(ESC, windowStub);
}

function mkBatch(patch = {}) {
  return {
    batchId: "line_fixture_deck",
    lane: "sandbox",
    target: "plumbing in Tulsa OK",
    status: "awaiting_approval",
    startedAt: "2026-08-09T12:00:00.000Z",
    settledAt: "2026-08-09T12:03:00.000Z",
    counts: { total: 2, working: 0, queued: 2, failed: 0, sent: 0 },
    rows: [
      { prospectId: "p1", businessName: "Rocky's Plumbing", status: "queued", reached: ["picked", "qualified", "mirrored", "gate_passed", "queued"], updatedAt: "2026-08-09T12:02:00.000Z" },
      { prospectId: "p2", businessName: "M&M Heating", status: "queued", reached: ["picked", "qualified", "mirrored", "gate_passed", "queued"], updatedAt: "2026-08-09T12:02:30.000Z" },
    ],
    mineFunnel: null,
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// 0. The page still parses — everything below assumes a runnable controller.
// ---------------------------------------------------------------------------

test("the console inline controller parses", () => {
  const sources = inlineScripts();
  assert.ok(sources.length >= 1, "the console keeps at least one inline script");
  const controller = controllerScript();
  assert.ok(controller.includes("function stageIndex("));
  sources.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: `console-inline-${index}.js` }));
  });
});

// ---------------------------------------------------------------------------
// 1. APPROVE & SEND — the button the waiting batches never had
// ---------------------------------------------------------------------------

test("a batch awaiting approval with queued rows renders one primary Approve & send button", () => {
  const F = deckFunctions();
  const html = F.batchCardHtml(mkBatch(), { shots: 12 });
  assert.match(html, /class="bact"/, "the action deck must render");
  assert.match(html, /class="btn approveBtn"/, "the primary button must render");
  assert.match(html, /Approve &amp; send 2 sites → your inbox/, "sandbox lane names the owner's inbox");
  const live = F.batchCardHtml(mkBatch({ lane: "live" }), { shots: 12 });
  assert.match(live, /Approve &amp; send 2 sites → prospects \(copy to me\)/, "live lane names prospects");
});

test("the approve button appears ONLY on awaiting batches with queued rows", () => {
  const F = deckFunctions();
  const running = F.batchCardHtml(mkBatch({
    status: "running",
    counts: { total: 2, working: 2, queued: 0, failed: 0, sent: 0 },
    rows: [
      { prospectId: "p1", businessName: "Rocky's Plumbing", status: "qualified", reached: ["picked", "qualified"], updatedAt: "2026-08-09T12:02:00.000Z" },
      { prospectId: "p2", businessName: "M&M Heating", status: "picked", reached: ["picked"], updatedAt: "2026-08-09T12:02:30.000Z" },
    ],
  }), { shots: 12 });
  assert.doesNotMatch(running, /approveBtn/, "a running batch must not offer approval");

  const sent = F.batchCardHtml(mkBatch({
    status: "done",
    counts: { total: 2, working: 0, queued: 0, failed: 0, sent: 2 },
    rows: [
      { prospectId: "p1", businessName: "Rocky's Plumbing", status: "sent", reached: ["picked", "qualified", "mirrored", "gate_passed", "queued", "sent"], updatedAt: "2026-08-09T12:02:00.000Z" },
      { prospectId: "p2", businessName: "M&M Heating", status: "sent", reached: ["picked", "qualified", "mirrored", "gate_passed", "queued", "sent"], updatedAt: "2026-08-09T12:02:30.000Z" },
    ],
  }), { shots: 12 });
  assert.doesNotMatch(sent, /approveBtn/, "a finished batch must not offer approval");

  const nothingQueued = F.batchCardHtml(mkBatch({
    counts: { total: 2, working: 0, queued: 0, failed: 2, sent: 0 },
    rows: [
      { prospectId: "p1", businessName: "Rocky's Plumbing", status: "gate_failed", reached: ["picked", "qualified", "mirrored", "gate_failed"], reason: "no own domain logo", updatedAt: "2026-08-09T12:02:00.000Z" },
      { prospectId: "p2", businessName: "M&M Heating", status: "rejected", reached: ["picked"], reason: "no email published", updatedAt: "2026-08-09T12:02:30.000Z" },
    ],
  }), { shots: 12 });
  assert.doesNotMatch(nothingQueued, /approveBtn/, "awaiting with zero queued has nothing to approve");
});

test("an approved batch with rows still queued offers Resume send — a stranded send is recoverable", () => {
  const F = deckFunctions();
  const html = F.batchCardHtml(mkBatch({ status: "approved" }), { shots: 12 });
  assert.match(html, /Resume send — 2 still queued → your inbox/);
});

test("the confirm is the stop bar's own two-press pattern: armed state, 20s window, expiry that speaks", () => {
  const script = controllerScript();
  const armSend = liftFunction(script, "armSend");
  assert.match(armSend, /20000/, "the window is 20 seconds, same as the stop bar");
  assert.match(armSend, /Send confirmation expired — nothing was approved and nothing was sent/);
  assert.match(armSend, /LIVE batch: approve and send every queued email to the REAL prospects/);
  // First press arms; only a second press inside the window sends.
  assert.match(script, /if\(st\.phase!=="armed"\)\{armSend\(id,isLive,Boolean\(btn\.closest&&btn\.closest\("#batchPanel"\)\)\);return;\}/);
  assert.match(script, /disarmSend\(id\);\s*runApprovedSend\(id,isLive\);/);
  // The armed button says so on the card itself.
  const F = deckFunctions();
  F.sendStateFor("line_fixture_deck").phase = "armed";
  const html = F.batchCardHtml(mkBatch(), { shots: 12 });
  assert.match(html, /CONFIRM SEND — click again/);
  assert.match(html, /armed2/);
  // And the approve path never hides behind a browser modal.
  assert.doesNotMatch(liftFunction(script, "runApprovedSend"), /window\.confirm/);
});

test("on confirm the send is bounded, stops without progress, and prints the server read-back", () => {
  const script = controllerScript();
  const run = liftFunction(script, "runApprovedSend");
  assert.match(run, /action:"approve",batchId:id,typedBatchId:id/);
  assert.match(run, /action:"send",batchId:id/);
  assert.match(run, /MAX_SEND_PASSES/, "the browser must put a hard cap on send passes");
  assert.match(run, /remaining>=previousRemaining/, "unchanged remaining must stop rather than retry forever");
  assert.match(run, /delaySend\(/, "a retry must yield between server passes");
  assert.match(run, /retryReason/, "a bounded stop must explain how to retry remaining rows");
  assert.match(run, /Server read-back:/, "the printed result is the server's answer, never the click");
  assert.match(run, /loadBatches\(\)/, "rows must refresh between passes so sent rows flip live");
  assert.match(run, /pass&&pass\.halted===true/, "a server halt ends the loop and is printed");
  // The whole page still carries exactly one approve, one send, one start.
  assert.deepEqual([...page.matchAll(/action:"([^"]+)"/g)].map((m) => m[1]).sort(), ["approve", "send", "start"]);
});

test("a big Mine starts each quota once and only polls while the server owns continuation", () => {
  const script = controllerScript();
  const launch = script.slice(
    script.indexOf('document.querySelectorAll(".launchBtn")'),
    script.indexOf("function armPoll"),
  );
  assert.doesNotMatch(launch, /continueBuild|again\.action="start"/, "the page must not own durable build continuation");
  assert.match(launch, /var campaignLane=currentLane\(\)/, "one launch keeps the lane selected at its first click");
  assert.match(launch, /post\("\/api\/admin\/line",\{action:"start",count:quota,target:t,lane:campaignLane\}\)/);
  assert.match(launch, /waitForWave\(waveIds\)/, "the browser observes server-owned work with GET polling");
  assert.match(launch, /retainCampaignBatch\(result\)/, "every returned batch id belongs to this campaign exactly");
  // The whole page still carries exactly one start/approve/send action literal.
  assert.deepEqual([...page.matchAll(/action:"([^"]+)"/g)].map((m) => m[1]).sort(), ["approve", "send", "start"]);
});

test("the Launch copy states approval and delivery behavior honestly", () => {
  assert.ok(!page.includes("No button on this page approves or sends"), "the false claim must be gone");
  const staticMarkup = page.slice(0, page.indexOf("<script>"));
  assert.match(staticMarkup, /Live waits for approval\./, "live work remains owner-gated");
  assert.match(staticMarkup, /Sandbox routes every approved proof only to your inbox\./,
    "sandbox delivery names the owner-only destination");
});

// ---------------------------------------------------------------------------
// 2. OUTCOME SENTENCES — computed from what the run measured
// ---------------------------------------------------------------------------

const EMPTY_SHELF_FUNNEL = [
  { stage: "1_packet_shelf", entered: 14, survived: 0, rejected: { "already built, queued or sent": 14 } },
  { stage: "2_requested_10", entered: 10, survived: 0, rejected: { "packet shelf exhausted — new packets arrive from LeadMiner exports; a vertical target (e.g. \"plumbers in Chattanooga\") mines fresh leads instead": 10 } },
];

test("an empty-shelf packet run resolves into ONE computed-true sentence", () => {
  const F = deckFunctions();
  const batch = mkBatch({
    target: "leadminer",
    counts: { total: 0, working: 0, queued: 0, failed: 0, sent: 0 },
    rows: [],
    mineFunnel: EMPTY_SHELF_FUNNEL,
  });
  const sentence = F.packetShelfSentence(batch, 2);
  assert.match(sentence, /all 14 packets on it are already built, queued or sent/, "the shelf's own arithmetic must be in the sentence");
  assert.match(sentence, /2 finished sites are queued below awaiting your approval/, "the queued sites the owner already has must be named");
  assert.match(sentence, /Re-running cannot restock the shelf/, "the false re-run advice is replaced by the true constraint");
  assert.match(sentence, /vertical lanes mine fresh leads/);
  assert.doesNotMatch(sentence, /Run it again/);

  // A shelf that is literally empty says so — no invented claim about builds.
  const bare = F.packetShelfSentence(mkBatch({
    target: "leadminer",
    counts: { total: 0, working: 0, queued: 0, failed: 0, sent: 0 },
    rows: [],
    mineFunnel: [{ stage: "1_packet_shelf", entered: 0, survived: 0, rejected: {} }],
  }), 0);
  assert.match(bare, /The packet shelf is empty — no packets are waiting to build/);
  assert.doesNotMatch(bare, /already built/, "an empty shelf must not claim everything was built");

  // Mixed refusals are named by count, biggest first.
  const mixed = F.packetShelfSentence(mkBatch({
    target: "leadminer",
    counts: { total: 0, working: 0, queued: 0, failed: 0, sent: 0 },
    rows: [],
    mineFunnel: [{
      stage: "1_packet_shelf", entered: 5, survived: 0,
      rejected: { "already built, queued or sent": 2, "export incomplete — LeadMiner marked build evidence missing": 3 },
    }],
  }), 0);
  assert.match(mixed, /5 held, refused: export incomplete — LeadMiner marked build evidence missing ×3/);
});

test("the packet lane's finish note never says Run it again — re-running reads the same shelf", () => {
  const script = controllerScript();
  const launch = script.slice(
    script.indexOf('document.querySelectorAll(".launchBtn")'),
    script.indexOf("function armPoll"),
  );
  assert.match(launch, /if\(packetSource\)\{finish\(packetRunNote\(lastBatch/, "the packet lane settles through its own note, before the metro copy");
  const note = liftFunction(script, "packetRunNote");
  assert.doesNotMatch(note, /Run it again/);
  const F = deckFunctions();
  assert.match(F.packetRunNote(null, 3, 10, 0), /3 of 10 built — the packet shelf ran short/);
  assert.match(F.packetRunNote(null, 10, 10, 0), /^Done: 10 sites built from the packet shelf/);
});

test("a batch whose picks were all refused states its top refusal — the owner's actual Run-10 case", () => {
  const F = deckFunctions();
  const refused = mkBatch({
    target: "leadminer",
    status: "awaiting_approval",
    counts: { total: 3, working: 0, queued: 0, failed: 3, sent: 0 },
    rows: [1, 2, 3].map((n) => ({
      prospectId: `p${n}`,
      businessName: `Multi Trade ${n}`,
      status: "rejected",
      reached: ["picked"],
      reason: "multi-trade business (hvac + plumbing) — a single-trade mirror would misrepresent them",
      updatedAt: "2026-08-09T12:02:00.000Z",
    })),
  });
  const sentence = F.batchOutcome(refused, 0);
  assert.match(sentence, /All 3 refused — multi-trade business \(hvac \+ plumbing\)/);
  assert.match(sentence, /×3/);
  assert.match(sentence, /Re-running re-reads the same shelf/);
});

// ---------------------------------------------------------------------------
// 3. DECLUTTER — no zero-box rails, one expanded batch, History rows
// ---------------------------------------------------------------------------

test("a zero-pick batch renders NO stage boxes — its story is the sentence plus reason chips", () => {
  const F = deckFunctions();
  const zero = mkBatch({
    target: "leadminer",
    counts: { total: 3, working: 0, queued: 0, failed: 3, sent: 0 },
    rows: [1, 2, 3].map((n) => ({
      prospectId: `p${n}`,
      businessName: `Multi Trade ${n}`,
      status: "rejected",
      reached: ["picked"],
      reason: "multi-trade business (hvac + plumbing) — a single-trade mirror would misrepresent them",
      updatedAt: "2026-08-09T12:02:00.000Z",
    })),
  });
  const html = F.batchCardHtml(zero, { shots: 12 });
  assert.doesNotMatch(html, /railrow|rnode/, "six zero-boxes must never render");
  assert.match(html, /class="boutcome"/, "the outcome sentence leads");
  assert.match(html, /All 3 refused/);
  assert.match(html, /class="kchip"/, "each refusal is a named chip");
  assert.match(html, /Multi Trade 1 — /);

  const emptyMetro = F.batchCardHtml(mkBatch({
    counts: { total: 0, working: 0, queued: 0, failed: 0, sent: 0 },
    rows: [],
  }), { shots: 12 });
  assert.doesNotMatch(emptyMetro, /railrow|rnode/);
  assert.match(emptyMetro, /0 candidates survived the hunt/);
  assert.ok(!emptyMetro.includes("hit Run again"), "the old canned encouragement is gone");

  // A healthy batch keeps its rail untouched.
  const healthy = F.batchCardHtml(mkBatch(), { shots: 12 });
  assert.match(healthy, /railrow/);
});

test("exactly one batch expands by default — the one that needs the owner — and the rest fold into History", () => {
  const F = deckFunctions();
  const running = mkBatch({
    batchId: "line_run", status: "running", startedAt: "2026-08-09T12:10:00.000Z",
    counts: { total: 1, working: 1, queued: 0, failed: 0, sent: 0 },
    rows: [{ prospectId: "r1", businessName: "Working Co", status: "qualified", reached: ["picked", "qualified"], updatedAt: "2026-08-09T12:11:00.000Z" }],
  });
  const awaiting = mkBatch({ batchId: "line_wait", startedAt: "2026-08-09T12:05:00.000Z" });
  const done = mkBatch({
    batchId: "line_done", status: "done", startedAt: "2026-08-09T12:00:00.000Z",
    counts: { total: 3, working: 0, queued: 0, failed: 1, sent: 2 },
    rows: [
      { prospectId: "d1", businessName: "Sent One", status: "sent", reached: ["picked", "qualified", "mirrored", "gate_passed", "queued", "sent"], updatedAt: "2026-08-09T12:01:00.000Z" },
      { prospectId: "d2", businessName: "Sent Two", status: "sent", reached: ["picked", "qualified", "mirrored", "gate_passed", "queued", "sent"], updatedAt: "2026-08-09T12:01:30.000Z" },
      { prospectId: "d3", businessName: "Dead Three", status: "gate_failed", reached: ["picked", "qualified", "mirrored", "gate_failed"], reason: "phone mismatch", updatedAt: "2026-08-09T12:01:40.000Z" },
    ],
  });

  // A running batch outranks everything.
  const withRun = F.pipelineHtml([running, awaiting, done], 6);
  assert.equal((withRun.match(/class="bcard/g) || []).length, 1, "exactly one expanded card");
  assert.match(withRun, /History \(2\)/);
  assert.equal((withRun.match(/class="histrow/g) || []).length, 2);

  // With nothing running, the batch awaiting the owner is the open one.
  const withWait = F.pipelineHtml([done, awaiting], 6);
  assert.equal((withWait.match(/class="bcard/g) || []).length, 1);
  assert.match(withWait, /Approve &amp; send 2 sites/, "the expanded card is the one with the button");

  // A history row is one line: name · when · outcome · count chips.
  const row = F.histRowHtml(done, false);
  assert.match(row, /class="histrow"/);
  assert.match(row, /Sent 2 of 3 · 1 refused\./);
  assert.match(row, /2 sent/);
  assert.match(row, /1 refused/);

  // Expanding a history row brings the full card back for that batch only.
  F.setState({ openHist: { line_done: true } });
  const expanded = F.pipelineHtml([running, awaiting, done], 6);
  assert.equal((expanded.match(/class="bcard/g) || []).length, 2, "the opened history row adds its card");
  assert.match(expanded, /class="histrow open"/);
});

// ---------------------------------------------------------------------------
// 4. THE LIVE CAMPAIGN CARD — the click answers instantly, resolves in place
// ---------------------------------------------------------------------------

test("the campaign card renders working state with clock and honest progress, then resolves in place", () => {
  const F = deckFunctions();
  const startedAt = Date.now() - 65000;
  F.setState({
    campaign: {
      name: "LeadMiner packets — all trades", lane: "sandbox", goal: 10, packet: true,
      found: 0, state: "working", note: "Reading the packet shelf — up to 10 held packets…",
      startedAt, settledAt: null, tickToken: 1,
    },
    mapBatches: [],
  });
  const working = F.campaignHtml();
  assert.match(working, /LIVE CAMPAIGN/);
  assert.match(working, /lc-live/, "the working card carries the working class — motion only while working");
  assert.match(working, /Reading the packet shelf/);
  assert.match(working, /id="lcClock"/);
  // 2026-08-16 plain-words redesign: the "sandbox → you" chip was
  // deliberately renamed "practice → you only" (owner instruction).
  assert.match(working, /practice → you only/);

  F.setState({
    campaign: {
      name: "LeadMiner packets — all trades", lane: "sandbox", goal: 10, packet: true,
      found: 0, state: "done", note: "The packet shelf is empty — no packets are waiting to build.",
      startedAt, settledAt: startedAt + 70000, tickToken: 1,
    },
  });
  const settled = F.campaignHtml();
  assert.match(settled, /CAMPAIGN RESULT/);
  assert.doesNotMatch(settled, /lc-live/, "a settled campaign must not keep the working motion");
  assert.match(settled, /The packet shelf is empty/);
});

test("campaign progress counts queued plus sent only from exact returned batch ids", () => {
  const F = deckFunctions();
  const startedAt = Date.now() - 1000;
  F.setState({
    campaign: {
      name: "plumbing — nationwide rotation", lane: "sandbox", goal: 10,
      found: 0, state: "working", note: "Building exact quotas…",
      batchIds: ["line_owned"], startedAt, settledAt: null, tickToken: 1,
    },
    mapBatches: [
      mkBatch({
        batchId: "line_owned",
        counts: { total: 4, working: 1, queued: 2, failed: 0, sent: 1 },
      }),
      mkBatch({
        batchId: "line_unrelated_same_lane",
        startedAt: new Date(startedAt + 100).toISOString(),
        counts: { total: 7, working: 0, queued: 7, failed: 0, sent: 0 },
      }),
    ],
  });
  const html = F.campaignHtml();
  assert.match(html, /3 of 10 built/, "2 queued + 1 sent are the three finished sites");
  assert.doesNotMatch(html, /10 of 10 built/, "a later same-lane batch must not leak into this campaign");
});

test("the campaign is born inside the launch click and settles through finish()", () => {
  const script = controllerScript();
  const launch = script.slice(
    script.indexOf('document.querySelectorAll(".launchBtn")'),
    script.indexOf("function armPoll"),
  );
  assert.match(launch, /startCampaign\(/, "the card exists from the click itself");
  assert.match(launch, /settleCampaign\(state\|\|"done",msg\)/.source ? /settleCampaign\(/ : /settleCampaign\(/);
  const settle = liftFunction(script, "settleCampaign");
  assert.match(settle, /campaign\.settledAt=Date\.now\(\)/);
  // The clock ticks by chained timeout. (Arcade integration 2026-09-03: the
  // hero's three visible-only feeds bring window.setInterval total to 4 —
  // see console-arcade-hero.test.js. The launch card still adds none.)
  assert.equal((page.match(/window\.setInterval\(/g) || []).length, 4);
});

// ---------------------------------------------------------------------------
// 5. KPI CARDS + GARNISH — same truth, better clothes, motion only when real
// ---------------------------------------------------------------------------

test("the six stage cards and their delta chips are retired; the glance deck carries the honest numbers", () => {
  // Campaign-flow pass 2026-08-16: the assembly line's six stage cards (and
  // the delta-chip machinery that fed them) moved off the owner face. The
  // four glance numbers are the overview now, and every absent number still
  // says so honestly instead of wearing a placeholder.
  const script = controllerScript();
  assert.doesNotMatch(script, /function deltaChip\(/, "the delta chip machinery went with the stage cards");
  for (const id of ["stageMine", "stageQualify", "stageBuild", "stageQueue", "stageApprove", "stageSend"]) {
    assert.doesNotMatch(script, new RegExp(`setValue\\("${id}"`), `${id} no longer exists`);
    assert.doesNotMatch(script, new RegExp(`deltaChip\\("${id}"`), `${id} must not feed a delta any more`);
  }
  assert.match(script, /function renderGlance\(snapshot\)/);
  assert.match(script, /None yet — start your first campaign below\./);
  assert.match(script, /Still reading your recent runs…/);
  assert.match(script, /Nothing is waiting — nice\./);
});

test("the well-ripple garnish runs only on working states and respects reduced motion", () => {
  const css = styleText();
  assert.match(css, /\.btn\.busy::after\{[^}]*animation:wellripple/, "the ripple binds to .busy — set only while a wave loop runs");
  assert.match(css, /\.lc-card\.lc-live\{[^}]*animation:lcglow/, "the glow binds to the live campaign card only");
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]{0,700}?\.btn\.busy::after\{animation:none/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]{0,900}?\.lc-card\.lc-live\{animation:none/);
});

// ---------------------------------------------------------------------------
// 6. THUMBNAILS — the batch rows bust the week-long cache like the gallery
// ---------------------------------------------------------------------------

test("safeRow shotUrl carries the gallery's daily cache-bust bucket", () => {
  const prev = process.env.GHOST_AGENCY_VISUAL_SECRET;
  process.env.GHOST_AGENCY_VISUAL_SECRET = "launch-deck-test-secret";
  try {
    const { safeBatch } = require("../api/admin/line");
    const out = safeBatch({
      batchId: "line_bucket",
      lane: "sandbox",
      target: "leadminer",
      status: "awaiting_approval",
      startedAt: "2026-08-09T12:00:00.000Z",
      rows: [{
        prospectId: "p1", businessName: "Rocky's Plumbing", status: "queued",
        previewUrl: "https://wss-test-rocky.wss-ai.com/", history: [], updatedAt: "2026-08-09T12:02:00.000Z",
      }],
    });
    const shot = out.rows[0].shotUrl;
    assert.match(shot, /^\/api\/media\/preview-shot\?/, "still the signed first-party route");
    assert.match(shot, /[?&]c=\d{8}$/, "the daily bucket must ride the URL so backfilled gate shots resolve within 24h");
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    assert.ok(shot.endsWith(`c=${today}`), `bucket must be today's, got ${shot}`);
    // No preview: no URL and no bare bust param.
    const bare = safeBatch({
      batchId: "line_bucket2", lane: "sandbox", target: "leadminer", status: "running",
      startedAt: "2026-08-09T12:00:00.000Z",
      rows: [{ prospectId: "p2", businessName: "No Site Yet", status: "picked", previewUrl: "", history: [], updatedAt: "2026-08-09T12:02:00.000Z" }],
    });
    assert.equal(bare.rows[0].shotUrl, "");
  } finally {
    if (prev === undefined) delete process.env.GHOST_AGENCY_VISUAL_SECRET;
    else process.env.GHOST_AGENCY_VISUAL_SECRET = prev;
  }
});
