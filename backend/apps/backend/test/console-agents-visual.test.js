"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const page = require("../lib/console-page");

test("approved command center is one screen with no agent roster", () => {
  for (const retired of [
    /Agent command bridge/i,
    /Voice provider registry/i,
    /agentVisualState/,
    /agentStatusWord/,
    /id="agentRadarBlips"/,
    /data-agent-state=/,
  ]) {
    assert.doesNotMatch(page, retired);
  }
});
// Owner instruction 2026-08-04: blend operations pages into the console. The
// broken tab prototype these guarded against (class="tabs", a bare
// data-tab= attribute, function sectionRequests() with its own polling) is
// still retired — see console-operability.test.js for that pin. The current
// tab shell uses class="tabbar"/"tabpanel" and data-tabid=, which is a
// different, working implementation and is intentionally allowed here.
test("approved command center retires the old broken tab prototype's identifiers", () => {
  for (const retired of [/class="tabs"/, /data-tab=/, /function sectionRequests\(/]) {
    assert.doesNotMatch(page, retired);
  }
});
test("approved command center removes plan-hunt and legacy mutation controls", () => {
  for (const retired of [
    /Confirm parsed lead hunt/i,
    /data-autopilot-vertical=/,
    /id="leadFilter"/,
    /id="mIndustry"/,
    /id="frLoc"/,
    /Restricted LIVE assistant changes/i,
    /assistantIdentity/,
    /id="lineConsoleLink"/,
    /id="campBtn"/,
    /id="advBtn"/,
    /function doCampaign\(/,
    /function doAdvance\(/,
  ]) {
    assert.doesNotMatch(page, retired);
  }
});
