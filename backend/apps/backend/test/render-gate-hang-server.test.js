"use strict";

// test/render-gate-hang-server.test.js — THE GATE MUST NEVER HANG.
//
// Batch line_mtmvwmyn_f72f05204d ("hvac nationwide", 2026-09-04) was the
// incident this file exists to pin: nine rows fired inspection_started and
// NEVER completed. The built sites were healthy in real browsers — network
// quiet in 12s, the gate's own body-clone scrape measured at 7ms, video
// readyState 4 — yet every row burned the runner's whole phase budget, retried
// seven times across an hour, and was swept build_retry_exhausted at 12:47Z
// with the triggering error erased. The defect: runRenderGate had NO internal
// timeout. `timeoutMs` bounded each page.goto and NOTHING ELSE — the chromium
// launch, newPage, the scrape evaluate, the logo fetches, and above all the
// CAPTURE HOOK await were unbounded, so one never-settling await held a row
// open until the runner's outer race killed the phase (render_gate_timed_out,
// retryable), and the retry loop walked the same wall seven times.
//
// THE LAW UNDER TEST (2026-09-04): every await between inspection_started and
// the verdict is bounded; a step that outruns its slice settles the row FAST
// with a NAMED reason (gate_step_timeout:<phase>) instead of hanging; and a
// capture that never settles can no longer hold a PASSING verdict hostage.
//
// Tier 1 and Tier 2 are deterministic (injected seams, a real never-responding
// HTTP endpoint) and RED on main 1998f36: there runRenderGate never returns at
// all. Tier 3 runs a live-shaped fixture on real chromium (skipped where no
// chromium is installed, like line-proof-shots-mirror-fixture) to prove the
// bounds did not slow or break a healthy gate.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { runRenderGate, readRenderedDom } = require("../lib/render-gate");

const GOOD_SOURCE = Object.freeze({
  prospect_id: "prospect-1",
  business_name: "Frontline HVAC",
  phone: "(512) 555-0147",
  postal_city: "Austin",
  vertical: "hvac",
  donor_strings: ["Donor Heating & Cooling"],
  services: ["Furnace repair", "AC installation"],
  reviews: [],
  brand_mark: {
    reason: "no client mark uploaded",
    rung: "wordmark",
    value: { type: "wordmark", text: "Frontline HVAC" },
  },
});

/** A production reader seam with an injected chromium-shaped launcher. */
const readerWithLauncher = (launcher) => (url, options) => readRenderedDom(url, { ...options, launcher });

// ---------------------------------------------------------------------------
// THE HANG SERVER — accepts the socket, never answers. The production shape of
// a black-holed origin: connections open, bytes never arrive, every await on
// the response stalls.
// ---------------------------------------------------------------------------
function startHangServer() {
  const server = http.createServer(() => {
    // Intentionally no res.end(): the request never settles.
  });
  server.on("connection", (socket) => { socket.setTimeout(0); });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// TIER 1 — THE INCIDENT, DETERMINISTIC, on the PRODUCTION reader path. Facts
// PASS (the chromium-shaped launcher serves a healthy scrape, exactly the
// incident rows), and the capture hook that runs inside the gate's open
// browser never settles. On main this await was unbounded: the row NEVER
// completed and died on the runner's wall. Now the capture slice ends, the
// miss is NAMED on dom.capture, and the PASSING verdict returns — capture may
// never change a fact, and it may no longer delay one either.
// ---------------------------------------------------------------------------
test("a capture hook that never settles cannot hold a PASSING verdict hostage", { timeout: 30_000 }, async () => {
  const url = "https://frontline-hvac.wss-ai.com/";
  // A chromium whose page reads healthy — the incident rows' exact shape.
  const healthyLauncher = {
    launch: async () => ({
      async newPage() {
        return {
          async goto() { return { status: () => 200 }; },
          async evaluate() {
            return {
              title: "Frontline HVAC",
              innerText: `${"Frontline HVAC — furnace and air conditioning service. ".repeat(4)}Call (512) 555-0147 in Austin.`,
              donorText: "Furnace and air conditioning service by our technicians.",
              hrefs: [],
              imgs: [{
                src: `${url}assets/brand-logo.svg`,
                alt: "Frontline HVAC",
                width: 120,
                height: 30,
                inHeader: true,
                looksLikeLogo: true,
              }],
              videos: [],
              videoEmbeds: [],
              placeNames: ["Austin"],
              jsonldRaw: [JSON.stringify({ "@type": "HVACBusiness", name: "Frontline HVAC" })],
            };
          },
          request: {
            async get() {
              return { ok: () => true, body: async () => Buffer.from("brand-mark-bytes") };
            },
          },
          async close() {},
        };
      },
      async close() {},
    }),
  };
  const startedAt = Date.now();
  const verdict = await runRenderGate({
    url,
    source: GOOD_SOURCE,
    reader: readerWithLauncher(healthyLauncher),
    // The caller's wall, exactly as processRowPhase passes it. The capture
    // slice is what is left of it minus the reserve that lets the gate close
    // its browser — a few seconds here, 100+ on the incident rows.
    deadlineAt: Date.now() + 5_000,
    capture: () => new Promise(() => {}), // the hang: never resolves, never throws
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(verdict.pass, true, `the twelve facts passed — the verdict must return: ${verdict.blockedBy}`);
  assert.ok(verdict.capture, "the failed capture is still recorded, not swallowed");
  assert.match(String(verdict.capture.reason), /^gate_step_timeout:capture/);
  assert.ok(elapsedMs < 15_000, `the gate must settle fast, not jam (took ${elapsedMs}ms)`);
});

// ---------------------------------------------------------------------------
// TIER 2 — THE HANG SERVER through the production reader. The endpoint never
// settles, so the browser's navigation await never returns. runRenderGate is
// driven exactly as processRowPhase drives it — with the caller's deadlineAt —
// and must return a verdict naming the phase, fast.
//
//   2a. the navigation itself black-holes: the verdict names `goto`.
//   2b. the browser never yields a page: the verdict names `new_page`.
//
// On main runRenderGate accepted no deadlineAt at all and returned never.
// ---------------------------------------------------------------------------
test("a hang-server endpoint cannot hang the inspection: the verdict names the phase", { timeout: 30_000 }, async () => {
  const hang = await startHangServer();
  try {
    // The navigation never settles — modelled on the launcher seam the gate
    // itself exports for tests, with every later step disabled so the ONLY
    // live await is the one a black-holed origin stalls.
    const launcher = {
      launch: async () => ({
        async newPage() {
          return {
            goto: () => new Promise(() => {}),
            evaluate: () => new Promise(() => {}),
            request: { get: () => new Promise(() => {}) },
          };
        },
        async close() {},
      }),
    };
    const startedAt = Date.now();
    const verdict = await runRenderGate({
      url: hang.url,
      source: GOOD_SOURCE,
      reader: readerWithLauncher(launcher),
      deadlineAt: Date.now() + 3_000, // exactly what processRowPhase passes
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(verdict.pass, false, "an unreadable page fails closed");
    assert.match(
      String(verdict.blockedBy),
      /render_unavailable:gate_step_timeout:(goto|render_read)/,
      `the refusal must name the phase that hung: ${verdict.blockedBy}`,
    );
    assert.ok(verdict.stepTimeout, "the verdict carries stepTimeout for the durable row");
    assert.ok(elapsedMs < 20_000, `the inspection must end inside its budget (took ${elapsedMs}ms)`);
  } finally {
    await hang.close();
  }
});

test("a chromium that launches but never yields a page names new_page and returns", { timeout: 30_000 }, async () => {
  const launcher = {
    launch: async () => ({
      newPage: () => new Promise(() => {}),
      async close() {},
    }),
  };
  const startedAt = Date.now();
  const verdict = await runRenderGate({
    url: "https://frontline-hvac.wss-ai.com/",
    source: GOOD_SOURCE,
    reader: readerWithLauncher(launcher),
    deadlineAt: Date.now() + 3_000,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(verdict.pass, false);
  assert.match(
    String(verdict.blockedBy),
    /render_unavailable:gate_step_timeout:(new_page|render_read)/,
    `named phase required: ${verdict.blockedBy}`,
  );
  assert.ok(elapsedMs < 20_000, `must not hang (took ${elapsedMs}ms)`);
});

// ---------------------------------------------------------------------------
// TIER 3 — LIVE-SHAPED REGRESSION GUARD (real chromium; skipped without one).
// The healthy incident page — quiet in seconds in a real browser — must still
// gate_pass end-to-end with the step budgets in place, its capture must
// survive a hook pointed at the hang server (the BEFORE lane's shape), and the
// whole inspection must stay far inside the runner's 180s wall.
// ---------------------------------------------------------------------------
test("a healthy page still gate_passes with the capture lane aimed at a hang server", { timeout: 120_000 }, async (t) => {
  let launchChromium;
  let browser;
  try {
    ({ launchChromium } = require("../lib/serverless-chromium"));
    browser = await launchChromium();
    await browser.close().catch(() => {});
  } catch {
    return t.skip("chromium is not installed in this environment");
  }
  browser = await launchChromium();
  const hang = await startHangServer();
  const server = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (req.url === "/assets/brand-logo.svg") {
        res.setHeader("content-type", "image/svg+xml");
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="30"><text x="0" y="20">Frontline HVAC</text></svg>');
        return;
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(`<!doctype html><html><head><title>Frontline HVAC</title></head>
<body><header><img class="logo" src="/assets/brand-logo.svg" alt="Frontline HVAC" width="120" height="30"></header>
<h1>Frontline HVAC</h1>
<p>Furnace and air conditioning service in Austin. Call (512) 555-0147.</p>
<script type="application/ld+json">{"@type":"HVACBusiness","name":"Frontline HVAC"}</script>
</body></html>`);
    });
    s.listen(0, "127.0.0.1", () => resolve({ s, baseUrl: `http://127.0.0.1:${s.address().port}/` }));
  });
  try {
    const startedAt = Date.now();
    const verdict = await runRenderGate({
      url: server.baseUrl,
      source: GOOD_SOURCE,
      build: { prospectId: "prospect-1", buildHash: "b".repeat(64), currentWebsite: hang.url },
      // THE PRODUCTION CAPTURE SHAPE: the hook navigates the prospect's OLD
      // site — here, the hang server. The slice the caller gives this hook is
      // the capture budget law; the hook's own awaits obey the same bounds.
      capture: async ({ browser: openBrowser }) => {
        const page = await openBrowser.newPage();
        try {
          await page.goto(hang.url, { waitUntil: "load", timeout: 2_000 }).catch(() => {});
          return { ok: true, shots: { new_captured_url: server.baseUrl } };
        } finally {
          await page.close().catch(() => {});
        }
      },
    });
    const elapsedMs = Date.now() - startedAt;
    const failures = (verdict.checks || []).filter((c) => !c.pass)
      .map((c) => `${c.fact}: ${c.reason}`).join(" | ");
    assert.equal(verdict.pass, true, `a healthy page must pass: ${failures}`);
    assert.ok(verdict.capture && verdict.capture.ok === true, JSON.stringify(verdict.capture || {}));
    assert.ok(elapsedMs < 60_000, `the whole inspection must stay well inside the runner wall (took ${elapsedMs}ms)`);
  } finally {
    await hang.close();
    await new Promise((done) => server.s.close(done));
    await browser.close().catch(() => {});
  }
});
