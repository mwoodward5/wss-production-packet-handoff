"use strict";
/**
 * scripts/donor-floater-hydration-proof.js — the TEN-TRADES donor gate, proven
 * by RENDERING, locally, with zero deploy budget.
 *
 * Runs the REAL engine (lib/mirror-engine/engine.js mirror()) over a donor with
 * probe facts, deploys to an in-memory static server that emulates the Vercel
 * bits the donors rely on (cleanUrls, directory indexes, SPA rewrite), lets the
 * REAL renderCheck/renderAudit run against it — and then answers the question
 * the render gate cannot: IS THE SIGN-UP FLOATER STILL IN THE DOM FIVE SECONDS
 * AFTER LOAD? A TanStack Start donor hydrates the whole <body>; anything the
 * engine appended before </body> is inside the hydration container, and a #418
 * client re-render silently deletes it ~3s in. Every concrete mirror shipped
 * with no Client ID, no Riley CTA and no checkout, while checks.render passed —
 * the deletion is an ERROR-FREE re-render, so only waiting and looking again
 * can see it.
 *
 *   node scripts/donor-floater-hydration-proof.js --donor concrete-elconstruction
 *   node scripts/donor-floater-hydration-proof.js --all
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.join(__dirname, "..");
const { chromium } = require(path.join(ROOT, "node_modules", "playwright"));

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { slugPolicy, withSpaRewrite } = require("../lib/mirror-engine/deploy");
const { renderCheck, renderAudit } = require("../lib/mirror-engine/verify");

const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const has = (n) => process.argv.includes(`--${n}`);
const OUT = path.join(ROOT, "artifacts", "donor-floater-proof");

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain",
  ".xml": "application/xml", ".mp4": "video/mp4", ".webm": "video/webm", ".webmanifest": "application/manifest+json",
};

/** Donor -> the probe request the engine gets. Facts match the existing
 *  probe-* client stamps (artifacts/clients/probe-<donor>/client.stamp.json)
 *  so GATE 4C agrees across runs. */
function probeRequest(donor, industry) {
  // The slug must NOT embed the donor's name: the donor's own identity atoms
  // (BOILERPLATE socials like "elconstruction") are scanned against the
  // HYDRATED bytes, and a slug carrying the donor name plants that atom in
  // every canonical URL — a probe-only false positive.
  return {
    slug: `probe-lane-${industry}`,
    donor,
    facts: {
      business_name: "Probe Test Services",
      industry,
      city: "Tulsa",
      state: "OK",
      phone: "(555) 010-2030",
      postal_code: "74103",
      // The tattoo donor has UNGUARDED {{EMAIL}} slots (mailto: in every
      // footer + a FAQ answer baked into the JS bundle), so a prospect with
      // no email cannot build on it at all. The probe carries one, like the
      // real prospects the lane picks.
      email: "probe@wss-ai.com",
      // Cox-shaped: a verified rating + count, because the live concrete #418
      // appeared on a build that carried review data while the probe did not.
      ...(has("reviews") ? { rating: 4.8, review_count: 123 } : {}),
    },
    content: {
      // --coxshape reproduces the exact island the live concrete mirror
      // shipped: NO services, NO areas, reviews + faqs + hours present. That
      // is the shape a service_floor-held build carries.
      services: has("coxshape") ? [] : [
        { name: "General service call", description: "Scheduled service visit with a written estimate." },
        { name: "Emergency call-out", description: "Same-day response for urgent problems." },
        { name: "Free written estimate", description: "A written scope and price before any work starts." },
      ],
      faqs: [
        { q: "Do you provide written estimates?", a: "Yes. Every job starts with a written estimate." },
        { q: "Are you locally owned?", a: "Yes, locally owned and operated in Tulsa." },
      ],
      areas: has("coxshape") ? [] : ["Tulsa", "Broken Arrow", "Owasso"],
      about: has("coxshape") ? "" : "Probe Test Services is a Tulsa company used only for local render proofs.",
      ...(has("reviews") ? {
        reviews: [
          { text: "Great crew, showed up on time and the slab is perfect.", author: "Verified Google review" },
          { text: "Fair price and clean work area every day.", author: "Verified Google review" },
          { text: "They repoured our driveway in two days.", author: "Verified Google review" },
          { text: "Quote matched the invoice to the dollar.", author: "Verified Google review" },
        ],
        hours: { monday: "8:00 AM - 5:00 PM", tuesday: "8:00 AM - 5:00 PM", wednesday: "8:00 AM - 5:00 PM", thursday: "8:00 AM - 5:00 PM", friday: "8:00 AM - 5:00 PM" },
      } : {}),
    },
    ...(has("coxshape") ? {
      brand: {
        logo: "https://le-cdn.hibuwebsites.com/df0ada218a3d46de8331c56d29395ec6/dms3rep/multi/opt/cox-concrete-and-excavation-logo-1920w.png",
        accent: "#fcae1a",
        accent_source: "https://le-cdn.hibuwebsites.com/df0ada218a3d46de8331c56d29395ec6/dms3rep/multi/opt/cox-concrete-and-excavation-logo-1920w.png",
      },
    } : {}),
    signup: {
      clientId: "PRB-0001",
      rileyTel: "tel:+19493395562",
      rileyDisplay: "(949) 339-9562",
      checkoutUrl: "https://wss-ai.com/api/checkout?probe=1",
      domain: `probe-lane-${industry}.wss-ai.com`,
    },
  };
}

/** Serve the engine's finalFiles map the way Vercel would serve them. */
function serveFiles(getFiles) {
  const server = http.createServer((req, res) => {
    const files = getFiles();
    if (!files) { res.writeHead(503).end("no deployment yet"); return; }
    let rel = decodeURIComponent(String(req.url || "/").split("?")[0]).replace(/^\/+/, "");
    let cfg = {};
    try { cfg = JSON.parse((files["vercel.json"] || Buffer.from("{}")).toString("utf8")); } catch { cfg = {}; }
    const candidates = [];
    if (!rel) candidates.push("index.html");
    else {
      candidates.push(rel);
      if (rel.endsWith("/")) candidates.push(`${rel}index.html`);
      // Vercel filesystem pass: directory index and cleanUrls extensionless html.
      candidates.push(`${rel}/index.html`);
      if (!path.posix.extname(rel)) candidates.push(`${rel}.html`);
    }
    let hit = candidates.find((c) => files[c]);
    if (!hit) {
      // Rewrites: honour a catch-all SPA rewrite if one is declared.
      const rewrites = Array.isArray(cfg.rewrites) ? cfg.rewrites : [];
      const catchAll = rewrites.find((r) => /\(\.\*\)|:path\*/.test(String(r.source || "")));
      if (catchAll) {
        const dest = String(catchAll.destination || "/index.html").replace(/^\//, "") || "index.html";
        if (files[dest]) hit = dest;
        else if (files[`${dest}/index.html`]) hit = `${dest}/index.html`;
      }
    }
    if (!hit && files["404.html"]) {
      res.writeHead(404, { "content-type": "text/html" }).end(files["404.html"]);
      return;
    }
    if (!hit) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.posix.extname(hit).toLowerCase()] || "application/octet-stream" });
    res.end(files[hit]);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

/**
 * The wait-5s probe. Loads "/", samples the floater family at ~1s and at 6s,
 * and records every pageerror. "Present at load" and "present after
 * hydration" are DIFFERENT facts; a TSR donor passes the first and fails the
 * second.
 */
async function floaterProbe(base, donor) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String((err && err.message) || err).slice(0, 200)));
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  const sample = () => page.evaluate(() => ({
    floater: !!document.getElementById("wss-floater"),
    pill: !!document.getElementById("wss-pill"),
    scrim: !!document.getElementById("wss-scrim"),
    card_open: (() => { const c = document.getElementById("wss-plan-card"); return !!c && !c.hidden; })(),
    client_id: /PRB-0001/.test(document.body ? document.body.innerText : ""),
    chat: !!document.getElementById("wss-chat-launcher"),
  }));
  await page.waitForTimeout(1000);
  const at1s = await sample();
  await page.waitForTimeout(5000);
  const at6s = await sample();
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${donor}-6s.png`), fullPage: false });
  await browser.close();
  return { at1s, at6s, pageErrors };
}

async function proveDonor(donor, industry) {
  let current = null;         // the finalFiles map the "deployment" serves
  const { server, port } = await serveFiles(() => current);
  const base = `http://127.0.0.1:${port}`;
  const rewriteUrl = (u) => String(u).replace(/^https:\/\/[^/]+/, base);

  const deps = {
    // probe-* is not the wss-test-* namespace; nothing here ever reaches
    // Vercel, so the namespace gate has nothing to protect.
    slugPolicy: () => ({ ok: true }),
    withSpaRewrite,
    siteEditLog: async () => ({ ok: true, fingerprint: "", active: [], revoked: [], legacy: [], configured: false }),
    ensureProject: async () => "prj_local_probe",
    uploadFiles: async (files) => ({ manifest: Object.keys(files).map((f) => ({ file: f })), uploaded: Object.keys(files).length, deduped: 0 }),
    createDeployment: async ({ projectName }) => ({ id: `dpl_local_${projectName}`, url: `local.${projectName}`, readyState: "READY" }),
    waitReady: async () => ({ readyState: "READY" }),
    byteDiff: async () => ({ clean: true, checked: 0, mismatches: [] }),
    deepLinkCheck: async () => ({ clean: true, failures: [] }),
    attachAlias: async ({ slug }) => ({ alias: `https://${slug}.wss-ai.com` }),
    aliasTargetCheck: async ({ deployId }) => ({ clean: true, deploymentId: deployId }),
    renderCheck: (url, opts) => renderCheck(rewriteUrl(url), opts),
    renderAudit: (url, opts) => renderAudit(rewriteUrl(url), opts),
  };
  // capture the final tree at the exact point the engine hands it to "Vercel"
  const realWithSpa = withSpaRewrite;
  deps.withSpaRewrite = (files, spaRoutes) => { const out = realWithSpa(files, spaRoutes); current = out; return out; };

  const t0 = Date.now();
  let result;
  try {
    result = await mirror(probeRequest(donor, industry), { registry: createRegistry(), deps });
  } catch (e) {
    server.close();
    return { donor, ok: false, threw: String((e && e.stack) || e).slice(0, 800) };
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const body = result.body || {};
  const checks = body.checks || {};
  const summary = {
    donor,
    industry,
    ok: result.ok && body.ok !== false,
    status: result.status,
    error: body.error || "",
    detail: body.detail || undefined,
    revealable: body.revealable,
    render: checks.render ? {
      status: checks.render.status,
      problems: checks.render.problems,
      page_errors: checks.render.page_errors,
      failed_requests: checks.render.failed_requests,
      console_errors: checks.render.console_errors,
    } : null,
    route_render: checks.route_render ? { status: checks.route_render.status, problems: (checks.route_render.problems || []).slice(0, 6) } : null,
    signup_panel: checks.content && checks.content.signup_panel ? checks.content.signup_panel : (body.content_report && body.content_report.signup_panel) || null,
    build_secs: secs,
  };

  if (current && has("dump")) {
    const dumpDir = path.join(OUT, `${donor}-tree`);
    for (const [rel, buf] of Object.entries(current)) {
      const full = path.join(dumpDir, rel.split("/").join(path.sep));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, buf);
    }
    summary.dumped = dumpDir;
  }

  // Even when the engine refuses, current may hold a tree worth probing; only
  // probe when we actually have files to serve.
  if (current) {
    try {
      summary.floater = await floaterProbe(base, donor);
    } catch (e) {
      summary.floater = { error: String((e && e.message) || e).slice(0, 300) };
    }
  } else {
    summary.floater = { error: "no_files_assembled" };
  }
  server.close();
  return summary;
}

const DONORS = [
  ["concrete-elconstruction", "concrete"],
  ["tattoo-aurelia", "tattoo"],
  ["medspa-luma", "medspa"],
  ["salon-lacquer-studio", "salon"],
  ["landscaping-evergreen", "landscaping"],
  ["fencing-sterling", "fencing"],
  ["roofing-falcon-clean", "roofing"],
];

async function main() {
  const donor = arg("donor", "");
  const industry = arg("industry", "");
  const picks = donor ? [[donor, industry || (DONORS.find(([d]) => d === donor) || [])[1] || "concrete"]]
    : has("all") ? DONORS : [DONORS[0]];
  const out = [];
  for (const [d, ind] of picks) {
    console.log(`\n=== ${d} (${ind}) ===`);
    const r = await proveDonor(d, ind);
    out.push(r);
    console.log(JSON.stringify(r, null, 1));
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(out, null, 2));
  console.log(`\nwrote ${path.join(OUT, "results.json")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
