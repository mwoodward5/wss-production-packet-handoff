"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const page = require("../lib/console-page");

test("operator masthead uses the canonical WSS tile and honest readiness copy", () => {
  assert.match(page, /<header class="board-masthead">/);
  assert.match(page, /<div class="brand-cluster">[\s\S]*?<div class="t">Command Center<\/div><div class="s">WSS Labs<\/div>/);
  assert.match(page, /<rect width="64" height="64" rx="15" fill="#131318"><\/rect>/);
  assert.match(page, /<rect x="0\.5" y="0\.5" width="63" height="63" rx="14\.5" fill="none" stroke="#FFFFFF" stroke-opacity="0\.09"><\/rect>/);
  assert.match(page, /stroke="url\(#boardWssMark\)" stroke-width="5\.5"/);
  assert.match(page, /<circle cx="50" cy="20" r="7" fill="#34D399" opacity="0\.22"><\/circle>/);
  assert.match(page, /<circle cx="50" cy="20" r="4" fill="#34D399"><\/circle>/);
  assert.match(page, /id="readyPill" role="status" aria-live="polite">Checking readiness<\/span>/);
  assert.match(page, /var ready=snapshot\.ready===true&&!haltedNow;/);
  assert.match(page, /pill\.textContent=ready\?"All systems ready"/);
});

test("the five internal tabs keep their names, ids, order, and panels", () => {
  const tabs = page.match(/<nav class="tabbar" id="consoleTabs"[\s\S]*?<\/nav>/)?.[0] || "";
  const buttons = [...tabs.matchAll(/<button class="tab(?: active)?"[^>]*id="([^"]+)" data-tabid="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)]
    .map((match) => [match[1], match[2], match[3].replace(/&amp;/g, "&")]);
  // Campaign-flow pass 2026-08-16: "Line Detail" renamed "Engine room" — the
  // same words the shared operator bar already used for /line, so the deep
  // view has one name everywhere.
  assert.deepEqual(buttons, [
    ["tabBtnMap", "map", "Live Map"],
    ["tabBtnCommand", "command", "Command Center"],
    ["tabBtnAgents", "agents", "Agents & Calls"],
    ["tabBtnOperations", "operations", "Operations"],
    ["tabBtnLine", "line", "Engine room"],
  ]);
  for (const panel of ["tabPanelMap", "tabPanelCommand", "tabPanelAgents", "tabPanelOperations", "tabPanelLine"]) {
    assert.match(page, new RegExp(`id="${panel}"`));
  }
  assert.doesNotMatch(tabs, /href="\/(?:gallery|campaigns)"/);
  // The console's own private "console-links" pair was retired: Gallery and
  // Campaigns now live in the shared operator bar that every page carries
  // (lib/operator-nav.js), so the five tabs above are the console's sections
  // and nothing else. Reaching the other pages is still guaranteed here.
  assert.doesNotMatch(page, /<nav class="console-links"/);
  assert.match(page, /<nav class="wssnav"[\s\S]*?href="\/gallery"[\s\S]*?href="\/campaigns"[\s\S]*?<\/nav>/);
});

test("the Command Center tab is the workflow: glance, then the run, then the sites", () => {
  // Campaign-flow pass 2026-08-16: the assembly line's six stage cards (and
  // their one sparkline) were retired with the stage renderers. The flow
  // surfaces that replace them, in reading order: the glance deck, the
  // campaign control tower, the live plain-words feed, the sites list.
  const panel = page.slice(page.indexOf('id="tabPanelCommand"'), page.indexOf('id="tabPanelAgents"'));
  for (const id of ["glanceDeck", "launchSection", "campaignWizard", "wzRail", "pipeHero", "happeningNow", "batchPanel"]) {
    assert.match(panel, new RegExp(`id="${id}"`), `${id} must live on the Command Center tab`);
  }
  assert.doesNotMatch(page, /class="kpi-spark"/, "the stage sparkline went with the stage cards");
  for (const id of ["stageMine", "stageQualify", "stageBuild", "stageQueue", "stageApprove", "stageSend", "stageSendSpark"]) {
    assert.doesNotMatch(page, new RegExp(`id="${id}"`), `${id} is retired`);
  }
});

test("board skin is additive, responsive, and leaves safety controls intact", () => {
  const firstStyleEnd = page.indexOf("</style>");
  const boardStyle = page.indexOf('<style id="boardAlignment">');
  assert.ok(firstStyleEnd >= 0 && boardStyle > firstStyleEnd, "board overrides must follow the byte-pinned first style");
  assert.match(page, /radial-gradient\(1100px 460px at 50% -160px/);
  assert.match(page, /@media\(max-width:640px\)/);
  assert.match(page, /@media\(max-width:420px\)/);
  assert.match(page, /@media\(prefers-reduced-motion:reduce\)/);
  for (const id of ["haltBar", "haltBtn", "batchPanel", "launchOut", "readyBanner"]) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  // Arcade integration 2026-09-03: the hero's three documented visible-only
  // feeds (vapi-calls 7s, gallery-data 60s, revenue-summary 120s) join the
  // 30s console poll — pinned in console-arcade-hero.test.js.
  assert.equal((page.match(/window\.setInterval\(/g) || []).length, 4, "the console keeps one console poll plus the three arcade hero feeds");
});
