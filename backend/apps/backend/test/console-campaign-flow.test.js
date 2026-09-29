"use strict";

/**
 * test/console-campaign-flow.test.js — THE WORKFLOW LAW.
 *
 * Owner verdict, 2026-08-16, after two translation passes: "there is NO
 * WORKFLOW. No A, B, C, 1, 2, 3 feel. I'm bombarded by the tool. Make it
 * like LeadMiner, which has a FLOW." This suite pins the redesign's four
 * promises:
 *
 *   (a) the console's front door is a numbered 1-2-3 wizard — a rail with
 *       three numbered steps, ONE step visible at a time, ending in one GO;
 *   (b) the GO button posts the EXISTING launch contract — same endpoint,
 *       same payload shape, same idempotency and wave machinery;
 *   (c) the owner-facing screens (console + campaigns) carry no machine
 *       vocabulary — no funnel internals, no candidate counts, no
 *       pickState, no CI telemetry — those live in the Engine room;
 *   (d) the style blocks carry the 18px body floor the owner can actually
 *       read.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const CONSOLE_PAGE = require("../lib/console-page");
const CAMPAIGNS_PAGE = require("../lib/campaigns-page");

function scriptOf(page) {
  return [...page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).join("\n");
}

/** What a human can READ: the markup minus scripts, styles and comments. */
function visibleMarkup(page) {
  return page
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function launchRegion(page) {
  const script = scriptOf(page);
  const start = script.indexOf('document.querySelectorAll(".launchBtn")');
  const end = script.indexOf("function armPoll", start);
  assert.ok(start >= 0 && end > start, "the launch binding region must exist");
  return script.slice(start, end);
}

// ---------------------------------------------------------------------------
// (a) THE WIZARD — 1, 2, 3, one step at a time
// ---------------------------------------------------------------------------

test("the front door renders the three numbered steps with a numbered rail", () => {
  const staticMarkup = CONSOLE_PAGE.slice(0, CONSOLE_PAGE.indexOf("<script>"));

  // The rail: an ordered list of three items, each numbered.
  const rail = staticMarkup.match(/<ol class="wz-rail" id="wzRail"[\s\S]*?<\/ol>/)?.[0] || "";
  assert.ok(rail, "the numbered rail must render");
  const railItems = [...rail.matchAll(/<li class="wz-ri" data-wstep="(\d)"[^>]*>([\s\S]*?)<\/li>/g)];
  assert.deepEqual(railItems.map((item) => Number(item[1])), [1, 2, 3], "rail items are numbered 1-2-3 in order");
  for (const item of railItems) {
    assert.match(item[2], /class="wz-dot num"[^>]*>\d</, `rail step ${item[1]} shows its number`);
  }
  assert.match(railItems[0][2], /Who are we reaching\?/);
  assert.match(railItems[1][2], /How many websites\?/);
  assert.match(railItems[2][2], /Practice or real\?/);
  assert.match(rail, /aria-current="step"/, "the rail marks the current step");

  // The steps: one section per number, exactly one visible at a time.
  const steps = [...staticMarkup.matchAll(/<section class="wz-step" id="(wzStep\d)" data-wstep="(\d)"([^>]*)>/g)];
  assert.deepEqual(steps.map((step) => [step[1], Number(step[2])]), [["wzStep1", 1], ["wzStep2", 2], ["wzStep3", 3]]);
  assert.equal(steps.filter((step) => /hidden/.test(step[3])).length, 2, "exactly one step visible at a time");

  // Step 1 carries the trade dropdown + city box (the pinned picker ids).
  const step1 = staticMarkup.slice(staticMarkup.indexOf('id="wzStep1"'), staticMarkup.indexOf('id="wzStep2"'));
  assert.match(step1, /id="mineVertical"/);
  assert.match(step1, /id="mineLocation"/);

  // Step 2 carries the four pinned Build-N buttons, unrenamed.
  const step2 = staticMarkup.slice(staticMarkup.indexOf('id="wzStep2"'), staticMarkup.indexOf('id="wzStep3"'));
  for (const label of ["Build 10", "Build 50", "Build 100", "Build 500"]) {
    assert.ok(step2.includes(">" + label + "</button>"), `step 2 carries ${label}`);
  }

  // Step 3 offers practice vs real in the owner's own promise, then THE GO.
  const step3 = staticMarkup.slice(staticMarkup.indexOf('id="wzStep3"'), staticMarkup.indexOf('id="launchOut"'));
  assert.match(step3, /Practice — emails come only to you/);
  assert.match(step3, /Real — business owners get emails after your OK/);
  assert.match(step3, /<button id="goButton" class="btn wz-go" type="button" disabled>Start my campaign<\/button>/);
});

test("the wizard advances one step at a time and only GO launches", () => {
  const script = scriptOf(CONSOLE_PAGE);
  assert.match(script, /var WIZ=\{step:1,count:0\}/);
  assert.match(script, /function wizShow\(step\)/, "one controller moves between the steps");
  assert.match(script, /panel\.hidden=i!==WIZ\.step/, "showing a step hides the other two");
  assert.match(script, /function wizSync\(\)/, "one sync point gates Next and GO on real answers");
  assert.match(script, /go\.disabled=!\(trade&&WIZ\.count\)/, "GO waits for the trade AND the count");
  // The Build N buttons CHOOSE the count; they no longer launch.
  const chooser = script.slice(
    script.indexOf('document.querySelectorAll(".launchBtn")'),
    script.indexOf("function launchCampaign"),
  );
  assert.match(chooser, /WIZ\.count=count;/, "clicking Build N records the choice");
  assert.doesNotMatch(chooser, /startCampaign\(/, "a Build N click must not start anything by itself");
});

// ---------------------------------------------------------------------------
// (b) GO posts the existing launch payload
// ---------------------------------------------------------------------------

test("GO posts the existing launch payload through the existing wave machinery", () => {
  const script = scriptOf(CONSOLE_PAGE);
  const launch = launchRegion(CONSOLE_PAGE);

  // The exact canonical start contract, byte-for-byte.
  assert.match(launch, /post\("\/api\/admin\/line",\{action:"start",count:quota,target:t,lane:campaignLane\}\)/);
  assert.match(launch, /var campaignLane=currentLane\(\)/);
  assert.match(launch, /var goal=count,found=0,requested=0,runs=0/);
  assert.match(launch, /retainCampaignBatch\(result\)/);
  assert.match(launch, /waitForWave\(waveIds\)/);
  assert.match(launch, /startCampaign\(/);
  assert.match(launch, /if\(\[10,50,100,500\]\.indexOf\(count\)<0\|\|!target\)return/);

  // The GO button is wired into that one launcher.
  assert.match(script, /function launchCampaign\(count\)/);
  assert.match(script, /goButton=document\.getElementById\("goButton"\)/);
  assert.match(script, /goButton\.addEventListener\("click",function\(\)\{launchCampaign\(WIZ\.count\);\}\)/);

  // One start per page — GO did not add a second POST path.
  assert.equal((script.match(/action:"start"/g) || []).length, 1);
});

// ---------------------------------------------------------------------------
// (c) No machine vocabulary on the owner-facing screens
// ---------------------------------------------------------------------------

test("no funnel, candidate, pickState or CI telemetry renders on the console or the campaigns page", () => {
  for (const [name, page] of [["console", CONSOLE_PAGE], ["campaigns", CAMPAIGNS_PAGE]]) {
    const visible = visibleMarkup(page);
    for (const banned of ["funnel", "candidate", "pickState", "CI —"]) {
      assert.ok(!visible.includes(banned), `${name} renders machine vocabulary a layman never asked for: "${banned}"`);
    }
  }

  // And the retired telemetry sockets are gone from the console entirely.
  for (const id of ["ciPill", "headPill", "releaseFooter"]) {
    assert.ok(!CONSOLE_PAGE.includes(`id="${id}"`), `the ${id} telemetry socket is retired`);
  }
  assert.ok(!CONSOLE_PAGE.includes("MIRROR LANE"), "the footer strip of build telemetry is retired");

  // The shared voice still translates machine statuses where the run shows
  // them — the words changed, the truth law did not.
  assert.match(CONSOLE_PAGE, /voiceChip\(b\.status\)\.label/, "campaign chips read through the shared voice table");
});

// ---------------------------------------------------------------------------
// (d) The 18px body floor
// ---------------------------------------------------------------------------

test("the style blocks carry the 18px body floor", () => {
  const consoleStyles = [...CONSOLE_PAGE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const campaignsStyles = [...CAMPAIGNS_PAGE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");

  // The console's campaign-flow sheet owns the floor for the wizard copy.
  const flowSheet = CONSOLE_PAGE.match(/<style id="campaignFlow">([\s\S]*?)<\/style>/)?.[1] || "";
  assert.ok(flowSheet, "the campaignFlow style block must exist");
  assert.match(flowSheet, /#cockpit \.fstep \.flabel,#cockpit \.fstep-hint,#cockpit \.wz-choice span,#cockpit \.wz-gohint\{font-size:18px/);
  assert.match(flowSheet, /#cockpit \.wz-rt\{font-size:18px/);

  // Both pages: at least one body-copy rule set at 18px in their own sheets.
  assert.ok((consoleStyles.match(/font-size:18px/g) || []).length >= 3, "the console carries the 18px floor");
  assert.ok((campaignsStyles.match(/font-size:18px/g) || []).length >= 3, "the campaigns page carries the 18px floor");
});

// ---------------------------------------------------------------------------
// The campaign manager reframed as the workflow home
// ---------------------------------------------------------------------------

test("the campaigns page is Your campaigns: one list, one big status line, progress, three plain actions", () => {
  const staticMarkup = CAMPAIGNS_PAGE.slice(0, CAMPAIGNS_PAGE.indexOf("<script>"));
  assert.match(staticMarkup, /<h1>Your campaigns<\/h1>/);
  assert.match(staticMarkup, /id="campaignList"/, "one vertical list for every campaign");
  assert.match(staticMarkup, /<div class="guide"[\s\S]*?Start it[\s\S]*?Watch it build[\s\S]*?Give your OK/,
    "the page answers in numbered A-B-C order");
  assert.match(CAMPAIGNS_PAGE, /function campaignCardName\(b\)/, "campaigns auto-name themselves");
  assert.match(CAMPAIGNS_PAGE, /Building "\+done\+" of "/, "the big status sentence counts the build live");
  assert.match(CAMPAIGNS_PAGE, /function progressBarFor\(b\)/, "every card carries a progress bar");
  assert.match(CAMPAIGNS_PAGE, /Email proofs to me/, "action two is the owner's own words");
  assert.match(CAMPAIGNS_PAGE, /Stop this campaign/, "action three exists");
  assert.match(CAMPAIGNS_PAGE, /See the websites/, "action one exists");
});
