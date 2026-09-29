"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { operatorNav: renderOperatorNav } = require("../lib/operator-nav");

const BACKEND = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.resolve(BACKEND, relative), "utf8");

const enterprise = read("lib/operator-enterprise-ux.js");
const operatorNav = read("lib/operator-nav.js");
const workspace = read("lib/operator-workspace-page.js");
const galleryPage = read("lib/gallery-page.js");
const galleryData = read("api/admin/gallery-data.js");
const galleryManage = read("api/admin/gallery-manage.js");
// The meter lives in the status core; the route is its transport shell
// (see api/vapi-tools/riley.js).
const rileyStatus = read("lib/edit-status-core.js");
const dashboard = read("../labs-site/dashboard/index.html");
const connect = read("../connect/index.html");

test("new-build controls stay bounded from ultrawide desktop through mobile", () => {
  assert.match(workspace, /\.form-grid\{display:grid;grid-template-columns:1fr 1fr/);
  assert.match(workspace, /\.field\.full\{grid-column:1\/-1\}/);
  assert.match(workspace, /\.counts\{display:flex;gap:7px;flex-wrap:wrap\}/);
  assert.match(workspace, /@media\(max-width:900px\)/);
  assert.match(workspace, /\.form-grid\{grid-template-columns:1fr\}/);
  assert.match(workspace, /\.launch-summary\{align-items:stretch;flex-direction:column\}/);
});

test("Command Center exposes a high-signal live production board", () => {
  for (const phrase of [
    "Prospect packets",
    "Qualified",
    "Websites built",
    "Live inspection",
    "Factory telemetry",
    "What the factory is doing now",
    "throughputPerMinute",
    "etaMinutes",
    "mirrorWorkers",
    "verificationBrowsers",
  ]) assert.match(workspace, new RegExp(phrase, "i"), phrase);
  assert.match(workspace, /\.milestones\{display:grid;grid-template-columns:repeat\(5/);
  assert.match(workspace, /\.overall-track\.indeterminate/);
  assert.match(workspace, /@keyframes liveSweep/);
  assert.match(workspace, /@keyframes orbit/);
  assert.match(workspace, /prefers-reduced-motion:reduce/);
  assert.match(workspace, /setInterval\(function\(\)\{if\(!document\.hidden\)load\(true\);\},5000\)/);
});

test("operator tables and cards cannot force the whole desktop into a narrow mobile column", () => {
  assert.match(enterprise, /\.grid\{grid-template-columns:repeat\(12,minmax\(0,1fr\)\)!important\}/);
  assert.match(enterprise, /\.grid>\*,\.launch>\*,\.controls>\*,\.gallery>\*/);
  assert.match(enterprise, /overflow-x:auto;overscroll-behavior-x:contain/);
  assert.match(enterprise, /@media\(max-width:900px\)\{[\s\S]*?table\{display:block;overflow-x:auto;white-space:nowrap\}/);
  assert.doesNotMatch(enterprise, /@media\(min-width:901px\)[\s\S]*?\.grid\{grid-template-columns:1fr/);
});

test("the shared operator typography floor is readable without shrinking data to fit", () => {
  assert.match(enterprise, /--wss-copy:clamp\(15\.5px,[^)]+17px\)/);
  assert.match(enterprise, /--wss-control:clamp\(15px,[^)]+16\.5px\)/);
  assert.match(enterprise, /--wss-label:clamp\(13\.5px,[^)]+15px\)/);
  assert.match(enterprise, /--wss-name:clamp\(18px,[^)]+22px\)/);
  assert.match(operatorNav, /OPERATOR_ENTERPRISE_STYLE/);
  assert.match(operatorNav, /OPERATOR_ENTERPRISE_SCRIPT/);
});

test("every operator surface inherits one live suite chrome and readable detail", () => {
  const rendered = renderOperatorNav("line");
  assert.match(rendered, /id="wss-operator-suite-chrome"/);
  assert.match(rendered, /id="wssnavLive"/);
  assert.match(rendered, /\/api\/admin\/line/);
  assert.match(rendered, /html\[data-wss-page="line"\] \.card/);
  assert.match(rendered, /html\[data-wss-page="line"\] \.stage\{min-height:74px!important/);
  assert.match(rendered, /html\[data-wss-page="gallery"\] \.controls\{top:66px!important/);
  assert.match(rendered, /html\[data-wss-page="replies"\] \.pause-rail\{top:66px!important/);
  assert.match(rendered, /html\[data-wss-page="ledger"\] \.kpi:hover/);
  assert.match(rendered, /href="\/campaigns">Outreach<\/a>/);
});

test("gallery management controller is scoped to the gallery and never leaks into other nav renders", () => {
  const consoleNav = renderOperatorNav("console");
  const galleryNav = renderOperatorNav("gallery");
  assert.doesNotMatch(consoleNav, /id="wss-gallery-enterprise-ux"/);
  assert.doesNotMatch(consoleNav, /\/api\/admin\/gallery-manage/);
  assert.match(galleryNav, /id="wss-gallery-enterprise-ux"/);
  assert.match(galleryNav, /\/api\/admin\/gallery-manage/);
});

test("gallery exposes readable per-site and batch workflows in plain language", () => {
  for (const id of ["searchInput", "sortSelect", "batchSelectAll", "batchSend", "showArchived"]) {
    assert.match(galleryPage, new RegExp(id));
  }
  for (const id of ["wssTradeFilter", "wssStatusFilter", "wssDateFilter", "wssCampaignFilter"]) {
    assert.match(enterprise, new RegExp(id));
  }
  for (const label of [
    "Open live",
    "Edit",
    "Archive",
    "Restore",
    "Select all visible",
    "Rebuild selected",
    "Archive selected",
  ]) {
    assert.match(enterprise, new RegExp(label));
  }
  assert.match(enterprise, /\/api\/admin\/gallery-manage/);
  assert.match(enterprise, /\/api\/admin\/build-preview/);
  assert.match(enterprise, /forceFreshDispatch:true/);
  assert.match(enterprise, /Management selection is separate from the owner-only proof-email checkboxes/);
  assert.match(galleryData, /updatedAt:/);
  assert.match(galleryData, /campaign,/);
});

test("archive and rebuild contracts are admin-gated, reversible, and never email prospects", () => {
  assert.match(galleryManage, /requireAdmin\(req, res\)/);
  assert.match(galleryManage, /const ACTIONS = Object\.freeze\(\["archive", "restore", "notes", "delete"\]\)/);
  assert.match(galleryManage, /ACTIONS\.includes\(action\)/);
  assert.match(galleryManage, /not_archived/);
  assert.match(galleryManage, /confirm_name_mismatch/);
  assert.match(galleryManage, /status=eq\.\$\{ARCHIVED\}/);
  assert.match(galleryManage, /gallery_previous_status/);
  assert.match(galleryManage, /conditionalUpdate/);
  assert.doesNotMatch(galleryManage, /sendEmail|sendResend|proof-email|emailProspect/i);
  assert.match(enterprise, /No email is sent/);
  assert.match(enterprise, /Completion will appear only after the backend reports it/);
});

test("Riley split preview and phone status share one server-recorded truth meter", () => {
  assert.match(dashboard, /\.editor-split\{[^}]*grid-template-columns:clamp\(360px,34%,420px\) minmax\(0,1fr\)/);
  assert.match(dashboard, /<iframe id="sitepreview" title="Live preview of your website"/);
  assert.match(dashboard, /id="previewdesktop"[^>]*aria-pressed="true"/);
  assert.match(dashboard, /id="previewphone"[^>]*aria-pressed="false"/);
  assert.match(dashboard, /id="previewrefresh"/);
  assert.match(dashboard, /id="previewopen"/);
  assert.match(dashboard, /meter\.plainWords/);
  assert.match(dashboard, /role="progressbar"/);
  assert.match(rileyStatus, /describeEditProgress\(job,\s*\{\s*select\s*\}\)/);
  assert.match(rileyStatus, /meter,/);
  assert.match(rileyStatus, /const meterSay/);
  assert.doesNotMatch(rileyStatus, /setTimeout\([^)]*status|fake.*deploy/i);
});

test("WSS Connect uses local visual marks, accessible states, and real connector routes", () => {
  // "Gmail" retired from this list with the Connect v2 weld: the v1 page
  // carried informational catalog rows (Gmail, Google Voice, Craigslist…)
  // with a request-a-connector flow; the v2 Connections tab lists only
  // providers with a real OAuth lane. RETIRED for the same reason:
  // requestConnection, which was that v1 flow's function.
  for (const provider of ["Google", "Calendar", "Facebook", "Instagram", "LinkedIn", "TikTok"]) {
    assert.match(connect, new RegExp(provider, "i"), `${provider} provider is missing`);
  }
  const svgCount = (connect.match(/<svg\b/gi) || []).length;
  assert.ok(svgCount >= 12, "provider and control marks must remain inline/local SVG assets");
  assert.doesNotMatch(connect, /<img[^>]+src=["']https?:\/\//i,
    "provider logos must not hotlink random external image hosts");
  assert.match(connect, /renderConnections/);
  assert.match(connect, /\/connectors\/status/);
  assert.match(connect, /connected/i);
  assert.match(connect, /disconnected/i);
  assert.match(connect, /aria-label=/i);
  assert.match(connect, /oauth/i);
  assert.match(connect, /error/i);
});

test("mobile and PWA contracts remain present on both customer products", () => {
  assert.match(dashboard, /<link rel="manifest"/);
  assert.match(connect, /<link rel="manifest"/);
  assert.match(dashboard, /@media\(max-width:820px\)/);
  assert.match(connect, /viewport-fit=cover/);
  assert.match(connect, /100dvh/);
  assert.match(dashboard, /prefers-reduced-motion:reduce/);
});
