"use strict";

// The customer Command Center's durable page contract. Existing dashboard
// tests exercise the editor, upload, inbox, report and authentication behavior
// in depth. This file pins the new information architecture and the seams that
// keep those proven flows customer-safe; it intentionally does not duplicate
// their end-to-end interaction cases.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const DASHBOARD = path.resolve(__dirname, "../../labs-site/dashboard/index.html");
const html = fs.readFileSync(DASHBOARD, "utf8");

const escRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const idCount = (id) => (html.match(new RegExp(`\\bid=["']${escRe(id)}["']`, "g")) || []).length;
const plain = (value) => String(value)
  .replace(/<[^>]*>/g, " ")
  .replace(/&(?:nbsp|thinsp);/g, " ")
  .replace(/&#8599;|&nearr;/g, " ")
  .replace(/&[a-z]+;|&#\d+;/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

function staticCustomerCopy() {
  return plain(html
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " "));
}

function fullButtonsWithRole(role) {
  const out = [];
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    if (new RegExp(`\\brole=["']${escRe(role)}["']`, "i").test(match[1])) out.push(match[0]);
  }
  return out;
}

function attr(fragment, name) {
  const match = new RegExp(`\\b${escRe(name)}=["']([^"']*)["']`, "i").exec(fragment);
  return match ? match[1] : "";
}

function openingTagById(id) {
  const match = new RegExp(`<[a-z][^>]*\\bid=["']${escRe(id)}["'][^>]*>`, "i").exec(html);
  return match ? match[0] : "";
}

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const next = html.indexOf("\n  function ", start + 12);
  return html.slice(start, next < 0 ? html.length : next);
}

test("the masthead stays local and the only CDN code is pinned Vapi", () => {
  // 2026-08-20: the mark went from a fetched local asset to an INLINE SVG
  // (class wss-mark-live) after the owner caught it rendering as a broken
  // image during a deploy gap. Inline is the strictest form of "stays local" —
  // it cannot 404. The guarantee this line protects is unchanged: the masthead
  // mark ships with the page, never from a CDN.
  assert.match(html, /<svg class="wss-mark-live"[^>]*aria-label="WSS Labs"/,
    "the inline WSS mark must lead the masthead");
  assert.match(html, /class="wss-mark-w"[\s\S]*?stroke="url\(#wssg\)"/,
    "the mark keeps its gradient W stroke");
  assert.match(html, /@font-face[\s\S]*?\/assets\/fonts\/instrument-sans-latin\.woff2/i);
  assert.match(html, /@font-face[\s\S]*?\/assets\/fonts\/martian-mono-latin\.woff2/i);
  assert.match(staticCustomerCopy(), /Command Center/);
  const remoteImports = [...html.matchAll(/import\(["'](https?:\/\/[^"']+)["']\)/gi)].map((match) => match[1]);
  assert.deepEqual(remoteImports, ["https://cdn.jsdelivr.net/npm/@vapi-ai/web@2.6.1/+esm"]);
  assert.doesNotMatch(html, /(?:unpkg|cdnjs|fonts\.googleapis|use\.typekit)\./i);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=["']https?:/i,
    "Vapi is a pinned dynamic import, not an unbounded script tag");
  assert.doesNotMatch(html, /<link\b[^>]*\bhref=["']https?:/i);

  const site = functionSource("renderSite");
  assert.match(site, /httpsOnly\(site\.url\)/);
  assert.match(site, /["']href["'],url/);
  assert.match(site, /removeAttribute\(["']href["']\)/,
    "the masthead live-site link must disappear when no verified site URL exists");
  const status = functionSource("updateSystemStatus");
  assert.match(status, /dataState/);
  assert.match(status, /Some details unavailable/);
  assert.match(status, /items? need(?:s)? attention/);
  assert.match(status, /All systems ready/);
});

// The bar a tab has to clear is a SOURCE, not an idea. Assistant reads
// connect_site_settings and the assistant's own sent messages, so it earns a
// surface. Reviews still has neither, which is what the last assertion pins.
test("there are exactly five accessible tabs and no invented Reviews tab", () => {
  const tabs = fullButtonsWithRole("tab");
  assert.equal((html.match(/\brole=["']tablist["']/gi) || []).length, 1);
  assert.equal(tabs.length, 5, "Overview, Leads, Calls, Assistant and Reports are the whole tab set");
  assert.deepEqual(tabs.map(plain), ["Overview", "Leads", "Calls", "Assistant", "Reports"]);
  assert.equal(new Set(tabs.map((tab) => attr(tab, "aria-controls"))).size, 5,
    "each tab must control its own panel");
  assert.ok(tabs.every((tab) => attr(tab, "id") && attr(tab, "aria-controls")),
    "each tab needs an id and aria-controls");
  assert.equal((html.match(/\brole=["']tabpanel["']/gi) || []).length, 5);
  for (const tab of tabs) {
    const panel = openingTagById(attr(tab, "aria-controls"));
    assert.equal(attr(panel, "role"), "tabpanel");
    assert.equal(attr(panel, "aria-labelledby"), attr(tab, "id"));
  }
  assert.doesNotMatch(staticCustomerCopy(), /\bReviews\b/i,
    "reviews have no source and therefore get no customer surface");
});

test("the Editor is the Assistant panel's split Riley and live-site studio", () => {
  assert.equal(idCount("editor-runway"), 1);
  assert.equal(idCount("tabpanels"), 1);
  const assistant = html.indexOf('id="panel-assistant"');
  const assistantEnd = html.indexOf('id="panel-reports"');
  const editor = html.indexOf('id="editor-runway"');
  const composer = html.indexOf('id="chatinput"');
  const preview = html.indexOf('id="sitepreview"');
  assert.ok(assistant >= 0 && editor > assistant && composer > editor && preview > composer && assistantEnd > preview,
    "the real composer and preview must stay inside the Assistant tab");
  assert.match(html.slice(editor, assistantEnd), /Ask Riley for a change/i);
  assert.match(html.slice(editor, assistantEnd), /Talk it through/);
  assert.doesNotMatch(html.slice(editor, assistantEnd), /tel:\+19493395562/,
    "the Assistant voice door must never dial a phone number");
});

test("all proven auth, editor, upload and inbox DOM seams survive exactly once", () => {
  const permanentIds = [
    "login", "email", "pin", "loginbtn", "loginerr", "dash", "whoname", "clientid",
    "sitebody", "gradehead", "gradetrend", "unread", "unreadsub", "leadlist", "threadview",
    "chatlog", "chatconfirm", "chatinput", "chatchips", "chatattachlabel", "chatfiles",
    "chatsend", "chaterr", "rileyid", "logout",
  ];
  for (const id of permanentIds) assert.equal(idCount(id), 1, `#${id} must exist exactly once`);
  for (const id of ["chatapply", "chatcancel"]) {
    assert.equal(idCount(id), 1, `the two-phase confirmation must create exactly one #${id}`);
  }

  assert.match(html, /localStorage\.getItem\(["']wss_connect_token["']\)/);
  assert.match(html, /\/api\/connect\/dashboard-login/);
  assert.match(html, /\/api\/connect\/verify-link\?t=/);
  assert.match(html, /location\.hash/);
  for (const route of ["edit", "edits", "upload", "threads", "messages", "send"]) {
    assert.match(html, new RegExp(`/api/connect/${route}`), `the existing ${route} route must stay wired`);
  }
});

test("preset chips are exact, prefill-only customer requests", () => {
  const prompts = [...html.matchAll(/\bdata-prompt=["']([^"']+)["']/gi)].map((match) => match[1]);
  assert.deepEqual(prompts, [
    "update my hours",
    "add a photo to Gallery",
    "change a service price",
  ]);
  const source = functionSource("wirePresets");
  assert.match(source, /["']chatinput["']/);
  assert.match(source, /input\.value\s*=/,
    "the preset handler must put words in the existing editor composer");
  assert.match(source, /input\.focus\(/);
  assert.doesNotMatch(source, /sendChat|fetch\(|\/api\//,
    "a preset must never send or apply a change by itself");
});

test("overview uses only the four measured claims and real response hooks", () => {
  assert.match(html, /setMetric\(["']metric-leads["'],["']New leads["']/);
  assert.match(html, /setMetric\(["']metric-calls["'],["']Calls answered["']/);
  assert.match(html, /setMetric\(["']metric-site["'],["']Site score["']/);
  assert.match(html, /Last edit ["']?\+?esc\(relativeTime\(/,
    "last edit must come from a dated response record");
  for (const invented of ["Site visitors", "Booking rate", "Est. pipeline", "Avg response"] ) {
    assert.doesNotMatch(html, new RegExp(escRe(invented), "i"), `${invented} has no source`);
  }
  for (const hook of ["summary", "newLeads", "unrepliedCount", "overview", "calls", "lastEdit", "weakest"]) {
    assert.match(html, new RegExp(`\\b${hook}\\b`), `the page must consume the real ${hook} response field`);
  }
  assert.equal(idCount("activityfeed"), 1);
  assert.equal(idCount("nextactions"), 1);
  assert.doesNotMatch(html, /Cedar\s*(?:&|and)\s*Stone|sample\s+(?:lead|call|activity)|mock\s+(?:lead|call|data)/i,
    "the customer page must contain no board-demo or sample records");
});

test("the measured Site score opens the real Reports panel", () => {
  const metrics = functionSource("renderMetrics");
  assert.match(metrics,
    /setMetric\(["']metric-site["'],["']Site score["'][\s\S]*?,["']reports["']\)/,
    "the scored report is the only source and target for the Site score card");

  const metric = functionSource("setMetric");
  assert.match(metric, /href=["']#panel-reports["']/,
    "the score must remain a real keyboard- and link-friendly hash link");
  assert.match(metric, /data-metric-tab=["']reports["']/);
  assert.match(metric, /preventDefault/);
  assert.match(metric, /showTab\(targetTab,true\)/,
    "activating the score must open and focus the Reports tab");
  assert.equal(attr(openingTagById("panel-reports"), "role"), "tabpanel");
});

test("every attachment remove button keeps a 44px touch target", () => {
  const chip = functionSource("renderChips");
  assert.match(chip, /<button type=["']button["'] data-drop=/);
  assert.match(chip, /aria-label=["']Remove /,
    "the remove target must keep a useful accessible name");

  const rule = /\.file button\s*\{([^}]+)\}/.exec(html);
  assert.ok(rule, "missing attachment remove-button rule");
  assert.match(rule[1], /(?:^|;)\s*(?:min-)?width\s*:\s*44px(?:;|$)/);
  assert.match(rule[1], /(?:^|;)\s*(?:min-)?height\s*:\s*44px(?:;|$)/);
});

test("calls state the attribution limit and keep call artifacts behind the scoped header", () => {
  assert.match(html, /Only calls safely matched to this account are shown\./);
  assert.match(html, /No calls can be safely matched to this account yet\./);
  assert.match(html, /callId/);
  assert.match(html, /audio=1/);
  for (const name of ["openCall", "loadCallAudio"]) {
    const source = functionSource(name);
    assert.match(source, /fetch\(/, `${name} must fetch only when the customer asks`);
    assert.match(source, /["']x-connect-token["']\s*:\s*token/,
      `${name} must use the existing scoped request header`);
  }
  assert.doesNotMatch(html, /[?&](?:token|access_token|x-connect-token)=/i,
    "a tenant credential must never be put in a call URL");
  assert.doesNotMatch(html, /(?:callId|audio=1)[^\n]{0,240}https:\/\/ghost-agency-backend/i,
    "call artifacts stay on the same-origin Connect seam");
});

test("retained audio stays authenticated, CSP-safe and accessible", () => {
  const audio = functionSource("loadCallAudio");
  assert.match(audio, /window\.AudioContext\s*\|\|\s*window\.webkitAudioContext/);
  assert.match(audio, /["']x-connect-token["']\s*:\s*token/,
    "the audio bytes must use the signed customer header");
  assert.match(audio, /\.arrayBuffer\(\)/);
  assert.match(audio, /decodeAudioData\(/);
  assert.match(audio, /aria-pressed/);
  assert.match(audio, /audiostatus/);
  assert.match(audio, /Recording playing\.|Recording finished\.|Recording stopped\./);

  const detail = functionSource("openCall");
  assert.match(detail, /aria-pressed=["']false["']/);
  assert.match(detail, /id=["']audiostatus["'][^>]*role=["']status["'][^>]*aria-live=["']polite["']/);

  assert.doesNotMatch(html, /\.blob\s*\(|createObjectURL|revokeObjectURL|<audio\b/i,
    "audio bytes must not escape into a blob URL or CSP-blocked media element");

  const stop = functionSource("stopCallAudio");
  assert.match(stop, /source\.stop\(0\)/);
  assert.match(stop, /source\.disconnect\(\)/);
  assert.match(functionSource("wireCallBack"), /stopCallAudio\(/);
  assert.match(detail, /stopCallAudio\(/);
  assert.match(html, /listen\(\$\(["']logout["']\),["']click["'][\s\S]{0,360}stopCallAudio\(["']["']\)[\s\S]{0,300}currentAudioContext\.close\(\)/,
    "back, call changes and logout must stop retained playback");
});

test("retained audio aborts and resets on every exit or startup failure", () => {
  const audio = functionSource("loadCallAudio");
  assert.match(audio, /try\{[\s\S]{0,180}new AudioCtor\(\)[\s\S]{0,220}catch\(_contextError\)\{/,
    "a synchronous AudioContext failure must be contained");
  assert.match(audio, /catch\(_contextError\)\{[\s\S]{0,260}target\.disabled=false;target\.textContent=["']Play retained audio["'];attr\(target,["']aria-pressed["'],["']false["']\)[\s\S]{0,180}return;/,
    "a failed startup must restore the idle Play control");

  assert.match(audio, /new AbortController\(\)/);
  assert.match(audio, /requestOptions\.signal=controller\.signal/,
    "the authenticated request must carry its cancellation signal");
  assert.match(audio, /currentAudioAbort=null;currentAudioSource=null;currentAudioButton=null/,
    "failed playback must release every current-control reference");
  assert.match(audio, /currentAudioButton=null;[\s\S]{0,220}Recording finished\./,
    "natural playback completion must release the current button");
  assert.match(audio, /context\.suspend\(\)/,
    "the audio context must suspend after natural playback completion");

  const stop = functionSource("stopCallAudio");
  assert.match(stop, /currentAudioAbort\.abort\(\)/);
  assert.match(stop, /currentAudioAbort=null/);
  assert.match(stop, /currentAudioButton=null/);
  assert.match(stop, /currentAudioContext\.suspend\(\)/,
    "manual stop must also suspend the audio context");

  const tabs = functionSource("showTab");
  assert.match(tabs, /if\(name!==["']calls["']\)stopCallAudio\(["']["']\)/,
    "leaving Calls must cancel playback and any in-flight audio request");
});

test("the visible shell uses plain customer language and no fake claims", () => {
  const copy = staticCustomerCopy();
  for (const word of [
    "connect_threads", "VAPI", "artifact", "proxy", "tenant", "token", "API", "slug",
    "provider ID", "campaign", "admin", "demo", "proof", "edit job", "build record",
  ]) {
    assert.doesNotMatch(copy, new RegExp(`\\b${escRe(word)}\\b`, "i"), `customer copy exposes ${word}`);
  }
  assert.match(copy, /The same leads and updates, with phone notifications\./,
    "the PWA promise must stay narrow and true");
  assert.match(html, /You(?:'|’|&rsquo;)re all caught up\./,
    "the derived-actions empty state must be explicit");
});

test("mobile, motion, keyboard and focus contracts are present", () => {
  assert.match(html, /<html\b[^>]*\blang=["']en["']/i);
  const main = /<main\b[^>]*\bid=["']([^"']+)["']/i.exec(html);
  const skip = /<a\b[^>]*\bhref=["']([^"']*#[^"']+)["'][^>]*>[^<]*Skip/i.exec(html);
  assert.ok(main && skip, "the page needs a skip link and a named main region");
  assert.equal(new URL(skip[1], "https://wss-ai.com/dashboard").hash, `#${main[1]}`);
  assert.match(html, /<time\b[^>]*\bid=["']liveclock["']/i);
  assert.match(html, /@media\s*\([^)]*max-width\s*:\s*\d+px[^)]*\)/i);
  assert.match(html, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/i);
  assert.match(html, /:focus-visible/i);
  assert.match(html, /min-(?:height|width)\s*:\s*44px/i,
    "interactive controls need a 44px touch target");
  assert.match(html, /ArrowLeft|ArrowRight/,
    "tabs must support keyboard arrow navigation");
  assert.match(html, /aria-live=["'](?:polite|assertive)["']/i,
    "live status must be announced without stealing focus");
});
