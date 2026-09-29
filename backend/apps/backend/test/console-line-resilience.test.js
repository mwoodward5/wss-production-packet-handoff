"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const page = require("../lib/console-page");
// Select the AUTHENTICATED controller by content, never by index: the page also
// ships small additive inline scripts (a shared nav poller now sits ahead of the
// controller), so a positional pick silently audits the wrong block.
const inlineScripts = () => [...page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
const script = inlineScripts().find((source) => source.includes("function api(path,opts)"));
assert.ok(script, "the console must ship its authenticated inline controller");
const css = [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join("\n");

function liftFunction(source, name) {
  const head = source.indexOf(`function ${name}(`);
  assert.notEqual(head, -1, `${name} must exist`);
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
    else if (ch === "}" && --depth === 0) return source.slice(head, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

test("Run N quotas are exact and no wave can request above its remaining goal", () => {
  const source = liftFunction(script, "allocateWaveQuotas");
  // eslint-disable-next-line no-new-func
  const allocate = new Function(`${source}; return allocateWaveQuotas;`)();
  assert.deepEqual(Array.from(allocate(10, 4, 50)), [3, 3, 2, 2]);
  assert.deepEqual(Array.from(allocate(50, 4, 50)), [13, 13, 12, 12]);
  assert.deepEqual(Array.from(allocate(100, 4, 50)), [25, 25, 25, 25]);
  assert.deepEqual(Array.from(allocate(500, 4, 50)), [50, 50, 50, 50]);
  assert.deepEqual(Array.from(allocate(100, 2, 50)), [50, 50]);

  const launch = script.slice(script.indexOf('document.querySelectorAll(".launchBtn")'), script.indexOf("function armPoll"));
  assert.match(launch, /remainingRequest=goal-requested/);
  assert.match(launch, /requested\+=quota/);
  assert.match(launch, /var quota=quotas\[index\]/);
  assert.doesNotMatch(launch, /count:perRun|goal\*10/);
});

test("each wave start gets a random PII-free key retained only for its exact request", () => {
  const source = [
    liftFunction(script, "newStartIdempotencyKey"),
    liftFunction(script, "startSignature"),
    liftFunction(script, "startKeyFor"),
    liftFunction(script, "clearStartRetryKey"),
    liftFunction(script, "startFailureRetryable"),
  ].join("\n");
  let seed = 0;
  const helpers = new Function("window", `
    var startRetryKeys=Object.create(null);
    ${source}
    return {newStartIdempotencyKey,startSignature,startKeyFor,clearStartRetryKey,startFailureRetryable};
  `)({ crypto: { getRandomValues(bytes) { seed += 1; bytes.fill(seed); return bytes; } } });

  const firstSignature = helpers.startSignature("sandbox", "roofing in Austin, TX", 13);
  const otherSignature = helpers.startSignature("sandbox", "plumbing in Tulsa, OK", 13);
  const firstKey = helpers.startKeyFor(firstSignature);
  assert.match(firstKey, /^launch-[a-f0-9]{32}$/);
  assert.equal(helpers.startKeyFor(firstSignature), firstKey, "an uncertain exact request reuses its key");
  assert.notEqual(helpers.startKeyFor(otherSignature), firstKey, "another target gets another key");
  assert.equal(firstKey.includes("Austin"), false, "the key carries no target text");

  helpers.clearStartRetryKey(firstSignature, firstKey);
  assert.notEqual(helpers.startKeyFor(firstSignature), firstKey, "a definitive response releases the key");
  assert.equal(helpers.startFailureRetryable({ status: 503, payload: { retryable: true } }), true);
  assert.equal(helpers.startFailureRetryable({ status: 400, payload: {} }), false);

  const launch = script.slice(script.indexOf('document.querySelectorAll(".launchBtn")'), script.indexOf("function armPoll"));
  assert.match(launch, /if\(launchBusy\)return/);
  assert.match(liftFunction(script, "post"), /idempotencyKey:startKeyFor\(signature\)/);
  assert.match(launch, /startFailureRetryable\(error\)/);
  assert.match(script, /function launchRequestChanged\(\)\{clearStartRetryKey\(\)/);
  assert.match(script, /laneModeBtn\.addEventListener\("click",function\(\)\{\s*clearStartRetryKey\(\)/);
});

test("campaign totals use only returned ids and count both queued and sent", () => {
  const campaignBatches = liftFunction(script, "campaignBatches");
  const retain = liftFunction(script, "retainCampaignBatch");
  const campaignHtml = liftFunction(script, "campaignHtml");
  assert.match(campaignBatches, /campaign\.batchIds\.indexOf\(b&&b\.batchId\)>=0/);
  assert.doesNotMatch(campaignBatches, /startedAt|campaign\.lane/);
  assert.match(retain, /campaign\.batchIds\.push\(id\)/);
  assert.match(campaignHtml, /Number\(c\.queued\).*Number\(c\.sent\)/s);
});

test("building is active, uses the fast GET poll, and is never POST-continued by the page", () => {
  const active = liftFunction(script, "batchRunning");
  assert.match(active, /status==="queued"/);
  assert.match(active, /status==="building"/);
  assert.match(liftFunction(script, "loadBatches"), /batchRunning\(b\)/);
  assert.doesNotMatch(script, /continueBuild|again\.action="start"/);
  assert.equal((script.match(/action:"start"/g) || []).length, 1);
});

test("the wave waits for the refreshed stop record before starting anything else", () => {
  const launch = script.slice(script.indexOf('document.querySelectorAll(".launchBtn")'), script.indexOf("function armPoll"));
  assert.match(launch, /return refreshHalt\(\)\.then\(function\(\)/);
  assert.match(launch, /if\(stoppedWhy\|\|halt\.active===true\)/);
});

test("send retries have a cap, delay, monotonic guard and visible Retry state", () => {
  const run = liftFunction(script, "runApprovedSend");
  const deck = liftFunction(script, "approveDeckHtml");
  assert.match(run, /MAX_SEND_PASSES/);
  assert.match(run, /remaining>=previousRemaining/);
  assert.match(run, /delaySend\(/);
  assert.match(run, /st\.phase=needsRetry\?"retry":"done"/);
  assert.match(deck, /Retry remaining/);
  assert.match(deck, /aria-live="polite"/);
});

test("copy states the real sandbox auto-send boundary", () => {
  assert.doesNotMatch(page, /no auto-send path exists|Sending is never automatic/i);
  assert.match(page, /Sandbox may auto-send/i);
  assert.match(page, /Live[^<.]*waits for approval/i);
});

test("modal, tabs, progress and 390px controls expose keyboard and screen-reader state", () => {
  assert.match(page, /<html lang="en">/);
  assert.match(page, /id="accessGate"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(page, /id="cockpit"[^>]*inert[^>]*aria-hidden="true"/);
  assert.match(script, /cockpit\.removeAttribute\("inert"\)/);
  assert.match(script, /gateReturnFocus/);
  assert.match(script, /ArrowLeft|ArrowRight/);
  assert.match(script, /Home|End/);
  assert.match(script, /setAttribute\("tabindex",active\?"0":"-1"\)/);
  assert.match(page, /id="batchPanel"[^>]*aria-live="polite"/);
  assert.match(script, /focusSendButton/);
  assert.match(css, /@media\(max-width:420px\)[\s\S]*min-height:44px/);
});
