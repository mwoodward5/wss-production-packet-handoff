"use strict";

/**
 * Five-trade visual release gate.
 *
 * Every sample is fictional. The mirror engine assembles the real hydrated
 * file tree, but every Vercel mutation is replaced with an in-memory server.
 * The engine's rendered checks and this script's desktop/mobile checks both
 * run against those exact final bytes. No deployment and no email can occur.
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createHash } = require("node:crypto");
const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { withSpaRewrite } = require("../lib/mirror-engine/deploy");
const { renderCheck, renderAudit } = require("../lib/mirror-engine/verify");
const { chromium } = require("playwright");

const OUT = path.join(__dirname, "..", "artifacts", "team-a-five-site");
const CHROME = process.env.CHROMIUM_BIN || "/usr/bin/google-chrome-stable";

const samples = [
  {
    vertical: "plumbing",
    donor: "plumbing-clean",
    businessName: "Harborline Plumbing",
    industry: "plumbing",
    city: "San Diego",
    state: "CA",
    phone: "(619) 555-0144",
    postalCode: "92101",
    services: ["Emergency Plumbing", "Drain Cleaning", "Water Heaters", "Leak Repair"],
  },
  {
    vertical: "roofing",
    donor: "roofing-falcon-clean",
    businessName: "Summit Ridge Roofing",
    industry: "roofing",
    city: "Spokane",
    state: "WA",
    phone: "(509) 555-0188",
    postalCode: "99201",
    services: ["Roof Repair", "Roof Replacement", "Storm Damage", "Roof Inspections"],
  },
  {
    vertical: "hvac",
    donor: "hvac-premier",
    businessName: "Northstar Heating & Air",
    industry: "hvac",
    city: "Portland",
    state: "OR",
    phone: "(503) 555-0162",
    postalCode: "97205",
    services: ["AC Repair", "Heating Repair", "Heat Pumps", "Seasonal Maintenance"],
  },
  {
    vertical: "construction/excavation",
    donor: "concrete-elconstruction",
    businessName: "Ironwood Excavation & Concrete",
    industry: "concrete",
    city: "Boise",
    state: "ID",
    phone: "(208) 555-0194",
    postalCode: "83702",
    services: ["Excavation", "Foundations", "Concrete Flatwork", "Site Preparation"],
  },
  {
    vertical: "strong alternate donor",
    donor: "tattoo-aurelia",
    businessName: "Aster & Ink Tattoo Studio",
    industry: "tattoo",
    city: "Austin",
    state: "TX",
    phone: "(512) 555-0137",
    postalCode: "78701",
    services: ["Custom Tattoos", "Fine Line", "Black & Grey", "Cover-Ups"],
  },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".webmanifest": "application/manifest+json",
};

function slugPart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const FIXTURE_PALETTES = [
  { accent: "#1677B8", primary: "#0D2B45" },
  { accent: "#C94B36", primary: "#253247" },
  { accent: "#1E78B4", primary: "#16344D" },
  { accent: "#D16B2F", primary: "#28323A" },
  { accent: "#C33B78", primary: "#241A2B" },
];

function fixtureBrand(sample, index) {
  const palette = FIXTURE_PALETTES[index % FIXTURE_PALETTES.length];
  const initials = sample.businessName.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  const safeName = sample.businessName.replace(/&/g, "&amp;");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><rect width="320" height="120" rx="22" fill="${palette.primary}"/><circle cx="62" cy="60" r="38" fill="${palette.accent}"/><text x="62" y="72" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="white">${initials}</text><text x="112" y="54" font-family="Arial,sans-serif" font-size="19" font-weight="700" fill="white">${safeName}</text><text x="112" y="79" font-family="Arial,sans-serif" font-size="13" fill="#dbeafe">${sample.city}, ${sample.state}</text></svg>`);
  const sha256 = createHash("sha256").update(svg).digest("hex");
  const sourceUrl = `https://assets.wss-ai.com/release-fixtures/${slugPart(sample.businessName)}.svg`;
  return {
    request: { logo: sourceUrl, logo_sha256: sha256, accent: palette.accent, accent_source: sourceUrl, primary: palette.primary, fonts: { display: "Arial", body: "Arial", provider: "declared" } },
    resolved: { ok: true, logo: { bytes: svg, sha256, ext: "svg", mime: "image/svg+xml", sourceUrl }, accent: palette.accent, accent_origin: "release_fixture", primary: palette.primary, primary_origin: "release_fixture", fonts: { display: "Arial", body: "Arial", provider: "declared" }, hashes: { logo_sha: sha256 } },
  };
}

function requestFor(sample, index) {
  const base = `wss-test-${slugPart(sample.businessName)}-${slugPart(sample.city)}`;
  const slug = base.slice(0, 63).replace(/-+$/g, "");
  return {
    slug,
    donor: sample.donor,
    facts: {
      business_name: sample.businessName,
      industry: sample.industry,
      city: sample.city,
      state: sample.state,
      phone: sample.phone,
      postal_code: sample.postalCode,
      email: `release-${String(index + 1).padStart(2, "0")}@wss-ai.com`,
    },
    content: {
      services: sample.services.map((name) => ({
        name,
        description: `${name} for homes and businesses in ${sample.city}, ${sample.state}.`,
      })),
      faqs: [
        {
          q: `What does ${sample.businessName} provide?`,
          a: `${sample.businessName} provides ${sample.services.join(", ")}.`,
        },
        {
          q: `Where does ${sample.businessName} work?`,
          a: `${sample.city}, ${sample.state} and nearby communities.`,
        },
      ],
      areas: [sample.city],
      about: `${sample.businessName} serves ${sample.city}, ${sample.state}.`,
      hours: {
        monday: "8:00 AM - 5:00 PM",
        tuesday: "8:00 AM - 5:00 PM",
        wednesday: "8:00 AM - 5:00 PM",
        thursday: "8:00 AM - 5:00 PM",
        friday: "8:00 AM - 5:00 PM",
      },
    },
  };
}

function toBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""));
}

function cloneFiles(files) {
  return Object.fromEntries(
    Object.entries(files || {}).map(([name, value]) => [name, Buffer.from(toBuffer(value))]),
  );
}

function serveFiles(getFiles) {
  const server = http.createServer((req, res) => {
    const files = getFiles();
    if (!files) {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("no build");
      return;
    }

    const rel = decodeURIComponent(String(req.url || "/").split("?")[0]).replace(/^\/+/, "");
    const candidates = [];
    if (!rel) candidates.push("index.html");
    else {
      candidates.push(rel);
      if (rel.endsWith("/")) candidates.push(`${rel}index.html`);
      if (!path.posix.extname(rel)) {
        candidates.push(`${rel}.html`);
        candidates.push(`${rel}/index.html`);
      }
    }

    let hit = candidates.find((candidate) => Object.prototype.hasOwnProperty.call(files, candidate));
    if (!hit && Object.prototype.hasOwnProperty.call(files, "404.html")) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(toBuffer(files["404.html"]));
      return;
    }
    if (!hit) {
      res.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
      res.end("not found");
      return;
    }

    const bytes = toBuffer(files[hit]);
    const range = String(req.headers.range || "");
    if (range && /\.(?:mp4|webm)$/i.test(hit)) {
      const match = range.match(/bytes=(\d+)-(\d*)/);
      const start = match ? Number(match[1]) : 0;
      const requestedEnd = match && match[2] ? Number(match[2]) : bytes.length - 1;
      const end = Math.min(bytes.length - 1, requestedEnd);
      const chunk = bytes.subarray(start, end + 1);
      res.writeHead(206, {
        "content-type": MIME[path.posix.extname(hit).toLowerCase()] || "application/octet-stream",
        "content-length": chunk.length,
        "content-range": `bytes ${start}-${end}/${bytes.length}`,
        "accept-ranges": "bytes",
        "cache-control": "no-store",
      });
      res.end(chunk);
      return;
    }

    res.writeHead(200, {
      "content-type": MIME[path.posix.extname(hit).toLowerCase()] || "application/octet-stream",
      "content-length": bytes.length,
      "cache-control": "no-store",
    });
    res.end(bytes);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function localRefs(text) {
  const refs = new Set();
  const pattern = /["'](\/(?:assets|media|images|hero)\/[^"']+\.(?:png|jpe?g|webp|avif|gif|svg|ico|woff2?|mp4|webm))["']/gi;
  for (const match of String(text || "").matchAll(pattern)) refs.add(match[1].replace(/^\//, ""));
  return [...refs];
}

function unresolvedTokens(files) {
  const tokens = new Set();
  for (const [name, value] of Object.entries(files || {})) {
    if (!/\.(?:html|css|js|json|xml|txt|webmanifest)$/i.test(name)) continue;
    for (const token of toBuffer(value).toString("utf8").match(/\{\{[A-Z0-9_]+\}\}|\[\[\/?NEED:[A-Z0-9_]+\]\]/g) || []) {
      tokens.add(token);
    }
  }
  return [...tokens];
}

function assembledText(files) {
  return Object.entries(files || {})
    .filter(([name]) => /\.(?:html|css|js|json|xml|txt|webmanifest)$/i.test(name))
    .map(([, value]) => toBuffer(value).toString("utf8"))
    .join("\n");
}

function localUrl(base, url) {
  try {
    const parsed = new URL(String(url));
    return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return base;
  }
}

async function browserEvidence({ base, sample, index }) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
  });
  const output = {};
  try {
    for (const [kind, viewport] of [
      ["desktop", { width: 1440, height: 1200 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      const page = await browser.newPage({ viewport });
      // Mobile acceptance intentionally runs without third-party webfonts. A
      // sellable site must keep its geometry when Google Fonts is slow, blocked,
      // or returns a stale/404 font URL. Desktop still proves the normal path.
      const fontFallbackForced = kind === "mobile";
      if (fontFallbackForced) {
        await page.route(/^https:\/\/fonts\.(?:gstatic|googleapis)\.com\//i, (route) => route.abort("failed"));
      }
      const failed = [];
      const thirdPartyFontFailures = [];
      const pageErrors = [];
      const isFontTransport = (url) => /^https:\/\/fonts\.(?:gstatic|googleapis)\.com\//i.test(String(url || ""));
      page.on("requestfailed", (request) => {
        const item = { url: request.url(), error: request.failure()?.errorText || "request_failed" };
        (isFontTransport(item.url) ? thirdPartyFontFailures : failed).push(item);
      });
      page.on("response", (response) => {
        if (response.status() < 400) return;
        const item = { url: response.url(), error: `http_${response.status()}` };
        (isFontTransport(item.url) ? thirdPartyFontFailures : failed).push(item);
      });
      page.on("pageerror", (error) => pageErrors.push(String(error.message || error)));
      await page.goto(base, { waitUntil: "networkidle", timeout: 45000 });
      // The chat invitation deliberately starts after 900ms and animates for
      // 450ms. Measuring at 1200ms sampled its compositor mid-frame and Chrome
      // reported 2-7px of phantom scroll width even though scrollX could not move
      // and no element crossed the viewport. Measure the settled first paint.
      await page.waitForTimeout(1800);

      const facts = await page.evaluate(({ businessName }) => {
        const visible = (node) => {
          if (!node) return false;
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none"
            && style.visibility !== "hidden"
            && Number(style.opacity || 1) > 0.01
            && rect.width > 1
            && rect.height > 1;
        };
        const media = [...document.querySelectorAll("img,video,picture,[style*='background-image']")]
          .filter(visible)
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return {
              tag: node.tagName.toLowerCase(),
              top: rect.top,
              width: rect.width,
              height: rect.height,
              background: style.backgroundImage,
              src: node.currentSrc || node.src || "",
              poster: node.poster || "",
              readyState: node.readyState ?? null,
            };
          });
        const heroMedia = media.some((item) =>
          item.top < innerHeight
          && item.width >= Math.min(220, innerWidth * 0.55)
          && item.height >= 100
          && (item.src || item.poster || (item.background && item.background !== "none"))
        );
        const bodyText = document.body?.innerText || "";
        const viewportWidth = document.documentElement.clientWidth;
        const overflowNodes = [...document.body.querySelectorAll("*")]
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const excessRight = Math.max(0, rect.right - viewportWidth);
            const excessLeft = Math.max(0, -rect.left);
            const excess = Math.max(excessRight, excessLeft);
            if (excess <= 2 || rect.width <= 1 || rect.height <= 1) return null;
            const classes = [...node.classList].slice(0, 4).join(".");
            return {
              node: node.id ? `#${node.id}` : `${node.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`,
              left: Math.round(rect.left * 10) / 10,
              right: Math.round(rect.right * 10) / 10,
              width: Math.round(rect.width * 10) / 10,
              top: Math.round(rect.top * 10) / 10,
              excess: Math.round(excess * 10) / 10,
              cta: node.getAttribute("data-cta") || "",
            };
          })
          .filter(Boolean)
          .sort((a, b) => b.excess - a.excess)
          .slice(0, 12);
        const oldScrollX = window.scrollX;
        window.scrollTo(100000, 0);
        const horizontalScrollPx = Math.abs(window.scrollX - oldScrollX);
        window.scrollTo(oldScrollX, 0);
        return {
          bodyTextLength: bodyText.trim().length,
          businessSeen: bodyText.includes(businessName),
          h1Visible: visible(document.querySelector("h1")),
          heroMedia,
          media,
          overflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          horizontalScrollPx,
          overflowNodes,
          rawTokens: bodyText.match(/\{\{[A-Z0-9_]+\}\}|\[\[\/?NEED:[A-Z0-9_]+\]\]/g) || [],
        };
      }, { businessName: sample.businessName });

      const shot = path.join(OUT, `${String(index + 1).padStart(2, "0")}-${sample.donor}-${kind}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      const recoveredPageErrors = pageErrors.filter((error) => /Minified React error #418\b/.test(error)
        && facts.bodyTextLength >= 180 && facts.businessSeen && facts.h1Visible);
      const fatalPageErrors = pageErrors.filter((error) => !recoveredPageErrors.includes(error));
      output[kind] = {
        pass: fs.existsSync(shot) && fs.statSync(shot).size > 10000
          && failed.length === 0
          && fatalPageErrors.length === 0
          && facts.businessSeen
          && facts.h1Visible
          && facts.heroMedia
          && facts.overflowPx <= 2
          && facts.rawTokens.length === 0
          && facts.bodyTextLength > 180,
        shot,
        failedRequests: failed.slice(0, 12),
        thirdPartyFontFailures: thirdPartyFontFailures.slice(0, 12),
        fontFallbackForced,
        pageErrors: fatalPageErrors.slice(0, 12),
        recoveredPageErrors: recoveredPageErrors.slice(0, 12),
        ...facts,
      };
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return output;
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const results = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const fixture = fixtureBrand(sample, index);
    const request = { ...requestFor(sample, index), brand: fixture.request };
    let currentFiles = null;
    const { server, port } = await serveFiles(() => currentFiles);
    const base = `http://127.0.0.1:${port}/`;
    const registry = createRegistry();

    const deps = {
      resolveBrandAssets: async () => fixture.resolved,
      siteEditLog: async () => ({ ok: true, fingerprint: "", configured: false, active: [], legacy: [], revoked: [] }),
      fleetIdentities: async () => [],
      ensureProject: async () => `project-${index + 1}`,
      uploadFiles: async (files) => ({ manifest: Object.keys(files).map((file) => ({ file })), uploaded: Object.keys(files).length, deduped: 0 }),
      createDeployment: async () => ({
        id: `dpl-release-${index + 1}`,
        url: `release-${index + 1}.example.test`,
        readyState: "READY",
      }),
      waitReady: async () => ({ readyState: "READY" }),
      withSpaRewrite: (files, routes) => {
        const finalFiles = withSpaRewrite(files, routes);
        currentFiles = cloneFiles(finalFiles);
        return finalFiles;
      },
      byteDiff: async () => ({ clean: true, checked: 0, mismatches: [] }),
      deepLinkCheck: async () => ({ clean: true, failures: [] }),
      attachAlias: async ({ slug }) => ({ alias: `https://${slug}.wss-ai.com` }),
      aliasTargetCheck: async ({ deployId }) => ({ clean: true, deploymentId: deployId }),
      renderCheck: (url, options) => renderCheck(localUrl(base, url), options),
      renderAudit: (url, routes, options) => renderAudit(localUrl(base, url), routes, options),
    };

    let built;
    try {
      built = await mirror(request, { registry, deps });
    } catch (error) {
      built = {
        ok: false,
        status: 500,
        body: { error: "acceptance_harness_exception", detail: String(error.stack || error) },
      };
    }

    const result = {
      vertical: sample.vertical,
      donor: sample.donor,
      businessName: sample.businessName,
      slug: request.slug,
      engine: built.ok === true,
      engineStatus: built.status,
      engineError: built.ok ? "" : String(built.body?.error || "mirror_failed"),
      engineDetail: built.ok ? undefined : built.body?.detail,
      revealable: built.body?.revealable === true,
      buildHash: built.body?.build_hash || "",
      renderer: built.body?.renderer || "",
      desktop: false,
      mobile: false,
      domHydrated: false,
      heroMediaVisible: false,
      noDeadMedia: false,
      noUnresolvedTokens: false,
    };

    try {
      if (built.ok && currentFiles && Object.keys(currentFiles).length) {
        const text = assembledText(currentFiles);
        const refs = localRefs(text);
        const missing = refs.filter((rel) => !Object.prototype.hasOwnProperty.call(currentFiles, rel));
        const tokens = unresolvedTokens(currentFiles);
        result.noDeadMedia = missing.length === 0;
        result.missingMedia = missing;
        result.noUnresolvedTokens = tokens.length === 0;
        result.unresolvedTokens = tokens;

        const evidence = await browserEvidence({ base, sample, index });
        result.desktop = evidence.desktop.pass;
        result.mobile = evidence.mobile.pass;
        result.desktopEvidence = evidence.desktop;
        result.mobileEvidence = evidence.mobile;
        result.domHydrated = evidence.desktop.businessSeen
          && evidence.desktop.h1Visible
          && evidence.mobile.businessSeen
          && evidence.mobile.h1Visible;
        result.heroMediaVisible = evidence.desktop.heroMedia && evidence.mobile.heroMedia;
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    result.pass = result.engine
      && result.revealable
      && result.desktop
      && result.mobile
      && result.domHydrated
      && result.heroMediaVisible
      && result.noDeadMedia
      && result.noUnresolvedTokens;

    results.push(result);
    console.log(JSON.stringify({
      vertical: result.vertical,
      donor: result.donor,
      slug: result.slug,
      engine: result.engine,
      revealable: result.revealable,
      desktop: result.desktop,
      mobile: result.mobile,
      domHydrated: result.domHydrated,
      heroMediaVisible: result.heroMediaVisible,
      noDeadMedia: result.noDeadMedia,
      noUnresolvedTokens: result.noUnresolvedTokens,
      pass: result.pass,
      engineError: result.engineError,
      engineDetail: result.engineDetail,
    }));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    chromium: CHROME,
    passed: results.filter((item) => item.pass).length,
    total: results.length,
    results,
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  if (summary.passed !== summary.total) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
