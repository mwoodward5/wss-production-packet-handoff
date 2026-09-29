"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const page = require("../lib/console-page");

test("approved overview renders only from the live console-data snapshot", () => {
  const renderStart = page.indexOf("function statusCount");
  const renderEnd = page.indexOf("function load()", renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart, "live render bundle must exist");
  const renderSource = page.slice(renderStart, renderEnd);

  // Campaign-flow pass 2026-08-16: the overview shrank to the workflow truth
  // (glance numbers, pickable trades, the one readiness pill). Funnel counts
  // and hard stops still arrive through snapshot.*; totals and engagement
  // ride the glance snapshot. The retired readers (providers,
  // recentProspects) moved to the Engine room tab and no longer pin this
  // bundle.
  for (const field of ["funnel", "hardStops"]) {
    assert.match(renderSource, new RegExp(`snapshot\\.${field}\\b`), `live renderer does not read snapshot.${field}`);
  }
  assert.match(renderSource, /snap\.totals\|/, "the glance deck reads the snapshot totals");
  assert.match(renderSource, /snap\.engagement\|/, "the glance deck reads the snapshot engagement");
  assert.match(renderSource, /function renderApprovedOverview\(snapshot\)/);

  const loadStart = page.indexOf("function load()");
  const loadEnd = page.indexOf('accessForm.addEventListener("submit"', loadStart);
  const loadSource = page.slice(loadStart, loadEnd);
  assert.match(loadSource, /api\("\/api\/admin\/console-data"\)\.then\(function\(snapshot\)\{/);
  assert.match(loadSource, /renderApprovedOverview\(snapshot\)/);
});

test("approved Aug-1 evidence snapshot is never shipped as current live data", () => {
  const staleLiterals = [
    "ready · blockers 0",
    "ci 609 / 609",
    "head 3d14ed6",
    ">140<",
    "run 7",
    "2.1% true yield",
    "owner approved 08-01",
    "sha 9152c161",
    "11 harvested · 8 shipped",
    "7e1ff98e",
    "Flint 0.18s",
    "Wilbourn 0.22s",
    "Aug 3 · 11pm PT",
    "609/609 GREEN",
    "good 714 call",
    "1 of 4 proven live",
    "width:55%",
  ];
  for (const literal of staleLiterals) {
    assert.ok(!page.includes(literal), `stale approved-snapshot literal survived: ${literal}`);
  }
});

test("console polls every 30 seconds only while visible", () => {
  assert.match(page, /window\.setInterval\(function\(\)\{if\(!document\.hidden&&token\(\)\)load\(\)\.catch\(function\(\)\{\}\);\},30000\)/);
  // Arcade integration 2026-09-03: the demo route (?demo=arcade) joins the
  // guard — demo mode fetches nothing, the visibility law itself is unchanged.
  assert.match(page, /document\.addEventListener\("visibilitychange",function\(\)\{if\(ARCADE_DEMO\|\|document\.hidden\|\|!token\(\)\)return;load\(\)\.catch\(function\(\)\{\}\);\}\)/);
  assert.match(page, /if\(loadInFlight\|\|document\.hidden\|\|!token\(\)\)return/);
  assert.doesNotMatch(page, /setInterval\([^\n]*,15000\)/);
});

// Campaign-flow pass 2026-08-16: the assembly line's six stage cards, the
// gates card, the last-car card and their renderers (renderStages,
// renderGates, renderLastCar, renderFunnel, renderProviders, deltaChip,
// renderSendSpark, releaseText) moved OFF the owner-facing console by the
// owner's own verdict — "there is NO WORKFLOW … I'm bombarded by the tool."
// Their machine vocabulary stays reachable in the Engine room (/line and the
// console's Engine room tab). What still renders on the front door is pinned
// here instead: the one honest readiness pill.
test("the front door carries exactly one honest readiness verdict, not a gate wall", () => {
  for (const id of ["gateReadiness", "gateReview", "gateDelivery", "gateDomain", "gateSends", "gateGenie"]) {
    assert.doesNotMatch(page, new RegExp(`id="${id}"`), "the gates card is retired from the owner face");
  }
  for (const fn of ["renderStages", "renderGates", "renderLastCar", "renderProviders", "renderFunnel"]) {
    assert.doesNotMatch(page, new RegExp(`function ${fn}\\(`), `${fn} is retired with its card`);
  }
  assert.match(page, /function renderReadiness\(snapshot\)/);
  assert.match(page, /var ready=snapshot\.ready===true&&!haltedNow;/);
  assert.match(page, /pill\.textContent=ready\?"All systems ready"/);
  assert.match(page, /id="readyPill" role="status" aria-live="polite">Checking readiness<\/span>/);
});

test("release telemetry stays off the owner face entirely", () => {
  // The ci/head pills and the MIRROR LANE footer strip printed build
  // telemetry a layman never asked for. They are gone from the console; the
  // old approved-snapshot literals stay gone with them.
  assert.doesNotMatch(page, /id="ciPill"/);
  assert.doesNotMatch(page, /id="headPill"/);
  assert.doesNotMatch(page, /MIRROR LANE/);
  assert.doesNotMatch(page, /609\s*\/\s*609|3d14ed6/);
  assert.match(page, /NOTHING SENDS WITHOUT YOUR APPROVAL/);
});
