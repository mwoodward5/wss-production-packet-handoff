"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const page = require("../lib/console-page");

function inlineScripts(source = page) {
  return [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
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

/** Lift a simple top-level LINE_* declaration used by the pure renderers. */
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

const NOW = Date.parse("2026-08-09T12:02:05.000Z");

const BATCH = {
  batchId: "line_fixture_crew",
  lane: "sandbox",
  target: "plumbing in Columbus OH",
  status: "running",
  requested: 500,
  startedAt: "2026-08-09T12:00:00.000Z",
  settledAt: null,
  counts: { total: 7, working: 4, queued: 2, failed: 1, sent: 0 },
  rows: [
    {
      prospectId: "p1", businessName: "Alpha Plumbing", status: "picked",
      reached: ["picked"], updatedAt: "2026-08-09T12:02:00.000Z",
    },
    {
      prospectId: "p2", businessName: "Bravo HVAC", status: "qualified",
      reached: ["picked", "qualified"], updatedAt: "2026-08-09T12:01:35.000Z",
    },
    {
      prospectId: "p3", businessName: "Cedar Roofing", status: "mirrored",
      reached: ["picked", "qualified", "mirrored"], updatedAt: "2026-08-09T12:00:55.000Z",
    },
    {
      prospectId: "p4", businessName: "Delta Electric", status: "gate_passed",
      reached: ["picked", "qualified", "mirrored", "gate_passed"], updatedAt: "2026-08-09T12:00:05.000Z",
    },
    {
      prospectId: "p5", businessName: "Echo Tree Care", status: "queued",
      reached: ["picked", "qualified", "mirrored", "gate_passed", "queued"], updatedAt: "2026-08-09T12:01:40.000Z",
    },
    {
      prospectId: "p6", businessName: "Foxtrot Garage", status: "queued",
      reached: ["picked", "qualified", "mirrored", "gate_passed", "queued"], updatedAt: "2026-08-09T12:01:55.000Z",
    },
    {
      prospectId: "p7", businessName: "Gamma Masonry", status: "gate_failed",
      reached: ["picked", "qualified", "mirrored", "gate_failed"], updatedAt: "2026-08-09T12:02:05.000Z",
      reason: "no own domain logo",
    },
  ],
  mineFunnel: [
    {
      stage: "4_brand_logo_and_accent", entered: 7, survived: 6,
      rejected: { no_own_domain_logo: 1 },
    },
    {
      stage: "5_email", entered: 6, survived: 5,
      rejected: { no_email_published: 1 },
    },
  ],
};

const IDLE_BATCH = {
  batchId: "line_fixture_idle",
  lane: "sandbox",
  target: "stored pool",
  status: "done",
  requested: 10,
  startedAt: "2026-08-09T12:00:00.000Z",
  settledAt: "2026-08-09T12:00:00.000Z",
  counts: { total: 0, working: 0, queued: 0, failed: 0, sent: 0 },
  rows: [],
  mineFunnel: null,
};

const REQUIRED = [
  "lineElapsedText",
  "lineClockText",
  "linePaceText",
  "lineBatchCounts",
  "lineWorkerModels",
  "lineWorkshopHtml",
];

// The controller is picked by CONTENT, not position: additive inline scripts
// (the shared nav poller) ship ahead of it, so index 0 is no longer the one
// that carries the renderers.
function controllerScript() {
  const script = inlineScripts().find((source) => source.includes("function api(path,opts)"));
  assert.ok(script, "the console must ship its authenticated inline controller");
  return script;
}

function workshopFunctions() {
  const script = controllerScript();
  const lineFunctions = [...new Set(
    [...script.matchAll(/\bfunction\s+(line[A-Z][A-Za-z0-9_]*)\s*\(/g)].map((match) => match[1]),
  )];
  for (const name of REQUIRED) assert.ok(lineFunctions.includes(name), `${name} must be a named pure renderer`);

  const declarations = [...new Set(
    [...script.matchAll(/\b(?:var|const|let)\s+(LINE_[A-Z0-9_]+)\s*=/g)].map((match) => match[1]),
  )].map((name) => liftDeclaration(script, name));

  const source = [
    ...declarations,
    liftDeclaration(script, "DEAD_STATES"),
    liftDeclaration(script, "STALL_MS"),
    liftFunction(script, "rowDead"),
    liftFunction(script, "batchRunning"),
    liftFunction(script, "killChips"),
    liftFunction(script, "funnelHtml"),
    ...lineFunctions.map((name) => liftFunction(script, name)),
    `return {${REQUIRED.join(",")}};`,
  ].join("\n");
  return new Function("esc", source)(ESC);
}

function workerArticles(html) {
  return [...html.matchAll(
    /<article\b[^>]*class="[^"]*\bline-worker\b[^"]*"[^>]*data-worker="([^"]+)"[^>]*data-state="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g,
  )].map((match) => ({ worker: match[1], state: match[2], body: match[3], markup: match[0] }));
}

test("the Command Center inline controller still parses", () => {
  // The orbit canvas ships its own small additive script; the pin is that the
  // one AUTHENTICATED controller exists, is unique, and parses — not that the
  // page can never carry another inert script.
  const sources = inlineScripts();
  const controllers = sources.filter((source) => source.includes("function api(path,opts)"));
  assert.equal(controllers.length, 1, "the console should keep one inline controller");
  assert.doesNotThrow(() => new vm.Script(controllers[0], { filename: "console-line-workshop-inline.js" }));
});

test("the seven-row fixture produces batch-relative counts, clocks, and pace", () => {
  const {
    lineElapsedText,
    lineClockText,
    linePaceText,
    lineBatchCounts,
  } = workshopFunctions();

  const counts = lineBatchCounts(BATCH);
  assert.equal(counts.total, 7);
  assert.equal(counts.mirrored, 5);
  assert.equal(counts.gated, 3);
  assert.equal(counts.queued, 2);
  assert.equal(BATCH.counts.working + BATCH.counts.queued + BATCH.counts.failed + BATCH.counts.sent, 7);

  assert.equal(lineElapsedText(5000), "5s");
  assert.equal(lineElapsedText(30000), "30s");
  assert.equal(lineElapsedText(70000), "1m 10s");
  assert.equal(lineElapsedText(120000), "2m");
  assert.equal(lineClockText(BATCH, NOW), "02:05");
  assert.equal(linePaceText(BATCH, NOW), "~42s per site at current pace");

  const settled = { ...BATCH, status: "awaiting_approval", settledAt: "2026-08-09T12:02:05.000Z" };
  assert.equal(
    lineClockText(settled, Date.parse("2026-08-09T13:00:00.000Z")),
    "02:05",
    "a settled batch clock must freeze at settledAt",
  );
});

test("the workshop renders the six truthful workers with inline SVG icons", () => {
  const { lineWorkerModels, lineWorkshopHtml } = workshopFunctions();
  const models = lineWorkerModels(BATCH, NOW);
  assert.equal(models.length, 6);

  const html = lineWorkshopHtml([BATCH], NOW);
  const articles = workerArticles(html);
  assert.equal(articles.length, 6, "one and only one card must render for each worker");
  assert.deepEqual(
    articles.map((article) => article.worker),
    ["miner", "extractor", "compiler", "designer", "inspector", "mailroom"],
  );
  for (const article of articles) {
    assert.match(article.body, /<svg\b/, `${article.worker} needs its own inline SVG icon`);
  }

  assert.match(html, /Mirrored\s*5 of 7/);
  assert.match(html, /Gate\s*3 of 7/);
  assert.match(html, /Queued\s*2\b/);
  assert.match(html, /02:05/);
  assert.match(html, /~42s per site at current pace/);
  assert.doesNotMatch(html, /\b500\b/, "requested and lifetime totals must not leak into batch progress");
});

test("workers with no measured work render idle and visibly dim", () => {
  const { lineWorkshopHtml } = workshopFunctions();
  const html = lineWorkshopHtml([IDLE_BATCH], NOW);
  const articles = workerArticles(html);
  assert.equal(articles.length, 6);
  assert.ok(articles.some((article) => article.state === "idle"), "at least one worker must say it is idle");
  for (const article of articles.filter((item) => item.state === "idle")) {
    assert.match(article.markup, /\bis-idle\b/);
    assert.match(article.body, /\bIdle\b/i);
  }

  const css = styleText();
  const idleRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => (
    /line-worker/.test(match[1]) && /idle/.test(match[1]) && /opacity\s*:\s*([0-9.]+)/.test(match[2])
  ));
  assert.ok(idleRules.length > 0, "idle worker CSS must set a dim opacity");
  for (const rule of idleRules) {
    const opacity = Number(/opacity\s*:\s*([0-9.]+)/.exec(rule[2])[1]);
    assert.ok(opacity >= 0 && opacity < 1, `idle opacity must be dim, got ${opacity}`);
  }
});

test("the per-stage reason rail remains exact and measured", () => {
  const { lineWorkshopHtml } = workshopFunctions();
  const html = lineWorkshopHtml([BATCH], NOW);
  assert.ok(
    html.includes('<i class="kchip" title="no own domain logo">no own domain logo<b>1</b></i>'),
    "the brand rejection reason and count must survive",
  );
  assert.ok(
    html.includes('<i class="kchip" title="no email published">no email published<b>1</b></i>'),
    "the email rejection reason and count must survive",
  );
  assert.doesNotMatch(lineWorkshopHtml([IDLE_BATCH], NOW), /class="mkill"|class="kchip"/);
});

test("Line Detail is an in-page, read-only surface", () => {
  const script = controllerScript();
  const loadLineTab = liftFunction(script, "loadLineTab");
  const panelStart = page.indexOf('id="tabPanelLine"');
  const panelEnd = page.indexOf('id="accessGate"', panelStart);
  assert.ok(panelStart >= 0 && panelEnd > panelStart, "Line Detail panel must exist");
  const panel = page.slice(panelStart, panelEnd);

  assert.doesNotMatch(panel, /<iframe\b/i);
  assert.doesNotMatch(loadLineTab, /createElement\(["']iframe["']\)|\.src\s*=\s*["']\/line["']/);
  assert.doesNotMatch(loadLineTab, /\bpost\s*\(|action\s*:\s*["'](?:approve|send|start)["']/);

  const html = workshopFunctions().lineWorkshopHtml([BATCH], NOW);
  assert.doesNotMatch(html, /<button\b|<form\b|approveBtn|action\s*:\s*["'](?:approve|send|start)["']/i);
});

test("Line Detail carries narrow-screen overflow guards for 390px", () => {
  const css = styleText();
  assert.match(css, /@media\s*\(\s*max-width\s*:\s*(?:[1-5]\d{2}|[1-9]\d?)px\s*\)/);
  const workerRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => /\.line-worker\b/.test(match[1]));
  assert.ok(
    workerRules.some((rule) => /min-width\s*:\s*0(?:px)?\b/.test(rule[2])),
    "worker cards must be allowed to shrink below their text width",
  );
  assert.ok(
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some((rule) => (
      /(?:\.line-worker\b|\.lw-)/.test(rule[1])
        && /(?:overflow-wrap\s*:\s*anywhere|word-break\s*:\s*break-word)/.test(rule[2])
    )),
    "long measured names and stage sentences must wrap rather than widen 390px",
  );

  const html = workshopFunctions().lineWorkshopHtml([BATCH], NOW);
  assert.doesNotMatch(html, /(?:min-)?width\s*:\s*(?:[4-9]\d{2}|\d{4,})px/i);
});
