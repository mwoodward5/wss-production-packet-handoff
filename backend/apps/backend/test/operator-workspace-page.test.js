"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const page = require("../lib/operator-workspace-page-final");
const { operatorNav, DESTINATIONS } = require("../lib/operator-nav");
const consoleHandlerSource = fs.readFileSync(path.join(__dirname, "../api/admin/console.js"), "utf8");

test("/console is a clean operator production studio", () => {
  for (const phrase of [
    "Build, watch, and ship from one place.",
    "Build new websites",
    "Live production",
    "Website production studio",
    "Websites",
    "Outreach",
    "Replies",
    "Results",
    "Factory details",
  ]) assert.match(page, new RegExp(phrase, "i"), phrase);

  assert.doesNotMatch(page, /Engine room/i, "developer jargon is removed from the operator-facing Home page");
  assert.match(page, /href="\/gallery"/);
  assert.match(page, /href="\/campaigns"/);
  assert.match(page, /href="\/replies"/);
  assert.match(page, /href="\/ledger"/);
  assert.match(page, /href="\/line"/);
});

test("old campaign inventory is still absent from Home", () => {
  for (const phrase of [
    "Action center",
    "Active campaigns",
    "Ready to review",
    "Waiting on you",
    "All campaigns",
    "Your campaigns",
  ]) assert.doesNotMatch(page, new RegExp(phrase, "i"), phrase);

  assert.doesNotMatch(page, /metricSites|metricReady|metricWaiting|metricReplies/);
  assert.doesNotMatch(page, /\/api\/admin\/console-data/);
  assert.match(page, /Review outreach/);
});

test("live production uses the real line telemetry instead of timer progress", () => {
  for (const phrase of [
    "Prospect packets",
    "Qualified",
    "Builds cleared",
    "Live inspection",
    "Ready",
    "Factory telemetry",
    "What the factory is doing now",
    "throughputPerMinute",
    "etaMinutes",
    "verificationBrowsers",
    "mirrorWorkers",
    "mineFunnel",
    "currentAgeMs",
  ]) assert.match(page, new RegExp(phrase, "i"), phrase);
  assert.match(page, /performance\.phases/);
  assert.match(page, /pickState/);
  assert.match(page, /setInterval\(function\(\)\{if\(!document\.hidden\)load\(true\);\},5000\)/);
});

test("summary counters name their unchanged row facts truthfully", () => {
  assert.match(page, /<span>In pipeline<\/span><b>'\+c\.working\+'<\/b><small>sites not yet finished<\/small>/);
  assert.match(page, /<span>Rejected attempts<\/span><b>'\+c\.failed\+'<\/b><small>did not consume quota<\/small>/);
  assert.doesNotMatch(page, /<span>Working now<\/span>/);
  assert.doesNotMatch(page, /<span>Replaced<\/span>/);
});

test("a slower older poll cannot overwrite a newer line snapshot", async () => {
  const controller = page.split("<script>").slice(1)
    .map((part) => part.split("</script>")[0])
    .find((script) => script.includes("var KEY='wsl_admin_token'"));
  assert.ok(controller, "workspace controller script is present");

  const pendingLines = [];
  const intervals = [];
  const elements = new Map();
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const child = { textContent: "" };
    const value = {
      id,
      hidden: false,
      value: "",
      disabled: false,
      textContent: "",
      className: "",
      innerHTML: "",
      classList: { toggle() {} },
      addEventListener() {},
      setAttribute() {},
      getAttribute() { return ""; },
      querySelector() { return child; },
      focus() {},
      scrollIntoView() {},
      closest() { return null; },
    };
    elements.set(id, value);
    return value;
  }
  function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  }
  function response(body) {
    return { ok: true, status: 200, json: async () => body };
  }
  function snapshot(target) {
    return {
      ok: true,
      capacity: {},
      batches: [{
        batchId: target,
        status: "building",
        startedAt: "2026-08-21T08:00:00.000Z",
        requested: 10,
        target,
        lane: "sandbox",
        rows: [],
        pickState: "pending",
        performance: { phases: {}, processed: 0, target: 10 },
      }],
    };
  }

  const context = {
    URLSearchParams,
    localStorage: {
      getItem() { return "signed-session"; },
      setItem() {},
      removeItem() {},
    },
    location: { search: "", reload() {} },
    document: {
      hidden: false,
      getElementById: element,
      querySelectorAll() { return []; },
      addEventListener() {},
    },
    confirm() { return true; },
    clearInterval() {},
    setInterval(callback, milliseconds) {
      intervals.push({ callback, milliseconds });
      return intervals.length;
    },
    setTimeout() { return 1; },
    fetch(url) {
      if (url === "/api/admin/line") {
        const request = deferred();
        pendingLines.push(request);
        return request.promise.then(response);
      }
      return Promise.resolve(response({}));
    },
  };
  vm.runInNewContext(controller, context);
  assert.equal(pendingLines.length, 1, "initial line request starts");
  pendingLines[0].resolve(snapshot("Initial"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].milliseconds, 5000, "guard does not slow the five-second poll");

  intervals[0].callback();
  intervals[0].callback();
  assert.equal(pendingLines.length, 3, "overlapping polls remain allowed");
  pendingLines[2].resolve(snapshot("Newer"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(element("sideLiveName").textContent, "Newer Sprint");

  pendingLines[1].resolve(snapshot("Older"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(element("sideLiveName").textContent, "Newer Sprint", "late older response is ignored");
});

test("per-site progress uses compact real milestones instead of arbitrary 30 percent math", () => {
  for (const label of ["Researched", "Built", "Inspected", "Ready", "Sent"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /parts\.join\('  ›  '\)/);
  assert.match(page, /p:\[20,20,40,60,80,80,100\]/);
});

test("Command Center carries the restrained liquid-glass layer", () => {
  assert.match(page, /id="wss-liquid-glass-command-center"/);
  assert.match(page, /backdrop-filter:blur\(18px\) saturate\(145%\)/);
  assert.match(page, /inset 0 1px 0 rgba\(255,255,255/);
  assert.match(page, /prefers-reduced-motion/);
});

test("zero-row active builds still render honest sourcing motion", () => {
  assert.match(page, /\(b\.rows\|\|\[\]\)\.length===0/);
  assert.match(page, /Searching for qualified businesses now/);
  assert.match(page, /indeterminate/);
});

test("active production is limited to non-terminal line batches", () => {
  assert.match(page, /function activeStatus\(v\)/);
  assert.match(page, /\['queued','building','running','awaiting_approval','approved','sending'\]/);
  assert.match(page, /filter\(function\(b\)\{return activeStatus\(b\.status\);\}\)/);
});

test("ready-made research gets a human campaign name", () => {
  assert.match(page, /goal\+'-Site Local Growth Sprint'/);
  assert.doesNotMatch(page, /class="prod-name">leadminer/i);
});

test("fresh website builds still use the canonical line contract", () => {
  assert.match(page, /\/api\/admin\/line/);
  assert.match(page, /action:'start'/);
  assert.match(page, /count:count,target:target\(\),lane:state\.mode/);
  assert.match(page, /action:'clear_stuck'/);
  assert.match(page, /olderThanMinutes:0/);
});

test("stopping current work does not claim to delete customer history", () => {
  assert.match(page, /does not delete customer records, replies, sent-email history, reports, payments, or results/i);
});

test("operator retains an immediate emergency send switch with truthful semantics", () => {
  assert.match(page, /id="sendSwitch"/);
  assert.match(page, /\/api\/admin\/outreach-pause/);
  assert.match(page, /Stop all prospect sending now\?/);
  assert.match(page, /Resume prospect sending\?/);
  assert.match(page, /reason:active\?'operator_resume':'operator_pause'/);
  assert.doesNotMatch(page, /reason:active\?'operator_pause':'operator_resume'/);
});

test("shared operator navigation is one coherent product with live factory status", () => {
  assert.deepEqual(DESTINATIONS.map((entry) => entry.label), ["Home", "Websites", "Outreach", "Replies", "Results", "Engine room"]);
  const galleryNav = operatorNav("gallery");
  assert.match(galleryNav, /WSS Command Center/);
  assert.match(galleryNav, /wssnavLive/);
  assert.match(galleryNav, /\/api\/admin\/line/);
  assert.match(galleryNav, /New build/);
  assert.match(galleryNav, /g\+'-Site Local Growth Sprint'/);
  assert.doesNotMatch(galleryNav, />Your campaigns</i);
});

test("console route serves the operator workspace — the standardized, fully-working UI (owner directive 2026-09-05); the arcade console-page stays unserved until its own completion", () => {
  // Owner law 2026-09-05: /console serves the operator workspace (the UI that
  // was completely working, incl. the 2026-08-19 login-recovery layer). The
  // arcade console-page generation remains in-repo (unserved) until its own
  // completion lane lands.
  assert.match(consoleHandlerSource, /const PAGE = require\("\.\.\/\.\.\/lib\/operator-workspace-login-hotfix"\);/);
  assert.doesNotMatch(consoleHandlerSource, /require\("[^"]*console-page"\)/);
});
